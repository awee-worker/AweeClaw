/**
 * 带背压控制的事件总线
 *
 * 设计目标：
 * - 防止高频事件（如流式 token）导致渲染线程阻塞
 * - 提供事件缓冲、节流、丢弃策略
 * - 保持事件顺序语义
 * - 监控队列健康状态
 */

import { logger } from '@toolkit/LogEngine'
import { EventBusClass, type AgentEvent, type EventType } from './EventDispatcher'

type EventHandler<T extends AgentEvent = AgentEvent> = (event: T) => void

interface BackpressureConfig {
  /** 队列最大长度，超过则触发背压 */
  maxQueueSize: number
  /** 高水位线（队列长度的百分比），超过开始节流 */
  highWaterMark: number
  /** 低水位线（队列长度的百分比），低于恢复正常 */
  lowWaterMark: number
  /** 流式事件节流间隔（ms） */
  streamThrottleMs: number
  /** 批量处理大小 */
  batchSize: number
  /** 批量处理间隔（ms） */
  batchIntervalMs: number
  /** 是否启用调试日志 */
  debug: boolean
}

const DEFAULT_BACKPRESSURE_CONFIG: BackpressureConfig = {
  maxQueueSize: 1000,
  highWaterMark: 0.7,
  lowWaterMark: 0.3,
  streamThrottleMs: 16,
  batchSize: 10,
  batchIntervalMs: 8,
  debug: import.meta.env.DEV,
}

/** 流式事件类型（高频，需要特殊处理） */
const STREAM_EVENT_TYPES: Set<EventType> = new Set([
  'stream:text',
  'stream:reasoning',
  'stream:tool_delta',
])

/** 高优先级事件（不应被丢弃） */
const HIGH_PRIORITY_EVENTS: Set<EventType> = new Set([
  'llm:error',
  'tool:error',
  'loop:warning',
  'context:warning',
  'plan:failed',
  'task:failed',
])

interface QueuedEvent {
  event: AgentEvent
  priority: number
  timestamp: number
}

/**
 * 背压状态机
 */
type BackpressureState = 'normal' | 'throttled' | 'dropping'

export class BackpressureEventBus extends EventBusClass {
  private config: BackpressureConfig
  private eventQueue: QueuedEvent[] = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private streamThrottleTimers = new Map<EventType, ReturnType<typeof setTimeout>>()
  private lastStreamEmit = new Map<EventType, number>()
  private state: BackpressureState = 'normal'
  private droppedCount = 0
  private processedCount = 0
  private metrics = {
    maxQueueDepth: 0,
    throttleEvents: 0,
    dropEvents: 0,
  }

  constructor(config: Partial<BackpressureConfig> = {}) {
    super()
    this.config = { ...DEFAULT_BACKPRESSURE_CONFIG, ...config }
  }

  /**
   * 发布事件（带背压控制）
   */
  emit(event: AgentEvent): void {
    const now = Date.now()
    const isStreamEvent = STREAM_EVENT_TYPES.has(event.type)
    const isHighPriority = HIGH_PRIORITY_EVENTS.has(event.type)

    // 高优先级事件直接处理，不进入队列
    if (isHighPriority) {
      this.processEvent(event)
      return
    }

    // 流式事件节流检查
    if (isStreamEvent) {
      const lastEmit = this.lastStreamEmit.get(event.type) || 0
      if (now - lastEmit < this.config.streamThrottleMs) {
        // 在节流窗口内，入队等待
        this.enqueue(event, isStreamEvent ? 1 : 2)
        return
      }
      this.lastStreamEmit.set(event.type, now)
    }

    // 检查背压状态
    if (this.state === 'dropping' && !isStreamEvent) {
      this.droppedCount++
      this.metrics.dropEvents++
      if (this.config.debug && this.droppedCount % 100 === 0) {
        logger.agent.warn(`[Backpressure] Dropped ${this.droppedCount} events, state: ${this.state}`)
      }
      return
    }

    // 入队
    this.enqueue(event, isStreamEvent ? 1 : 2)

    // 检查水位线
    this.checkWaterMark()

    // 启动批处理定时器
    this.scheduleBatchProcessing()
  }

