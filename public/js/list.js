const ROW_HEIGHT = 52
const RECENTS_KEY = 'pdfLibrary.recents.v1'
const MAX_RECENTS = 10

const folderStore = new Map()
const expandedFolders = new Set()
let visibleRows = []
let searchQuery = ''
let isSearchMode = false
let searchResults = []
let rootLoaded = false
let progressData = {}

const viewport = document.getElementById('tree-viewport')
const topSpacer = document.getElementById('top-spacer')
const bottomSpacer = document.getElementById('bottom-spacer')
const visibleRowsEl = document.getElementById('visible-rows')
const loadingOverlay = document.getElementById('loading-overlay')
const searchInput = document.getElementById('search-input')
const searchClear = document.getElementById('search-clear')
const pdfCount = document.getElementById('pdf-count')
const recentSection = document.getElementById('recent-section')
const recentList = document.getElementById('recent-list')

function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function formatTimeAgo(ms) {
  if (!ms || typeof ms !== 'number' || isNaN(ms)) return 'Unknown'
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago'
  return new Date(ms).toLocaleDateString()
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text)
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)
  if (index === -1) return escapeHtml(text)
  
  const before = text.slice(0, index)
  const match = text.slice(index, index + query.length)
  const after = text.slice(index + query.length)
  
  return escapeHtml(before) + '<span class="search-highlight">' + escapeHtml(match) + '</span>' + escapeHtml(after)
}

const PINS_KEY = 'pdfLibrary.pins.v1'
const MAX_PINS = 3

function getPins() {
  try {
    const data = localStorage.getItem(PINS_KEY)
    if (!data) return []
    return JSON.parse(data).filter(p => p && p.id && p.name && p.pinnedAt)
  } catch {
    return []
  }
}

function savePins(pins) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins))
  } catch {}
}

function isPinned(pdfId) {
  return getPins().some(p => p.id === pdfId)
}

function togglePin(pdfId) {
  let pins = getPins()
  if (isPinned(pdfId)) {
    pins = pins.filter(p => p.id !== pdfId)
  } else {
    if (pins.length >= MAX_PINS) return
    const recents = getRecents()
    const pdf = recents.find(r => r.id === pdfId)
    if (pdf) {
      pins.unshift({
        id: pdf.id,
        name: pdf.name,
        relPath: pdf.relPath,
        pinnedAt: Date.now()
      })
    }
  }
  savePins(pins)
}

function getRecents() {
  try {
    const data = localStorage.getItem(RECENTS_KEY)
    if (!data) return []
    const parsed = JSON.parse(data)
    return parsed.filter(r => r && r.id && r.name && typeof r.lastOpenedAt === 'number' && r.lastOpenedAt > 0)
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
  let recents = getRecents()
  const existing = recents.find(r => r.id === pdf.id)
  
  if (existing) {
    existing.lastOpenedAt = Date.now()
    if (!isPinned(pdf.id)) {
      recents = recents.filter(r => r.id !== pdf.id)
      recents.unshift(existing)
    }
  } else {
    recents.unshift({
      id: pdf.id,
      name: pdf.name,
      relPath: pdf.relPath,
      lastOpenedAt: Date.now()
    })
  }

  if (recents.length > MAX_RECENTS) {
    const pinnedIds = new Set(getPins().map(p => p.id))
    const toKeep = recents.filter(r => pinnedIds.has(r.id))
    const others = recents.filter(r => !pinnedIds.has(r.id))
    recents = [...toKeep, ...others].slice(0, MAX_RECENTS)
  }

  saveRecents(recents)
  renderRecents()
}

function clearRecents() {
  const pinnedIds = new Set(getPins().map(p => p.id))
  const recents = getRecents().filter(r => pinnedIds.has(r.id))
  saveRecents(recents)
  renderRecents()
}

function renderRecents() {
  const pins = getPins()
  const allRecents = getRecents()
  const recentsById = new Map(allRecents.map(r => [r.id, r]))
  const unpinnedRecents = allRecents.filter(r => !isPinned(r.id))
  
  pins.sort((a, b) => a.pinnedAt - b.pinnedAt)
  unpinnedRecents.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  
  const pinnedDisplay = pins.map(p => {
    const recent = recentsById.get(p.id)
    return { ...p, lastOpenedAt: recent?.lastOpenedAt || null }
  })
  
  const displayItems = [...pinnedDisplay, ...unpinnedRecents]
  
  if (displayItems.length === 0) {
    recentSection.style.display = 'none'
    return
  }
  
  recentSection.style.display = 'block'
  recentList.innerHTML = displayItems.map(item => {
    const isItemPinned = isPinned(item.id)
    const pinIcon = isItemPinned 
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1-1l.784-.784A1 1 0 0 0 17 2.5v0a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5v0a1 1 0 0 0 .216.63L8 4a1 1 0 0 1 1 1z"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1-1l.784-.784A1 1 0 0 0 17 2.5v0a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5v0a1 1 0 0 0 .216.63L8 4a1 1 0 0 1 1 1z"/></svg>'
      
    const timeText = item.lastOpenedAt ? formatTimeAgo(item.lastOpenedAt) : (isItemPinned ? 'Pinned' : '')
    const progress = progressData[item.id]
    const progressText = progress?.page > 1 ? ` · p.${progress.page}` : ''
    
    return `
    <a href="/view/${item.id}" class="recent-item ${isItemPinned ? 'pinned' : ''}" data-pdf-id="${item.id}">
      <div class="recent-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      </div>
      <div class="recent-info">
        <div class="recent-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="recent-meta">${timeText}${progressText}</div>
      </div>
      <button class="recent-pin-btn" data-pin-id="${item.id}" title="${isItemPinned ? 'Unpin' : 'Pin'}">
        ${pinIcon}
      </button>
    </a>
  `}).join('')
  
  recentList.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.recent-pin-btn')) return
      
      const id = el.dataset.pdfId
      const recents = getRecents()
      const pdf = recents.find(r => r.id === id) || getPins().find(p => p.id === id)
      if (pdf) addRecent(pdf)
    })
  })
  
  recentList.querySelectorAll('.recent-pin-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const id = btn.dataset.pinId
      togglePin(id)
      renderRecents()
    })
  })
}

