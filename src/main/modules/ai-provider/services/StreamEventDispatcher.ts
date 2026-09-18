/**
 * 流式事件分发器 — IPC 事件的批量发送与即时发送
 *
 * 通过双通道发送策略优化渲染进程的事件接收：
 * - 批量通道：文本、推理、工具调用增量等高频事件合并发送
 * - 即时通道：错误、完成、工具调用开始/可用等关键事件立即发送
 */

import { BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import type { StreamEvent, TokenUsage } from '../providerTypes'

/** 需要立即发送的事件类型 */
const IMMEDIATE_EVENT_TYPES = new Set(['error', 'done', 'tool-call-start', 'tool-call-available'])

/** 批量发送的延迟时间（毫秒） */
const BATCH_FLUSH_DELAY_MS = 30

/**
 * 单次批量发送的事件条数上限，超过则立即刷出。
 *
 * 上限刻意压得比「避免缓冲膨胀」所需要的低得多。原先取 200，但它防住的并不是
 * 膨胀，而是把失效模式放大了：节拍一旦被推迟（定时器被更长的任务挡在后面），
 * 缓冲就趁机攒到 200 条，紧接着一次 flush 在同一个同步块里做完
 * `events.map(serialize)` 与 `webContents.send` —— 停顿造出大批次，大批次又造出
 * 更大的停顿，两者互相喂养。条数上限越低，这个正反馈越容易被断开。
 */
const MAX_BUFFER_EVENTS = 24

/**
 * 单次批量发送的累计字符预算。
 *
 * 只限条数约束不住单次序列化的体积：24 条文本增量若各含 4KB 内容，一次 flush
 * 仍要处理近 100KB。而决定这次同步阻塞多久的正是体积，因此再设一道按字符计的
 * 闸门，让每批的工作量有上界。
 */
const MAX_BUFFER_CHARS = 8 * 1024

/**
 * 估算事件在 IPC 上的字符体积
 *
 * 只需要相对准确：这里的用途是「要不要提前刷出」的闸门，不是精确字节数，
 * 因此固定开销按常量计，可变部分按字符串长度计。
 */
function estimateEventChars(event: StreamEvent): number {
  switch (event.type) {
    case 'text':
    case 'reasoning':
      return event.content.length
    case 'tool-call-delta':
      return (event.argumentsDelta?.length ?? 0) + 32
    case 'source':
      return 128
    default:
      return 32
  }
}

/** 单个请求的待发送缓冲 */
interface BufferedEvents {
  events: StreamEvent[]
  /** 已缓冲事件的字符体积估算值，用于按体积触发刷出 */
  chars: number
}

/** 流式事件分发器 */
export class StreamEventDispatcher {
  private readonly eventBuffer = new Map<string, BufferedEvents>()
  private readonly flushTimers = new Map<string, NodeJS.Timeout>()

  constructor(private readonly window: BrowserWindow) {}

  /** 发送事件（根据类型自动选择批量或即时） */
  dispatch(requestId: string, event: StreamEvent): void {
    if (this.window.isDestroyed()) return

    if (IMMEDIATE_EVENT_TYPES.has(event.type)) {
      this.flushBuffered(requestId)
      this.sendImmediate(requestId, event)
      return
    }

    this.bufferEvent(requestId, event)
  }

  /** 刷新指定请求的所有缓冲事件 */
  flush(requestId: string): void {
    this.flushBuffered(requestId)
  }

  /** 清理指定请求的所有资源 */
  cleanup(requestId: string): void {
    this.eventBuffer.delete(requestId)
    const timer = this.flushTimers.get(requestId)
    if (timer) {
      clearTimeout(timer)
      this.flushTimers.delete(requestId)
    }
  }

  /** 将事件加入缓冲区并按固定节拍发送 */
  private bufferEvent(requestId: string, event: StreamEvent): void {
    let buffer = this.eventBuffer.get(requestId)
    if (!buffer) {
      buffer = { events: [], chars: 0 }
      this.eventBuffer.set(requestId, buffer)
    }
    buffer.events.push(event)
    buffer.chars += estimateEventChars(event)

    // 两道闸门任一触发就立即刷出：条数约束每批的调度开销，字符数约束单次
    // 序列化的体积，后者才是这次同步阻塞时长的决定因素
    if (buffer.events.length >= MAX_BUFFER_EVENTS || buffer.chars >= MAX_BUFFER_CHARS) {
      this.flushBuffered(requestId)
      return
    }

    // 固定节拍（throttle）而非重新计时（debounce）：
    // 流式事件间隔常小于批量延迟，如果每次到达都重置定时器，
    // 定时器将永远不触发，事件会在缓冲区里一直累积，
    // 既看不到实时输出，又会在某个时刻整体冲击渲染进程。
    if (this.flushTimers.has(requestId)) return

    const timer = setTimeout(() => {
      this.flushTimers.delete(requestId)
      this.flushBuffered(requestId)
    }, BATCH_FLUSH_DELAY_MS)
    this.flushTimers.set(requestId, timer)
  }

  /** 刷新缓冲区，批量发送所有事件 */
  private flushBuffered(requestId: string): void {
    const timer = this.flushTimers.get(requestId)
    if (timer) {
      clearTimeout(timer)
      this.flushTimers.delete(requestId)
    }

    const buffered = this.eventBuffer.get(requestId)
    if (!buffered || buffered.events.length === 0) return

    if (this.window.isDestroyed()) {
      this.eventBuffer.delete(requestId)
      return
    }

    try {
      this.window.webContents.send('llm:stream:' + requestId, {
        type: 'batch',
        events: buffered.events.map((e) => this.serialize(e)),
      })
    } catch (error) {
      logger.llm.error('[StreamEventDispatcher] 批量发送失败:', error)
    }

    this.eventBuffer.delete(requestId)
  }

  /** 立即发送单个事件 */
  private sendImmediate(requestId: string, event: StreamEvent): void {
    if (this.window.isDestroyed()) return

    try {
      const channel = 'llm:stream:' + requestId

      switch (event.type) {
        case 'tool-call-start':
          this.window.webContents.send(channel, {
            type: 'tool_call_start',
            id: event.id,
            name: event.name,
          })
          break

        case 'tool-call-available':
          this.window.webContents.send(channel, {
            type: 'tool_call_available',
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          })
          break

        case 'error':
          this.window.webContents.send('llm:error:' + requestId, {
            message: event.error.message,
            code: event.error.code,
            retryable: event.error.retryable,
            suggestion: event.error.suggestion,
          })
          break

        case 'done':
          this.sendDoneEvent(requestId, event)
          break
      }
    } catch (error) {
      logger.llm.error('[StreamEventDispatcher] 即时发送失败:', error)
    }
  }

  /** 发送完成事件 */
  private sendDoneEvent(requestId: string, event: StreamEvent): void {
    if (event.type !== 'done') return

    logger.llm.info('[StreamEventDispatcher] 发送完成事件', { requestId })

    this.window.webContents.send('llm:done:' + requestId, {
      reasoning: event.reasoning,
      usage: event.usage ? this.serializeUsage(event.usage) : undefined,
      metadata: event.metadata,
    })
  }

  /** 序列化 Usage 对象 */
  private serializeUsage(usage: TokenUsage): Record<string, unknown> {
    return {
      promptTokens: usage.inputTokens,
      completionTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      reasoningTokens: usage.reasoningTokens,
    }
  }

  /** 序列化事件为 IPC 传输格式 */
  private serialize(event: StreamEvent): Record<string, unknown> {
    switch (event.type) {
      case 'text':
        return { type: 'text', content: event.content }
      case 'reasoning':
        return { type: 'reasoning', content: event.content }
      case 'tool-call-delta':
        return {
          type: 'tool_call_delta',
          id: event.id,
          name: event.name,
          argumentsDelta: event.argumentsDelta,
        }
      case 'tool-call-delta-end':
        return { type: 'tool_call_delta_end', id: event.id }
      case 'source':
        return { type: 'source', source: event.source }
      default:
        return event as unknown as Record<string, unknown>
    }
  }
}
