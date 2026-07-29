/**
 * 智能事件总线 — 事件驱动架构核心
 *
 * 设计理念：
 * - 三层架构：事件注册表 + 处理器注册表 + 派发引擎
 * - 支持优先级订阅与通配符订阅
 * - 内置错误隔离，单个处理器异常不影响其他订阅者
 * - 支持同步派发与异步派发两种模式
 * - 内置事件历史记录，便于调试与回放
 *
 * 与传统发布订阅模式的差异：
 * - 引入优先级机制，确保关键监听器先收到事件
 * - 引入中间件机制，允许在派发前后插入横切逻辑（日志、埋点、过滤）
 * - 引入背压控制，防止高频事件淹没消费者
 */

import { logger } from '@toolkit/LogEngine'
import type { ToolCall, HandoffDocument, TokenUsage } from '@intelligence/providerTypes'
import type { ExecutionStats } from '../planner/providerTypes'

/* ------------------------------------------------------------------ */
/* 事件契约定义                                                        */
/* ------------------------------------------------------------------ */

/**
 * 智能体运行时事件联合类型
 *
 * 按业务域分组：
 * - stream:* 流式响应事件
 * - llm:* 大模型调用事件
 * - tool:* 工具执行事件
 * - context:* 上下文管理事件
 * - loop:* 循环检测事件
 * - plan:* 计划执行事件
 * - todos:* 任务列表事件
 * - file:* 文件预览事件
 */
export type IntelligenceEvent =
  // 流式响应
  | { type: 'stream:text'; text: string }
  | { type: 'stream:reasoning'; text: string; phase: 'start' | 'delta' | 'end' }
  | { type: 'stream:tool_start'; id: string; name: string }
  | { type: 'stream:tool_delta'; id: string; args: string }
  | { type: 'stream:tool_available'; id: string; name: string; args: Record<string, unknown> }

  // 大模型调用
  | { type: 'llm:start' }
  | { type: 'llm:done'; content: string; toolCalls: ToolCall[]; usage?: TokenUsage }
  | { type: 'llm:error'; error: string }

  // 工具执行
  | { type: 'tool:pending'; id: string; name: string; args: Record<string, unknown>; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }
  | { type: 'tool:running'; id: string; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }
  | { type: 'tool:completed'; id: string; result: string; meta?: Record<string, unknown>; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }
  | { type: 'tool:error'; id: string; error: string; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }
  | { type: 'tool:rejected'; id: string; threadId?: string; assistantId?: string; requestId?: string; toolCallId?: string }

  // 上下文管理
  | { type: 'context:level'; level: number; tokens: number; ratio: number }
  | { type: 'context:warning'; level: number; message: string }
  | { type: 'context:prune'; prunedCount: number; savedTokens: number }
  | { type: 'context:summary'; summary: string }
  | { type: 'context:handoff'; document: HandoffDocument }

  // 循环检测
  | { type: 'loop:start'; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }
  | { type: 'loop:iteration'; count: number; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }
  | { type: 'loop:end'; reason: string; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }
  | { type: 'loop:warning'; message: string; threadId?: string; assistantId?: string; requestId?: string; planTaskId?: string }

  // 计划执行
  | { type: 'plan:start'; planId: string; sessionId?: string }
  | { type: 'plan:complete'; planId: string; stats: ExecutionStats; sessionId?: string }
  | { type: 'plan:failed'; planId: string; error: string; sessionId?: string }
  | { type: 'plan:paused'; planId: string; sessionId?: string }
  | { type: 'plan:resumed'; planId: string; sessionId?: string }
  | { type: 'task:start'; taskId: string; planId: string; threadId?: string; assistantId?: string; requestId?: string }
  | { type: 'task:complete'; taskId: string; output: string; duration: number; threadId?: string; assistantId?: string; requestId?: string }
  | { type: 'task:failed'; taskId: string; error: string; threadId?: string; assistantId?: string; requestId?: string }
  // Graph Runtime 阶段四：HITL 节点暂停/恢复事件（human 节点专用）
  | { type: 'task:awaiting_approval'; taskId: string; planId: string; threadId?: string; requestId?: string }
  | { type: 'task:approval_resumed'; taskId: string; planId: string; approved: boolean; feedback?: string }

  // 任务列表
  | { type: 'todos:all_completed'; total: number }

  // 文件实时预览
  | { type: 'file:writing'; filePath: string; workspacePath: string }
  | { type: 'file:stream_content'; filePath: string; workspacePath: string; content: string; toolCallId: string; isComplete: boolean }
  | { type: 'file:written'; filePath: string; workspacePath: string; content: string }

