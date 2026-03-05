# Reading Progress Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Save reading progress (current page) to the server so it persists across browsers/devices, and auto-restore it when reopening a PDF.

**Architecture:** Add a JSON-file-backed progress store on the server (same pattern as `pdf-cache.js`), expose GET/PUT API endpoints for reading progress per PDF, and wire the frontend viewer to save on page change (debounced) and restore on load.

**Tech Stack:** Express (existing), Node.js fs (existing pattern), vanilla JS frontend (existing)

---

### Task 1: Server-side progress store module

**Files:**
- Create: `server/progress-store.js`

**Step 1: Create the progress store module**

This follows the exact same JSON-file persistence pattern as `server/pdf-cache.js`. The store keeps a map of `pdfId -> { page, updatedAt }` in memory, backed by a JSON file.

```javascript
import * as fs from 'node:fs'
import * as path from 'node:path'

const PROGRESS_FILENAME = 'reading-progress.json'
const STORE_VERSION = 1

/** @type {Map<string, { page: number, updatedAt: number }>} */
const progressMap = new Map()

let progressFilePath = null

export function getProgressFilePath() {
  if (!progressFilePath) {
    progressFilePath = process.env.PROGRESS_PATH || path.resolve(PROGRESS_FILENAME)
  }
  return progressFilePath
}

export function loadProgress() {
  const filePath = getProgressFilePath()
  try {
    if (!fs.existsSync(filePath)) return
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (data.version !== STORE_VERSION) return
    
    progressMap.clear()
    for (const [id, entry] of Object.entries(data.entries || {})) {
      progressMap.set(id, entry)
    }
    console.log(`Loaded reading progress: ${progressMap.size} entries`)
  } catch (err) {
    console.error('Failed to load reading progress:', err.message)
  }
}

function saveProgress() {
  const filePath = getProgressFilePath()
  const tmpPath = `${filePath}.tmp`
  try {
    const data = {
      version: STORE_VERSION,
      entries: Object.fromEntries(progressMap)
    }
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    console.error('Failed to save reading progress:', err.message)
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {}
  }
}

export function getProgress(pdfId) {
  return progressMap.get(pdfId) || null
}

export function setProgress(pdfId, page) {
  progressMap.set(pdfId, { page, updatedAt: Date.now() })
  saveProgress()
}

export function getAllProgress() {
  return Object.fromEntries(progressMap)
}
```

**Step 2: Verify no syntax errors**

Run: `node -c server/progress-store.js`
Expected: no output (success)

**Step 3: Commit**

```bash
git add server/progress-store.js
git commit -m "feat: add server-side reading progress store"
```

---

### Task 2: API endpoints for reading progress

**Files:**
- Modify: `server/index.js` — add `GET /api/progress/:id` and `PUT /api/progress/:id` endpoints, call `loadProgress()` at startup

**Step 1: Add the endpoints**

In `server/index.js`, add these imports and endpoints:

Import at top (after existing imports):
```javascript
import { loadProgress, getProgress, setProgress, getAllProgress } from './progress-store.js'
```

Add `express.json()` middleware (needed for PUT body parsing) after `express.static`:
```javascript
app.use(express.json())
```

Add endpoints before the `app.get('/view/{*splat}', ...)` route:

```javascript
app.get('/api/progress/:id', (req, res) => {
  const { id } = req.params
  const progress = getProgress(id)
  if (!progress) {
    return res.json({ page: null })
  }
  res.json({ page: progress.page, updatedAt: progress.updatedAt })
})

app.put('/api/progress/:id', (req, res) => {
  const { id } = req.params
  const { page } = req.body
  
  if (typeof page !== 'number' || page < 1 || !Number.isInteger(page)) {
    return res.status(400).json({ error: 'Invalid page number' })
  }
  
  setProgress(id, page)
  res.json({ ok: true })
})

app.get('/api/progress', (req, res) => {
  res.json(getAllProgress())
})
```

