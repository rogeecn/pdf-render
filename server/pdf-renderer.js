import * as fs from 'node:fs'
import * as path from 'node:path'
import * as mupdf from 'mupdf'
import { LRUCache } from './cache.js'

const PDF_DIR = path.resolve('pdfs')
const imageCache = new LRUCache(100)
const docCache = new Map()

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
    const bounds = page.getBounds()
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
  if (scale < 0.5) scale = 0.5
  if (scale > 4.0) scale = 4.0

  const cacheKey = `${pdfId}:${pageNum}:${scale}`
  const cached = imageCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const doc = getDocument(pdfId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pageIndex = pageNum - 1
  if (pageIndex < 0 || pageIndex >= pageCount) return null

  const page = doc.loadPage(pageIndex)
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB
  )
  const pngBuffer = pixmap.asPNG()

  imageCache.set(cacheKey, Buffer.from(pngBuffer))

  return Buffer.from(pngBuffer)
}
