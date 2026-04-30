/**
 * 文件变更缓冲服务
 * 收集文件变更事件，批量触发索引更新
 * 避免频繁的单文件更新导致性能问题
 */

import { logger } from '@shared/utils/Logger'

export interface FileChangeEvent {
  type: 'create' | 'update' | 'delete'
  path: string
  timestamp: number
}

export interface FileChangeBufferConfig {
  /** 缓冲时间（毫秒），在此时间内的变更会被合并 */
  bufferTimeMs: number
  /** 最大缓冲文件数，超过此数量立即触发 */
  maxBufferSize: number
  /** 最大等待时间（毫秒），超过此时间强制触发 */
  maxWaitTimeMs: number
}

const DEFAULT_CONFIG: FileChangeBufferConfig = {
  bufferTimeMs: 500,
  maxBufferSize: 50,
  maxWaitTimeMs: 5000,
}

export class FileChangeBuffer {
  private buffer: Map<string, FileChangeEvent> = new Map()
  private timer: NodeJS.Timeout | null = null
  private firstEventTime: number | null = null
  private config: FileChangeBufferConfig
  private onFlush: (events: FileChangeEvent[]) => void

  constructor(
    onFlush: (events: FileChangeEvent[]) => void,
    config?: Partial<FileChangeBufferConfig>
  ) {
    this.onFlush = onFlush
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 添加文件变更事件
   */
  add(event: FileChangeEvent): void {
    const existing = this.buffer.get(event.path)

    // 合并事件逻辑
    if (existing) {
      // 如果已有 create，后续 update 保持为 create
      if (existing.type === 'create' && event.type === 'update') {
        event.type = 'create'
      }
      // 如果已有 create/update，后续 delete 直接删除（新建后删除 = 无操作）
      if ((existing.type === 'create') && event.type === 'delete') {
        this.buffer.delete(event.path)
        this.checkFlush()
        return
      }
    }

    this.buffer.set(event.path, event)

    // 记录第一个事件时间
    if (this.firstEventTime === null) {
      this.firstEventTime = Date.now()
    }

    // 检查是否需要立即刷新
    if (this.buffer.size >= this.config.maxBufferSize) {
      logger.index.info(`[FileChangeBuffer] Max buffer size reached (${this.buffer.size}), flushing...`)
      this.flush()
      return
    }

    // 检查是否超过最大等待时间
    if (Date.now() - this.firstEventTime >= this.config.maxWaitTimeMs) {
      logger.index.info(`[FileChangeBuffer] Max wait time reached, flushing...`)
      this.flush()
      return
    }

    // 重置定时器
    this.resetTimer()
  }

  /**
   * 批量添加事件
   */
  addBatch(events: FileChangeEvent[]): void {
    for (const event of events) {
      this.add(event)
    }
  }

  /**
   * 立即刷新缓冲区
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.buffer.size === 0) {
      return
    }

    const events = Array.from(this.buffer.values())
    this.buffer.clear()
    this.firstEventTime = null

    logger.index.info(`[FileChangeBuffer] Flushing ${events.length} events`)
    this.onFlush(events)
  }

  /**
   * 获取当前缓冲区大小
   */
  size(): number {
    return this.buffer.size
  }

  /**
   * 清空缓冲区（不触发回调）
   */
  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.buffer.clear()
    this.firstEventTime = null
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.clear()
  }

  private resetTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }

    this.timer = setTimeout(() => {
      this.flush()
    }, this.config.bufferTimeMs)
  }

  private checkFlush(): void {
    if (this.buffer.size === 0 && this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.firstEventTime = null
    }
  }
}

/**
 * 创建带有去重功能的文件变更处理器
 */
export function createFileChangeHandler(
  indexService: { updateFiles: (paths: string[]) => Promise<void>; deleteFileIndex: (path: string) => Promise<void> },
  config?: Partial<FileChangeBufferConfig>
): FileChangeBuffer {
  return new FileChangeBuffer(async (events) => {
    // 分离删除和更新事件
    const deleteEvents = events.filter(e => e.type === 'delete')
    const updateEvents = events.filter(e => e.type !== 'delete')

    // 处理删除
    for (const event of deleteEvents) {
      await indexService.deleteFileIndex(event.path)
    }

    // 批量处理更新
    if (updateEvents.length > 0) {
      const paths = updateEvents.map(e => e.path)
      await indexService.updateFiles(paths)
    }
  }, config)
}
