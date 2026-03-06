# Text Format Direct HTML Rendering

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render MD, TXT, HTML/XHTML files as native HTML in the browser instead of server-rendered PNG images, with lazy-loaded pagination for large files.

**Architecture:** Add a parallel rendering path: server exposes a `/content` API returning sanitized HTML per page; client detects text formats via `info.format` and renders `<div>` content instead of `<canvas>`. TXT files are split into fixed-line chunks server-side. Existing pagination, progress, zoom, and display mode features remain fully functional.

**Tech Stack:** Express 5 routes, sanitize-html, markdown-it (existing deps), no new dependencies.

---

## Task 1: Add `.txt` to Supported Formats

**Files:**
- Modify: `server/formats.js:2-5`

**Step 1: Add .txt extension**

In `server/formats.js`, add `.txt` to `SUPPORTED_EXTENSIONS`:

```js
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.epub', '.xps', '.oxps', '.cbz', '.fb2',
  '.mobi', '.cbt', '.html', '.xhtml', '.md', '.txt'
])
```

**Step 2: Verify server starts**

Run: `npm run dev`
Expected: Server starts without error. A rescan should now pick up `.txt` files.

**Step 3: Commit**

```bash
git add server/formats.js
git commit -m "feat: add .txt to supported ebook formats"
```

---

## Task 2: Add TXT/HTML Preprocessing for Direct Rendering

**Files:**
- Modify: `server/html-sanitizer.js`

This task adds functions for converting text content into sanitized HTML suitable for direct browser rendering (not MuPDF). These are separate from the existing `preprocessBuffer` which prepares content for MuPDF.

**Step 1: Add `txtToHtml` and `txtToPages` functions**

At the bottom of `server/html-sanitizer.js`, before the closing of the file, add:

```js
const TXT_LINES_PER_PAGE = 200

/**
 * Check if a file extension is a direct-render text format (bypasses MuPDF)
 * @param {string} ext - File extension
 * @returns {boolean}
 */
export function isDirectRenderFormat(ext) {
  return ['.html', '.xhtml', '.md', '.txt'].includes(ext.toLowerCase())
}

/**
 * Convert raw file buffer to an array of sanitized HTML page strings for direct browser rendering.
 * - TXT: split by lines into chunks, wrap in <pre>
 * - MD: convert to HTML via markdown-it, return as single page
 * - HTML/XHTML: sanitize, return as single page
 * @param {Buffer} buffer - Raw file content
 * @param {string} ext - File extension (e.g. '.txt', '.md', '.html')
 * @returns {{ pages: string[], totalLines?: number }}
 */
export function bufferToHtmlPages(buffer, ext) {
  const lowerExt = ext.toLowerCase()

  if (lowerExt === '.txt') {
    const text = buffer.toString('utf-8')
    const lines = text.split(/\r?\n/)
    const pages = []

    for (let i = 0; i < lines.length; i += TXT_LINES_PER_PAGE) {
      const chunk = lines.slice(i, i + TXT_LINES_PER_PAGE)
      const escaped = chunk
        .map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .join('\n')
      pages.push(`<pre class="txt-content">${escaped}</pre>`)
    }

    if (pages.length === 0) {
      pages.push('<pre class="txt-content"></pre>')
    }

    return { pages, totalLines: lines.length }
  }

  if (lowerExt === '.md') {
    const markdown = buffer.toString('utf-8')
    const html = markdownToHtml(markdown)
    return { pages: [html] }
  }

  // .html, .xhtml
  const raw = buffer.toString('utf-8')
  const sanitized = sanitizeEbookHtml(raw)
  return { pages: [sanitized] }
}
```

**Step 2: Verify server starts**

Run: `npm run dev`
Expected: Server starts without error.

**Step 3: Commit**

```bash
git add server/html-sanitizer.js
git commit -m "feat: add bufferToHtmlPages for direct text rendering"
```

---

## Task 3: Add Content API Route & Extend Info Route

**Files:**
- Modify: `server/index.js`
- Modify: `server/ebook-renderer.js`

This task adds:
1. A `format` field to the `/info` response so the client knows which rendering path to use.
2. A new `/content` API that returns sanitized HTML pages for text formats.

**Step 1: Add format detection to `getEbookInfo` in `ebook-renderer.js`**

Modify `server/ebook-renderer.js` to import `isDirectRenderFormat` and include the format in info response.

Add to imports at top:
```js
import { preprocessBuffer, isReflowable, isDirectRenderFormat } from './html-sanitizer.js'
```

