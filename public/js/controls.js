import Panzoom from '/js/vendor/panzoom.es.js'

export class ViewerControls {
  constructor(viewer) {
    this.viewer = viewer
    this.panzoom = null
    this.currentZoom = 1.0

    this.viewport = document.getElementById('viewport')
    this.container = document.getElementById('page-container')
    this.zoomInBtn = document.getElementById('zoom-in')
    this.zoomOutBtn = document.getElementById('zoom-out')
    this.fitWidthBtn = document.getElementById('fit-width')
    this.fitPageBtn = document.getElementById('fit-page')
    this.resetBtn = document.getElementById('reset')
    this.zoomLevel = document.getElementById('zoom-level')
    this.pageIndicator = document.getElementById('page-indicator')
  }

  init() {
    this.setupPanzoom()
    this.bindToolbarEvents()
    this.bindScrollEvents()
    this.updateZoomDisplay()
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
      const containerWidth = this.container.scrollWidth
      const targetScale = viewportWidth / containerWidth
      this.panzoom.zoom(targetScale, { animate: true })
      this.panzoom.pan(0, 0, { animate: true })
      this.onZoomChange()
    })

    this.fitPageBtn.addEventListener('click', () => {
      this.panzoom.reset({ animate: true })
      this.onZoomChange()
    })

    this.resetBtn.addEventListener('click', () => {
      this.panzoom.reset({ animate: true })
      this.onZoomChange()
    })
  }

  bindScrollEvents() {
    this.viewport.addEventListener('scroll', () => {
      this.updatePageIndicator()
    })
  }

  onZoomChange() {
    this.currentZoom = this.panzoom.getScale()
    this.updateZoomDisplay()
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

  destroy() {
    if (this.panzoom) {
      this.panzoom.destroy()
    }
  }
}
