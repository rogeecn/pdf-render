import express from 'express'
import path from 'node:path'
import { getEbookInfo, renderPage, getEbookOutline, getPageText, getTextContent } from './ebook-renderer.js'
import { getAllEbooks, startPeriodicScan, getFolderNode, listSearchResults, getEbooksByIds, getEbookById, triggerRescan } from './ebook-index.js'
import { loadProgress, getProgress, setProgress, getAllProgress } from './progress-store.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.static(path.resolve('public')))
app.use(express.json())

app.get('/api/ebooks', (req, res) => {
  const { ids, flat } = req.query
  
  if (ids) {
    const idList = ids.split(',').filter(Boolean)
    return res.json(getEbooksByIds(idList))
  }
  
  if (flat === '1') {
    const ebooks = getAllEbooks()
    return res.json(ebooks)
  }
  
  res.json(getFolderNode(''))
})

app.get('/api/tree', (req, res) => {
  const node = getFolderNode('')
  if (!node) {
    return res.status(404).json({ error: 'Root folder not found' })
  }
  res.json(node)
})

app.get('/api/tree/{*path}', (req, res) => {
  const folderPath = decodeURIComponent(req.params.path || '')
  const node = getFolderNode(folderPath)
  
  if (!node) {
    return res.status(404).json({ error: `Folder "${folderPath}" not found` })
  }
  
  res.json(node)
})

app.get('/api/search', (req, res) => {
  const { q, limit } = req.query
  
  if (!q || q.trim() === '') {
    return res.json({ query: '', results: [] })
  }
  
  const results = listSearchResults(q, { limit: parseInt(limit, 10) || 200 })
  res.json({ query: q, results })
})

app.post('/api/rescan', async (req, res) => {
  const result = triggerRescan()
  if (!result.ok) {
    return res.status(429).json({ error: result.error, retryAfter: result.retryAfter })
  }
  res.json({ ok: true, message: result.message })
})

app.get('/api/ebook/:id/info', (req, res) => {
  const { id } = req.params
  const info = getEbookInfo(id)

  if (!info) {
    return res.status(404).json({ error: `Ebook "${id}" not found` })
  }

  res.json(info)
})

app.get('/api/ebook/:id/page/:pageNum', (req, res) => {
  const { id, pageNum } = req.params
  const scale = parseFloat(req.query.scale) || 1.5
  const page = parseInt(pageNum, 10)

  if (isNaN(page) || page < 1) {
    return res.status(400).json({ error: 'Invalid page number' })
  }

  const png = renderPage(id, page, scale)

  if (!png) {
    return res.status(404).json({ error: `Page ${page} not found for ebook "${id}"` })
  }

  res.set({
    'Content-Type': 'image/png',
    'Content-Length': png.length,
    'Cache-Control': 'public, max-age=3600',
  })
  res.send(png)
})

app.get('/api/ebook/:id/page/:pageNum/text', (req, res) => {
  const { id, pageNum } = req.params
  const page = parseInt(pageNum, 10)

  if (isNaN(page) || page < 1) {
    return res.status(400).json({ error: 'Invalid page number' })
  }

  const textData = getPageText(id, page)

  if (!textData) {
    return res.status(404).json({ error: `Page ${page} not found for ebook "${id}"` })
  }

  res.set({ 'Cache-Control': 'public, max-age=3600' })
  res.json(textData)
})

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

app.get('/api/ebook/:id/outline', (req, res) => {
  const { id } = req.params
  const items = getEbookOutline(id)
  res.json({ items })
})

app.get('/api/ebook/:id/meta', (req, res) => {
  const { id } = req.params
  const entry = getEbookById(id)
  
  if (!entry) {
    return res.status(404).json({ error: `Ebook "${id}" not found` })
  }
  
  res.json({
    id: entry.id,
    name: entry.name,
    relPath: entry.relPath,
    dirPath: entry.dirPath,
    pageCount: entry.pageCount,
    size: entry.size
  })
})

app.get('/api/progress', (req, res) => {
  res.json(getAllProgress())
})

app.get('/api/progress/:id', (req, res) => {
  const { id } = req.params
  const progress = getProgress(id)
  if (!progress) {
    return res.json({ page: null })
  }
  res.json({ page: progress.page, updatedAt: progress.updatedAt, settings: progress.settings || null })
})

app.put('/api/progress/:id', (req, res) => {
  const { id } = req.params
  const { page, settings } = req.body

  if (typeof page !== 'number' || page < 1 || !Number.isInteger(page)) {
    return res.status(400).json({ error: 'Invalid page number' })
  }

  const validSettings = settings && typeof settings === 'object'
    ? {
        displayMode: typeof settings.displayMode === 'string' ? settings.displayMode : undefined,
        zoom: typeof settings.zoom === 'number' ? settings.zoom : undefined,
        bgColor: typeof settings.bgColor === 'string' ? settings.bgColor : undefined,
      }
    : undefined

  const ebook = getEbookById(id)
  const relPath = ebook?.relPath || ''
  const filePath = ebook?.filePath || ''

  setProgress(id, page, relPath, filePath, validSettings)
  res.json({ ok: true })
})

app.get('/view/{*splat}', (req, res) => {
  res.sendFile(path.resolve('public/view.html'))
})

app.get('/', (req, res) => {
  res.sendFile(path.resolve('public/index.html'))
})

loadProgress()
startPeriodicScan()

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ebook Library server running at http://0.0.0.0:${PORT}`)
})