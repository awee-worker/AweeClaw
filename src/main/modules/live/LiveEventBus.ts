/**
 * 直播事件总线（主进程）
 *
 * 职责（对应 P0-2 关键设计点 5 / 6）：
 *   1. **归一化**：所有平台适配器都通过 `publish()` 投递同一结构事件
 *   2. **去重**：按 `id` 做 LRU（上限 1000），防重连后服务端重放
 *   3. **洪水保护**：1s 窗口内超过阈值时丢弃低优先级类型（like / enter_room），
 *      保住 danmaku / gift / super_chat 等有价值事件
 *   4. **可观测**：保留最近事件与计数器，供 `live:get-status` 排障
 *
 * 刻意用组合而非继承 EventEmitter：
 * 继承会让 `on/emit` 带上一堆宽泛签名，业务侧拿不到精确的事件类型。
 *
 * @module live/LiveEventBus
 */

import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import type { LiveDanmuType, LiveEvent, LivePlatform } from './types'

// ============================================
// 常量
// ============================================

/** 去重表上限（LRU 逐出） */
const DEDUP_LIMIT = 1000

/** 最近事件环形缓存上限 */
export const RECENT_EVENT_LIMIT = 50

/** 洪水保护窗口（ms） */
const FLOOD_WINDOW_MS = 1000

/** 洪水保护阈值（窗口内条数，超过后开始丢弃低优先级） */
const FLOOD_THRESHOLD = 20

/** 低优先级类型：洪水时优先丢弃 */
const LOW_PRIORITY_TYPES: ReadonlySet<LiveDanmuType> = new Set<LiveDanmuType>([
  'like',
  'enter_room',
])

/** 洪水丢弃日志最小间隔（ms），避免刷日志 */
const FLOOD_LOG_INTERVAL_MS = 10_000

// ============================================
// 事件构造
// ============================================

/**
 * 构造一条归一化事件。
 *
 * 适配器统一走这里，保证 `type` / `ts` / `id` 三处不会各写各的。
 */
export function createLiveEvent(
  platform: LivePlatform,
  danmu_type: LiveDanmuType,
  content: string,
  raw?: unknown,
): LiveEvent {
  return {
    id: randomUUID(),
    type: 'message',
    content,
    danmu_type,
    platform,
    raw,
    ts: Date.now(),
  }
}

// ============================================
// LiveEventBus
// ============================================

export class LiveEventBus {
  private readonly emitter = new EventEmitter()

  /** 去重表：id → 首次出现时间（Map 保持插入顺序，用于 LRU 逐出） */
  private readonly seen = new Map<string, number>()

  /** 最近事件（最新在前） */
  private recent: LiveEvent[] = []

  /** 洪水保护窗口起点 */
  private windowStart = 0
  /** 当前窗口内计数 */
  private windowCount = 0
  /** 上次打印洪水告警的时间 */
  private lastFloodLogAt = 0

  /** 计数器 */
  private totalEvents = 0
  private droppedEvents = 0
  private duplicatedEvents = 0

  /**
   * 投递一条事件。
   *
   * @returns 是否真正分发（false = 被去重或洪水保护丢弃）
   */
  publish(event: LiveEvent): boolean {
    // ---------- 去重 ----------
    if (this.seen.has(event.id)) {
      this.duplicatedEvents++
      return false
    }
    this.seen.set(event.id, event.ts)
    if (this.seen.size > DEDUP_LIMIT) {
      // 逐出最旧的一条（Map 迭代顺序 = 插入顺序）
      const oldest = this.seen.keys().next()
      if (!oldest.done) this.seen.delete(oldest.value)
    }

    // ---------- 洪水保护 ----------
    const now = Date.now()
    if (now - this.windowStart >= FLOOD_WINDOW_MS) {
      this.windowStart = now
      this.windowCount = 0
    }
    this.windowCount++

    if (this.windowCount > FLOOD_THRESHOLD && LOW_PRIORITY_TYPES.has(event.danmu_type)) {
      this.droppedEvents++
      if (now - this.lastFloodLogAt >= FLOOD_LOG_INTERVAL_MS) {
        this.lastFloodLogAt = now
        logger.system.warn(
          `[Live] 事件洪水保护生效：窗口内 ${this.windowCount} 条，已丢弃低优先级事件 ${this.droppedEvents} 条`,
        )
      }
      return false
    }

    // ---------- 分发 ----------
    this.totalEvents++
    this.recent.unshift(event)
    if (this.recent.length > RECENT_EVENT_LIMIT) {
      this.recent.length = RECENT_EVENT_LIMIT
    }
    this.emitter.emit('event', event)
    return true
  }

  /**
   * 订阅事件（返回取消订阅函数）。
   *
   * 订阅者抛错不应影响其他订阅者与适配器主循环，因此包一层 try/catch。
   */
  onEvent(handler: (event: LiveEvent) => void): () => void {
    const wrapped = (event: LiveEvent): void => {
      try {
        handler(event)
      } catch (err) {
        logger.system.warn('[Live] event handler failed:', err)
      }
    }
    this.emitter.on('event', wrapped)
    return () => {
      this.emitter.off('event', wrapped)
    }
  }

  /** 最近事件快照（最新在前） */
  getRecentEvents(limit = 10): LiveEvent[] {
    return this.recent.slice(0, limit)
  }

  /** 计数器快照 */
  getStats(): { totalEvents: number; droppedEvents: number; duplicatedEvents: number } {
    return {
      totalEvents: this.totalEvents,
      droppedEvents: this.droppedEvents,
      duplicatedEvents: this.duplicatedEvents,
    }
  }

  /** 清空去重表 / 缓存 / 计数器（stop 时调用，避免下次启动被旧 id 误判） */
  reset(): void {
    this.seen.clear()
    this.recent = []
    this.windowStart = 0
    this.windowCount = 0
    this.totalEvents = 0
    this.droppedEvents = 0
    this.duplicatedEvents = 0
  }
}

/** 单例（主进程内共享：适配器 → 总线 → overlay / 渲染层） */
let instance: LiveEventBus | null = null

export function getLiveEventBus(): LiveEventBus {
  if (!instance) instance = new LiveEventBus()
  return instance
}
