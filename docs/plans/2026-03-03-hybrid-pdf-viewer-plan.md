# Hybrid PDF Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a PoC hybrid PDF viewer where Node.js server renders PDF pages to PNG images via MuPDF WASM, and the browser displays them on Canvas with zoom/pan/page navigation.

**Architecture:** Express server with MuPDF WASM rendering engine + LRU cache → REST API serving page images → Vanilla JS client with Canvas per page + @panzoom/panzoom for interactions + IntersectionObserver for lazy loading.

**Tech Stack:** Node.js, Express, mupdf (WASM), @panzoom/panzoom, vanilla JS, HTML5 Canvas

**Design Doc:** `docs/plans/2026-03-03-hybrid-pdf-viewer-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `server/index.js` (placeholder)
- Create: `public/index.html` (placeholder)
- Create: `pdfs/` directory

**Step 1: Initialize npm project**

```bash
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install express mupdf
npm install @panzoom/panzoom
```

**Step 3: Create directory structure**

```bash
mkdir -p server public/css public/js pdfs
```

**Step 4: Add a sample PDF for testing**

Place any multi-page PDF file at `pdfs/sample.pdf`. If you don't have one, download a public domain PDF:

```bash
curl -L "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" -o pdfs/sample.pdf
```

**Step 5: Update package.json scripts**

Add to `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js"
  }
}
```

**Step 6: Commit**

```bash
git init
echo "node_modules/" > .gitignore
echo "pdfs/*.pdf" >> .gitignore
git add -A
git commit -m "chore: scaffold project with dependencies"
```

---

### Task 2: LRU Cache Module

**Files:**
- Create: `server/cache.js`
- Test manually via Node REPL

**Step 1: Implement LRU cache**

Create `server/cache.js`:

```javascript
export class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize
    this.cache = new Map()
  }

  get(key) {
    if (!this.cache.has(key)) return undefined
    // Move to end (most recently used)
    const value = this.cache.get(key)
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Delete the least recently used (first entry)
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }

  has(key) {
    return this.cache.has(key)
  }

  get size() {
    return this.cache.size
  }

  clear() {
    this.cache.clear()
  }
}
```

**Step 2: Verify it works**

```bash
node -e "
import { LRUCache } from './server/cache.js';
const c = new LRUCache(2);
c.set('a', 1); c.set('b', 2); c.set('c', 3);
console.log('a:', c.get('a'), '(should be undefined)');
console.log('b:', c.get('b'), '(should be 2)');
console.log('c:', c.get('c'), '(should be 3)');
console.log('size:', c.size, '(should be 2)');
"
```

Expected: `a` is evicted, `b` and `c` remain, size is 2.

**Step 3: Commit**

```bash
git add server/cache.js
git commit -m "feat: add LRU cache module"
```

---

### Task 3: PDF Renderer Module (MuPDF Wrapper)

**Files:**
- Create: `server/pdf-renderer.js`

**Step 1: Implement the renderer**

Create `server/pdf-renderer.js`:

```javascript
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as mupdf from 'mupdf'
import { LRUCache } from './cache.js'

const PDF_DIR = path.resolve('pdfs')
const imageCache = new LRUCache(100)
const docCache = new Map() // Cache opened documents

function getDocument(pdfId) {
  if (docCache.has(pdfId)) {
    return docCache.get(pdfId)
  }

  const filePath = path.join(PDF_DIR, `${pdfId}.pdf`)
  if (!fs.existsSync(filePath)) {
    return null
  }

  const buffer = fs.readFileSync(filePath)
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  docCache.set(pdfId, doc)
  return doc
}

export function getPdfInfo(pdfId) {
  const doc = getDocument(pdfId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pages = []

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i)
    const bounds = page.getBounds() // [x0, y0, x1, y1]
    pages.push({
      index: i,
      width: Math.round(bounds[2] - bounds[0]),
      height: Math.round(bounds[3] - bounds[1]),
    })
  }

  return {
    id: pdfId,
    pageCount,
    pages,
  }
}

