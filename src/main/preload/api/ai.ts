/**
 * LLM / Embedding / 健康检查 API
 *
 * 覆盖 IPC 频道：
 * - llm:*           消息发送 / 结构化输出 / 向量嵌入
 * - llm:stream:/error:/done:  动态频道流式响应
 * - cloud:*         云端 token 刷新 / 认证失败
 * - healthCheck:*   提供商健康检查 / 模型测试 / 模型列表
 */
import { ipcRenderer, IpcRendererEvent } from 'electron'
import { invoke, send, on, onVoid, dynamicChannel } from '../ipcHelpers'
import type { LLMSendMessageParams, LLMStreamChunk, LLMError, LLMResult, LLMConfig } from '../types'

export function createAiApi() {
  return {
    // ── 消息发送 ──
    sendMessage: (params: LLMSendMessageParams) => invoke('llm:sendMessage')(params),
    compactContext: (params: LLMSendMessageParams) => invoke('llm:compactContext')(params),
    abortMessage: send('llm:abort'),

    // ── 结构化输出 ──
    analyzeCode: (params: unknown) => invoke('llm:analyzeCode')(params),
    analyzeCodeStream: (params: unknown) => invoke('llm:analyzeCodeStream')(params),
    suggestRefactoring: (params: unknown) => invoke('llm:suggestRefactoring')(params),
    suggestFixes: (params: unknown) => invoke('llm:suggestFixes')(params),
    generateTests: (params: unknown) => invoke('llm:generateTests')(params),
    generateObject: (params: { config: unknown; schema: unknown; system: string; prompt: string }) =>
      invoke('llm:generateObject')(params),

    // ── 向量嵌入 ──
    embedText: (params: { text: string; config: unknown }) => invoke('llm:embedText')(params),
    embedMany: (params: { texts: string[]; config: unknown }) => invoke('llm:embedMany')(params),
    findSimilar: (params: {
      query: string
      candidates: string[]
      config: unknown
      topK?: number
    }) => invoke('llm:findSimilar')(params),

    // ── LLM 流式事件（动态频道，支持批量推送）──
    onLLMStream: (requestId: string, callback: (data: LLMStreamChunk) => void): (() => void) => {
      const channel = `llm:stream:${requestId}`
      const handler = (
        _: IpcRendererEvent,
        data: LLMStreamChunk | { type: 'batch'; events: LLMStreamChunk[] },
      ) => {
        // 批量事件展开后逐条分发
        if (data.type === 'batch' && 'events' in data) {
          data.events.forEach((event) => callback(event))
        } else {
          callback(data as LLMStreamChunk)
        }
      }
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onLLMError: dynamicChannel<LLMError>('llm:error:'),
    onLLMDone: dynamicChannel<LLMResult>('llm:done:'),

    // ── 云端认证 ──
    onCloudTokenRefreshed: on<{ accessToken: string; refreshToken?: string }>('cloud:tokenRefreshed'),
    onCloudAuthFailed: onVoid('cloud:authFailed'),

    // ── 健康检查 ──
    healthCheckProvider: (
      provider: string,
      apiKey: string,
      baseUrl?: string,
      timeout?: number,
      protocol?: string,
    ) => invoke('healthCheck:check')(provider, apiKey, baseUrl, timeout, protocol),
    testModel: (config: LLMConfig) => invoke('healthCheck:testModel')(config),
    fetchModels: (provider: string, apiKey: string, baseUrl?: string, protocol?: string) =>
      invoke('healthCheck:fetchModels')(provider, apiKey, baseUrl, protocol),
  }
}
