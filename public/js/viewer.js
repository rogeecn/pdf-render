import { TextLayer } from './text-layer.js'

const DEFAULT_SCALE = 1.5
const DISPLAY_WIDTH = 800

function getScaleForQualityTier(tier) {
  return DEFAULT_SCALE * tier
}

export class EbookViewer {
  constructor(containerId, viewportId) {
    this.container = document.getElementById(containerId)
    this.viewport = document.getElementById(viewportId)
    this.ebookId = null
    this.ebookInfo = null
    this.serverScale = DEFAULT_SCALE
    this.qualityTier = 1
    this.renderedPages = new Set()
    this.observer = null
    this.displayMode = 'vertical'
    this.currentPage = 1
    this.outlineItems = []
    this.outlineOpen = false
    this.format = 'image' // 'image' or 'text'
  }

  async load(ebookId) {
    this.ebookId = ebookId
    this.renderedPages.clear()
    this.outlineItems = []

    const res = await fetch(`/api/ebook/${ebookId}/info`)
    if (!res.ok) throw new Error(`Failed to load ebook: ${res.statusText}`)
    this.ebookInfo = await res.json()
    this.format = this.ebookInfo.format || 'image'

    this.container.innerHTML = ''
    this.ebookInfo.pages.forEach((page, i) => {
      const wrapper = this.createPageWrapper(page, i + 1)
      this.container.appendChild(wrapper)
    })

    this.setupIntersectionObserver()
    this.loadOutline()

    return this.ebookInfo
  }

  async loadOutline() {
    try {
      const res = await fetch(`/api/ebook/${this.ebookId}/outline`)
      if (!res.ok) return
      
      const data = await res.json()
      this.outlineItems = data.items || []
      
      this.container.dispatchEvent(new CustomEvent('viewer:outlineLoaded', {
        detail: { items: this.outlineItems }
      }))
    } catch (err) {
      console.error('Failed to load outline:', err)
    }
  }

  hasOutline() {
    return this.outlineItems.length > 0
  }

  toggleOutline(forceState) {
    this.outlineOpen = forceState !== undefined ? forceState : !this.outlineOpen
    this.container.dispatchEvent(new CustomEvent('viewer:outlineToggle', {
      detail: { open: this.outlineOpen }
    }))
  }

  navigateToPage(pageNum) {
    const clampedPage = Math.max(1, Math.min(pageNum, this.pageCount))
    
    if (this.displayMode === 'horizontal') {
      this.goToPage(clampedPage)
    } else {
      const wrapper = this.container.querySelector(`[data-page="${clampedPage}"]`)
      if (wrapper) {
        wrapper.scrollIntoView({ block: 'center' })
      }
    }
    
    if (this.outlineOpen) {
      this.toggleOutline(false)
    }
  }

  createPageWrapper(pageInfo, pageNum) {
    const wrapper = document.createElement('div')
    wrapper.className = 'page-wrapper loading'
    wrapper.dataset.page = pageNum

    if (this.format === 'text') {
      wrapper.style.width = `${DISPLAY_WIDTH}px`
      wrapper.classList.add('text-format')

      const contentDiv = document.createElement('div')
      contentDiv.className = 'page-content panzoom-exclude'
      wrapper.appendChild(contentDiv)
    } else {
      const aspectRatio = pageInfo.height / pageInfo.width
      const displayWidth = DISPLAY_WIDTH
      const displayHeight = Math.round(displayWidth * aspectRatio)

      wrapper.style.width = `${displayWidth}px`
      wrapper.style.height = `${displayHeight}px`

      const canvas = document.createElement('canvas')
      canvas.className = 'page-canvas'
      this.setupCanvas(canvas, displayWidth, displayHeight)

      const textLayerDiv = document.createElement('div')
      textLayerDiv.className = 'text-layer panzoom-exclude'

      wrapper.appendChild(canvas)
      wrapper.appendChild(textLayerDiv)
    }

    return wrapper
  }

  setupCanvas(canvas, width, height, qualityMultiplier = 1) {
    const dpr = window.devicePixelRatio || 1
    const scale = dpr * qualityMultiplier
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
  }

