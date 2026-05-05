import type { LLMConfig } from '@shared/types/llm'

export type LocalProviderType = 'ollama' | 'lmstudio' | 'llamacpp' | 'koboldcpp' | 'custom_local'

export interface LocalProviderEndpoint {
  type: LocalProviderType
  baseUrl: string
  apiKey?: string
  connected: boolean
  lastChecked: number
}

export interface LocalModelInfo {
  id: string
  name: string
  provider: LocalProviderType
  size?: number
  quantization?: string
  format?: string
  family?: string
  parameterSize?: string
  contextLength?: number
  capabilities: LocalModelCapabilities
  modifiedAt?: number
}

export interface LocalModelCapabilities {
  completion: boolean
  chat: boolean
  tools: boolean
  vision: boolean
  embedding: boolean
  streaming: boolean
}

export interface LocalProviderStatus {
  available: boolean
  provider: LocalProviderType
  baseUrl: string
  version?: string
  models: LocalModelInfo[]
  gpuInfo?: string
  checkedAt: number
  error?: string
}

export interface LocalModelConfig {
  provider: LocalProviderType
  baseUrl: string
  apiKey?: string
  model: string
  contextLength?: number
  temperature?: number
  topP?: number
  topK?: number
  repeatPenalty?: number
  numGpu?: number
  numCtx?: number
}

const DEFAULT_PORTS: Record<LocalProviderType, number> = {
  ollama: 11434,
  lmstudio: 1234,
  llamacpp: 8080,
  koboldcpp: 5001,
  custom_local: 8080,
}

const API_PATHS: Record<LocalProviderType, { models: string; health: string; chat: string }> = {
  ollama: {
    models: '/api/tags',
    health: '/api/version',
    chat: '/api/chat',
  },
  lmstudio: {
    models: '/v1/models',
    health: '/v1/models',
    chat: '/v1/chat/completions',
  },
  llamacpp: {
    models: '/v1/models',
    health: '/health',
    chat: '/v1/chat/completions',
  },
  koboldcpp: {
    models: '/api/v1/model',
    health: '/api/v1/model',
    chat: '/v1/chat/completions',
  },
  custom_local: {
    models: '/v1/models',
    health: '/v1/models',
    chat: '/v1/chat/completions',
  },
}

export function getDefaultPort(provider: LocalProviderType): number {
  return DEFAULT_PORTS[provider]
}

export function getDefaultBaseUrl(provider: LocalProviderType): string {
  return `http://localhost:${DEFAULT_PORTS[provider]}`
}

export function getApiPaths(provider: LocalProviderType) {
  return API_PATHS[provider]
}

export function toLLMConfig(config: LocalModelConfig): LLMConfig {
  return {
    provider: config.provider === 'ollama' ? 'ollama' : 'custom',
    model: config.model,
    apiKey: config.apiKey || 'local',
    baseUrl: config.baseUrl,
    protocol: 'openai',
    openAICompatibilityProfile: 'compatible',
    maxTokens: config.contextLength ?? 4096,
    temperature: config.temperature ?? 0.7,
    topP: config.topP ?? 0.9,
    topK: config.topK,
  }
}

export function detectLocalProviderFromUrl(baseUrl: string): LocalProviderType | null {
  const url = new URL(baseUrl)
  const port = parseInt(url.port, 10)

  for (const [provider, defaultPort] of Object.entries(DEFAULT_PORTS)) {
    if (port === defaultPort) {
      return provider as LocalProviderType
    }
  }

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return 'custom_local'
  }

  return null
}
