import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as mupdf from 'mupdf'
import { loadCache, saveCacheAtomically, buildCacheData, getCachePath } from './pdf-cache.js'
import { isSupportedFile, getMimeType } from './formats.js'

const PDF_DIR = process.env.PDF_DIR || path.resolve('pdfs')
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL || '1800000', 10)

/**
 * @typedef {Object} PdfEntry
 * @property {string} id - MD5 hash of relative path
 * @property {string} name - Filename (basename)
 * @property {string} relPath - Relative path from PDF_DIR (POSIX separators)
 * @property {string} dirPath - Directory path (parent folder, POSIX)
 * @property {number} pageCount - Number of pages
 * @property {number} size - File size in bytes
 * @property {number} mtimeMs - Last modified time in ms
 * @property {string} filePath - Absolute file path (server-only)
 */

/**
 * @typedef {Object} FolderSummary
 * @property {string} path - Folder path relative to PDF_DIR ("" for root)
 * @property {string} name - Folder name ("" for root)
 * @property {string[]} childFolders - Direct child folder names
 * @property {string[]} childPdfIds - Direct child PDF ids
 * @property {number} folderCount - Count of direct child folders
 * @property {number} pdfCount - Count of direct child PDFs
 * @property {number} totalPdfCount - Total PDFs in subtree
 */

/** @type {Map<string, PdfEntry>} */
const byId = new Map()

/** @type {Map<string, PdfEntry>} */
const byRelPath = new Map()

/** @type {Map<string, FolderSummary>} */
const folderIndex = new Map()

function normalizeRelPath(p) {
  return p.split(path.sep).join('/')
}

function getDirPath(relPath) {
  const parts = relPath.split('/')
  parts.pop()
  return parts.join('/')
}

function hashRelPath(relPath) {
  return crypto.createHash('md5').update(relPath).digest('hex')
}

function extractMetadata(filePath) {
  const buffer = fs.readFileSync(filePath)
  const magic = getMimeType(filePath)
  const doc = mupdf.Document.openDocument(buffer, magic)
  try {
    const pageCount = doc.countPages()
    const stats = fs.statSync(filePath)
    return { pageCount, size: stats.size, mtimeMs: stats.mtimeMs }
  } finally {
    doc.destroy()
  }
}

function ensureFolderExists(folderPath) {
  if (folderIndex.has(folderPath)) return
  
  const parts = folderPath.split('/').filter(Boolean)
  const name = parts.length > 0 ? parts[parts.length - 1] : ''
  
  folderIndex.set(folderPath, {
    path: folderPath,
    name,
    childFolders: [],
    childPdfIds: [],
    folderCount: 0,
    pdfCount: 0,
    totalPdfCount: 0
  })
  
  if (parts.length > 1) {
    const parentPath = parts.slice(0, -1).join('/')
    ensureFolderExists(parentPath)
  }
}

function updateFolderRelationships() {
  for (const folder of folderIndex.values()) {
    folder.childFolders = []
    folder.childPdfIds = []
    folder.folderCount = 0
    folder.pdfCount = 0
  }
  
  for (const entry of byId.values()) {
    const parentPath = entry.dirPath
    ensureFolderExists(parentPath)
    const folder = folderIndex.get(parentPath)
    if (folder) {
      folder.childPdfIds.push(entry.id)
      folder.pdfCount++
    }
  }
  
  for (const [folderPath, folder] of folderIndex) {
    if (folderPath === '') continue
    
    const parts = folderPath.split('/')
    const parentPath = parts.slice(0, -1).join('/')
    ensureFolderExists(parentPath)
    const parent = folderIndex.get(parentPath)
    if (parent) {
      parent.childFolders.push(folder.name)
      parent.folderCount++
    }
  }
  
  function calculateTotals(folderPath) {
    const folder = folderIndex.get(folderPath)
    if (!folder) return 0
    
    let total = folder.pdfCount
    
    for (const childName of folder.childFolders) {
      const childPath = folderPath ? `${folderPath}/${childName}` : childName
      total += calculateTotals(childPath)
    }
    
    folder.totalPdfCount = total
    return total
  }
  
  ensureFolderExists('')
  calculateTotals('')
}

