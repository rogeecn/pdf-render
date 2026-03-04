# Hybrid PDF Viewer Design: Server-Side Rendering + Client Canvas Display

## Problem Statement

Build a system where the server renders PDF pages to images, and the browser displays them via Canvas with zoom/pan/page navigation support. PDF source files must NOT be exposed to the client.

## Design Goals

1. **Security** - PDF files never reach the browser; only rendered images and metadata are transmitted
2. **Lightweight Client** - No PDF parsing library on the frontend; just image display + interaction
3. **Rendering Consistency** - Server-side rendering ensures identical output across all browsers/devices
4. **Technical Exploration** - PoC to validate the hybrid architecture's feasibility

## Constraints

- Interactions: zoom, pan (drag), page navigation only (no text selection, no link clicking, no annotations)
- Tech stack: Node.js (Express) server + vanilla JS client
- PDF rendering: MuPDF WASM (`mupdf` npm package)
- Client interaction: `@panzoom/panzoom` library (3.7KB gzipped)

---

## Architecture Overview

```
                         ┌─────────────────────────────────┐
                         │        Node.js Server           │
                         │                                 │
  PDF files on disk ───► │  MuPDF WASM Engine               │
  (never exposed)        │    ├─ Parse PDF                  │
                         │    ├─ Render page → PNG buffer   │
                         │    └─ Get page count & bounds    │
                         │                                 │
                         │  Express REST API                │
                         │    ├─ GET /api/pdf/:id/info     │
                         │    └─ GET /api/pdf/:id/page/:n  │
                         │                                 │
                         │  In-memory LRU cache             │
                         │    └─ Caches rendered PNG buffers│
                         └──────────┬──────────────────────┘
                                    │  HTTP (PNG + JSON)
                                    ▼
                         ┌─────────────────────────────────┐
                         │        Browser Client           │
                         │                                 │
                         │  Scroll container                │
                         │    └─ Page containers (1..N)    │
                         │        └─ <canvas> per page     │
                         │            ├─ drawImage(png)    │
                         │            └─ @panzoom/panzoom  │
                         │                                 │
                         │  Controls                       │
                         │    ├─ Page indicator (1/N)      │
                         │    ├─ Zoom +/- buttons          │
                         │    └─ Fit width / Fit page      │
                         └─────────────────────────────────┘
```

---

## 1. Server Side

### 1.1 PDF Rendering Engine: MuPDF WASM

**Package:** `mupdf` (npm)
**License:** AGPL-3.0 (acceptable for PoC)
**Install:** `npm install mupdf`

**Core API (verified from official docs):**

```javascript
import * as fs from "node:fs"
import * as mupdf from "mupdf"

// Open document from buffer (NOT from file path in WASM)
const buffer = fs.readFileSync("document.pdf")
const doc = mupdf.Document.openDocument(buffer, "application/pdf")

// Page count
const pageCount = doc.countPages()

// Load specific page (0-indexed)
const page = doc.loadPage(0)

// Get page dimensions
const bounds = page.getBounds() // [x0, y0, x1, y1]

// Render to PNG at specific scale
// Matrix format: [scaleX, shearX, shearY, scaleY, translateX, translateY]
// For 2x scale (192 DPI): scale = 192/72 = 2.667
const scale = 2.0
const pixmap = page.toPixmap(
  mupdf.Matrix.scale(scale, scale),
  mupdf.ColorSpace.DeviceRGB
)
const pngBuffer = pixmap.asPNG() // Returns Uint8Array
```

**Key design decisions:**
- PDF files are read from disk into memory as `Buffer`, then opened via `mupdf.Document.openDocument(buffer, mimeType)`
- Scale factor is passed as a matrix parameter — this allows the client to request different zoom levels
- `pixmap.asPNG()` returns a `Uint8Array` that can be sent directly as HTTP response

### 1.2 REST API Design

#### `GET /api/pdf/:id/info`

Returns document metadata needed for client initialization.

**Response:**
```json
{
  "id": "sample",
  "pageCount": 42,
  "pages": [
    { "index": 0, "width": 595, "height": 842 },
    { "index": 1, "width": 595, "height": 842 }
  ]
}
```

- `width`/`height` are in PDF points (1 point = 1/72 inch) at scale=1
- Client uses these to compute layout before images load

#### `GET /api/pdf/:id/page/:pageNum?scale=1.5`

Returns a rendered PNG image of the specified page.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | PDF identifier (maps to filename) |
| `pageNum` | number | required | 1-based page number |
| `scale` | number | 1.5 | Render scale factor (0.5 ~ 4.0) |

