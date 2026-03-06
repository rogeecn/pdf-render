import sanitizeHtml from 'sanitize-html'
import markdownit from 'markdown-it'

const md = markdownit({
  html: true,
  linkify: true,
  typographer: true
})

/** @type {sanitizeHtml.IOptions} */
const SANITIZE_OPTIONS = {
  // MuPDF renders server-side (no browser), so <style> is safe here
  allowVulnerableTags: true,
  allowedTags: [
    // Structure
    'html', 'head', 'body', 'div', 'span', 'p', 'blockquote', 'pre', 'hr', 'br',
    'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
    // Headings
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Lists
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    // Text formatting
    'b', 'strong', 'i', 'em', 'u', 'mark', 'small', 'sub', 'sup',
    'abbr', 'cite', 'code', 'kbd', 'samp', 'var', 's', 'del', 'ins', 'q',
    // Links & images
    'a', 'img', 'figure', 'figcaption',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'col', 'colgroup',
    // Other
    'details', 'summary', 'time', 'ruby', 'rt', 'rp',
    // Meta (needed for MuPDF HTML parsing)
    'title', 'meta', 'link', 'style'
  ],
  allowedAttributes: {
    '*': ['id', 'class', 'title', 'lang', 'dir', 'style'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    col: ['span'],
    colgroup: ['span'],
    time: ['datetime'],
    meta: ['charset', 'name', 'content'],
    link: ['rel', 'href', 'type'],
    style: []
  },
  allowedSchemes: ['http', 'https', 'data', 'mailto'],
  // Strip all script/iframe/object/embed/form elements entirely
  disallowedTagsMode: 'discard',
  // Allow style tags but filter dangerous CSS
  allowedStyles: {
    '*': {
      'color': [/.*/],
      'background-color': [/.*/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [/.*/],
      'font-weight': [/.*/],
      'font-style': [/.*/],
      'font-family': [/.*/],
      'text-decoration': [/.*/],
      'margin': [/.*/],
      'margin-top': [/.*/],
      'margin-bottom': [/.*/],
      'margin-left': [/.*/],
      'margin-right': [/.*/],
      'padding': [/.*/],
      'padding-top': [/.*/],
      'padding-bottom': [/.*/],
      'padding-left': [/.*/],
      'padding-right': [/.*/],
      'border': [/.*/],
      'width': [/.*/],
      'height': [/.*/],
      'max-width': [/.*/],
      'line-height': [/.*/],
      'display': [/^(block|inline|inline-block|none|flex|table|table-row|table-cell)$/],
      'vertical-align': [/.*/],
      'list-style-type': [/.*/],
      'white-space': [/.*/]
    }
  }
}

/**
 * Sanitize HTML content by stripping dangerous elements
 * (script, iframe, on* handlers, javascript: URLs, etc.)
 * @param {string} html - Raw HTML content
 * @returns {string} Sanitized HTML
 */
export function sanitizeEbookHtml(html) {
  return sanitizeHtml(html, SANITIZE_OPTIONS)
}

/**
 * Convert Markdown to sanitized HTML document suitable for MuPDF rendering
 * @param {string} markdown - Raw Markdown content
 * @returns {string} Full HTML document string
 */
export function markdownToHtml(markdown) {
  const body = md.render(markdown)
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: serif; font-size: 12pt; line-height: 1.6; margin: 2em; }
h1 { font-size: 2em; margin-bottom: 0.5em; }
h2 { font-size: 1.5em; margin-bottom: 0.5em; }
h3 { font-size: 1.25em; margin-bottom: 0.5em; }
code { font-family: monospace; background: #f0f0f0; padding: 0.1em 0.3em; }
pre { background: #f0f0f0; padding: 1em; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #555; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 0.5em; text-align: left; }
th { background: #f5f5f5; font-weight: bold; }
img { max-width: 100%; height: auto; }
</style>
</head>
<body>
${body}
</body>
</html>`
  return sanitizeEbookHtml(html)
}

/**
 * Check if a file extension requires HTML preprocessing (sanitization/conversion)
 * @param {string} ext - File extension (e.g., '.html', '.md')
 * @returns {boolean}
 */
export function needsHtmlPreprocessing(ext) {
  return ['.html', '.xhtml', '.md'].includes(ext.toLowerCase())
}

/**
 * Check if a file extension is for a reflowable document that needs layout()
 * @param {string} ext - File extension
 * @returns {boolean}
 */
export function isReflowable(ext) {
  return ['.html', '.xhtml', '.md', '.epub', '.fb2', '.mobi'].includes(ext.toLowerCase())
}

/**
 * Preprocess file buffer for formats that need it (HTML sanitization, MD conversion)
 * Returns { buffer, magic } ready for MuPDF openDocument
 * @param {Buffer} buffer - Raw file buffer
 * @param {string} ext - File extension
 * @returns {{ buffer: Buffer, magic: string }}
 */
export function preprocessBuffer(buffer, ext) {
  const lowerExt = ext.toLowerCase()

  if (lowerExt === '.md') {
    const markdown = buffer.toString('utf-8')
    const html = markdownToHtml(markdown)
    return { buffer: Buffer.from(html, 'utf-8'), magic: '.xhtml' }
  }

  if (lowerExt === '.html' || lowerExt === '.xhtml') {
    const raw = buffer.toString('utf-8')
    const sanitized = sanitizeEbookHtml(raw)
    return { buffer: Buffer.from(sanitized, 'utf-8'), magic: lowerExt }
  }

  // No preprocessing needed
  return { buffer, magic: lowerExt }
}

const TXT_LINES_PER_PAGE = 200

/**
 * Check if a file extension is a direct-render text format (bypasses MuPDF)
 * @param {string} ext - File extension
 * @returns {boolean}
 */
export function isDirectRenderFormat(ext) {
  return ['.html', '.xhtml', '.md', '.txt'].includes(ext.toLowerCase())
}

/**
 * Convert raw file buffer to an array of sanitized HTML page strings for direct browser rendering.
 * - TXT: split by lines into chunks, wrap in <pre>
 * - MD: convert to HTML via markdown-it, return as single page
 * - HTML/XHTML: sanitize, return as single page
 * @param {Buffer} buffer - Raw file content
 * @param {string} ext - File extension (e.g. '.txt', '.md', '.html')
 * @returns {{ pages: string[], totalLines?: number }}
 */
export function bufferToHtmlPages(buffer, ext) {
  const lowerExt = ext.toLowerCase()

  if (lowerExt === '.txt') {
    const text = buffer.toString('utf-8')
    const lines = text.split(/\r?\n/)
    const pages = []

    for (let i = 0; i < lines.length; i += TXT_LINES_PER_PAGE) {
      const chunk = lines.slice(i, i + TXT_LINES_PER_PAGE)
      const escaped = chunk
        .map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .join('\n')
      pages.push(`<pre class="txt-content">${escaped}</pre>`)
    }

    if (pages.length === 0) {
      pages.push('<pre class="txt-content"></pre>')
    }

    return { pages, totalLines: lines.length }
  }

  if (lowerExt === '.md') {
    const markdown = buffer.toString('utf-8')
    const html = markdownToHtml(markdown)
    return { pages: [html] }
  }

  const raw = buffer.toString('utf-8')
  const sanitized = sanitizeEbookHtml(raw)
  return { pages: [sanitized] }
}
