import * as fs from 'node:fs'
import * as path from 'node:path'

const PROGRESS_FILENAME = 'reading-progress.json'
const STORE_VERSION = 2

/** @type {Map<string, { page: number, updatedAt: number, relPath: string, filePath: string, settings?: { displayMode?: string, zoom?: number, bgColor?: string } }>} */
const progressMap = new Map()

let progressFilePath = null

export function getProgressFilePath() {
  if (!progressFilePath) {
    if (process.env.PROGRESS_PATH) {
      progressFilePath = process.env.PROGRESS_PATH
    } else {
      const dataDir = process.env.DATA_DIR || path.resolve('data')
      progressFilePath = path.join(dataDir, PROGRESS_FILENAME)
    }
  }
  return progressFilePath
}

export function loadProgress() {
  const filePath = getProgressFilePath()
  const dir = path.dirname(filePath)
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(filePath)) return
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (data.version !== STORE_VERSION) return

    progressMap.clear()
    for (const [id, entry] of Object.entries(data.entries || {})) {
      progressMap.set(id, entry)
    }
    console.log(`Loaded reading progress: ${progressMap.size} entries`)
  } catch (err) {
    console.error('Failed to load reading progress:', err.message)
  }
}

function saveProgress() {
  const filePath = getProgressFilePath()
  const tmpPath = `${filePath}.tmp`
  try {
    const data = {
      version: STORE_VERSION,
      entries: Object.fromEntries(progressMap)
    }
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    console.error('Failed to save reading progress:', err.message)
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {}
  }
}

export function getProgress(ebookId) {
  return progressMap.get(ebookId) || null
}

export function setProgress(ebookId, page, relPath, filePath, settings) {
  const entry = { page, updatedAt: Date.now(), relPath, filePath }
  if (settings) entry.settings = settings
  progressMap.set(ebookId, entry)
  saveProgress()
}

export function getAllProgress() {
  return Object.fromEntries(progressMap)
}
