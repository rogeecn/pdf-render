import express from 'express'
import path from 'node:path'
import { getPdfInfo, renderPage, getPdfOutline, getPageText } from './pdf-renderer.js'
import { getAllPdfs, startPeriodicScan, getFolderNode, listSearchResults, getPdfsByIds, getPdfById } from './pdf-index.js'
import { loadProgress, getProgress, setProgress, getAllProgress } from './progress-store.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.static(path.resolve('public')))
app.use(express.json())

app.get('/api/pdfs', (req, res) => {
  const { ids, flat } = req.query
  
  if (ids) {
    const idList = ids.split(',').filter(Boolean)
    return res.json(getPdfsByIds(idList))
  }
  
  if (flat === '1') {
    const pdfs = getAllPdfs()
    return res.json(pdfs)
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

app.get('/api/pdf/:id/info', (req, res) => {
  const { id } = req.params
  const info = getPdfInfo(id)

  if (!info) {
    return res.status(404).json({ error: `PDF "${id}" not found` })
  }

  res.json(info)
})

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

app.get('/api/pdf/:id/page/:pageNum/text', (req, res) => {
  const { id, pageNum } = req.params
  const page = parseInt(pageNum, 10)

  if (isNaN(page) || page < 1) {
    return res.status(400).json({ error: 'Invalid page number' })
  }

  const textData = getPageText(id, page)

  if (!textData) {
    return res.status(404).json({ error: `Page ${page} not found for PDF "${id}"` })
  }

  res.set({ 'Cache-Control': 'public, max-age=3600' })
  res.json(textData)
})

app.get('/api/pdf/:id/outline', (req, res) => {
  const { id } = req.params
  const items = getPdfOutline(id)
  res.json({ items })
})

app.get('/api/pdf/:id/meta', (req, res) => {
  const { id } = req.params
  const entry = getPdfById(id)
  
  if (!entry) {
    return res.status(404).json({ error: `PDF "${id}" not found` })
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

app.get('/view/{*splat}', (req, res) => {
  res.sendFile(path.resolve('public/view.html'))
})

app.get('/', (req, res) => {
  res.sendFile(path.resolve('public/index.html'))
})

loadProgress()
startPeriodicScan()

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Library server running at http://0.0.0.0:${PORT}`)
})