async function fetchAllProgress() {
  try {
    const res = await fetch('/api/progress')
    if (res.ok) {
      progressData = await res.json()
    }
  } catch {}
}

async function fetchRoot() {
  showLoading(true)
  try {
    const res = await fetch('/api/tree')
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json()
    folderStore.set('', data)
    rootLoaded = true
    updatePdfCount()
    computeVisibleRows()
    render()
  } catch (err) {
    console.error('Failed to load tree:', err)
    visibleRowsEl.innerHTML = '<div class="empty-state"><h3>Error loading PDFs</h3><p>Please refresh the page</p></div>'
  } finally {
    showLoading(false)
  }
}

async function fetchFolder(folderPath) {
  try {
    const url = folderPath ? `/api/tree/${encodeURIComponent(folderPath)}` : '/api/tree'
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to load folder')
    const data = await res.json()
    folderStore.set(folderPath, data)
    return data
  } catch (err) {
    console.error(`Failed to load folder ${folderPath}:`, err)
    return null
  }
}

async function performSearch(query) {
  if (!query || query.trim() === '') {
    exitSearch()
    return
  }
  
  searchQuery = query.trim()
  isSearchMode = true
  showLoading(true)
  
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=500`)
    if (!res.ok) throw new Error('Search failed')
    const data = await res.json()
    searchResults = data.results || []
    computeVisibleRows()
    render()
    updatePdfCount()
  } catch (err) {
    console.error('Search failed:', err)
    searchResults = []
  } finally {
    showLoading(false)
  }
}

function exitSearch() {
  isSearchMode = false
  searchQuery = ''
  searchResults = []
  searchInput.value = ''
  searchClear.style.display = 'none'
  computeVisibleRows()
  render()
  updatePdfCount()
}

function toggleFolder(folderPath) {
  if (expandedFolders.has(folderPath)) {
    expandedFolders.delete(folderPath)
  } else {
    expandedFolders.add(folderPath)
  }
  computeVisibleRows()
  render()
}

async function expandFolder(folderPath) {
  if (expandedFolders.has(folderPath)) {
    expandedFolders.delete(folderPath)
    computeVisibleRows()
    render()
    return
  }
  
  const folder = folderStore.get(folderPath)
  if (!folder || !folder.loaded) {
    showLoading(true)
    await fetchFolder(folderPath)
    showLoading(false)
  }
  
  expandedFolders.add(folderPath)
  computeVisibleRows()
  render()
}

function computeVisibleRows() {
  visibleRows = []
  
  if (isSearchMode) {
    searchResults.forEach(pdf => {
      visibleRows.push({
        type: 'pdf',
        data: pdf,
        depth: 0,
        isSearchResult: true
      })
    })
    return
  }
  
  function addFolderRows(folderPath, depth) {
    const folder = folderStore.get(folderPath)
    if (!folder || !folder.children) return
    
    folder.children.folders.forEach(childFolder => {
      visibleRows.push({
        type: 'folder',
        data: childFolder,
        depth,
        isExpanded: expandedFolders.has(childFolder.path)
      })
      
      if (expandedFolders.has(childFolder.path)) {
        addFolderRows(childFolder.path, depth + 1)
      }
    })
    
    folder.children.pdfs.forEach(pdf => {
      visibleRows.push({
        type: 'pdf',
        data: pdf,
        depth
      })
    })
  }
  
  if (rootLoaded) {
    addFolderRows('', 0)
  }
}

function render() {
  const scrollTop = viewport.scrollTop
  const viewportHeight = viewport.clientHeight
  
  const totalHeight = visibleRows.length * ROW_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10)
  const endIndex = Math.min(visibleRows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + 10)
  
  topSpacer.style.height = startIndex * ROW_HEIGHT + 'px'
  bottomSpacer.style.height = (totalHeight - endIndex * ROW_HEIGHT) + 'px'
  
  const rows = visibleRows.slice(startIndex, endIndex)
  let html = ''
  
  rows.forEach((row, i) => {
    const top = (startIndex + i) * ROW_HEIGHT
    
    if (row.type === 'folder') {
      const hasChildren = row.data.hasChildren
      const isExpanded = row.isExpanded
      
      html += `
        <div class="tree-row folder-row ${isExpanded ? 'expanded' : ''}" 
             style="position: absolute; top: ${top}px; width: 100%;" 
             data-folder-path="${escapeHtml(row.data.path)}">
          <div class="row-indent" style="width: ${row.depth * 20}px;">
            ${Array(row.depth).fill('<span class="indent-unit"></span>').join('')}
          </div>
          <span class="folder-toggle ${isExpanded ? 'expanded' : ''} ${hasChildren ? '' : 'empty'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </span>
          <span class="row-icon folder-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          </span>
          <div class="row-content">
            <div class="row-name">${escapeHtml(row.data.name)}</div>
            <div class="row-counts">${row.data.counts?.totalPdfs || 0} docs</div>
          </div>
        </div>
      `
    } else {
      const pdf = row.data
      const nameClass = row.isSearchResult ? 'row-name search-match' : 'row-name'
      const displayName = row.isSearchResult ? highlightMatch(pdf.name, searchQuery) : escapeHtml(pdf.name)
      
      html += `
        <a class="tree-row pdf-row" 
           style="position: absolute; top: ${top}px; width: 100%;" 
           href="/view/${pdf.id}" 
           data-pdf-id="${pdf.id}"
           data-pdf-name="${escapeHtml(pdf.name)}"
           data-pdf-rel-path="${escapeHtml(pdf.relPath || '')}">
          <div class="row-indent" style="width: ${row.depth * 20}px;">
            ${Array(row.depth).fill('<span class="indent-unit"></span>').join('')}
          </div>
          <span class="folder-toggle empty"></span>
          <span class="row-icon pdf-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          </span>
          <div class="row-content">
            <div class="${nameClass}">${displayName}</div>
            <div class="row-meta">${pdf.pageCount || 0} pages · ${formatSize(pdf.size || 0)}</div>
          </div>
        </a>
      `
    }
  })
  
  visibleRowsEl.innerHTML = html
  
  visibleRowsEl.querySelectorAll('.folder-row').forEach(el => {
    el.addEventListener('click', () => {
      const folderPath = el.dataset.folderPath
      expandFolder(folderPath)
    })
  })
  
  visibleRowsEl.querySelectorAll('.pdf-row').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.pdfId
      const name = el.dataset.pdfName
      const relPath = el.dataset.pdfRelPath
      addRecent({ id, name, relPath })
    })
  })
}

function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show)
}

function updatePdfCount() {
  if (isSearchMode) {
    pdfCount.textContent = `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`
  } else {
    const root = folderStore.get('')
    const total = root?.counts?.totalPdfs || 0
    pdfCount.textContent = `${total} document${total !== 1 ? 's' : ''}`
  }
}

function handleScroll() {
  requestAnimationFrame(render)
}

function handleSearchInput(e) {
  const query = e.target.value
  searchClear.style.display = query ? 'block' : 'none'
  debounce(performSearch, 200)(query)
}

async function init() {
  viewport.addEventListener('scroll', handleScroll, { passive: true })
  searchInput.addEventListener('input', handleSearchInput)
  searchClear.addEventListener('click', () => {
    searchInput.value = ''
    searchClear.style.display = 'none'
    exitSearch()
  })
  document.getElementById('clear-recents').addEventListener('click', clearRecents)
  
  await fetchAllProgress()
  renderRecents()
  fetchRoot()
}

init()