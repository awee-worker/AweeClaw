/**
 * 场景工具 LLM 直调辅助
 *
 * 为场景工具提供轻量 LLM 文本生成能力（AI 生成纪要 / 周报 / 拆解等）。
 * 复用现有 api.llm 流式接口（与 codeCompletionAdapter 同模式），
 * 不污染对话历史，纯工具调用。
 */

import { api } from '@renderer/adapters/electronBridge'
import { getEffectiveLLMConfig } from '@services/modelConfigHelper'
import { useStore } from '@store'

export interface LlmTextParams {
  systemPrompt: string
  userPrompt: string
  signal?: AbortSignal
}

/** 判断 LLM 是否已配置（apiKey 或云模式） */
export function isLlmConfigured(): boolean {
  const state = useStore.getState()
  const config = getEffectiveLLMConfig(state.llmConfig)
  return Boolean(config.apiKey || config.cloudMode)
}

/**
 * 调用 LLM 生成纯文本（流式聚合，无对话历史副作用）
 * @throws 未配置 LLM / 请求失败时抛错
 */
export function runLlmText({ systemPrompt, userPrompt, signal }: LlmTextParams): Promise<string> {
  return new Promise((resolve, reject) => {
    const state = useStore.getState()
    const llmConfig = getEffectiveLLMConfig(state.llmConfig)

    if (!llmConfig.apiKey && !llmConfig.cloudMode) {
      reject(new Error('未配置 LLM（缺少 API Key 或云模式未开启）'))
      return
    }

    const requestId = crypto.randomUUID()
    let text = ''
    let finished = false

    const cleanup = () => {
      unsubStream()
      unsubError()
      unsubDone()
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      if (finished) return
      finished = true
      api.llm.abort()
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', onAbort)
    }

    const unsubStream = api.llm.onStream(requestId, (chunk: { type: string; content?: string }) => {
      if (chunk.type === 'text' && chunk.content) text += chunk.content
    })

    const unsubError = api.llm.onError(requestId, (err: { message: string }) => {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error(err?.message || 'LLM 请求失败'))
    })

    const unsubDone = api.llm.onDone(requestId, () => {
      if (finished) return
      finished = true
      cleanup()
      resolve(text.trim())
    })

    api.llm
      .send({
        config: llmConfig,
        messages: [{ role: 'user', content: userPrompt }],
        systemPrompt,
        requestId,
      })
      .catch((err: unknown) => {
        if (finished) return
        finished = true
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
      })
  })
}
