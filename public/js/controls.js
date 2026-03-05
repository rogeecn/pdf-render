import Panzoom from '/js/vendor/panzoom.es.js'

const SWIPE_MIN_PX = 40
const SWIPE_MAX_MS = 600
const DEFAULT_MIN_SCALE = 0.5
const FIT_MIN_SCALE = 0.1
const BG_STORAGE_KEY = 'pdfViewer.bgColor'

export class ViewerControls {
  constructor(viewer) {
    this.viewer = viewer
    this.panzoom = null
    this.currentZoom = 1.0
    this.currentQualityTier = 1

    this.viewport = document.getElementById('viewport')
    this.container = document.getElementById('page-container')
    this.zoomInBtn = document.getElementById('zoom-in')
    this.zoomOutBtn = document.getElementById('zoom-out')
    this.fitWidthBtn = document.getElementById('fit-width')
    this.fitPageBtn = document.getElementById('fit-page')
    this.zoomLevel = document.getElementById('zoom-level')
    this.pageIndicator = document.getElementById('page-indicator')
    this.toggleModeBtn = document.getElementById('toggle-mode')
    this.toggleOutlineBtn = document.getElementById('toggle-outline')
    this.outlinePanel = document.getElementById('outline-panel')
    this.outlineTree = document.getElementById('outline-tree')
    this.closeOutlineBtn = document.getElementById('close-outline')
    this.settingsBtn = document.getElementById('toggle-settings')
    this.settingsPanel = document.getElementById('settings-panel')
    this.autoscrollSpeedSection = document.getElementById('autoscroll-speed-section')

    this.swipeStartX = 0
    this.swipeStartY = 0
    this.swipeStartTime = 0

    this.isAutoScrolling = false
    this.autoScrollSpeedPps = 30
    this.autoScrollRafId = null
    this.autoScrollLastTs = null
    this.settingsPanelOpen = false
    this.hasOutlineItems = false
  }

  getQualityTier(zoom) {
    if (zoom <= 1.0) return 1
    if (zoom <= 1.5) return 1.5
    if (zoom <= 2.0) return 2
    if (zoom <= 3.0) return 3
    return 4
  }

  init() {
    this.setupPanzoom()
    this.bindToolbarEvents()
    this.bindScrollEvents()
    this.bindModeEvents()
    this.bindKeyboardEvents()
    this.bindSwipeEvents()
    this.bindViewerEvents()
    this.bindAutoScrollEvents()
    this.bindOutlineEvents()
    this.bindSettingsPanel()
    this.bindBackgroundPresets()
    this.restoreBackground()
    this.updateZoomDisplay()
    this.updateAutoScrollButton()
    this.updateAutoScrollSpeedDisplay()
  }

