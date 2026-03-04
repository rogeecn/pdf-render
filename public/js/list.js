async function loadPdfList() {
  const listEl = document.getElementById('pdf-list')
  const countEl = document.getElementById('pdf-count')

  try {
    const res = await fetch('/api/pdfs')
    if (!res.ok) throw new Error('Failed to load PDF list')
    
    const pdfs = await res.json()
    
    countEl.textContent = `${pdfs.length} PDF${pdfs.length !== 1 ? 's' : ''}`
    
    if (pdfs.length === 0) {
      listEl.innerHTML = '<div class="empty">No PDF files found</div>'
      return
    }
    
    listEl.innerHTML = pdfs.map(pdf => `
      <a href="/view/${pdf.id}" class="pdf-item">
        <div class="pdf-info">
          <div class="pdf-filename">${escapeHtml(pdf.filename)}</div>
          <div class="pdf-meta">${pdf.pageCount} pages · ${formatSize(pdf.size)}</div>
        </div>
        <span class="pdf-arrow">→</span>
      </a>
    `).join('')
    
  } catch (err) {
    console.error('Failed to load PDF list:', err)
    listEl.innerHTML = '<div class="empty">Failed to load PDF list</div>'
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

loadPdfList()
