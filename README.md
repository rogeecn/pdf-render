# Ebook Viewer

A self-hosted ebook library and viewer with server-side rendering powered by MuPDF.

Ebooks are rendered to images on the server, so the browser only needs to display PNGs — no client-side ebook parsing, fast on any device.

## Features

- **Server-side rendering** — MuPDF renders pages to PNG on the server with LRU caching
- **Ebook library** — Auto-scans a directory, builds a browsable folder tree with search
- **Reading progress** — Remembers your last page per document
- **Viewer controls** — Zoom, pan (via panzoom), vertical/horizontal page flip, outline/TOC navigation
- **Recent files** — Tracks recently opened ebooks with pin support
- **Docker ready** — Single container, mount your ebook folder and go

## Quick Start

```bash
# Clone and install
git clone https://github.com/rogeecn/ebook-viewer.git
cd ebook-viewer
npm install

# Put ebooks in the ebooks/ directory
mkdir -p ebooks
cp /path/to/your/ebooks ebooks/

# Start
npm start
# → http://localhost:3000
```

Development mode (auto-reload on file changes):

```bash
npm run dev
```

## Docker

```bash
docker build -t ebook-viewer .
docker run -d -p 3000:3000 -v /path/to/your/ebooks:/app/ebooks ebook-viewer
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ebooks` | List all ebooks (supports `?flat=1` and `?ids=a,b`) |
| `GET` | `/api/tree` | Get folder tree from root |
| `GET` | `/api/tree/:path` | Get folder tree for subdirectory |
| `GET` | `/api/search?q=keyword` | Search ebook filenames |
| `GET` | `/api/ebook/:id/info` | Page dimensions and count |
| `GET` | `/api/ebook/:id/page/:num?scale=1.5` | Render page as PNG |
| `GET` | `/api/ebook/:id/outline` | Table of contents |
| `GET` | `/api/ebook/:id/meta` | File metadata |
| `GET` | `/api/progress/:id` | Get reading progress |
| `PUT` | `/api/progress/:id` | Save reading progress (`{ "page": N }`) |

## Tech Stack

- **Runtime** — Node.js (ESM)
- **Server** — Express 5
- **Ebook engine** — [MuPDF](https://mupdf.com/) (via `mupdf` npm package)
- **Zoom/Pan** — [@panzoom/panzoom](https://github.com/timmywil/panzoom)

## Project Structure

```
server/
  index.js           # Express app and API routes
  ebook-renderer.js    # MuPDF rendering with document and image caching
  ebook-index.js       # Ebook directory scanner with MD5 dedup and search
  ebook-cache.js       # Persistent scan cache
  cache.js           # LRU cache implementation
  progress-store.js  # Reading progress persistence
public/
  index.html         # Library page
  view.html          # Viewer page
  css/               # Styles (dark glassmorphism theme)
  js/                # Client modules (viewer, controls, list)
```

## License

MIT