export function scanDirectoryRecursive() {
  console.log(`Scanning document directory recursively: ${PDF_DIR}`)
  
  if (!fs.existsSync(PDF_DIR)) {
    console.warn(`PDF directory does not exist: ${PDF_DIR}, creating...`)
    fs.mkdirSync(PDF_DIR, { recursive: true })
    return
  }
  
  const seenRelPaths = new Set()
  let added = 0
  let updated = 0
  let skipped = 0
  
  const stack = [{ absDir: PDF_DIR, relDir: '' }]
  
  while (stack.length > 0) {
    const { absDir, relDir } = stack.pop()
    
    let entries
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch (err) {
      console.error(`Failed to read directory ${absDir}:`, err.message)
      continue
    }
    
    for (const entry of entries) {
      const name = entry.name
      const absPath = path.join(absDir, name)
      const relPath = relDir ? `${relDir}/${name}` : name
      
      if (entry.isDirectory()) {
        stack.push({ absDir: absPath, relDir: relPath })
      } else if (entry.isFile() && isSupportedFile(name)) {
        const normalizedRelPath = normalizeRelPath(relPath)
        seenRelPaths.add(normalizedRelPath)
        
        try {
          const stats = fs.statSync(absPath)
          const existing = byRelPath.get(normalizedRelPath)
          
          if (existing && existing.mtimeMs === stats.mtimeMs && existing.size === stats.size) {
            skipped++
            continue
          }
          
          const metadata = extractMetadata(absPath)
          const id = hashRelPath(normalizedRelPath)
          
          const pdfEntry = {
            id,
            name,
            relPath: normalizedRelPath,
            dirPath: getDirPath(normalizedRelPath),
            pageCount: metadata.pageCount,
            size: metadata.size,
            mtimeMs: metadata.mtimeMs,
            filePath: absPath
          }
          
          if (existing && existing.id !== id) {
            byId.delete(existing.id)
          }
          
          byId.set(id, pdfEntry)
          byRelPath.set(normalizedRelPath, pdfEntry)
          
          if (existing) {
            updated++
          } else {
            added++
          }
          
        } catch (err) {
          console.error(`Failed to process ${name}:`, err.message)
        }
      }
    }
  }
  
  let removed = 0
  for (const [relPath, entry] of byRelPath) {
    if (!seenRelPaths.has(relPath)) {
      byId.delete(entry.id)
      byRelPath.delete(relPath)
      removed++
    }
  }
  
  folderIndex.clear()
  ensureFolderExists('')
  updateFolderRelationships()
  
  console.log(`Scan complete: ${byId.size} documents indexed (${added} added, ${updated} updated, ${skipped} unchanged, ${removed} removed)`)
}

export function getAllPdfs() {
  return Array.from(byId.values())
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
}

export function getPdfById(id) {
  return byId.get(id) || null
}

export function getPdfByRelPath(relPath) {
  return byRelPath.get(relPath) || null
}

/**
 * Get folder node for tree API
 * @param {string} folderPath - Folder path ("" for root)
 * @param {Object} opts - Options
 * @param {number} opts.limitFolders - Max folders to return
 * @param {number} opts.limitPdfs - Max PDFs to return
 */
