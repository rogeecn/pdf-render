import express from 'express'
import path from 'node:path'
import { getPdfInfo, renderPage, getPdfOutline } from './pdf-renderer.js'
import { getAllPdfs, startPeriodicScan } from './pdf-index.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.static(path.resolve('public')))

app.get('/api/pdfs', (req, res) => {
  const pdfs = getAllPdfs()
  res.json(pdfs)
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

app.get('/api/pdf/:id/outline', (req, res) => {
  const { id } = req.params
  const items = getPdfOutline(id)
  res.json({ items })
})

app.get('/view/*', (req, res) => {
  res.sendFile(path.resolve('public/view.html'))
})

app.get('/', (req, res) => {
  res.sendFile(path.resolve('public/index.html'))
})

startPeriodicScan()

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Library server running at http://0.0.0.0:${PORT}`)
})