export function renderPage(pdfId, pageNum, scale = 1.5) {
  // Validate
  if (scale < 0.5) scale = 0.5
  if (scale > 4.0) scale = 4.0

  // Check cache
  const cacheKey = `${pdfId}:${pageNum}:${scale}`
  const cached = imageCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const doc = getDocument(pdfId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pageIndex = pageNum - 1 // API uses 1-based, MuPDF uses 0-based
  if (pageIndex < 0 || pageIndex >= pageCount) return null

  const page = doc.loadPage(pageIndex)
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB
  )
  const pngBuffer = pixmap.asPNG()

  // Cache the result
  imageCache.set(cacheKey, Buffer.from(pngBuffer))

  return Buffer.from(pngBuffer)
}
```

**Step 2: Verify MuPDF renders correctly**

```bash
node -e "
import { getPdfInfo, renderPage } from './server/pdf-renderer.js';
import * as fs from 'node:fs';
const info = getPdfInfo('sample');
console.log('PDF Info:', JSON.stringify(info, null, 2));
if (info) {
  const png = renderPage('sample', 1, 1.5);
  if (png) {
    fs.writeFileSync('/tmp/test-page.png', png);
    console.log('Rendered page 1 to /tmp/test-page.png, size:', png.length, 'bytes');
  } else {
    console.log('ERROR: renderPage returned null');
  }
} else {
  console.log('ERROR: No PDF found. Place a PDF at pdfs/sample.pdf');
}
"
```

Expected: PDF info printed with page count and dimensions. PNG file written to `/tmp/test-page.png`. Visually verify the PNG is correct.

**Step 3: Commit**

```bash
git add server/pdf-renderer.js
git commit -m "feat: add MuPDF PDF renderer with caching"
```

---

### Task 4: Express Server with REST API

**Files:**
- Create: `server/index.js`

**Step 1: Implement the server**

Create `server/index.js`:

```javascript
import express from 'express'
import path from 'node:path'
import { getPdfInfo, renderPage } from './pdf-renderer.js'

const app = express()
const PORT = process.env.PORT || 3000

// Serve static files from public/
app.use(express.static(path.resolve('public')))

// API: Get PDF document info
app.get('/api/pdf/:id/info', (req, res) => {
  const { id } = req.params
  const info = getPdfInfo(id)

  if (!info) {
    return res.status(404).json({ error: `PDF "${id}" not found` })
  }

  res.json(info)
})

// API: Render a specific page as PNG
app.get('/api/pdf/:id/page/:pageNum', (req, res) => {
  const { id, pageNum } = req.params
  const scale = parseFloat(req.query.scale) || 1.5
  const page = parseInt(pageNum, 10)

  if (isNaN(page) || page < 1) {
    return res.status(400).json({ error: 'Invalid page number' })
  }

  const png = renderPage(id, page, scale)

  if (!png) {
    return res.status(404).json({ error: `Page ${page} not found for PDF "${id}"` })
  }

  res.set({
    'Content-Type': 'image/png',
    'Content-Length': png.length,
    'Cache-Control': 'public, max-age=3600',
  })
  res.send(png)
})

app.listen(PORT, () => {
  console.log(`PDF Viewer server running at http://localhost:${PORT}`)
})
```

**Step 2: Test the API**

```bash
node server/index.js &
sleep 2

# Test info endpoint
curl -s http://localhost:3000/api/pdf/sample/info | head -c 500
echo ""

# Test page render endpoint
curl -s -o /tmp/api-test-page.png http://localhost:3000/api/pdf/sample/page/1?scale=1.5
ls -la /tmp/api-test-page.png

# Cleanup
kill %1
```

Expected: Info endpoint returns JSON with page count. Page endpoint returns PNG image.

**Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: add Express server with PDF info and page render API"
```

---

### Task 5: Client HTML + CSS

**Files:**
- Create: `public/index.html`
- Create: `public/css/style.css`

**Step 1: Create the HTML**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF Viewer</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div id="app">
    <div id="toolbar">
      <div id="toolbar-left">
        <button id="zoom-out" title="Zoom Out">−</button>
        <span id="zoom-level">100%</span>
        <button id="zoom-in" title="Zoom In">+</button>
        <button id="fit-width" title="Fit Width">Fit W</button>
        <button id="fit-page" title="Fit Page">Fit P</button>
      </div>
      <div id="toolbar-center">
        <span id="page-indicator">Loading...</span>
      </div>
      <div id="toolbar-right">
        <button id="reset" title="Reset View">Reset</button>
      </div>
    </div>

    <div id="viewport">
      <div id="page-container">
        <!-- Pages will be dynamically inserted here -->
      </div>
    </div>
  </div>

  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

**Step 2: Create the CSS**

