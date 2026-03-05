import * as fs from 'node:fs'
import * as path from 'node:path'

const CACHE_VERSION = 3
const CACHE_FILENAME = 'pdf-cache.json'

export function getCachePath() {
  return process.env.PDF_CACHE_PATH || path.resolve(CACHE_FILENAME)
}

export function loadCache(cachePath, pdfDir) {
  try {
    if (!fs.existsSync(cachePath)) {
      return null
    }
    
    const raw = fs.readFileSync(cachePath, 'utf-8')
    const data = JSON.parse(raw)
    
    if (data.version !== CACHE_VERSION) {
      console.log('Cache version mismatch, rebuilding...')
      return null
    }
    
    if (data.pdfDir !== pdfDir) {
      console.log('PDF directory changed, rebuilding cache...')
      return null
    }
    
    return {
      pdfs: data.pdfs || [],
      folders: data.folders || [],
      generatedAt: data.generatedAt
    }
  } catch (err) {
    console.error('Failed to load cache:', err.message)
    return null
  }
}

export function saveCacheAtomically(cachePath, data) {
  const tmpPath = `${cachePath}.tmp`
  
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, cachePath)
  } catch (err) {
    console.error('Failed to save cache:', err.message)
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath)
      }
    } catch {}
  }
}

export function buildCacheData(byId, folderIndex, pdfDir) {
  const pdfs = Array.from(byId.values()).map(entry => ({
    id: entry.id,
    name: entry.name,
    relPath: entry.relPath,
    dirPath: entry.dirPath,
    pageCount: entry.pageCount,
    size: entry.size,
    mtimeMs: entry.mtimeMs
  }))
  
  const folders = Array.from(folderIndex.values()).map(folder => ({
    path: folder.path,
    name: folder.name,
    childFolders: folder.childFolders,
    childPdfIds: folder.childPdfIds,
    folderCount: folder.folderCount,
    pdfCount: folder.pdfCount,
    totalPdfCount: folder.totalPdfCount
  }))
  
  return {
    version: CACHE_VERSION,
    pdfDir,
    generatedAt: Date.now(),
    pdfs,
    folders
  }
}