**Response:** `image/png` binary

**Scale logic:**
- `scale=1.0` → 72 DPI (PDF native)
- `scale=1.5` → 108 DPI (default, good balance)
- `scale=2.0` → 144 DPI (retina)
- `scale=3.0` → 216 DPI (deep zoom)

### 1.3 Caching Strategy

Simple in-memory LRU cache keyed by `${pdfId}:${pageNum}:${scale}`.

```
Cache Key: "sample:3:1.5"
Cache Value: PNG Buffer (Uint8Array)
Max entries: 100 (configurable)
Eviction: LRU
```

**Why cache:**
- MuPDF rendering is CPU-intensive (~50-200ms per page depending on complexity)
- Same page at same scale will be requested repeatedly (e.g., navigating back)
- Different scales are cached separately (zoom level change = new render)

**PoC simplification:** Use a `Map` with size limit. Production would use Redis or disk cache.

### 1.4 PDF File Management

For the PoC, PDFs are stored in a `pdfs/` directory. The `:id` parameter maps directly to the filename.

```
pdfs/
  sample.pdf
  report.pdf
```

`GET /api/pdf/sample/info` → opens `pdfs/sample.pdf`

**Security:** The server NEVER exposes the raw PDF file. No download endpoint exists.

---

## 2. Client Side

### 2.1 HTML Structure

```html
<div id="app">
  <!-- Toolbar -->
  <div id="toolbar">
    <button id="zoom-in">+</button>
    <button id="zoom-out">-</button>
    <button id="fit-width">Fit Width</button>
    <button id="fit-page">Fit Page</button>
    <span id="page-indicator">1 / 42</span>
  </div>

  <!-- PDF viewport -->
  <div id="viewport">
    <div id="page-container">
      <!-- Dynamically created per page -->
      <div class="page-wrapper" data-page="1">
        <canvas class="page-canvas"></canvas>
      </div>
    </div>
  </div>
</div>
```

### 2.2 Canvas Rendering Pipeline

Each page follows this lifecycle:

```
1. Client fetches /api/pdf/:id/info → gets page dimensions
2. Create page-wrapper divs with correct aspect ratios (prevents layout shift)
3. As pages scroll into view → fetch PNG → draw to canvas
4. On zoom change → optionally re-fetch at higher scale
```

**Canvas sizing for retina:**

```javascript
function setupCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1
  // CSS size (logical pixels)
  canvas.style.width = width + 'px'
  canvas.style.height = height + 'px'
  // Backing store (physical pixels)
  canvas.width = width * dpr
  canvas.height = height * dpr
  // Scale context so drawing operations use logical coordinates
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  return ctx
}
```

**Image loading and drawing:**

```javascript
async function renderPage(canvas, pdfId, pageNum, scale) {
  const url = `/api/pdf/${pdfId}/page/${pageNum}?scale=${scale}`
  const img = new Image()
  img.src = url

  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
  })

  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, canvas.style.width.replace('px',''), canvas.style.height.replace('px',''))
}
```

### 2.3 Interaction: @panzoom/panzoom

**Package:** `@panzoom/panzoom` v4.x
**Size:** ~3.7KB gzipped, 0 dependencies

**Initialization:**

```javascript
import Panzoom from '@panzoom/panzoom'

const container = document.getElementById('page-container')
const pz = Panzoom(container, {
  maxScale: 5,
  minScale: 0.5,
  step: 0.3,
  contain: 'inside',
  canvas: true,         // Bind events to parent (viewport)
  cursor: 'grab',
})

// Mouse wheel zoom
const viewport = document.getElementById('viewport')
viewport.addEventListener('wheel', (e) => {
  e.preventDefault()
  pz.zoomWithWheel(e)
}, { passive: false })
```

**Key API used:**

| Method | Purpose |
|--------|---------|
| `Panzoom(elem, options)` | Initialize on the page container |
| `pz.zoomWithWheel(event)` | Handle mouse wheel zoom at cursor position |
| `pz.zoom(scale, opts)` | Programmatic zoom (for buttons / fit modes) |
| `pz.pan(x, y, opts)` | Programmatic pan |
| `pz.reset()` | Reset to initial state |
| `pz.getScale()` | Get current zoom level |
| `pz.getPan()` | Get current {x, y} translation |
| `pz.destroy()` | Cleanup |

**Zoom button handlers:**

