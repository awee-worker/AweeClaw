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

export class FileWatchSource implements TriggerSource {
  readonly id: string
  readonly type: TriggerSourceType = 'file'

  private readonly shouldIgnore?: (absolutePath: string) => boolean
  private unsubscribe: (() => void) | null = null

  constructor(options: FileWatchSourceOptions = {}) {
    this.id = options.id ?? 'file-watch'
    this.shouldIgnore = options.shouldIgnore
  }

  start(onEvent: (event: TriggerEvent) => void): void {
    if (this.unsubscribe) return

    this.unsubscribe = addFileChangeListener((data) => {
      const normalized = data.path.replace(/\\/g, '/')
      if (this.isIgnored(normalized)) return

      onEvent({
        sourceType: 'file',
        sourceId: this.id,
        // create | update | delete 直接透传为 eventType
        eventType: data.event,
        subject: normalized,
        payload: { absolutePath: data.path, event: data.event },
        timestamp: Date.now(),
      })
    })

    logger.system.info(`${TRIGGER_LOG_PREFIX} 文件变更源已接入: ${this.id}`)
  }

  stop(): void {
    if (!this.unsubscribe) return
    this.unsubscribe()
    this.unsubscribe = null
    logger.system.info(`${TRIGGER_LOG_PREFIX} 文件变更源已断开: ${this.id}`)
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
