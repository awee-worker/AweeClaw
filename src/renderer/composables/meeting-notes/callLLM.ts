/**
 * 通用 LLM 调用工具（非流式封装）
 *
 * `api.llm.send` 是流式接口，返回 `Promise<void>`，结果通过
 * `onStream`/`onDone`/`onError` 事件回调返回。本工具将其封装为
 * 返回完整文本的 Promise，供会议纪要的翻译/整理等场景使用。
 *
 * 设计要点：
 * - 注册监听 → 发送请求 → 累积流式文本 → done 时 resolve
 * - 支持超时取消
 * - 支持中止信号（AbortSignal）
 * - 清理所有监听器，避免内存泄漏
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import type { LLMConfig, LLMMessage } from '@shared/protocols/modelProtocol'

export interface CallLLMOptions {
  /** 系统提示词 */
  systemPrompt?: string
  /** 超时时间（ms），<=0 表示不限制 */
  timeoutMs?: number
  /** 中止信号 */
  abortSignal?: AbortSignal
}

export interface CallLLMResult {
  /** LLM 返回的完整文本 */
  content: string
  /** 推理内容（思考模型） */
  reasoning?: string
}

/**
 * 调用 LLM 并等待完整响应（非流式封装）
 *
 * @param config LLM 配置
 * @param messages 消息列表
 * @param options 选项（系统提示/超时/中止）
 * @returns 完整文本响应
 */
export function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  options: CallLLMOptions = {},
): Promise<CallLLMResult> {
  const { systemPrompt, timeoutMs = 60000, abortSignal } = options

  return new Promise<CallLLMResult>((resolve, reject) => {
    let settled = false
    let fullContent = ''
    let fullReasoning = ''
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const requestId = `mn-llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    /** 清理所有监听器和定时器 */
    const cleanup = (): void => {
      unsubStream()
      unsubError()
      unsubDone()
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort)
      }
    }

    /** 安全 resolve */
    const doResolve = (result: CallLLMResult): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    /** 安全 reject */
    const doReject = (err: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    // 注册流式监听
    const unsubStream = api.llm.onStream(requestId, (data) => {
      if (settled) return
      if (data.type === 'text' && data.content) {
        fullContent += data.content
      } else if (data.type === 'reasoning' && data.content) {
        fullReasoning += data.content
      }
    })

    const unsubError = api.llm.onError(requestId, (err) => {
      if (settled) return
      logger.system.error('[callLLM] LLM error:', err)
      doReject(new Error(err.message || 'LLM 请求失败'))
    })

    const unsubDone = api.llm.onDone(requestId, (data) => {
      if (settled) return
      // done 事件可能携带完整的 reasoning
      if (typeof data?.reasoning === 'string' && data.reasoning.length >= fullReasoning.length) {
        fullReasoning = data.reasoning
      }
      doResolve({ content: fullContent, reasoning: fullReasoning })
    })

    // 中止信号处理
    const onAbort = (): void => {
      if (settled) return
      try {
        api.llm.abort()
      } catch {
        /* noop */
      }
      doReject(new DOMException('Aborted', 'AbortError'))
    }

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort()
        return
      }
      abortSignal.addEventListener('abort', onAbort)
    }

    // 超时保护
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (settled) return
        doReject(new Error(`LLM 请求超时（${timeoutMs}ms）`))
      }, timeoutMs)
    }

    // 发送请求
    const sendParams: Record<string, unknown> = {
      config,
      messages,
      requestId,
    }
    if (systemPrompt) {
      sendParams.systemPrompt = systemPrompt
    }

    api.llm.send(sendParams as never).catch((err) => {
      if (settled) return
      const msg = err instanceof Error ? err.message : String(err)
      logger.system.error('[callLLM] api.llm.send failed:', err)
      doReject(new Error(`LLM 发送失败：${msg}`))
    })
  })
}
