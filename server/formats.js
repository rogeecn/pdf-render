/** @type {Set<string>} */
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.epub', '.xps', '.oxps', '.cbz', '.fb2',
  '.mobi', '.cbt', '.html', '.xhtml', '.md', '.txt'
])

export { SUPPORTED_EXTENSIONS }

/** @param {string} filePath @returns {string} MuPDF magic string (file extension) */
export function getMimeType(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return SUPPORTED_EXTENSIONS.has(ext) ? ext : 'application/pdf'
}

/** @param {string} name @returns {boolean} */
export function isSupportedFile(name) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return SUPPORTED_EXTENSIONS.has(ext)
}
