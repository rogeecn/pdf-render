export class TextLayer {
  constructor() {
    this.container = null
  }

  render(textData, container, displayWidth, displayHeight) {
    this.container = container
    this.clear()

    const scaleX = displayWidth / textData.width
    const scaleY = displayHeight / textData.height

    const fragment = document.createDocumentFragment()

    for (const block of textData.blocks) {
      if (block.type !== 'text') continue

      for (const line of block.lines) {
        if (!line.text || line.text.trim() === '') continue

        const span = document.createElement('span')
        span.textContent = line.text

        span.style.left = `${line.bbox.x * scaleX}px`
        span.style.top = `${line.bbox.y * scaleY}px`
        span.style.width = `${line.bbox.w * scaleX}px`
        span.style.height = `${line.bbox.h * scaleY}px`
        span.style.fontSize = `${line.font.size * scaleY}px`

        fragment.appendChild(span)
      }
    }

    this.container.appendChild(fragment)
  }

  clear() {
    if (this.container) {
      this.container.innerHTML = ''
    }
  }
}
