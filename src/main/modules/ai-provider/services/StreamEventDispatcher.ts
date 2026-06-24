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

/** 流式事件分发器 */
export class StreamEventDispatcher {
  private readonly eventBuffer = new Map<string, StreamEvent[]>()
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

  /** 将事件加入缓冲区并设置刷新定时器 */
  private bufferEvent(requestId: string, event: StreamEvent): void {
    let buffer = this.eventBuffer.get(requestId)
    if (!buffer) {
      buffer = []
      this.eventBuffer.set(requestId, buffer)
    }
    buffer.push(event)

    const existingTimer = this.flushTimers.get(requestId)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => this.flushBuffered(requestId), BATCH_FLUSH_DELAY_MS)
    this.flushTimers.set(requestId, timer)
  }

  /** 刷新缓冲区，批量发送所有事件 */
  private flushBuffered(requestId: string): void {
    const events = this.eventBuffer.get(requestId)
    if (!events || events.length === 0) return

    if (this.window.isDestroyed()) {
      this.eventBuffer.delete(requestId)
      this.flushTimers.delete(requestId)
      return
    }

    try {
      this.window.webContents.send('llm:stream:' + requestId, {
        type: 'batch',
        events: events.map((e) => this.serialize(e)),
      })
    } catch (error) {
      logger.llm.error('[StreamEventDispatcher] 批量发送失败:', error)
    }

    this.eventBuffer.delete(requestId)
    this.flushTimers.delete(requestId)
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
