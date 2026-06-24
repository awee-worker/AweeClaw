/**
 * Plugin SDK - Provider 插件扩展接口
 *
 * AI 模型 Provider 的插件化接口，支持多 Provider 动态注册。
 *
 * @module plugin-sdk/provider
 */

import type { PluginManifest, PluginRuntime, PluginContext } from './types'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/protocols/modelProtocol'

// ============================================
// Provider 插件 Manifest 扩展
// ============================================

/** Provider 插件 Manifest */
export interface ProviderPluginManifest extends PluginManifest {
  type: 'provider'
  /** Provider 标识（如 'openai', 'anthropic'） */
  providerId: string
  /** Provider 类型 */
  providerType: string
  /** 支持的模型列表（可选，可通过运行时动态获取） */
  models?: ProviderModelInfo[]
  /** 是否支持模型列表动态获取 */
  dynamicModels?: boolean
  /** API 基础 URL（可选，用于自定义端点） */
  defaultBaseUrl?: string
  /** 凭证 Schema */
  credentialSchema: ProviderCredentialField[]
}

/** Provider 模型信息 */
export interface ProviderModelInfo {
  /** 模型 ID */
  id: string
  /** 显示名称 */
  name: string
  /** 模型能力 */
  capabilities: ProviderModelCapabilities
  /** 上下文窗口大小 */
  contextWindow?: number
  /** 最大输出 token */
  maxOutputTokens?: number
  /** 是否支持 vision */
  vision?: boolean
  /** 是否免费 */
  free?: boolean
}

/** Provider 模型能力 */
export interface ProviderModelCapabilities {
  chat: boolean
  streaming: boolean
  toolCalling: boolean
  embedding: boolean
  vision: boolean
  audio: boolean
  reasoning: boolean
}

/** Provider 凭证字段 */
export interface ProviderCredentialField {
  key: string
  label: string
  labelZh: string
  type: 'api-key' | 'oauth' | 'custom'
  required: boolean
  placeholder?: string
  description?: string
  descriptionZh?: string
}

// ============================================
// Provider 插件运行时接口
// ============================================

/** Provider 插件运行时 */
export interface ProviderPluginRuntime extends PluginRuntime {
  /** Provider ID */
  readonly providerId: string
  /** Provider Manifest */
  readonly manifest: ProviderPluginManifest

  /** 同步生成 */
  complete(params: ProviderCompleteParams): Promise<ProviderCompleteResult>

  /** 流式生成 */
  stream(params: ProviderCompleteParams): AsyncIterable<ProviderStreamChunk>

  /** 获取可用模型列表 */
  listModels?(): Promise<ProviderModelInfo[]>

  /** 验证凭证 */
  validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }>

  /** 获取 Token 用量估算 */
  estimateTokens?(text: string, model: string): number
}

/** Provider 生成参数 */
export interface ProviderCompleteParams {
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  signal?: AbortSignal
}

/** Provider 生成结果 */
export interface ProviderCompleteResult {
  content: string
  reasoning?: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, unknown>
  }>
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/** Provider 流式 Chunk */
export interface ProviderStreamChunk {
  type: 'text' | 'tool_call' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'reasoning' | 'error' | 'done'
  content?: string
  toolCall?: {
    id?: string
    name?: string
    arguments?: string
  }
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  error?: string
}

// ============================================
// Provider 插件工厂
// ============================================

/** Provider 插件工厂 */
export interface ProviderPluginFactory {
  create(context: PluginContext): ProviderPluginRuntime
  getManifest(): ProviderPluginManifest
}
