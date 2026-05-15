import { logger } from '@shared/toolkit/LogEngine'
import { app, type WebContents } from 'electron'
import { safeIpcHandle } from './ipcGuard'
import { spawn, type ChildProcess } from 'child_process'
import { rgPath } from '@vscode/ripgrep'
import * as path from 'path'
import * as fs from 'fs'
import type { SearchFilesOptions, SearchFileResult } from '@protocols'

interface SearchProfile {
  label: string
  includeGlobs: string[]
  excludeGlobs: string[]
  priorityExtensions: string[]
}

const SCENARIO_SEARCH_PROFILES: Record<string, SearchProfile> = {
  'code-review': {
    label: 'Code Review',
    includeGlobs: ['*.{ts,tsx,js,jsx,py,java,go,rs,c,cpp,h}'],
    excludeGlobs: ['*.min.js', '*.bundle.js', '*.generated.*'],
    priorityExtensions: ['.ts', '.tsx', '.py'],
  },
  'legal-review': {
    label: 'Legal Review',
    includeGlobs: ['*.{md,txt,doc,docx,pdf,dotx}'],
    excludeGlobs: ['*.exe', '*.bin'],
    priorityExtensions: ['.md', '.txt'],
  },
  'medical-diagnosis': {
    label: 'Medical Diagnosis',
    includeGlobs: ['*.{json,csv,xlsx,md,txt}'],
    excludeGlobs: ['*.tmp', '*.log'],
    priorityExtensions: ['.json', '.csv'],
  },
  'education-tutor': {
    label: 'Education Tutor',
    includeGlobs: ['*.{md,txt,pdf,ipynb,py}'],
    excludeGlobs: ['*.pyc', '__pycache__/**'],
    priorityExtensions: ['.md', '.ipynb'],
  },
  'store-diagnosis': {
    label: 'Store Diagnosis',
    includeGlobs: ['*.{json,csv,xlsx,md,sql}'],
    excludeGlobs: ['*.tmp'],
    priorityExtensions: ['.json', '.csv'],
  },
}

