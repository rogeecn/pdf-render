import * as fs from 'node:fs'
import * as path from 'node:path'

const CACHE_VERSION = 6
const CACHE_FILENAME = 'ebook-cache.json'

export function getCachePath() {
  if (process.env.EBOOK_CACHE_PATH) return process.env.EBOOK_CACHE_PATH
  const dataDir = process.env.DATA_DIR || path.resolve('data')
  return path.join(dataDir, CACHE_FILENAME)
}

export function loadCache(cachePath, ebookDir) {
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
    
    if (data.ebookDir !== ebookDir) {
      console.log('Ebook directory changed, rebuilding cache...')
      return null
    }
    
    return {
      ebooks: data.ebooks || [],
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
  const dir = path.dirname(cachePath)
  
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
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

export function buildCacheData(byId, folderIndex, ebookDir) {
  const ebooks = Array.from(byId.values()).map(entry => ({
    id: entry.id,
    name: entry.name,
    relPath: entry.relPath,
    dirPath: entry.dirPath,
    filePath: entry.filePath,
    pageCount: entry.pageCount,
    size: entry.size,
    mtimeMs: entry.mtimeMs
  }))
  
  const folders = Array.from(folderIndex.values()).map(folder => ({
    path: folder.path,
    name: folder.name,
    childFolders: folder.childFolders,
    childEbookIds: folder.childEbookIds,
    folderCount: folder.folderCount,
    ebookCount: folder.ebookCount,
    totalEbookCount: folder.totalEbookCount
  }))
  
  return {
    version: CACHE_VERSION,
    ebookDir,
    generatedAt: Date.now(),
    ebooks,
    folders
  }
}