Modify `getEbookInfo` to include format:
```js
export function getEbookInfo(ebookId) {
  const entry = getEbookById(ebookId)
  if (!entry) return null

  const ext = path.extname(entry.filePath).toLowerCase()
  const isText = isDirectRenderFormat(ext)

  // For direct-render text formats, we don't need MuPDF
  if (isText) {
    const rawBuffer = fs.readFileSync(entry.filePath)
    const { bufferToHtmlPages } = await import('./html-sanitizer.js')
    // ... no, we need sync. Let's just import at top.
  }

  const doc = getDocument(ebookId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pages = []

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i)
    const bounds = page.getBounds()
    pages.push({
      index: i,
      width: Math.round(bounds[2] - bounds[0]),
      height: Math.round(bounds[3] - bounds[1]),
    })
  }

  return {
    id: ebookId,
    filename: entry?.name,
    pageCount,
    pages,
    format: isText ? 'text' : 'image',
  }
}
```

Wait — for text formats we want to **bypass MuPDF entirely**. The whole point is to NOT run MuPDF on these. So we need a separate path. Here's the corrected approach:

Add a new exported function in `ebook-renderer.js`:

```js
import { preprocessBuffer, isReflowable, isDirectRenderFormat, bufferToHtmlPages } from './html-sanitizer.js'

/** @type {Map<string, { pages: string[] }>} */
const textContentCache = new Map()

/**
 * Get text content pages for direct-render formats.
 * Returns null if the ebook is not a direct-render format.
 */
export function getTextContent(ebookId) {
  if (textContentCache.has(ebookId)) {
    return textContentCache.get(ebookId)
  }

  const entry = getEbookById(ebookId)
  if (!entry) return null

  const ext = path.extname(entry.filePath).toLowerCase()
  if (!isDirectRenderFormat(ext)) return null

  const rawBuffer = fs.readFileSync(entry.filePath)
  const result = bufferToHtmlPages(rawBuffer, ext)

  textContentCache.set(ebookId, result)
  return result
}
```

And modify `getEbookInfo`:
```js
export function getEbookInfo(ebookId) {
  const entry = getEbookById(ebookId)
  if (!entry) return null

  const ext = path.extname(entry.filePath).toLowerCase()

  // Direct-render text formats: bypass MuPDF entirely
  if (isDirectRenderFormat(ext)) {
    const content = getTextContent(ebookId)
    if (!content) return null

    return {
      id: ebookId,
      filename: entry.name,
      pageCount: content.pages.length,
      pages: content.pages.map((_, i) => ({ index: i, width: 800, height: 1000 })),
      format: 'text',
    }
  }

  // Image formats: use MuPDF as before
  const doc = getDocument(ebookId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pages = []

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i)
    const bounds = page.getBounds()
    pages.push({
      index: i,
      width: Math.round(bounds[2] - bounds[0]),
      height: Math.round(bounds[3] - bounds[1]),
    })
  }

  return {
    id: ebookId,
    filename: entry.name,
    pageCount,
    pages,
    format: 'image',
  }
}
```

**Step 2: Add content API route in `server/index.js`**

Add after the existing page route (after line ~99):

```js
import { getEbookInfo, renderPage, getEbookOutline, getPageText, getTextContent } from './ebook-renderer.js'

// ... existing routes ...

app.get('/api/ebook/:id/content/:pageNum', (req, res) => {
  const { id, pageNum } = req.params
  const page = parseInt(pageNum, 10)

  if (isNaN(page) || page < 1) {
    return res.status(400).json({ error: 'Invalid page number' })
  }

  const content = getTextContent(id)
  if (!content) {
    return res.status(404).json({ error: `Content not found for ebook "${id}"` })
  }

  const pageIndex = page - 1
  if (pageIndex >= content.pages.length) {
    return res.status(404).json({ error: `Page ${page} not found` })
  }

  res.set({ 'Cache-Control': 'public, max-age=3600' })
  res.json({ html: content.pages[pageIndex], page, totalPages: content.pages.length })
})
```

**Step 3: Also fix ebook-index.js to skip MuPDF for text formats**

In `server/ebook-index.js`, the `extractMetadata` function currently opens every file with MuPDF to get page count. For text formats, we should use `bufferToHtmlPages` instead:

```js
import { preprocessBuffer, isReflowable } from './html-sanitizer.js'
import { isDirectRenderFormat, bufferToHtmlPages } from './html-sanitizer.js'

function extractMetadata(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const stats = fs.statSync(filePath)
  const rawBuffer = fs.readFileSync(filePath)

  // Text formats: bypass MuPDF, use direct HTML conversion for page count
  if (isDirectRenderFormat(ext)) {
    const result = bufferToHtmlPages(rawBuffer, ext)
    return { pageCount: result.pages.length, size: stats.size, mtimeMs: stats.mtimeMs }
  }

  // Other formats: use MuPDF as before
  const { buffer, magic } = preprocessBuffer(rawBuffer, ext)
  const doc = mupdf.Document.openDocument(buffer, magic)
  try {
    if (isReflowable(ext) && typeof doc.layout === 'function') {
      doc.layout(595, 842, 12)
    }
    const pageCount = doc.countPages()
    return { pageCount, size: stats.size, mtimeMs: stats.mtimeMs }
  } finally {
    doc.destroy()
  }
}
```