Create `public/css/style.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #525659;
}

#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* Toolbar */
#toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #323639;
  color: #fff;
  border-bottom: 1px solid #1a1a1a;
  flex-shrink: 0;
  z-index: 10;
}

#toolbar button {
  background: #4a4d50;
  border: 1px solid #5a5d60;
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

#toolbar button:hover {
  background: #5a5d60;
}

#toolbar button:active {
  background: #3a3d40;
}

#toolbar-left, #toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

#zoom-level {
  min-width: 48px;
  text-align: center;
  font-size: 13px;
  color: #ccc;
}

#page-indicator {
  font-size: 13px;
  color: #ccc;
}

/* Viewport */
#viewport {
  flex: 1;
  overflow: auto;
  position: relative;
}

#page-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
  gap: 12px;
  min-height: 100%;
}

/* Page wrappers */
.page-wrapper {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  position: relative;
  /* Width/height set dynamically via JS */
}

.page-wrapper canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* Loading state */
.page-wrapper.loading::after {
  content: 'Loading...';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #999;
  font-size: 14px;
}
```

**Step 3: Verify static serving**

```bash
node server/index.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
kill %1
```

Expected: HTTP 200 response.

**Step 4: Commit**

```bash
git add public/index.html public/css/style.css
git commit -m "feat: add client HTML and CSS for PDF viewer"
```

---

### Task 6: Client Viewer Module (Canvas + Lazy Loading)

**Files:**
- Create: `public/js/viewer.js`

**Step 1: Implement the viewer**

Create `public/js/viewer.js`:

```javascript
/**
 * PDF Viewer - handles page layout, canvas rendering, and lazy loading.
 */

const DEFAULT_SCALE = 1.5
const DISPLAY_WIDTH = 800 // CSS pixels for page display width

export class PdfViewer {
  constructor(containerId, viewportId) {
    this.container = document.getElementById(containerId)
    this.viewport = document.getElementById(viewportId)
    this.pdfId = null
    this.pdfInfo = null
    this.serverScale = DEFAULT_SCALE
    this.renderedPages = new Set()
    this.observer = null
  }

  async load(pdfId) {
    this.pdfId = pdfId
    this.renderedPages.clear()

    // Fetch PDF info
    const res = await fetch(`/api/pdf/${pdfId}/info`)
    if (!res.ok) throw new Error(`Failed to load PDF: ${res.statusText}`)
    this.pdfInfo = await res.json()

    // Create page placeholders
    this.container.innerHTML = ''
    this.pdfInfo.pages.forEach((page, i) => {
      const wrapper = this.createPageWrapper(page, i + 1)
      this.container.appendChild(wrapper)
    })

    // Setup lazy loading
    this.setupIntersectionObserver()

    return this.pdfInfo
  }

  createPageWrapper(pageInfo, pageNum) {
    const wrapper = document.createElement('div')
    wrapper.className = 'page-wrapper loading'
    wrapper.dataset.page = pageNum

    // Calculate display dimensions maintaining aspect ratio
    const aspectRatio = pageInfo.height / pageInfo.width
    const displayWidth = DISPLAY_WIDTH
    const displayHeight = Math.round(displayWidth * aspectRatio)

    wrapper.style.width = `${displayWidth}px`
    wrapper.style.height = `${displayHeight}px`

    const canvas = document.createElement('canvas')
    canvas.className = 'page-canvas'
    this.setupCanvas(canvas, displayWidth, displayHeight)

    wrapper.appendChild(canvas)
    return wrapper
  }

  setupCanvas(canvas, width, height) {
    const dpr = window.devicePixelRatio || 1
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }

  setupIntersectionObserver() {
    if (this.observer) {
      this.observer.disconnect()
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.page, 10)
            if (!this.renderedPages.has(pageNum)) {
              this.renderPage(entry.target, pageNum)
            }
          }
        })
      },
      {
        root: this.viewport,
        rootMargin: '300px', // Pre-load 300px before visible
      }
    )

    this.container.querySelectorAll('.page-wrapper').forEach((wrapper) => {
      this.observer.observe(wrapper)
    })
  }

  async renderPage(wrapper, pageNum) {
    this.renderedPages.add(pageNum)
    const canvas = wrapper.querySelector('canvas')
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    try {
      const url = `/api/pdf/${this.pdfId}/page/${pageNum}?scale=${this.serverScale}`
      const img = new Image()
      img.src = url

      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })

      // Draw image scaled for retina
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      wrapper.classList.remove('loading')
    } catch (err) {
      console.error(`Failed to render page ${pageNum}:`, err)
    }
  }

  /**
   * Re-render all visible pages at a new server scale.
   */
  reRenderAll(newScale) {
    this.serverScale = newScale
    this.renderedPages.clear()
    // Re-observe to trigger rendering of visible pages
    this.setupIntersectionObserver()
  }

  /**
   * Get the currently most-visible page number.
   */
  getCurrentPage() {
    const wrappers = this.container.querySelectorAll('.page-wrapper')
    const viewportRect = this.viewport.getBoundingClientRect()
    const viewportCenter = viewportRect.top + viewportRect.height / 2

    let closestPage = 1
    let closestDistance = Infinity

    wrappers.forEach((wrapper) => {
      const rect = wrapper.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      const distance = Math.abs(center - viewportCenter)
      if (distance < closestDistance) {
        closestDistance = distance
        closestPage = parseInt(wrapper.dataset.page, 10)
      }
    })

    return closestPage
  }

  get pageCount() {
    return this.pdfInfo ? this.pdfInfo.pageCount : 0
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect()
    }
    this.container.innerHTML = ''
    this.renderedPages.clear()
  }
}
```