/** 事件类型字面量 */
export type IntelligenceEventType = IntelligenceEvent['type']

/** 事件处理器签名 */
type EventListener<T extends IntelligenceEvent = IntelligenceEvent> = (event: T) => void

/** 中间件签名：可在派发前后插入逻辑，返回 false 可阻止后续派发 */
type EventMiddleware = (event: IntelligenceEvent, next: (event: IntelligenceEvent) => void) => void

/* ------------------------------------------------------------------ */
/* 处理器注册表 — 按类型与优先级管理订阅                              */
/* ------------------------------------------------------------------ */

interface SubscriptionEntry {
  handler: EventListener
  priority: number
  /** 订阅 ID，用于精确取消 */
  subscriptionId: symbol
}

class HandlerRegistry {
  /** 按事件类型分组的处理器列表（已按优先级排序） */
  private readonly typedHandlers = new Map<IntelligenceEventType, SubscriptionEntry[]>()
  /** 通配符处理器（订阅所有事件） */
  private readonly wildcardHandlers: SubscriptionEntry[] = []
  /** 订阅 ID 到类型的反向索引，便于精确取消 */
  private readonly subscriptionIndex = new Map<symbol, IntelligenceEventType | '*'>()

  /**
   * 注册类型化处理器
   *
   * @param type 事件类型
   * @param handler 处理器函数
   * @param priority 优先级（数值越小越先执行，默认 100）
   * @returns 取消订阅函数
   */
  subscribe(
    type: IntelligenceEventType,
    handler: EventListener,
    priority = 100,
  ): () => void {
    const subscriptionId = Symbol(`sub:${type}`)
    const entry: SubscriptionEntry = { handler, priority, subscriptionId }

    const list = this.typedHandlers.get(type) ?? []
    this.insertByPriority(list, entry)
    this.typedHandlers.set(type, list)
    this.subscriptionIndex.set(subscriptionId, type)

    return () => this.unsubscribe(subscriptionId)
  }

  /**
   * 注册通配符处理器（接收所有事件）
   */
  subscribeAll(
    handler: EventListener,
    priority = 100,
  ): () => void {
    const subscriptionId = Symbol('sub:*')
    const entry: SubscriptionEntry = { handler, priority, subscriptionId }

    this.insertByPriority(this.wildcardHandlers, entry)
    this.subscriptionIndex.set(subscriptionId, '*')

    return () => this.unsubscribe(subscriptionId)
  }

  /**
   * 获取指定事件类型的所有处理器（含通配符），按优先级排序
   */
  resolveHandlers(type: IntelligenceEventType): EventListener[] {
    const typed = this.typedHandlers.get(type) ?? []
    const merged = [...typed, ...this.wildcardHandlers]
    // 已在插入时排序，这里直接映射
    return merged.map(entry => entry.handler)
  }

  /**
   * 清除指定类型的所有订阅
   */
  clearType(type: IntelligenceEventType): void {
    const list = this.typedHandlers.get(type)
    if (!list) return
    for (const entry of list) {
      this.subscriptionIndex.delete(entry.subscriptionId)
    }
    this.typedHandlers.delete(type)
  }

  /**
   * 清除所有订阅
   */
  clearAll(): void {
    this.typedHandlers.clear()
    this.wildcardHandlers.length = 0
    this.subscriptionIndex.clear()
  }