```javascript
document.getElementById('zoom-in').addEventListener('click', () => pz.zoomIn())
document.getElementById('zoom-out').addEventListener('click', () => pz.zoomOut())
document.getElementById('fit-width').addEventListener('click', () => {
  const containerWidth = viewport.clientWidth
  const pageWidth = pages[0].width * currentDisplayScale
  const targetScale = containerWidth / pageWidth
  pz.zoom(targetScale, { animate: true })
})
```

### 2.4 Page Navigation

**Approach:** Vertical scroll with all pages stacked (like a typical PDF viewer).

- All page wrappers are created upfront with correct dimensions (aspect ratio placeholder)
- Canvas rendering is lazy: only pages near the viewport are rendered
- `IntersectionObserver` tracks which pages are visible → triggers render
- Page indicator updates based on the topmost visible page

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const pageNum = parseInt(entry.target.dataset.page)
      renderPage(entry.target.querySelector('canvas'), pdfId, pageNum, currentScale)
    }
  })
}, { rootMargin: '200px' }) // Pre-load 200px before visible
```

### 2.5 Zoom ↔ Server Re-render (Optional Enhancement)

When user zooms past a threshold, request a higher-resolution image:

```javascript
// Listen for zoom changes
container.addEventListener('panzoomzoom', (e) => {
  const { scale } = e.detail
  const effectiveScale = scale * baseScale

  // If zoomed beyond 2x, request higher res
  if (effectiveScale > 2.0 && currentServerScale < 3.0) {
    currentServerScale = 3.0
    reRenderVisiblePages(currentServerScale)
  }
})
```

**For the PoC, this is optional.** CSS-transformed zoom (slightly blurry at high zoom) is acceptable.

---

## 3. Project Structure

```
try-pdf-server-render/
  package.json
  server/
    index.js          # Express server entry point
    pdf-renderer.js   # MuPDF wrapper (open, render, cache)
    cache.js          # Simple LRU cache
  public/
    index.html        # Single page HTML
    css/
      style.css       # Viewer styles
    js/
      app.js          # Main app logic
      viewer.js       # Canvas rendering + page management
      controls.js     # Toolbar interactions (zoom/pan/navigate)
  pdfs/
    sample.pdf        # Test PDF file(s)
```

---

## 4. Data Flow

### Initial Load

```
Client                          Server
  │                               │
  │  GET /api/pdf/sample/info     │
  │──────────────────────────────►│
  │                               │ Open PDF, count pages, get bounds
  │◄──────────────────────────────│ { pageCount: 42, pages: [...] }
  │                               │
  │  Create 42 page placeholders  │
  │  Observe with Intersection    │
  │                               │
  │  GET /api/pdf/sample/page/1   │
  │      ?scale=1.5               │
  │──────────────────────────────►│
  │                               │ Render page 1 → PNG (cache miss)
  │◄──────────────────────────────│ image/png binary
  │                               │
  │  drawImage to canvas[1]       │
  │                               │
  │  (scroll → pages 2,3 visible) │
  │  GET /page/2?scale=1.5        │
  │  GET /page/3?scale=1.5        │ (parallel)
  │──────────────────────────────►│
```

### Zoom Interaction

```
Client                          Server
  │                               │
  │  User scrolls wheel           │
  │  panzoom.zoomWithWheel()      │
  │  → CSS transform scale(2.0)  │
  │  (instant, GPU accelerated)  │
  │                               │
  │  [Optional: if scale > 2x]   │
  │  GET /page/1?scale=3.0        │
  │──────────────────────────────►│
  │                               │ Render at 3x (cache miss)
  │◄──────────────────────────────│ Higher-res PNG
  │  Re-draw canvas with          │
  │  sharper image                │
```

---

## 5. Non-Goals (Explicitly Out of Scope)

- Text selection / copy
- PDF link clicking
- Form interaction
- Annotation overlay
- Multi-document support
- User authentication
- Persistent storage / database
- Production deployment concerns (HTTPS, load balancing, etc.)

---

## 6. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| MuPDF WASM performance too slow | Low | MuPDF is native-speed WASM; cache rendered pages |
| Large PDF (100+ pages) memory | Medium | Lazy rendering + LRU cache eviction |
| AGPL license for production | High (if productionized) | PoC only; evaluate pdfium/Puppeteer for prod |
| Canvas memory limits (huge pages) | Low | Single canvas per page; reasonable max dimensions |
| Panzoom + scroll container conflict | Medium | Use `contain: 'inside'` and test touch devices |
