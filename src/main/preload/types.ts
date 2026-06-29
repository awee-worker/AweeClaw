/**
 * Preload 本地类型定义
 *
 * 仅包含 preload 实现所需的类型，保持最小化耦合。
 * 对外契约类型由 src/renderer/types/electronBridge.d.ts 维护。
 *
 * 注：这些类型故意不从 @shared/protocols 导入，以避免 preload 打包体积膨胀
 * 和循环依赖。字段与 shared/protocols/modelProtocol.ts 保持子集兼容。
 */

// =================== 基础类型 ===================

export type Language = 'en' | 'zh'

// =================== 搜索 ===================

export interface SearchFilesOptions {
  isRegex: boolean
  isCaseSensitive: boolean
  isWholeWord?: boolean
  include?: string
  exclude?: string
}

export interface SearchFileResult {
  path: string
  line: number
  text: string
}

// =================== LLM ===================

export interface LLMConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  protocol?: string
}

export interface LLMStreamChunk {
  type:
    | 'text'
    | 'reasoning'
    | 'error'
    | 'tool_call'
    | 'tool_call_start'
    | 'tool_call_delta'
    | 'tool_call_delta_end'
    | 'tool_call_end'
    | 'tool_call_available'
    | 'source'
  content?: string
  error?: string
  id?: string
  name?: string
  arguments?: Record<string, unknown>
  argumentsDelta?: string
  source?: {
    id: string
    sourceType: 'url' | 'document'
    url?: string
    title?: string
    mediaType?: string
    filename?: string
  }
}

export interface LLMError {
  message: string
  code: string
  retryable: boolean
}

export interface LLMResult {
  content: string
  reasoning?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedInputTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  }
}

type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64' | 'url'; media_type: string; data: string } }

type MessageContent = string | MessageContentPart[]

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: MessageContent
  toolCallId?: string
  toolName?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
    }>
    required?: string[]
  }
}

export interface LLMSendMessageParams {
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  activeTools?: string[]
  requestId: string
}

// =================== Embedding / Indexing ===================

export interface EmbeddingConfigInput {
  provider?: 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'custom'
  apiKey?: string
  model?: string
  baseUrl?: string
  dimensions?: number
}

export interface IndexStatusData {
  mode: 'structural' | 'semantic'
  isIndexing: boolean
  totalFiles: number
  indexedFiles: number
  totalChunks: number
  lastIndexedAt?: number
  error?: string
  message?: string
}

export interface IndexSearchResult {
  filePath: string
  relativePath: string
  content: string
  startLine: number
  endLine: number
  score: number
  type: string
  language: string
}

export interface EmbeddingProvider {
  id: string
  name: string
  description: string
  free: boolean
}

// =================== Remote Shell ===================

export interface RemoteShellEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifyTime?: number
}

export interface RemoteShellServer {
  host: string
  port?: number
  username?: string
  password?: string
  privateKeyPath?: string
  remotePath?: string
}
