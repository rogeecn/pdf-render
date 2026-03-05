# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-05
**Commit:** dc23487
**Branch:** main

## OVERVIEW

Self-hosted ebook library + viewer. Server renders pages to PNG via MuPDF; browser displays images. No client-side ebook parsing.

## STRUCTURE

```
.
├── server/              # Express 5 API + MuPDF rendering (6 modules)
├── public/              # SPA frontend (2 HTML pages, vanilla JS, no framework)
│   ├── js/              # viewer.js, controls.js, viewer-app.js, list.js
│   │   └── vendor/      # panzoom.es.js (bundled, do not edit)
│   └── css/             # style.css (viewer), list.css (library page)
├── ebooks/                # Mounted ebook directory (gitignored, Docker VOLUME)
├── Dockerfile           # node:20-alpine, single-stage
└── docs/plans/          # Design docs (historical, not authoritative)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add API endpoint | `server/index.js` | All routes in one file, Express 5 syntax (`{*path}` not `*`) |
| Change ebook rendering | `server/ebook-renderer.js` | MuPDF Document/Pixmap, two caches (doc + image LRU) |
| Modify ebook scanning/indexing | `server/ebook-index.js` | Largest server file (440 lines), recursive scanner + folder tree |
| Change viewer behavior | `public/js/viewer.js` | EbookViewer class, IntersectionObserver lazy loading |
| Change viewer controls | `public/js/controls.js` | ViewerControls class, Panzoom integration, zoom/autoscroll/outline |
| Change library page | `public/js/list.js` | Virtualized list (manual ROW_HEIGHT positioning), search, recents/pins |
| Viewer page wiring | `public/js/viewer-app.js` | Bootstraps EbookViewer + ViewerControls, manages progress |
| Persistent data | `server/ebook-cache.js`, `server/progress-store.js` | Both use atomic write (tmp+rename) pattern |
| Docker deployment | `Dockerfile` | VOLUME /app/ebooks, EXPOSE 3000 |

## CONVENTIONS

- **ESM only** — `"type": "module"` in package.json, all imports use `.js` extensions
- **No build step** — Client JS runs directly in browser, `<script type="module">`
- **No TypeScript** — Plain JS with JSDoc `@typedef` for key types (see ebook-index.js)
- **No linter/formatter** — No .eslintrc, .prettierrc, .editorconfig
- **No tests** — No test files, no test framework
- **No framework** — Client is vanilla JS classes + DOM manipulation
- **Class-based client modules** — `EbookViewer`, `ViewerControls` as ES6 classes; `list.js` is procedural
- **Named exports** — Server modules export named functions, no default exports
- **CustomEvent IPC** — Viewer ↔ Controls communicate via DOM events: `viewer:pageChange`, `viewer:outlineLoaded`, `viewer:outlineToggle`, `viewer:resetZoom`
- **In-memory state** — Server stores ebook index in Maps (`byId`, `byRelPath`, `folderIndex`), rebuilt on scan
- **Atomic file writes** — Both ebook-cache.js and progress-store.js write to `.tmp` then `fs.renameSync`

## ANTI-PATTERNS (THIS PROJECT)

- **No error boundary** — Server error handling is per-route try/catch, no global error middleware
- **No input validation lib** — Manual parseInt/parseFloat in routes
- **Sync file reads** — `fs.readFileSync` in ebook-renderer.js and ebook-index.js (blocking on scan)
- **Unbounded doc cache** — `docCache` in ebook-renderer.js is a plain Map, never evicts (memory leak risk for large libraries)
- **Duplicated utilities** — `debounce`, `getRecents`, `saveRecents`, `formatSize` repeated between list.js and viewer-app.js

## ENV VARIABLES

| Variable | Default | Location |
|----------|---------|----------|
| `PORT` | `3000` | `server/index.js` |
| `EBOOK_DIR` | `./ebooks` | `server/ebook-index.js` |
| `SCAN_INTERVAL` | `1800000` (30min) | `server/ebook-index.js` |
| `EBOOK_CACHE_PATH` | `./ebook-cache.json` | `server/ebook-cache.js` |
| `PROGRESS_PATH` | `./reading-progress.json` | `server/progress-store.js` |

## COMMANDS

```bash
npm start          # Production: node server/index.js
npm run dev        # Development: node --watch server/index.js
docker build -t ebook-viewer .
docker run -d -p 3000:3000 -v /path/to/ebooks:/app/ebooks ebook-viewer
```

## NOTES

- Express 5 wildcard syntax: use `{*splat}` not `:splat(*)` — see `server/index.js:37,142`
- Ebook IDs are MD5 hashes of relative paths — stable across restarts but change if file is moved
- `public/js/vendor/panzoom.es.js` is a vendored copy of @panzoom/panzoom — do not modify
- Client pages: `/` → library (index.html + list.js), `/view/:id` → viewer (view.html + viewer-app.js)
- Cache version bumps (`CACHE_VERSION`, `STORE_VERSION`) invalidate on-disk JSON — increment when schema changes
- Periodic scan runs in `setInterval` — first scan is synchronous on startup (or deferred 100ms if cache hit)