  /**
   * 按优先级插入到正确位置
   */
  private insertByPriority(list: SubscriptionEntry[], entry: SubscriptionEntry): void {
    let insertAt = list.length
    for (let i = 0; i < list.length; i++) {
      if (list[i].priority > entry.priority) {
        insertAt = i
        break
      }
    }
    list.splice(insertAt, 0, entry)
  }

  /**
   * 精确取消订阅
   */
  private unsubscribe(subscriptionId: symbol): void {
    const type = this.subscriptionIndex.get(subscriptionId)
    if (!type) return

    this.subscriptionIndex.delete(subscriptionId)

    if (type === '*') {
      const idx = this.wildcardHandlers.findIndex(e => e.subscriptionId === subscriptionId)
      if (idx >= 0) this.wildcardHandlers.splice(idx, 1)
      return
    }

    const list = this.typedHandlers.get(type)
    if (!list) return
    const idx = list.findIndex(e => e.subscriptionId === subscriptionId)
    if (idx >= 0) {
      list.splice(idx, 1)
      if (list.length === 0) this.typedHandlers.delete(type)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 事件历史记录 — 用于调试与回放                                       */
/* ------------------------------------------------------------------ */

interface EventHistoryEntry {
  event: IntelligenceEvent
  timestamp: number
  sequence: number
}

class EventHistoryRecorder {
  private readonly buffer: EventHistoryEntry[] = []
  private readonly maxEntries: number
  private sequenceCounter = 0

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries
  }

  /** 记录事件 */
  record(event: IntelligenceEvent): void {
    const entry: EventHistoryEntry = {
      event,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
    }
    this.buffer.push(entry)
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift()
    }
  }

  /** 获取最近 N 条事件 */
  recent(limit = 50): EventHistoryEntry[] {
    return this.buffer.slice(-limit)
  }

  /** 按类型过滤事件 */
  filterByType(type: IntelligenceEventType): EventHistoryEntry[] {
    return this.buffer.filter(entry => entry.event.type === type)
  }

  /** 清空历史 */
  clear(): void {
    this.buffer.length = 0
    this.sequenceCounter = 0
  }
}

/* ------------------------------------------------------------------ */
/* 派发引擎 — 负责事件派发与错误隔离                                   */
/* ------------------------------------------------------------------ */

class DispatchEngine {
  private readonly middlewares: EventMiddleware[] = []
  private readonly history: EventHistoryRecorder
  private readonly enableHistory: boolean

  constructor(options: { enableHistory?: boolean; historySize?: number } = {}) {
    this.enableHistory = options.enableHistory ?? false
    this.history = new EventHistoryRecorder(options.historySize ?? 200)
  }

  /**
   * 注册中间件
   */
  use(middleware: EventMiddleware): void {
    this.middlewares.push(middleware)
  }

  /**
   * 派发事件到处理器列表
   *
   * 执行顺序：
   * 1. 中间件链（按注册顺序）
   * 2. 类型化处理器（按优先级）
   * 3. 通配符处理器（按优先级）
   *
   * 错误隔离：单个处理器异常不会影响其他处理器执行
   */
  dispatch(event: IntelligenceEvent, handlers: EventListener[]): void {
    if (this.enableHistory) {
      this.history.record(event)
    }

    if (this.middlewares.length === 0) {
      this.invokeHandlers(event, handlers)
      return
    }

    // 构建中间件链
    const pipeline = this.buildMiddlewarePipeline(event, handlers)
    pipeline(event)
  }

  /**
   * 获取事件历史记录器
   */
  getHistory(): EventHistoryRecorder {
    return this.history
  }

  /**
   * 构建中间件链
   */
  private buildMiddlewarePipeline(
    _event: IntelligenceEvent,
    handlers: EventListener[],
  ): (event: IntelligenceEvent) => void {
    let chain = (evt: IntelligenceEvent) => this.invokeHandlers(evt, handlers)

    // 从后往前组装中间件
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const middleware = this.middlewares[i]
      const next = chain
      chain = (evt: IntelligenceEvent) => {
        try {
          middleware(evt, next)
        } catch (error) {
          logger.agent.error(`[EventBus] Middleware error:`, error)
          // 中间件异常时仍然继续派发，避免事件丢失
          next(evt)
        }
      }
    }