**Step 2: Commit**

```bash
git add public/js/viewer.js
git commit -m "feat: add PDF viewer module with canvas rendering and lazy loading"
```

---

### Task 7: Client Controls Module (Zoom/Pan/Navigation)

**Files:**
- Create: `public/js/controls.js`

**Step 1: Implement controls**

Create `public/js/controls.js`:

```javascript
/**
 * Controls - toolbar interactions: zoom, pan, page navigation.
 * Integrates @panzoom/panzoom with the viewer.
 */

import Panzoom from '/js/vendor/panzoom.min.js'

export class ViewerControls {
  constructor(viewer) {
    this.viewer = viewer
    this.panzoom = null
    this.currentZoom = 1.0

    // DOM elements
    this.viewport = document.getElementById('viewport')
    this.container = document.getElementById('page-container')
    this.zoomInBtn = document.getElementById('zoom-in')
    this.zoomOutBtn = document.getElementById('zoom-out')
    this.fitWidthBtn = document.getElementById('fit-width')
    this.fitPageBtn = document.getElementById('fit-page')
    this.resetBtn = document.getElementById('reset')
    this.zoomLevel = document.getElementById('zoom-level')
    this.pageIndicator = document.getElementById('page-indicator')
  }

  init() {
    this.setupPanzoom()
    this.bindToolbarEvents()
    this.bindScrollEvents()
    this.updateZoomDisplay()
  }

  setupPanzoom() {
    this.panzoom = Panzoom(this.container, {
      maxScale: 5,
      minScale: 0.5,
      step: 0.15,
      contain: 'inside',
      cursor: 'grab',
      animate: true,
      duration: 200,
    })

    // Mouse wheel zoom
    this.viewport.addEventListener('wheel', (e) => {
      // Only zoom if Ctrl key is held, otherwise allow normal scroll
      if (e.ctrlKey) {
        e.preventDefault()
        this.panzoom.zoomWithWheel(e)
        this.onZoomChange()
      }
    }, { passive: false })

    // Track zoom changes via panzoom events
    this.container.addEventListener('panzoomchange', () => {
      this.onZoomChange()
    })
  }

  bindToolbarEvents() {
    this.zoomInBtn.addEventListener('click', () => {
      this.panzoom.zoomIn()
      this.onZoomChange()
    })

    this.zoomOutBtn.addEventListener('click', () => {
      this.panzoom.zoomOut()
      this.onZoomChange()
    })

    this.fitWidthBtn.addEventListener('click', () => {
      const viewportWidth = this.viewport.clientWidth - 40 // padding
      const containerWidth = this.container.scrollWidth
      const targetScale = viewportWidth / containerWidth
      this.panzoom.zoom(targetScale, { animate: true })
      this.panzoom.pan(0, 0, { animate: true })
      this.onZoomChange()
    })

    this.fitPageBtn.addEventListener('click', () => {
      this.panzoom.reset({ animate: true })
      this.onZoomChange()
    })

    this.resetBtn.addEventListener('click', () => {
      this.panzoom.reset({ animate: true })
      this.onZoomChange()
    })
  }

  bindScrollEvents() {
    // Update page indicator on scroll
    this.viewport.addEventListener('scroll', () => {
      this.updatePageIndicator()
    })
  }

  onZoomChange() {
    this.currentZoom = this.panzoom.getScale()
    this.updateZoomDisplay()
  }

  updateZoomDisplay() {
    const percentage = Math.round(this.currentZoom * 100)
    this.zoomLevel.textContent = `${percentage}%`
  }

  updatePageIndicator() {
    const currentPage = this.viewer.getCurrentPage()
    const totalPages = this.viewer.pageCount
    this.pageIndicator.textContent = `${currentPage} / ${totalPages}`
  }

  destroy() {
    if (this.panzoom) {
      this.panzoom.destroy()
    }
  }
}
```

**Step 2: Bundle panzoom for browser use**

