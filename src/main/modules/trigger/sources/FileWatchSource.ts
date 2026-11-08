/**
 * 文件变更事件源
 *
 * 不在本模块自建 watcher：直接订阅 guard/fileSystemObserver 的追加式监听者，
 * 复用已有的 @parcel/watcher 实例与忽略规则（node_modules / .git / .history 等），
 * 避免同一目录被监听两次。
 *
 * 事件主体使用归一化后的绝对路径；规则里用 `**` 通配即可跨目录匹配。
 *
 * @module trigger/sources/FileWatchSource
 */

import { logger } from '@shared/toolkit/LogEngine'
import { addFileChangeListener } from '../../../guard/fileSystemObserver'
import { TRIGGER_LOG_PREFIX, type TriggerEvent, type TriggerSource, type TriggerSourceType } from '../types'

export interface FileWatchSourceOptions {
  /** 源实例 id */
  id?: string
  /** 额外的路径过滤（返回 true 表示忽略），用于屏蔽不希望触发的高频目录 */
  shouldIgnore?: (absolutePath: string) => boolean
}

/** 默认忽略：仓库元数据、构建产物、依赖目录 */
const DEFAULT_IGNORED_SEGMENTS = [
  '/node_modules/',
  '/.git/',
  '/dist/',
  '/build/',
  '/.history/',
  '/.aweeclaw/',
]

/** 事件合并窗口：同一窗口内同一路径的多次变更只上抛最后一次 */
const MERGE_WINDOW_MS = 150

export class FileWatchSource implements TriggerSource {
  readonly id: string
  readonly type: TriggerSourceType = 'file'

  private readonly shouldIgnore?: (absolutePath: string) => boolean
  private unsubscribe: (() => void) | null = null

  /** 待上抛事件：normalizedPath → 最近一次变更 */
  private pending = new Map<string, { eventType: 'create' | 'update' | 'delete'; absolutePath: string }>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: FileWatchSourceOptions = {}) {
    this.id = options.id ?? 'file-watch'
    this.shouldIgnore = options.shouldIgnore
  }

  start(onEvent: (event: TriggerEvent) => void): void {
    if (this.unsubscribe) return

    this.unsubscribe = addFileChangeListener((data) => {
      const normalized = data.path.replace(/\\/g, '/')
      if (this.isIgnored(normalized)) return

      // 工作区级监听在一批发操作（AI 写文件、批量生成）时会瞬发大量事件，
      // 逐条上抛会让触发器逐条跑规则匹配；这里按路径合并后成批上抛。
      this.pending.set(normalized, { eventType: data.event, absolutePath: data.path })
      this.scheduleFlush(onEvent)
    })

    logger.system.info(`${TRIGGER_LOG_PREFIX} 文件变更源已接入: ${this.id}`)
  }

  stop(): void {
    if (!this.unsubscribe) return
    this.unsubscribe()
    this.unsubscribe = null
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pending.clear()
    logger.system.info(`${TRIGGER_LOG_PREFIX} 文件变更源已断开: ${this.id}`)
  }

  private scheduleFlush(onEvent: (event: TriggerEvent) => void): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush(onEvent)
    }, MERGE_WINDOW_MS)
  }

  private flush(onEvent: (event: TriggerEvent) => void): void {
    if (this.pending.size === 0) return
    const batch = Array.from(this.pending.entries())
    this.pending.clear()

    for (const [subject, item] of batch) {
      onEvent({
        sourceType: 'file',
        sourceId: this.id,
        // create | update | delete 直接透传为 eventType
        eventType: item.eventType,
        subject,
        payload: { absolutePath: item.absolutePath, event: item.eventType },
        timestamp: Date.now(),
      })
    }
  }

  private isIgnored(absolutePath: string): boolean {
    for (const segment of DEFAULT_IGNORED_SEGMENTS) {
      if (absolutePath.includes(segment)) return true
    }
    if (this.shouldIgnore) {
      try {
        return this.shouldIgnore(absolutePath)
      } catch {
        return false
      }
    }
    return false
  }
}
