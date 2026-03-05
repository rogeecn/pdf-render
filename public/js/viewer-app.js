import { PdfViewer } from './viewer.js'
import { ViewerControls } from './controls.js'

const RECENTS_KEY = 'pdfLibrary.recents.v1'
const MAX_RECENTS = 10
const PROGRESS_SAVE_DEBOUNCE_MS = 1000

function getPdfIdFromUrl() {
  const match = window.location.pathname.match(/^\/view\/([a-f0-9]{32})$/)
  return match ? match[1] : null
}

function getRecents() {
  try {
    const data = localStorage.getItem(RECENTS_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveRecents(recents) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
  } catch {}
}

function addRecent(pdf) {
  const recents = getRecents().filter(r => r.id !== pdf.id)
  recents.unshift({
    id: pdf.id,
    name: pdf.name,
    relPath: pdf.relPath || '',
    lastOpenedAt: Date.now(),
    lastPage: 1
  })
  saveRecents(recents.slice(0, MAX_RECENTS))
}

function updateRecentPage(pdfId, page) {
  const recents = getRecents()
  const recent = recents.find(r => r.id === pdfId)
  if (recent) {
    recent.lastPage = page
    saveRecents(recents)
  }
}

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

const debouncedSaveProgress = debounce(saveProgressToServer, PROGRESS_SAVE_DEBOUNCE_MS)

async function fetchSavedProgress(pdfId) {
  try {
    const res = await fetch(`/api/progress/${pdfId}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.page || null
  } catch {
    return null
  }
}

async function main() {
  const pdfId = getPdfIdFromUrl()
  
  if (!pdfId) {
    document.getElementById('page-indicator').textContent = 'Invalid PDF ID'
    return
  }

  const viewer = new PdfViewer('page-container', 'viewport')
  const controls = new ViewerControls(viewer)

  try {
    const info = await viewer.load(pdfId)
    document.title = `${info.filename || 'PDF Viewer'}`
    console.log(`Loaded PDF: ${info.pageCount} pages`)

    addRecent({
      id: pdfId,
      name: info.filename || 'Unknown'
    })

    const savedPage = await fetchSavedProgress(pdfId)
    if (savedPage && savedPage > 1 && savedPage <= info.pageCount) {
      viewer.navigateToPage(savedPage)
    }

    const container = document.getElementById('page-container')
    container.addEventListener('viewer:pageChange', (e) => {
      updateRecentPage(pdfId, e.detail.page)
      debouncedSaveProgress(pdfId, e.detail.page)
    })

    controls.init()
    controls.updatePageIndicator()

    const viewport = document.getElementById('viewport')
    let lastTrackedPage = savedPage || 1
    viewport.addEventListener('scroll', () => {
      const currentPage = viewer.getCurrentPage()
      if (currentPage !== lastTrackedPage) {
        lastTrackedPage = currentPage
        updateRecentPage(pdfId, currentPage)
        debouncedSaveProgress(pdfId, currentPage)
      }
    }, { passive: true })
  } catch (err) {
    console.error('Failed to initialize PDF viewer:', err)
    document.getElementById('page-indicator').textContent = 'Error loading PDF'
  }
}

main()