Add `loadProgress()` call before `startPeriodicScan()`:
```javascript
loadProgress()
```

**Step 2: Verify server starts**

Run: `node server/index.js` (then Ctrl+C)
Expected: Server starts without errors

**Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: add reading progress API endpoints"
```

---

### Task 3: Frontend — save progress on page change (debounced)

**Files:**
- Modify: `public/js/viewer-app.js` — add debounced save to server on page change, and restore on load

**Step 1: Update viewer-app.js**

Replace the entire `viewer-app.js` with the updated version that:
1. On load: fetches `/api/progress/:id` and navigates to saved page
2. On page change: debounced PUT to `/api/progress/:id`
3. Keeps existing localStorage recents behavior intact

Key changes to `main()` function:

After `addRecent(...)`, before the pageChange listener:
```javascript
// Restore reading progress from server
try {
  const progressRes = await fetch(`/api/progress/${pdfId}`)
  if (progressRes.ok) {
    const progress = await progressRes.json()
    if (progress.page && progress.page > 1 && progress.page <= info.pageCount) {
      viewer.navigateToPage(progress.page)
    }
  }
} catch (err) {
  console.error('Failed to restore reading progress:', err)
}
```

Add a debounced save function at module level:
```javascript
function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

function saveProgressToServer(pdfId, page) {
  fetch(`/api/progress/${pdfId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page })
  }).catch(err => console.error('Failed to save progress:', err))
}

const debouncedSaveProgress = debounce(saveProgressToServer, 1000)
```

Update the pageChange listener to also save remotely:
```javascript
container.addEventListener('viewer:pageChange', (e) => {
  updateRecentPage(pdfId, e.detail.page)
  debouncedSaveProgress(pdfId, e.detail.page)
})
```

Also add scroll-based progress tracking for vertical mode (since `viewer:pageChange` only fires in horizontal mode). Add after controls.init():
```javascript
const viewport = document.getElementById('viewport')
let lastSavedPage = 0
viewport.addEventListener('scroll', () => {
  const currentPage = viewer.getCurrentPage()
  if (currentPage !== lastSavedPage) {
    lastSavedPage = currentPage
    updateRecentPage(pdfId, currentPage)
    debouncedSaveProgress(pdfId, currentPage)
  }
}, { passive: true })
```

**Step 2: Verify no syntax errors**

Open browser, navigate to a PDF, verify no console errors.

**Step 3: Commit**

```bash
git add public/js/viewer-app.js
git commit -m "feat: save and restore reading progress from server"
```

---

### Task 4: Show reading progress in recent files list

**Files:**
- Modify: `public/js/list.js` — show "Page X" badge on recent items that have server-side progress

**Step 1: Fetch progress data on list page load**

In `list.js`, add a function to fetch all progress and enrich recents display:

```javascript
let progressData = {}

async function fetchAllProgress() {
  try {
    const res = await fetch('/api/progress')
    if (res.ok) {
      progressData = await res.json()
    }
  } catch {}
}
```

Call it in `init()` and after that call `renderRecents()`:
```javascript
await fetchAllProgress()
renderRecents()
```

In `renderRecents()`, add progress info to the meta display:
```javascript
const progress = progressData[item.id]
const progressText = progress?.page > 1 ? ` · Page ${progress.page}` : ''
// Append to timeText
const timeText = (item.lastOpenedAt ? formatTimeAgo(item.lastOpenedAt) : (isItemPinned ? 'Pinned' : '')) + progressText
```

**Step 2: Verify list page shows progress**

Open browser, verify recent items show "Page X" when progress exists.

**Step 3: Commit**

```bash
git add public/js/list.js
git commit -m "feat: show reading progress on recent files list"
```

---

### Task 5: Add reading-progress.json to .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Add entry**

Append `reading-progress.json` to `.gitignore`.

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore reading progress data file"
```