export function getFolderNode(folderPath, {
  limitFolders = 200,
  limitPdfs = 200
} = {}) {
  const folder = folderIndex.get(folderPath)
  if (!folder) return null
  
  const childFolders = folder.childFolders.slice(0, limitFolders)
  const childPdfIds = folder.childPdfIds.slice(0, limitPdfs)
  
  const hasMoreFolders = folder.childFolders.length > limitFolders
  const hasMorePdfs = folder.childPdfIds.length > limitPdfs
  
  const folders = childFolders.map(name => {
    const childPath = folderPath ? `${folderPath}/${name}` : name
    const childFolder = folderIndex.get(childPath)
    return {
      type: 'folder',
      path: childPath,
      name,
      counts: {
        folders: childFolder?.folderCount || 0,
        pdfs: childFolder?.pdfCount || 0,
        totalPdfs: childFolder?.totalPdfCount || 0
      },
      hasChildren: (childFolder?.folderCount || 0) > 0 || (childFolder?.pdfCount || 0) > 0,
      loaded: false
    }
  })
  
  // Build PDF nodes
  const pdfs = childPdfIds.map(id => {
    const entry = byId.get(id)
    if (!entry) return null
    return {
      type: 'pdf',
      id: entry.id,
      name: entry.name,
      relPath: entry.relPath,
      dirPath: entry.dirPath,
      pageCount: entry.pageCount,
      size: entry.size,
      mtimeMs: entry.mtimeMs
    }
  }).filter(Boolean)
  
  return {
    type: 'folder',
    path: folderPath,
    name: folder.name || 'Root',
    counts: {
      folders: folder.folderCount,
      pdfs: folder.pdfCount,
      totalPdfs: folder.totalPdfCount
    },
    children: {
      folders,
      pdfs
    },
    hasMore: {
      folders: hasMoreFolders,
      pdfs: hasMorePdfs
    },
    loaded: true
  }
}

/**
 * Search PDFs by filename
 * @param {string} query - Search query
 * @param {Object} opts - Options
 * @param {number} opts.limit - Max results
 */
export function listSearchResults(query, {
  limit = 200
} = {}) {
  if (!query || query.trim() === '') {
    return []
  }
  
  const lowerQuery = query.toLowerCase()
  const results = []
  
  for (const entry of byId.values()) {
    const nameLower = entry.name.toLowerCase()
    const relPathLower = entry.relPath.toLowerCase()
    
    if (nameLower.includes(lowerQuery) || relPathLower.includes(lowerQuery)) {
      const nameIndex = nameLower.indexOf(lowerQuery)
      const pathIndex = relPathLower.indexOf(lowerQuery)
      
      let score = 1000
      if (nameIndex >= 0) {
        score = nameIndex
      } else if (pathIndex >= 0) {
        score = 500 + pathIndex
      }
      
      results.push({
        id: entry.id,
        name: entry.name,
        relPath: entry.relPath,
        dirPath: entry.dirPath,
        pageCount: entry.pageCount,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        score
      })
    }
  }
  
  results.sort((a, b) => a.score - b.score)
  
  return results.slice(0, limit)
}

/**
 * Get multiple PDFs by IDs
 * @param {string[]} ids - Array of PDF IDs
 */
export function getPdfsByIds(ids) {
  return ids
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(entry => ({
      id: entry.id,
      name: entry.name,
      relPath: entry.relPath,
      dirPath: entry.dirPath,
      pageCount: entry.pageCount,
      size: entry.size,
      mtimeMs: entry.mtimeMs
    }))
}

export function startPeriodicScan() {
  const cachePath = getCachePath()
  const cached = loadCache(cachePath, PDF_DIR)
  
  if (cached) {
    for (const pdf of cached.pdfs) {
      const entry = {
        ...pdf,
        filePath: path.join(PDF_DIR, pdf.relPath)
      }
      byId.set(entry.id, entry)
      byRelPath.set(entry.relPath, entry)
    }
    
    for (const folder of cached.folders) {
      folderIndex.set(folder.path, folder)
    }
    
    console.log(`Loaded cache: ${byId.size} documents, ${folderIndex.size} folders`)
    
    setTimeout(() => {
      try {
        scanDirectoryRecursive()
        const cacheData = buildCacheData(byId, folderIndex, PDF_DIR)
        saveCacheAtomically(cachePath, cacheData)
      } catch (err) {
        console.error('Background sync failed:', err)
      }
    }, 100)
  } else {
    scanDirectoryRecursive()
    const cacheData = buildCacheData(byId, folderIndex, PDF_DIR)
    saveCacheAtomically(cachePath, cacheData)
  }
  
  setInterval(() => {
    try {
      scanDirectoryRecursive()
      const cacheData = buildCacheData(byId, folderIndex, PDF_DIR)
      saveCacheAtomically(cachePath, cacheData)
    } catch (err) {
      console.error('Periodic scan failed:', err)
    }
  }, SCAN_INTERVAL)
  
  console.log(`Periodic scanning enabled: every ${SCAN_INTERVAL / 1000 / 60} minutes`)
}

ensureFolderExists('')