  /**
   * 直接入队（内部使用）
   */
  private enqueue(event: AgentEvent, priority: number): void {
    if (this.eventQueue.length >= this.config.maxQueueSize) {
      // 队列已满，丢弃最低优先级的事件
      const dropped = this.dropLowestPriority()
      if (!dropped) {
        // 无法丢弃，直接丢弃当前事件
        this.droppedCount++
        this.metrics.dropEvents++
        return
      }
    }

    this.eventQueue.push({ event, priority, timestamp: Date.now() })

    if (this.eventQueue.length > this.metrics.maxQueueDepth) {
      this.metrics.maxQueueDepth = this.eventQueue.length
    }
  }

  /**
   * 丢弃队列中最低优先级的事件
   */
  private dropLowestPriority(): boolean {
    // 找到最低优先级且最老的事件
    let lowestIdx = -1
    let lowestPriority = Infinity

    for (let i = 0; i < this.eventQueue.length; i++) {
      const item = this.eventQueue[i]
      if (item.priority < lowestPriority) {
        lowestPriority = item.priority
        lowestIdx = i
      }
    }

    if (lowestIdx >= 0) {
      this.eventQueue.splice(lowestIdx, 1)
      this.droppedCount++
      this.metrics.dropEvents++
      return true
    }
    return false
  }

  /**
   * 检查水位线并调整状态
   */
  private checkWaterMark(): void {
    const ratio = this.eventQueue.length / this.config.maxQueueSize

    if (ratio >= this.config.highWaterMark && this.state !== 'dropping') {
      this.state = 'throttled'
      this.metrics.throttleEvents++
      if (this.config.debug) {
        logger.agent.warn(`[Backpressure] Entering throttled state (queue: ${this.eventQueue.length})`)
      }
    }

    if (ratio >= 0.95) {
      this.state = 'dropping'
      if (this.config.debug) {
        logger.agent.error(`[Backpressure] Entering dropping state (queue: ${this.eventQueue.length})`)
      }
    }

    if (ratio <= this.config.lowWaterMark && this.state !== 'normal') {
      this.state = 'normal'
      if (this.config.debug) {
        logger.agent.info(`[Backpressure] Returning to normal state (queue: ${this.eventQueue.length})`)
      }
    }
  }

  /**
   * 调度批处理
   */
  private scheduleBatchProcessing(): void {
    if (this.batchTimer) return

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null
      this.processBatch()
    }, this.config.batchIntervalMs)
  }

  /**
   * 批量处理事件
   */
  private processBatch(): void {
    if (this.eventQueue.length === 0) return

    const batchSize = Math.min(this.config.batchSize, this.eventQueue.length)
    const batch = this.eventQueue.splice(0, batchSize)

    for (const { event } of batch) {
      this.processEvent(event)
      this.processedCount++
    }

    // 如果队列还有数据，继续调度
    if (this.eventQueue.length > 0) {
      this.scheduleBatchProcessing()
    }

    // 处理完后检查水位线
    this.checkWaterMark()
  }

  /**
   * 处理单个事件（调用父类 emit）
   */
  private processEvent(event: AgentEvent): void {
    try {
      super.emit(event)
    } catch (error) {
      logger.agent.error(`[BackpressureEventBus] Error processing event ${event.type}:`, error)
    }
  }

  /**
   * 获取当前背压状态
   */
  getBackpressureState(): BackpressureState {
    return this.state
  }

  /**
   * 获取队列深度
   */
  getQueueDepth(): number {
    return this.eventQueue.length
  }

  /**
   * 获取统计信息
   */
  getMetrics(): {
    queueDepth: number
    state: BackpressureState
    processed: number
    dropped: number
    maxQueueDepth: number
    throttleEvents: number
    dropEvents: number
  } {
    return {
      queueDepth: this.eventQueue.length,
      state: this.state,
      processed: this.processedCount,
      dropped: this.droppedCount,
      maxQueueDepth: this.metrics.maxQueueDepth,
      throttleEvents: this.metrics.throttleEvents,
      dropEvents: this.metrics.dropEvents,
    }
  }

  /**
   * 清空队列并释放资源
   */
  dispose(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    this.streamThrottleTimers.forEach((timer) => clearTimeout(timer))
    this.streamThrottleTimers.clear()
    this.eventQueue = []
    this.state = 'normal'
  }
}

/**
 * 全局背压事件总线实例
 * 替换原有的 EventBus 使用
 */
export const BackpressureEventBusInstance = new BackpressureEventBus()