**Step 4: Verify server starts and text formats are scanned**

Run: `npm run dev`
Expected: Server starts. If there are `.txt`, `.md`, or `.html` files in ebooks/, they should appear in the index. The `/info` endpoint for these should return `format: 'text'`.

**Step 5: Commit**

```bash
git add server/ebook-renderer.js server/index.js server/ebook-index.js
git commit -m "feat: add content API and bypass MuPDF for text formats"
```

---

## Task 4: Client-Side Text Rendering in Viewer

**Files:**
- Modify: `public/js/viewer.js`

This task modifies the `EbookViewer` class to detect `format: 'text'` from the info response and use a different rendering path: fetch HTML content from `/content` API and inject into a `<div>` instead of drawing to canvas.

**Step 1: Add text format detection to `load()`**

In the constructor, add a `format` property:
```js
this.format = 'image' // 'image' or 'text'
```

In `load()`, after `this.ebookInfo = await res.json()`, store the format:
```js
this.format = this.ebookInfo.format || 'image'
```

**Step 2: Modify `createPageWrapper` for text format**

```js
createPageWrapper(pageInfo, pageNum) {
  const wrapper = document.createElement('div')
  wrapper.className = 'page-wrapper loading'
  wrapper.dataset.page = pageNum

  if (this.format === 'text') {
    // Text format: use a div container instead of canvas
    wrapper.style.width = `${DISPLAY_WIDTH}px`
    wrapper.classList.add('text-format')

    const contentDiv = document.createElement('div')
    contentDiv.className = 'page-content'
    wrapper.appendChild(contentDiv)
  } else {
    // Image format: use canvas as before
    const aspectRatio = pageInfo.height / pageInfo.width
    const displayWidth = DISPLAY_WIDTH
    const displayHeight = Math.round(displayWidth * aspectRatio)

    wrapper.style.width = `${displayWidth}px`
    wrapper.style.height = `${displayHeight}px`

    const canvas = document.createElement('canvas')
    canvas.className = 'page-canvas'
    this.setupCanvas(canvas, displayWidth, displayHeight)

    const textLayerDiv = document.createElement('div')
    textLayerDiv.className = 'text-layer panzoom-exclude'

    wrapper.appendChild(canvas)
    wrapper.appendChild(textLayerDiv)
  }

  return wrapper
}
```

**Step 3: Modify `renderPage` for text format**

```js
async renderPage(wrapper, pageNum, qualityMultiplier = 1) {
  this.renderedPages.add(pageNum)

  if (this.format === 'text') {
    try {
      const res = await fetch(`/api/ebook/${this.ebookId}/content/${pageNum}`)
      if (!res.ok) throw new Error(`Content fetch failed: ${res.statusText}`)
      const data = await res.json()

      const contentDiv = wrapper.querySelector('.page-content')
      if (contentDiv) {
        contentDiv.innerHTML = data.html
      }
      wrapper.classList.remove('loading')
    } catch (err) {
      console.error(`Failed to render text page ${pageNum}:`, err)
    }
    return
  }

  // Existing image rendering code below (unchanged)
  const canvas = wrapper.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  // ... rest of existing renderPage ...
}
```

**Step 4: Modify `reRenderAll` to skip re-render for text format**

Text content doesn't need quality tier re-rendering:

```js
reRenderAll(qualityTier) {
  if (this.format === 'text') return  // Text doesn't have quality tiers

  this.qualityTier = qualityTier
  this.serverScale = getScaleForQualityTier(qualityTier)
  this.renderedPages.clear()

  this.container.querySelectorAll('.page-wrapper').forEach((wrapper) => {
    const pageNum = parseInt(wrapper.dataset.page, 10)
    this.renderPage(wrapper, pageNum, qualityTier)
  })
}
```

**Step 5: Verify in browser**

Open a text-format ebook in the viewer. It should:
- Show pages with HTML content instead of canvas images
- Lazy-load pages as you scroll
- Page indicator shows correct page number
- Progress saving works

**Step 6: Commit**

```bash
git add public/js/viewer.js
git commit -m "feat: client-side direct HTML rendering for text formats"
```

---

## Task 5: Add CSS for Text Content Pages

**Files:**
- Modify: `public/css/style.css`

**Step 1: Add text format styles**

Append to `public/css/style.css`, before the responsive media queries section:

```css
/* ========== Text Format (Direct HTML Rendering) ========== */

.page-wrapper.text-format {
  height: auto;
  min-height: 200px;
  background: #fff;
  color: #1a1a1a;
  overflow: hidden;
}

.page-content {
  padding: 2em 2.5em;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 16px;
  line-height: 1.8;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Markdown/HTML content styling */
.page-content h1 { font-size: 1.8em; margin: 0.8em 0 0.4em; }
.page-content h2 { font-size: 1.5em; margin: 0.7em 0 0.35em; }
.page-content h3 { font-size: 1.25em; margin: 0.6em 0 0.3em; }
.page-content h4 { font-size: 1.1em; margin: 0.5em 0 0.25em; }
.page-content p { margin: 0.6em 0; }
.page-content ul, .page-content ol { margin: 0.6em 0; padding-left: 1.5em; }
.page-content blockquote {
  border-left: 3px solid #ccc;
  margin: 0.8em 0;
  padding: 0.2em 1em;
  color: #555;
}
.page-content pre {
  background: #f5f5f5;
  padding: 1em;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 14px;
}
.page-content code {
  font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  background: #f5f5f5;
  padding: 0.15em 0.4em;
  border-radius: 3px;
  font-size: 0.9em;
}
.page-content pre code {
  background: none;
  padding: 0;
  border-radius: 0;
}
.page-content img { max-width: 100%; height: auto; }
.page-content table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
.page-content th, .page-content td { border: 1px solid #ddd; padding: 0.5em 0.8em; text-align: left; }
.page-content th { background: #f5f5f5; font-weight: 600; }
.page-content a { color: #2563eb; text-decoration: underline; }

/* TXT content */
.page-content .txt-content {
  font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
  background: transparent;
  padding: 0;
  margin: 0;
  border-radius: 0;
}
```

**Step 2: Verify styles look correct**

Open a text-format ebook and confirm:
- Clean readable typography
- Proper spacing for headings, paragraphs, lists
- Code blocks have monospace font and background
- TXT files display with preserved whitespace

**Step 3: Commit**

```bash
git add public/css/style.css
git commit -m "feat: add CSS styles for direct HTML text rendering"
```

---

## Task 6: Skip MuPDF in ebook-renderer.js for Text Formats

**Files:**
- Modify: `server/ebook-renderer.js`

The existing `renderPage` and `getPageText` functions will return null for text-format ebooks since they never create a MuPDF document for them. We need to make sure `getDocument` doesn't try to open text files with MuPDF now that the `/info` route bypasses it. The `docCache` should never contain text-format entries.

This is already handled by the changes in Task 3 — `getEbookInfo` returns early for text formats before calling `getDocument`. But we should also guard `renderPage` and `getPageText` to return null gracefully (they already do via `getDocument` returning null, but the doc won't be in cache).

Actually, we need to make sure `getDocument` doesn't try to open `.txt` files (MuPDF can't handle them). Add a guard:

```js
function getDocument(ebookId) {
  if (docCache.has(ebookId)) {
    return docCache.get(ebookId)
  }

  const entry = getEbookById(ebookId)
  if (!entry) return null

  const ext = path.extname(entry.filePath).toLowerCase()

  // Direct-render text formats don't use MuPDF
  if (isDirectRenderFormat(ext)) return null

  const rawBuffer = fs.readFileSync(entry.filePath)
  const { buffer, magic } = preprocessBuffer(rawBuffer, ext)
  const doc = mupdf.Document.openDocument(buffer, magic)

  if (isReflowable(ext) && typeof doc.layout === 'function') {
    doc.layout(595, 842, 12)
  }

  docCache.set(ebookId, doc)
  return doc
}
```

**Step 1: Apply the guard**

Add the `isDirectRenderFormat` check to `getDocument` as shown above.

**Step 2: Verify no regression**

Open a PDF or EPUB in the viewer — still works as canvas images.
Open a MD/TXT/HTML — works as direct HTML.

**Step 3: Commit**

```bash
git add server/ebook-renderer.js
git commit -m "fix: guard getDocument against text formats that bypass MuPDF"
```

---

## Task 7: Integration Test & Polish

**Files:**
- All modified files

**Step 1: End-to-end verification**

1. Place test files in `ebooks/`:
   - A `.txt` file (small and a large one >200 lines)
   - A `.md` file with headings, code blocks, lists
   - A `.html` file with various elements
2. Trigger rescan: `curl -X POST http://localhost:3000/api/rescan`
3. Verify library page shows all files
4. Open each in viewer and verify:
   - Content renders as readable HTML (not blurry images)
   - Page indicator works
   - Large TXT is paginated (~200 lines per page)
   - Progress saves and restores on reload
   - Vertical scroll mode works
   - Horizontal paged mode works (arrow keys, swipe)
   - Zoom still works (scales the content div via panzoom)
   - Outline button is hidden (no TOC for text formats)

**Step 2: Test PDF/EPUB still works (no regression)**

Open a PDF — should render as canvas images as before.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: direct HTML rendering for text formats (MD, TXT, HTML/XHTML)"
```