  setupPanzoom() {
    this.panzoom = Panzoom(this.container, {
      maxScale: 5,
      minScale: 0.5,
      step: 0.15,
      cursor: 'default',
      animate: true,
      duration: 200,
      overflow: 'auto',
      touchAction: 'auto',
      panOnlyWhenZoomed: true,
    })

    this.viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault()
        this.panzoom.zoomWithWheel(e)
        this.onZoomChange()
      }
    }, { passive: false })

    this.container.addEventListener('panzoomchange', () => {
      this.onZoomChange()
    })
  }

  getFitWidthBaseWidth() {
    if (this.viewer.displayMode === 'horizontal') {
      const currentPageWrapper = this.container.querySelector(`.page-wrapper[data-page-num="${this.viewer.currentPage}"]`)
      if (currentPageWrapper) return currentPageWrapper.offsetWidth
    } else {
      const visibleWrappers = Array.from(this.container.querySelectorAll('.page-wrapper')).filter(el => {
        const rect = el.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < window.innerHeight
      })
      if (visibleWrappers.length > 0) return visibleWrappers[0].offsetWidth
    }
    
    const firstWrapper = this.container.querySelector('.page-wrapper')
    if (firstWrapper) return firstWrapper.offsetWidth
    
    return this.container.scrollWidth
  }

  setPanzoomMinScale(min) {
    if (this.panzoom) {
      this.panzoom.setOptions({ minScale: min })
    }
  }

  bindToolbarEvents() {
    this.zoomInBtn.addEventListener('click', () => {
      this.panzoom.zoomIn()
      this.onZoomChange()
    })

    this.zoomOutBtn.addEventListener('click', () => {
      this.panzoom.zoomOut()
      this.onZoomChange()
    })

    this.fitWidthBtn.addEventListener('click', () => {
      const viewportWidth = this.viewport.clientWidth - 40
      const containerWidth = this.getFitWidthBaseWidth()
      const targetScale = viewportWidth / containerWidth
      
      const isBelowMin = targetScale < DEFAULT_MIN_SCALE
      if (isBelowMin) {
        this.setPanzoomMinScale(FIT_MIN_SCALE)
      }
      
      this.panzoom.zoom(targetScale, { animate: true })
      this.panzoom.pan(0, 0, { animate: true })
      this.onZoomChange()
      
      if (isBelowMin) {
        setTimeout(() => {
          this.setPanzoomMinScale(DEFAULT_MIN_SCALE)
        }, 250)
      }
    })

    this.fitPageBtn.addEventListener('click', () => {
      this.panzoom.reset({ animate: true })
      this.onZoomChange()
    })
  }

  bindScrollEvents() {
    this.viewport.addEventListener('scroll', () => {
      if (this.viewer.displayMode === 'vertical') {
        this.updatePageIndicator()
      }
    })
  }

  bindModeEvents() {
    this.toggleModeBtn.addEventListener('click', () => {
      const newMode = this.viewer.displayMode === 'vertical' ? 'horizontal' : 'vertical'
      
      if (this.isAutoScrolling && newMode === 'horizontal') {
        this.stopAutoScroll()
      }
      
      this.viewer.setDisplayMode(newMode)
      this.updateModeButton()
      this.updatePanzoomForMode(newMode)
      this.updatePageIndicator()
      this.updateAutoScrollButton()
    })
  }

  bindKeyboardEvents() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.settingsPanelOpen) this.closeSettingsPanel()
        return
      }

      if (this.viewer.displayMode !== 'horizontal') return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        this.viewer.goToPage(this.viewer.currentPage - 1)
        this.updatePageIndicator()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        this.viewer.goToPage(this.viewer.currentPage + 1)
        this.updatePageIndicator()
      }
    })
  }

  bindSwipeEvents() {
    this.viewport.addEventListener('pointerdown', (e) => {
      if (this.viewer.displayMode !== 'horizontal') return

      this.swipeStartX = e.clientX
      this.swipeStartY = e.clientY
      this.swipeStartTime = Date.now()
      this.viewport.setPointerCapture(e.pointerId)
    })

    this.viewport.addEventListener('pointerup', (e) => {
      if (this.viewer.displayMode !== 'horizontal') return
      if (this.swipeStartTime === 0) return

      const dx = e.clientX - this.swipeStartX
      const dy = e.clientY - this.swipeStartY
      const dt = Date.now() - this.swipeStartTime

      this.swipeStartTime = 0

      if (dt > SWIPE_MAX_MS) return
      if (Math.abs(dy) > Math.abs(dx)) return
      if (Math.abs(dx) < SWIPE_MIN_PX) return

      if (dx < 0) {
        this.viewer.goToPage(this.viewer.currentPage + 1)
      } else {
        this.viewer.goToPage(this.viewer.currentPage - 1)
      }
      this.updatePageIndicator()
    })

    this.viewport.addEventListener('pointercancel', () => {
      this.swipeStartTime = 0
    })
  }

  bindViewerEvents() {
    this.container.addEventListener('viewer:resetZoom', () => {
      this.panzoom.reset({ animate: true })
      this.onZoomChange()
    })

    this.container.addEventListener('viewer:pageChange', () => {
      this.updatePageIndicator()
    })
  }

  bindSettingsPanel() {
    this.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.settingsPanelOpen ? this.closeSettingsPanel() : this.openSettingsPanel()
    })

    document.addEventListener('click', (e) => {
      if (this.settingsPanelOpen &&
          !this.settingsPanel.contains(e.target) &&
          e.target !== this.settingsBtn &&
          !this.settingsBtn.contains(e.target)) {
        this.closeSettingsPanel()
      }
    })
  }

  openSettingsPanel() {
    this.settingsPanelOpen = true
    this.settingsPanel.classList.add('open')
    this.settingsPanel.setAttribute('aria-hidden', 'false')
    this.settingsBtn.setAttribute('aria-pressed', 'true')
  }

  closeSettingsPanel() {
    this.settingsPanelOpen = false
    this.settingsPanel.classList.remove('open')
    this.settingsPanel.setAttribute('aria-hidden', 'true')
    this.settingsBtn.setAttribute('aria-pressed', 'false')
  }

  bindBackgroundPresets() {
    const presets = this.settingsPanel.querySelectorAll('.bg-preset')
    presets.forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.bg
        this.setBackground(color)
        presets.forEach(b => { b.classList.remove('active') })
        btn.classList.add('active')
      })
    })
  }

  setBackground(color) {
    document.body.style.background = color
    try {
      localStorage.setItem(BG_STORAGE_KEY, color)
    } catch {}
  }

  restoreBackground() {
    try {
      const saved = localStorage.getItem(BG_STORAGE_KEY)
      if (saved) {
        document.body.style.background = saved
        const presets = this.settingsPanel.querySelectorAll('.bg-preset')
        presets.forEach(btn => {
          if (btn.dataset.bg === saved) {
            btn.classList.add('active')
          } else {
            btn.classList.remove('active')
          }
        })
      }
    } catch {}
  }

  updateModeButton() {
    const isHorizontal = this.viewer.displayMode === 'horizontal'
    const label = this.toggleModeBtn.querySelector('span')
    if (label) label.textContent = isHorizontal ? 'Scroll' : 'Paged'
    this.toggleModeBtn.setAttribute('aria-pressed', isHorizontal.toString())
  }

  updatePanzoomForMode(mode) {
    if (mode === 'horizontal') {
      this.panzoom.setOptions({
        disablePan: true,
        touchAction: 'none',
      })
      this.panzoom.reset({ animate: false })
      this.onZoomChange()
    } else {
      this.panzoom.setOptions({
        disablePan: false,
        panOnlyWhenZoomed: true,
        touchAction: 'auto',
      })
    }
  }

  onZoomChange() {
    const newZoom = this.panzoom.getScale()
    const newTier = this.getQualityTier(newZoom)
    
    this.currentZoom = newZoom
    this.updateZoomDisplay()
    
    if (newTier !== this.currentQualityTier) {
      this.currentQualityTier = newTier
      this.viewer.reRenderAll(newTier)
    }
  }

  updateZoomDisplay() {
    const percentage = Math.round(this.currentZoom * 100)
    this.zoomLevel.textContent = `${percentage}%`
  }

  updatePageIndicator() {
    const currentPage = this.viewer.getCurrentPage()
    const totalPages = this.viewer.pageCount
    this.pageIndicator.textContent = `${currentPage} / ${totalPages}`
  }

  canAutoScroll() {
    return this.viewer.displayMode === 'vertical'
  }

  startAutoScroll() {
    if (this.isAutoScrolling) return
    if (!this.canAutoScroll()) return

    this.isAutoScrolling = true
    this.autoScrollLastTs = null
    this.autoScrollRafId = requestAnimationFrame((ts) => this.autoScrollTick(ts))
    this.updateAutoScrollButton()
    this.showAutoScrollSpeed(true)
  }

  stopAutoScroll() {
    if (!this.isAutoScrolling) return

    this.isAutoScrolling = false
    if (this.autoScrollRafId !== null) {
      cancelAnimationFrame(this.autoScrollRafId)
      this.autoScrollRafId = null
    }
    this.autoScrollLastTs = null
    this.updateAutoScrollButton()
    this.showAutoScrollSpeed(false)
  }

  toggleAutoScroll() {
    if (this.isAutoScrolling) {
      this.stopAutoScroll()
    } else {
      this.startAutoScroll()
    }
  }

  setAutoScrollSpeed(pps) {
    this.autoScrollSpeedPps = Math.max(10, Math.min(50, pps))
    this.updateAutoScrollSpeedDisplay()
  }

  autoScrollTick(timestamp) {
    if (!this.isAutoScrolling) return
    if (!this.canAutoScroll()) {
      this.stopAutoScroll()
      return
    }

    if (this.autoScrollLastTs === null) {
      this.autoScrollLastTs = timestamp
    }

    const dt = (timestamp - this.autoScrollLastTs) / 1000
    this.autoScrollLastTs = timestamp

    const deltaPx = this.autoScrollSpeedPps * dt
    const newScrollTop = this.viewport.scrollTop + deltaPx
    const maxScrollTop = this.viewport.scrollHeight - this.viewport.clientHeight

    if (newScrollTop >= maxScrollTop - 1) {
      this.viewport.scrollTop = maxScrollTop
      this.stopAutoScroll()
      return
    }

    this.viewport.scrollTop = newScrollTop
    this.autoScrollRafId = requestAnimationFrame((ts) => this.autoScrollTick(ts))
  }

  updateAutoScrollButton() {
    const btn = document.getElementById('toggle-autoscroll')
    if (!btn) return

    const label = btn.querySelector('span')
    if (label) label.textContent = this.isAutoScrolling ? 'Stop' : 'Auto'
    btn.setAttribute('aria-pressed', this.isAutoScrolling.toString())
    btn.disabled = !this.canAutoScroll()
  }

  showAutoScrollSpeed(visible) {
    if (this.autoscrollSpeedSection) {
      this.autoscrollSpeedSection.style.display = visible ? '' : 'none'
    }
  }

  updateAutoScrollSpeedDisplay() {
    const display = document.getElementById('autoscroll-speed-value')
    if (display) {
      display.textContent = `${Math.round(this.autoScrollSpeedPps)}`
    }
  }

  bindAutoScrollEvents() {
    const toggleBtn = document.getElementById('toggle-autoscroll')
    const speedInput = document.getElementById('autoscroll-speed')

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleAutoScroll())
    }

    if (speedInput) {
      speedInput.value = this.autoScrollSpeedPps
      speedInput.addEventListener('input', (e) => {
        this.setAutoScrollSpeed(parseFloat(e.target.value) || 30)
      })
    }

    this.viewport.addEventListener('wheel', () => {
      if (this.isAutoScrolling) this.stopAutoScroll()
    }, { passive: true })

    this.viewport.addEventListener('pointerdown', () => {
      if (this.isAutoScrolling) this.stopAutoScroll()
    })

    this.viewport.addEventListener('keydown', (e) => {
      if (this.isAutoScrolling && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        this.stopAutoScroll()
      }
    })
  }

  bindOutlineEvents() {
    if (this.toggleOutlineBtn) {
      this.toggleOutlineBtn.addEventListener('click', () => {
        this.viewer.toggleOutline()
      })
    }

    if (this.closeOutlineBtn) {
      this.closeOutlineBtn.addEventListener('click', () => {
        this.viewer.toggleOutline(false)
      })
    }

    this.container.addEventListener('viewer:outlineLoaded', (e) => {
      this.onOutlineLoaded(e.detail.items)
    })

    this.container.addEventListener('viewer:outlineToggle', (e) => {
      this.updateOutlinePanel(e.detail.open)
    })
  }

  onOutlineLoaded(items) {
    if (!this.toggleOutlineBtn) return

    if (items.length > 0) {
      this.toggleOutlineBtn.style.display = ''
      this.renderOutlineTree(items)
      this.hasOutlineItems = true
    } else {
      this.hasOutlineItems = false
      this.toggleOutlineBtn.style.display = 'none'
    }
  }

  renderOutlineTree(items, level = 1) {
    this.outlineTree.innerHTML = ''

    const renderItems = (items, container, currentLevel) => {
      items.forEach(item => {
        const btn = document.createElement('button')
        btn.className = `outline-item level-${Math.min(currentLevel, 5)}`
        btn.textContent = item.title

        if (item.page !== null) {
          btn.addEventListener('click', () => {
            this.viewer.navigateToPage(item.page)
            this.updatePageIndicator()
          })
        } else if (item.uri && (item.uri.startsWith('http://') || item.uri.startsWith('https://'))) {
          btn.addEventListener('click', () => {
            window.open(item.uri, '_blank', 'noopener,noreferrer')
          })
        }

        container.appendChild(btn)

        if (item.children && item.children.length > 0) {
          renderItems(item.children, container, currentLevel + 1)
        }
      })
    }

    renderItems(items, this.outlineTree, level)
  }

  updateOutlinePanel(isOpen) {
    if (this.outlinePanel) {
      if (isOpen) {
        this.outlinePanel.classList.add('open')
      } else {
        this.outlinePanel.classList.remove('open')
      }
    }

    if (this.toggleOutlineBtn) {
      this.toggleOutlineBtn.setAttribute('aria-pressed', isOpen.toString())
    }
  }

  destroy() {
    if (this.panzoom) {
      this.panzoom.destroy()
    }
  }
}