Since we're using vanilla JS without a bundler, we need the panzoom library available as a browser module. Create a vendor copy:

```bash
mkdir -p public/js/vendor
cp node_modules/@panzoom/panzoom/dist/panzoom.min.js public/js/vendor/
```

> **Note:** In the import, we reference `/js/vendor/panzoom.min.js`. If panzoom's dist doesn't export as ESM, we may need to adjust the import strategy. Check the dist file format and adapt — either use a `<script>` tag to load it as a global, or use the ESM build if available. See Task 9 for integration testing.

**Step 3: Commit**

```bash
git add public/js/controls.js public/js/vendor/
git commit -m "feat: add viewer controls with panzoom integration"
```

---

### Task 8: Client App Entry Point

**Files:**
- Create: `public/js/app.js`

**Step 1: Implement main app**

Create `public/js/app.js`:

```javascript
/**
 * App entry point — initializes viewer and controls.
 */

import { PdfViewer } from './viewer.js'
import { ViewerControls } from './controls.js'

const PDF_ID = 'sample' // Hardcoded for PoC

async function main() {
  const viewer = new PdfViewer('page-container', 'viewport')
  const controls = new ViewerControls(viewer)

  try {
    const info = await viewer.load(PDF_ID)
    console.log(`Loaded PDF: ${info.pageCount} pages`)

    controls.init()
    controls.updatePageIndicator()
  } catch (err) {
    console.error('Failed to initialize PDF viewer:', err)
    document.getElementById('page-indicator').textContent = 'Error loading PDF'
  }
}

main()
```

**Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add app entry point wiring viewer and controls"
```

---

### Task 9: Integration Test — End-to-End Verification

**Files:**
- Modify: various files as needed to fix integration issues

**Step 1: Start the server**

```bash
npm run dev
```

**Step 2: Open browser and verify**

Navigate to `http://localhost:3000` and check:

1. [ ] Page loads without console errors
2. [ ] PDF info is fetched (check Network tab: `GET /api/pdf/sample/info`)
3. [ ] Page placeholders appear with correct aspect ratios
4. [ ] First visible pages render (check Network tab: `GET /api/pdf/sample/page/1?scale=1.5`)
5. [ ] Canvas shows the rendered PDF page image
6. [ ] Scrolling down triggers lazy loading of additional pages
7. [ ] Page indicator updates on scroll (`1 / N`)
8. [ ] Zoom in/out buttons work
9. [ ] Ctrl+wheel zoom works
10. [ ] Fit Width / Fit Page / Reset buttons work
11. [ ] Drag to pan works when zoomed in

**Step 3: Fix any integration issues**

Common issues to watch for:
- Panzoom ESM import may not work directly in browser → may need to load via `<script>` tag and use `window.Panzoom`
- CORS or MIME type issues with static serving
- Canvas sizing / retina rendering issues
- IntersectionObserver root margin not triggering early enough

**Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve integration issues from end-to-end testing"
```

---

### Task 10: Polish and Final Verification

**Files:**
- Modify: `public/css/style.css` (if needed)
- Modify: `public/js/viewer.js` (if needed)

**Step 1: Verify rendering quality**

- Open a multi-page PDF with text, images, and vector graphics
- Check that rendering at scale=1.5 is crisp on regular displays
- Check that rendering is crisp on retina displays (if available)
- Verify that zooming in doesn't cause excessive blurriness

**Step 2: Verify performance**

- Check server console for rendering times
- Verify LRU cache is working (second request for same page should be instant)
- Scroll through a 10+ page PDF smoothly

**Step 3: Verify security**

- Confirm there is NO endpoint that serves the raw PDF file
- Try accessing `http://localhost:3000/pdfs/sample.pdf` → should 404
- Only `/api/pdf/:id/info` and `/api/pdf/:id/page/:n` endpoints exist

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete hybrid PDF viewer PoC"
```

---

## Summary

| Task | Description | Key Output |
|------|-------------|------------|
| 1 | Project scaffolding | package.json, directories, dependencies |
| 2 | LRU cache module | `server/cache.js` |
| 3 | PDF renderer (MuPDF wrapper) | `server/pdf-renderer.js` |
| 4 | Express server + REST API | `server/index.js` |
| 5 | Client HTML + CSS | `public/index.html`, `public/css/style.css` |
| 6 | Client viewer module | `public/js/viewer.js` |
| 7 | Client controls module | `public/js/controls.js` + vendor panzoom |
| 8 | App entry point | `public/js/app.js` |
| 9 | Integration testing | Fix any issues found |
| 10 | Polish and final verification | Production-quality PoC |
