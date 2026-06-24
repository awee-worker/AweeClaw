/**
 * 文件监听服务 — 基于 @parcel/watcher 的文件变更监听
 *
 * 职责：
 * - 使用 @parcel/watcher 监听文件变化
 * - 通过 FileChangeBuffer 批量处理变更事件
 * - 触发索引更新和 LSP 通知
 *
 * 差异化特性（相比基础实现）：
 * - 与搜索引擎集成（FileChangeBuffer + indexOrchestrator）
 * - 与 LSP 语言服务集成（lspManager）
 * - picomatch 模式匹配（忽略 node_modules 等）
 * - 品牌配置通过 `@shared/brand` 集中管理
 */

import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { FileChangeBuffer, createFileChangeHandler } from '../search-engine/fileChangeQueue'
import { getIndexService } from '../search-engine/indexOrchestrator'
import { lspManager } from '../language-server/languageServerManager'
import * as watcher from '@parcel/watcher'
import picomatch from 'picomatch'
import { BRAND } from '@shared/brand'

export interface FileWatcherEvent {
  event: 'create' | 'update' | 'delete'
  path: string
}

export interface FileWatcherConfig {
  ignored: (string | RegExp)[]
  persistent: boolean
  ignoreInitial: boolean
  bufferTimeMs: number
  maxBufferSize: number
  maxWaitTimeMs: number
}

interface WatcherEntry {
  subscription: watcher.AsyncSubscription
  buffer: FileChangeBuffer
  root: string
}

const DEFAULT_CONFIG: FileWatcherConfig = {
  ignored: [/node_modules/, /\.git/, /dist/, /build/, new RegExp(`\\.${BRAND.dirName.slice(1)}`), '**/*.tmp', '**/*.temp'],
  persistent: true,
  ignoreInitial: true,
  bufferTimeMs: 500,
  maxBufferSize: 50,
  maxWaitTimeMs: 5000,
}

const watcherEntries = new Map<string, WatcherEntry>()

const LSP_FILE_CHANGE_TYPE = {
  create: 1,
  update: 2,
  delete: 3,
} as const

function createIgnoreMatcher(patterns: (string | RegExp)[]): (path: string) => boolean {
  const regexPatterns = patterns.filter((p): p is RegExp => p instanceof RegExp)
  const globPatterns = patterns.filter((p): p is string => typeof p === 'string')
  const globMatcher = globPatterns.length > 0 ? picomatch(globPatterns) : null

  return (filePath: string) => {
    for (const regex of regexPatterns) {
      if (regex.test(filePath)) return true
    }
    if (globMatcher && globMatcher(filePath)) return true
    return false
  }
}

function notifyLspFileChanges(changes: Array<{ path: string; type: 'create' | 'update' | 'delete' }>): void {
  const runningServers = lspManager.getRunningServers()
  if (runningServers.length === 0) return

  const lspChanges = changes.map(c => ({
    uri: pathToLspUri(c.path),
    type: LSP_FILE_CHANGE_TYPE[c.type],
  }))

  for (const serverKey of runningServers) {
    lspManager.notifyDidChangeWatchedFiles(serverKey, lspChanges)
  }
}

function pathToLspUri(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(normalizedPath)) {
    return `file:///${normalizedPath}`
  }
  return `file://${normalizedPath}`
}

function getBackend(): watcher.BackendType | undefined {
  switch (process.platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'fs-events'
    case 'linux':
      return 'inotify'
    default:
      return undefined
  }
}

export async function setupFileWatcher(
  watcherId: string,
  workspaceRoot: string,
  callback: (data: FileWatcherEvent) => void,
  config?: Partial<FileWatcherConfig>
): Promise<void> {
  if (!watcherId || !workspaceRoot) return

  await cleanupFileWatcher(watcherId)

  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  const shouldIgnore = createIgnoreMatcher(mergedConfig.ignored)
  const indexService = getIndexService(workspaceRoot)
  const fileChangeBuffer = createFileChangeHandler(indexService, {
    bufferTimeMs: mergedConfig.bufferTimeMs,
    maxBufferSize: mergedConfig.maxBufferSize,
    maxWaitTimeMs: mergedConfig.maxWaitTimeMs,
  })

  const watcherOptions: watcher.Options = {
    ignore: mergedConfig.ignored.filter((p): p is string => typeof p === 'string'),
    backend: getBackend(),
  }

  const subscription = await watcher.subscribe(workspaceRoot, (err, events) => {
    if (err) {
      logger.security.error('[Watcher] Error:', err)
      return
    }

    const lspChanges: Array<{ path: string; type: 'create' | 'update' | 'delete' }> = []

    for (const event of events) {
      if (shouldIgnore(event.path)) continue

      const eventType = event.type === 'create' ? 'create' : event.type === 'delete' ? 'delete' : 'update'
      callback({ event: eventType, path: event.path })
      fileChangeBuffer.add({ type: eventType, path: event.path, timestamp: Date.now() })
      lspChanges.push({ path: event.path, type: eventType })
    }

    if (lspChanges.length > 0) {
      notifyLspFileChanges(lspChanges)
    }
  }, watcherOptions)

  watcherEntries.set(watcherId, {
    subscription,
    buffer: fileChangeBuffer,
    root: workspaceRoot,
  })

  logger.security.info('[Watcher] File watcher started for:', workspaceRoot, 'id:', watcherId)
}

export async function cleanupFileWatcher(watcherId?: string): Promise<void> {
  const entries = watcherId
    ? (watcherEntries.has(watcherId) ? [[watcherId, watcherEntries.get(watcherId)!] as const] : [])
    : Array.from(watcherEntries.entries())

  await Promise.all(entries.map(async ([id, entry]) => {
    entry.buffer.destroy()
    watcherEntries.delete(id)

    logger.security.info('[Watcher] Cleaning up file watcher...', 'id:', id, 'root:', entry.root)
    try {
      await entry.subscription.unsubscribe()
    } catch (err) {
      logger.security.info('[Watcher] Cleanup completed (ignored error):', toAppError(err).message)
    }
  }))
}

export function getWatcherStatus(): {
  isActive: boolean
  hasBuffer: boolean
  bufferSize: number
} {
  const entries = Array.from(watcherEntries.values())

  return {
    isActive: entries.length > 0,
    hasBuffer: entries.length > 0,
    bufferSize: entries.reduce((sum, entry) => sum + entry.buffer.size(), 0),
  }
}

export function flushBuffer(watcherId?: string): void {
  if (watcherId) {
    watcherEntries.get(watcherId)?.buffer.flush()
    return
  }

  watcherEntries.forEach(entry => entry.buffer.flush())
}