const EXCLUSION_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/vendor/bundle/**',
  '**/.tox/**',
  '**/target/**',
]

const SEARCH_TIMEOUT_MS = 30000
const STREAM_BATCH_SIZE = 50
const STREAM_FLUSH_INTERVAL_MS = 100
const MAX_RESULTS_PER_ROOT = 2000
const MAX_FILE_SIZE_BYTES = 1024 * 1024
const TEXT_PREVIEW_MAX_LENGTH = 500

const searchHistory: Array<{ query: string; timestamp: number; resultCount: number }> = []
const MAX_HISTORY_ENTRIES = 100

function resolveRgBinaryPath(): string {
  if (!app.isPackaged) return rgPath
  const unpacked = rgPath.replace('app.asar', 'app.asar.unpacked')
  return fs.existsSync(unpacked) ? unpacked : rgPath
}

function normalizePathSeparators(p: string): string {
  return p.toLowerCase().replace(/\\/g, '/')
}

function toRelativePath(absolutePath: string, rootPath: string): string {
  const normalized = normalizePathSeparators(absolutePath)
  const root = normalizePathSeparators(rootPath)
  if (normalized.startsWith(root)) {
    return absolutePath.slice(rootPath.length).replace(/^[/\\]+/, '')
  }
  return absolutePath
}

function computeRelevanceScore(result: SearchFileResult, query: string, profile?: SearchProfile): number {
  let score = 0
  const ext = path.extname(result.path).toLowerCase()
  if (profile?.priorityExtensions.includes(ext)) {
    score += 50
  }
  const fileName = path.basename(result.path).toLowerCase()
  if (fileName.includes(query.toLowerCase())) {
    score += 30
  }
  if (result.text.toLowerCase().includes(query.toLowerCase())) {
    score += 10
  }
  const depth = result.path.split(/[/\\]/).length
  score -= depth
  return score
}

function sortResultsByRelevance(results: SearchFileResult[], query: string, profile?: SearchProfile): SearchFileResult[] {
  return results
    .map(r => ({ ...r, _score: computeRelevanceScore(r, query, profile) }))
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...rest }) => rest)
}

function recordSearchHistory(query: string, resultCount: number): void {
  searchHistory.push({ query, timestamp: Date.now(), resultCount })
  if (searchHistory.length > MAX_HISTORY_ENTRIES) {
    searchHistory.splice(0, searchHistory.length - MAX_HISTORY_ENTRIES)
  }
}

function composeRipgrepArgs(query: string, rootPath: string, options: SearchFilesOptions, profile?: SearchProfile): string[] {
  const args = ['--json', '--max-count', String(MAX_RESULTS_PER_ROOT), '--max-filesize', `${MAX_FILE_SIZE_BYTES}`]

  args.push(options?.isCaseSensitive ? '--case-sensitive' : '--smart-case')

  if (options?.isWholeWord) args.push('--word-regexp')
  if (!options?.isRegex) args.push('--fixed-strings')

  for (const pattern of EXCLUSION_PATTERNS) {
    args.push('--glob', `!${pattern}`)
  }

  if (profile) {
    for (const glob of profile.includeGlobs) args.push('--glob', glob)
    for (const glob of profile.excludeGlobs) args.push('--glob', `!${glob}`)
  }

  if (options?.exclude) {
    options.exclude.split(',').filter(Boolean).forEach((ex: string) => args.push('--glob', `!${ex.trim()}`))
  }
  if (options?.include) {
    options.include.split(',').filter(Boolean).forEach((inc: string) => args.push('--glob', inc.trim()))
  }

  args.push('--', query, rootPath)
  return args
}

function extractMatchesFromRgJson(output: string, rootPath: string): SearchFileResult[] {
  const results: SearchFileResult[] = []
  const rootNormalized = normalizePathSeparators(rootPath)

  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.type === 'match') {
        const rawPath: string = entry.data.path.text
        const relativePath = normalizePathSeparators(rawPath).startsWith(rootNormalized)
          ? toRelativePath(rawPath, rootPath)
          : rawPath
        results.push({
          path: relativePath,
          line: entry.data.line_number,
          text: (entry.data.lines.text as string).trim().slice(0, TEXT_PREVIEW_MAX_LENGTH),
        })
      }
    } catch { /* skip malformed lines */ }
  }
  return results
}

function executeRgSearch(args: string[], rootPath: string): Promise<SearchFileResult[]> {
  return new Promise((resolve) => {
    const rg: ChildProcess = spawn(resolveRgBinaryPath(), args)
    let stdout = ''
    let stderr = false

    rg.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    rg.stderr?.on('data', (chunk) => {
      stderr = true
      logger.ipc.error('[RipgrepEngine]', chunk.toString().trim())
    })

    rg.on('close', (code) => {
      if (code && code > 1 && stderr) {
        logger.ipc.warn('[RipgrepEngine] exit code:', code)
      }
      resolve(extractMatchesFromRgJson(stdout, rootPath))
    })

    rg.on('error', (err) => {
      logger.ipc.error('[RipgrepEngine] spawn failed:', err.message)
      resolve([])
    })

    setTimeout(() => {
      if (!rg.killed) {
        logger.ipc.warn('[RipgrepEngine] timeout, terminating')
        rg.kill()
      }
    }, SEARCH_TIMEOUT_MS)
  })
}

async function searchWorkspace(
  query: string,
  rootPath: string,
  options: SearchFilesOptions,
  scenarioId?: string,
): Promise<SearchFileResult[]> {
  if (!query || !rootPath) return []

  const normalizedRoot = path.normalize(rootPath)
  if (!fs.existsSync(normalizedRoot)) {
    logger.ipc.warn(`[RipgrepEngine] Directory not found: ${normalizedRoot}`)
    return []
  }

  const profile = scenarioId ? SCENARIO_SEARCH_PROFILES[scenarioId] : undefined
  const args = composeRipgrepArgs(query, normalizedRoot, options, profile)
  const results = await executeRgSearch(args, normalizedRoot)

  if (profile || query) {
    return sortResultsByRelevance(results, query, profile)
  }
  return results
}