  setupIntersectionObserver() {
    if (this.observer) {
      this.observer.disconnect()
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.page, 10)
            if (!this.renderedPages.has(pageNum)) {
              this.renderPage(entry.target, pageNum)
            }
          }
        })
      },
      {
        root: this.viewport,
        rootMargin: '300px',
      }
    )

    this.container.querySelectorAll('.page-wrapper').forEach((wrapper) => {
      this.observer.observe(wrapper)
    })
  }

  async renderPage(wrapper, pageNum, qualityMultiplier = 1) {
    this.renderedPages.add(pageNum)

    if (this.format === 'text') {
      try {
        const res = await fetch(`/api/ebook/${this.ebookId}/content/${pageNum}`)
        if (!res.ok) throw new Error(`Content fetch failed: ${res.statusText}`)
        const data = await res.json()

        const contentDiv = wrapper.querySelector('.page-content')
        if (contentDiv) {
          contentDiv.innerHTML = data.html
        }
        wrapper.classList.remove('loading')
      } catch (err) {
        console.error(`Failed to render text page ${pageNum}:`, err)
      }
      return
    }

    const canvas = wrapper.querySelector('canvas')
    const ctx = canvas.getContext('2d')

    const displayWidth = parseInt(wrapper.style.width, 10)
    const displayHeight = parseInt(wrapper.style.height, 10)

    this.setupCanvas(canvas, displayWidth, displayHeight, qualityMultiplier)

    try {
      const url = `/api/ebook/${this.ebookId}/page/${pageNum}?scale=${this.serverScale}`
      const img = new Image()
      img.src = url

      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      wrapper.classList.remove('loading')

      const textLayerDiv = wrapper.querySelector('.text-layer')
      if (textLayerDiv && !textLayerDiv.hasChildNodes()) {
        fetch(`/api/ebook/${this.ebookId}/page/${pageNum}/text`)
          .then(res => {
            if (!res.ok) throw new Error(`Text fetch failed: ${res.statusText}`)
            return res.json()
          })
          .then(textData => {
            const textLayer = new TextLayer()
            textLayer.render(textData, textLayerDiv, displayWidth, displayHeight)
          })
          .catch(err => {
            console.warn(`Failed to load text for page ${pageNum}:`, err)
          })
      }
    } catch (err) {
      console.error(`Failed to render page ${pageNum}:`, err)
    }
  }

  reRenderAll(qualityTier) {
    if (this.format === 'text') return

    this.qualityTier = qualityTier
    this.serverScale = getScaleForQualityTier(qualityTier)
    this.renderedPages.clear()
    
    this.container.querySelectorAll('.page-wrapper').forEach((wrapper) => {
      const pageNum = parseInt(wrapper.dataset.page, 10)
      this.renderPage(wrapper, pageNum, qualityTier)
    })
  }

  getCurrentPage() {
    if (this.displayMode === 'horizontal') {
      return this.currentPage
    }

    const wrappers = this.container.querySelectorAll('.page-wrapper')
    const viewportRect = this.viewport.getBoundingClientRect()
    const viewportCenter = viewportRect.top + viewportRect.height / 2

    let closestPage = 1
    let closestDistance = Infinity

    wrappers.forEach((wrapper) => {
      const rect = wrapper.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      const distance = Math.abs(center - viewportCenter)
      if (distance < closestDistance) {
        closestDistance = distance
        closestPage = parseInt(wrapper.dataset.page, 10)
      }
    })

    return closestPage
  }

  setDisplayMode(mode, { preservePage = true } = {}) {
    const targetPage = preservePage ? this.getCurrentPage() : 1
    this.displayMode = mode

    const app = document.getElementById('app')
    const wrappers = this.container.querySelectorAll('.page-wrapper')

    if (mode === 'horizontal') {
      app.classList.add('mode-horizontal')
      wrappers.forEach((wrapper) => {
        const pageNum = parseInt(wrapper.dataset.page, 10)
        if (pageNum === targetPage) {
          wrapper.classList.remove('is-hidden')
        } else {
          wrapper.classList.add('is-hidden')
        }
      })
      this.currentPage = targetPage
      this.ensurePageRendered(targetPage)
      this.viewport.scrollTop = 0
    } else {
      app.classList.remove('mode-horizontal')
      wrappers.forEach((wrapper) => {
        wrapper.classList.remove('is-hidden')
      })
      const targetWrapper = this.container.querySelector(`[data-page="${targetPage}"]`)
      if (targetWrapper) {
        targetWrapper.scrollIntoView({ block: 'center' })
      }
    }
  }

  goToPage(pageNum) {
    const clampedPage = Math.max(1, Math.min(pageNum, this.pageCount))
    if (clampedPage === this.currentPage && this.displayMode === 'horizontal') return

    this.currentPage = clampedPage

    if (this.displayMode === 'horizontal') {
      const wrappers = this.container.querySelectorAll('.page-wrapper')
      wrappers.forEach((wrapper) => {
        const pNum = parseInt(wrapper.dataset.page, 10)
        if (pNum === clampedPage) {
          wrapper.classList.remove('is-hidden')
        } else {
          wrapper.classList.add('is-hidden')
        }
      })
      this.ensurePageRendered(clampedPage)
      this.container.dispatchEvent(new CustomEvent('viewer:pageChange', { detail: { page: clampedPage } }))
    }
  }

  ensurePageRendered(pageNum) {
    if (!this.renderedPages.has(pageNum)) {
      const wrapper = this.container.querySelector(`[data-page="${pageNum}"]`)
      if (wrapper) {
        this.renderPage(wrapper, pageNum, this.qualityTier)
      }
    }
  }

  resetZoom() {
    this.container.dispatchEvent(new CustomEvent('viewer:resetZoom'))
  }

  get pageCount() {
    return this.ebookInfo ? this.ebookInfo.pageCount : 0
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect()
    }
    this.container.innerHTML = ''
    this.renderedPages.clear()
  }
}