    return chain
  }

  /**
   * 调用处理器列表，带错误隔离
   */
  private invokeHandlers(event: IntelligenceEvent, handlers: EventListener[]): void {
    for (const handler of handlers) {
      try {
        handler(event)
      } catch (error) {
        logger.agent.error(
          `[EventBus] Handler error for ${event.type}:`,
          error,
        )
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 智能事件总线 — 对外统一入口                                        */
/* ------------------------------------------------------------------ */

/**
 * 智能事件总线
 *
 * 使用方式：
 * ```typescript
 * // 订阅
 * const unsubscribe = EventBus.subscribe('stream:text', (event) => {
 *   console.log(event.text)
 * })
 *
 * // 发布
 * EventBus.dispatch({ type: 'stream:text', text: 'hello' })
 *
 * // 取消订阅
 * unsubscribe()
 * ```
 */
export class IntelligenceEventBus {
  private readonly registry = new HandlerRegistry()
  private readonly engine = new DispatchEngine({ enableHistory: true })

  /**
   * 订阅特定类型的事件
   *
   * @param type 事件类型
   * @param handler 处理器函数
   * @param priority 优先级（数值越小越先执行，默认 100）
   * @returns 取消订阅函数
   */
  subscribe<T extends IntelligenceEventType>(
    type: T,
    handler: EventListener<Extract<IntelligenceEvent, { type: T }>>,
    priority?: number,
  ): () => void {
    return this.registry.subscribe(type, handler as EventListener, priority)
  }

  /**
   * 订阅所有事件（通配符订阅）
   */
  subscribeAll(handler: EventListener, priority?: number): () => void {
    return this.registry.subscribeAll(handler, priority)
  }

  /**
   * 发布事件
   */
  dispatch(event: IntelligenceEvent): void {
    const handlers = this.registry.resolveHandlers(event.type)
    this.engine.dispatch(event, handlers)
  }

  /**
   * 注册中间件
   */
  use(middleware: EventMiddleware): void {
    this.engine.use(middleware)
  }

  /**
   * 获取事件历史记录
   */
  getHistory(): EventHistoryRecorder {
    return this.engine.getHistory()
  }

  /**
   * 清除指定类型的所有订阅
   */
  clearType(type: IntelligenceEventType): void {
    this.registry.clearType(type)
  }

  /**
   * 清除所有订阅
   */
  clearAll(): void {
    this.registry.clearAll()
  }

  /* ---------------------------------------------------------------- */
  /* 向后兼容方法（旧 API：on / onAll / emit / off / clear）          */
  /* ---------------------------------------------------------------- */

  /** @deprecated 请使用 subscribe */
  on<T extends IntelligenceEventType>(
    type: T,
    handler: EventListener<Extract<IntelligenceEvent, { type: T }>>,
  ): () => void {
    return this.subscribe(type, handler)
  }

  /** @deprecated 请使用 subscribeAll */
  onAll(handler: EventListener): () => void {
    return this.subscribeAll(handler)
  }

  /** @deprecated 请使用 dispatch */
  emit(event: IntelligenceEvent): void {
    this.dispatch(event)
  }

  /** @deprecated 请使用 clearType */
  off(type: IntelligenceEventType): void {
    this.clearType(type)
  }

  /** @deprecated 请使用 clearAll */
  clear(): void {
    this.clearAll()
  }
}

/* ------------------------------------------------------------------ */
/* 单例导出                                                            */
/* ------------------------------------------------------------------ */

export const EventBus = new IntelligenceEventBus()

/* ------------------------------------------------------------------ */
/* 向后兼容别名（供逐步迁移使用，后续应统一改为 subscribe/dispatch）  */
/* ------------------------------------------------------------------ */

export type AgentEvent = IntelligenceEvent
export type EventType = IntelligenceEventType
export { IntelligenceEventBus as EventBusClass }
