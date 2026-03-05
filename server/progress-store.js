import * as fs from 'node:fs'
import * as path from 'node:path'

const PROGRESS_FILENAME = 'reading-progress.json'
const STORE_VERSION = 1

/** @type {Map<string, { page: number, updatedAt: number }>} */
const progressMap = new Map()

let progressFilePath = null

export function getProgressFilePath() {
  if (!progressFilePath) {
    progressFilePath = process.env.PROGRESS_PATH || path.resolve(PROGRESS_FILENAME)
  }
  return progressFilePath
}

export function loadProgress() {
  const filePath = getProgressFilePath()
  try {
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

export function getProgress(pdfId) {
  return progressMap.get(pdfId) || null
}

export function setProgress(pdfId, page) {
  progressMap.set(pdfId, { page, updatedAt: Date.now() })
  saveProgress()
}

export function getAllProgress() {
  return Object.fromEntries(progressMap)
}