function streamWorkspaceSearch(
  query: string,
  rootPath: string,
  options: SearchFilesOptions,
  sender: WebContents,
  searchId: string,
  scenarioId?: string,
): Promise<void> {
  if (!query || !rootPath) return Promise.resolve()

  const normalizedRoot = path.normalize(rootPath)
  if (!fs.existsSync(normalizedRoot)) return Promise.resolve()

  const profile = scenarioId ? SCENARIO_SEARCH_PROFILES[scenarioId] : undefined
  const args = composeRipgrepArgs(query, normalizedRoot, options, profile)
  const rg: ChildProcess = spawn(resolveRgBinaryPath(), args)
  const rootNormalized = normalizePathSeparators(normalizedRoot)

  let pending = ''
  let batch: SearchFileResult[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const emitBatch = () => {
    if (batch.length > 0) {
      try { sender.send('search:results', searchId, batch) } catch { /* receiver gone */ }
      batch = []
    }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  }

  const scheduleEmit = () => {
    if (!flushTimer) flushTimer = setTimeout(emitBatch, STREAM_FLUSH_INTERVAL_MS)
  }

  const processLine = (line: string) => {
    if (!line.trim()) return
    try {
      const entry = JSON.parse(line)
      if (entry.type === 'match') {
        const rawPath: string = entry.data.path.text
        const relativePath = normalizePathSeparators(rawPath).startsWith(rootNormalized)
          ? toRelativePath(rawPath, normalizedRoot)
          : rawPath
        batch.push({
          path: relativePath,
          line: entry.data.line_number,
          text: (entry.data.lines.text as string).trim().slice(0, TEXT_PREVIEW_MAX_LENGTH),
        })
        if (batch.length >= STREAM_BATCH_SIZE) emitBatch()
        else scheduleEmit()
      }
    } catch { /* skip */ }
  }

  return new Promise((resolve) => {
    rg.stdout?.on('data', (chunk) => {
      pending += chunk.toString()
      const lines = pending.split('\n')
      pending = lines.pop() || ''
      lines.forEach(processLine)
    })

    rg.on('close', () => {
      processLine(pending)
      pending = ''
      emitBatch()
      try { sender.send('search:done', searchId) } catch { /* receiver gone */ }
      resolve()
    })

    rg.on('error', () => {
      emitBatch()
      try { sender.send('search:done', searchId) } catch { /* receiver gone */ }
      resolve()
    })

    setTimeout(() => { if (!rg.killed) rg.kill() }, SEARCH_TIMEOUT_MS)
  })
}

export function registerSearchHandlers() {
  safeIpcHandle('file:search', async (
    _event,
    query: string,
    rootPath: string | string[],
    options: SearchFilesOptions,
    scenarioId?: string,
  ) => {
    const roots = Array.isArray(rootPath) ? rootPath : [rootPath]
    try {
      const allResults = await Promise.all(
        roots.map(root => searchWorkspace(query, root, options, scenarioId))
      )
      const flat = allResults.flat()
      recordSearchHistory(query, flat.length)
      return flat
    } catch (error) {
      logger.ipc.error('[RipgrepEngine] search failed:', error)
      return []
    }
  })

  safeIpcHandle('file:search-stream', async (
    event,
    query: string,
    rootPath: string | string[],
    options: SearchFilesOptions,
    searchId: string,
    scenarioId?: string,
  ) => {
    const roots = Array.isArray(rootPath) ? rootPath : [rootPath]
    const sender = event.sender
    try {
      await Promise.all(
        roots.map(root => streamWorkspaceSearch(query, root, options, sender, searchId, scenarioId))
      )
      recordSearchHistory(query, 0)
    } catch (error) {
      logger.ipc.error('[RipgrepEngine] stream failed:', error)
      try { sender.send('search:done', searchId) } catch { /* receiver gone */ }
    }
  })

  safeIpcHandle('file:search-history', async () => {
    return searchHistory.slice(-20).reverse()
  })

  safeIpcHandle('file:search-profiles', async () => {
    return Object.entries(SCENARIO_SEARCH_PROFILES).map(([id, profile]) => ({
      id,
      label: profile.label,
      extensions: profile.priorityExtensions,
    }))
  })
}
