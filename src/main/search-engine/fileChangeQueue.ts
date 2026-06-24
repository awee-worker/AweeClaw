/**
 * 文件变更缓冲服务 — 批量索引更新的去抖动机制
 *
 * 通过组合多个专职组件实现文件变更的收集与批量触发：
 * - 事件合并器：将同文件的多次变更合并为单个事件
 * - 刷新调度器：基于定时器与阈值控制刷新时机
 * - 变更累积器：管理缓冲区状态与刷新回调
 */

import { logger } from '@shared/toolkit/LogEngine'

/* ------------------------------------------------------------------ */
/* 类型定义                                                           */
/* ------------------------------------------------------------------ */

/** 文件变更事件 */
export interface FileChangeEvent {
  type: 'create' | 'update' | 'delete'
  path: string
  timestamp: number
}

/** 缓冲区配置 */
export interface FileChangeBufferConfig {
  /** 缓冲时间（毫秒），在此时间内的变更会被合并 */
  bufferTimeMs: number
  /** 最大缓冲文件数，超过此数量立即触发 */
  maxBufferSize: number
  /** 最大等待时间（毫秒），超过此时间强制触发 */
  maxWaitTimeMs: number
}

/* ------------------------------------------------------------------ */
/* 默认配置                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG: FileChangeBufferConfig = {
  bufferTimeMs: 500,
  maxBufferSize: 50,
  maxWaitTimeMs: 5000,
}

/* ------------------------------------------------------------------ */
/* 事件合并器                                                         */
/* ------------------------------------------------------------------ */

/** 将同文件的多次变更事件合并为最终状态 */
class EventMerger {
  /**
   * 合并已有事件与新事件
   *
   * @param existing 已存在的变更事件
   * @param incoming 新到达的变更事件
   * @returns 合并后的事件；返回 null 表示事件互相抵消（创建后删除）
   */
  merge(existing: FileChangeEvent, incoming: FileChangeEvent): FileChangeEvent | null {
    // 创建后更新：保持创建语义
    if (existing.type === 'create' && incoming.type === 'update') {
      return { ...incoming, type: 'create' }
    }

    // 创建后删除：互相抵消
    if (existing.type === 'create' && incoming.type === 'delete') {
      return null
    }

    return incoming
  }
}

/* ------------------------------------------------------------------ */
/* 刷新调度器                                                         */
/* ------------------------------------------------------------------ */

/** 基于定时器与阈值控制刷新时机 */
class FlushScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private firstEventTime: number | null = null

  /**
   * @param bufferTimeMs 缓冲时间
   * @param maxWaitTimeMs 最大等待时间
   * @param onTimeout 定时器触发时的回调
   */
  constructor(
    private readonly bufferTimeMs: number,
    private readonly maxWaitTimeMs: number,
    private readonly onTimeout: () => void,
  ) {}

  /** 记录首个事件时间并启动定时器 */
  schedule(): void {
    if (this.firstEventTime === null) {
      this.firstEventTime = Date.now()
    }
    this.resetTimer()
  }

  /** 判断是否超过最大等待时间 */
  isMaxWaitExceeded(): boolean {
    if (this.firstEventTime === null) return false
    return Date.now() - this.firstEventTime >= this.maxWaitTimeMs
  }

  /** 重置定时器 */
  resetTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => this.onTimeout(), this.bufferTimeMs)
  }

  /** 取消定时器并重置状态 */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.firstEventTime = null
  }

  /** 当缓冲区为空时清理定时器 */
  cleanupIfEmpty(bufferSize: number): void {
    if (bufferSize === 0 && this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.firstEventTime = null
    }
  }
}

/* ------------------------------------------------------------------ */
/* 变更累积器                                                         */
/* ------------------------------------------------------------------ */

/** 管理缓冲区状态，协调事件合并与刷新调度 */
class ChangeAccumulator {
  private readonly buffer = new Map<string, FileChangeEvent>()
  private readonly merger = new EventMerger()

  /**
   * @param scheduler 刷新调度器
   */
  constructor(private readonly scheduler: FlushScheduler) {}

  /**
   * 添加变更事件到缓冲区
   *
   * @param event 文件变更事件
   * @returns 事件是否互相抵消（创建后删除）
   */
  push(event: FileChangeEvent): boolean {
    const existing = this.buffer.get(event.path)
    if (existing) {
      const merged = this.merger.merge(existing, event)
      if (merged === null) {
        this.buffer.delete(event.path)
        this.scheduler.cleanupIfEmpty(this.buffer.size)
        return true
      }
      this.buffer.set(event.path, merged)
    } else {
      this.buffer.set(event.path, event)
    }
    return false
  }

  /** 获取缓冲区大小 */
  get size(): number {
    return this.buffer.size
  }

  /** 判断缓冲区是否为空 */
  isEmpty(): boolean {
    return this.buffer.size === 0
  }

  /** 取出所有事件并清空缓冲区 */
  drain(): FileChangeEvent[] {
    const events = Array.from(this.buffer.values())
    this.buffer.clear()
    return events
  }

  /** 清空缓冲区 */
  clear(): void {
    this.buffer.clear()
  }
}

/* ------------------------------------------------------------------ */
/* 文件变更缓冲区（外观）                                             */
/* ------------------------------------------------------------------ */

/** 文件变更缓冲区 — 协调事件合并、刷新调度与回调触发 */
export class FileChangeBuffer {
  private readonly config: FileChangeBufferConfig
  private readonly scheduler: FlushScheduler
  private readonly accumulator: ChangeAccumulator
  private readonly onFlush: (events: FileChangeEvent[]) => void

  constructor(
    onFlush: (events: FileChangeEvent[]) => void,
    config?: Partial<FileChangeBufferConfig>,
  ) {
    this.onFlush = onFlush
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.scheduler = new FlushScheduler(
      this.config.bufferTimeMs,
      this.config.maxWaitTimeMs,
      () => this.flush(),
    )
    this.accumulator = new ChangeAccumulator(this.scheduler)
  }

  /** 添加文件变更事件 */
  add(event: FileChangeEvent): void {
    const cancelled = this.accumulator.push(event)
    if (cancelled) return

    if (this.accumulator.size >= this.config.maxBufferSize) {
      logger.index.info(`[FileChangeBuffer] 达到最大缓冲数 (${this.accumulator.size})，立即刷新`)
      this.flush()
      return
    }

    if (this.scheduler.isMaxWaitExceeded()) {
      logger.index.info('[FileChangeBuffer] 超过最大等待时间，立即刷新')
      this.flush()
      return
    }

    this.scheduler.schedule()
  }

  /** 批量添加事件 */
  addBatch(events: FileChangeEvent[]): void {
    for (const event of events) {
      this.add(event)
    }
  }

  /** 立即刷新缓冲区 */
  flush(): void {
    this.scheduler.cancel()
    if (this.accumulator.isEmpty()) return

    const events = this.accumulator.drain()
    logger.index.info(`[FileChangeBuffer] 刷新 ${events.length} 个事件`)
    this.onFlush(events)
  }

  /** 获取当前缓冲区大小 */
  size(): number {
    return this.accumulator.size
  }

  /** 清空缓冲区（不触发回调） */
  clear(): void {
    this.scheduler.cancel()
    this.accumulator.clear()
  }

  /** 销毁 */
  destroy(): void {
    this.clear()
  }
}

/* ------------------------------------------------------------------ */
/* 工厂函数                                                           */
/* ------------------------------------------------------------------ */

/**
 * 创建带有去重功能的文件变更处理器
 *
 * @param indexService 索引服务，提供文件更新与删除接口
 * @param config 缓冲区配置
 * @returns 文件变更缓冲区实例
 */
export function createFileChangeHandler(
  indexService: {
    updateFiles: (paths: string[]) => Promise<void>
    deleteFileIndex: (path: string) => Promise<void>
  },
  config?: Partial<FileChangeBufferConfig>,
): FileChangeBuffer {
  return new FileChangeBuffer(async (events) => {
    const deleteEvents = events.filter((e) => e.type === 'delete')
    const updateEvents = events.filter((e) => e.type !== 'delete')

    for (const event of deleteEvents) {
      await indexService.deleteFileIndex(event.path)
    }

    if (updateEvents.length > 0) {
      const paths = updateEvents.map((e) => e.path)
      await indexService.updateFiles(paths)
    }
  }, config)
}
