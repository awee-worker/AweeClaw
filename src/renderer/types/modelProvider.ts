import type { ApiProtocol, OpenAICompatibilityProfile } from '@configuration/aiProviders'

export type ModelCapability =
  | 'llm'
  | 'embedding'
  | 'vision'
  | 'tool-calling'
  | 'reasoning'
  | 'image-gen'
  | 'code'
  | 'audio'

export interface ModelGenerationParams {
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  seed?: number
  logitBias?: Record<string, number>
  enableThinking?: boolean
  thinkingBudget?: number
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  maxRetries?: number
  toolChoice?: 'auto' | 'none' | 'required'
  parallelToolCalls?: boolean
}

export interface ModelConfig {
  capabilities: ModelCapability[]
  generationParams?: ModelGenerationParams
  enabled?: boolean
}

export interface ProviderModelConfig {
  apiKey?: string
  baseUrl?: string
  timeout?: number
  model?: string
  customModels?: string[]
  headers?: Record<string, string>
  openAICompatibilityProfile?: OpenAICompatibilityProfile
  displayName?: string
  protocol?: ApiProtocol
  modelConfigs?: Record<string, ModelConfig>
  createdAt?: number
  updatedAt?: number
}

export interface ModelProviderPanel {
  configs: Record<string, ProviderModelConfig>
}

export function isCustomProvider(providerId: string): boolean {
  return providerId.startsWith('custom-')
}

export function generateCustomProviderId(): string {
  return `custom-${Date.now()}`
}

export const CAPABILITY_META: Record<ModelCapability, { label: { en: string; zh: string }; color: string; bgColor: string }> = {
  llm: { label: { en: 'LLM', zh: 'LLM' }, color: 'text-blue-400', bgColor: 'bg-blue-400/10 border-blue-400/20' },
  embedding: { label: { en: 'Embedding', zh: '嵌入' }, color: 'text-purple-400', bgColor: 'bg-purple-400/10 border-purple-400/20' },
  vision: { label: { en: 'Vision', zh: '视觉' }, color: 'text-amber-400', bgColor: 'bg-amber-400/10 border-amber-400/20' },
  'tool-calling': { label: { en: 'Tools', zh: '工具' }, color: 'text-emerald-400', bgColor: 'bg-emerald-400/10 border-emerald-400/20' },
  reasoning: { label: { en: 'Reasoning', zh: '推理' }, color: 'text-rose-400', bgColor: 'bg-rose-400/10 border-rose-400/20' },
  'image-gen': { label: { en: 'Image Gen', zh: '图片生成' }, color: 'text-pink-400', bgColor: 'bg-pink-400/10 border-pink-400/20' },
  code: { label: { en: 'Code', zh: '代码' }, color: 'text-cyan-400', bgColor: 'bg-cyan-400/10 border-cyan-400/20' },
  audio: { label: { en: 'Audio', zh: '音频' }, color: 'text-orange-400', bgColor: 'bg-orange-400/10 border-orange-400/20' },
}

export function inferCapabilities(modelName: string): ModelCapability[] {
  const name = modelName.toLowerCase()
  const caps: ModelCapability[] = []

  const isEmbedding = /\bembed\b|\bembedding\b/i.test(name)
  const isImageGen = /\bdall\b|\bstable\b|\bdiffus\b|\bsdxl\b|\bimage.gen\b/i.test(name)
  const isAudio = /\btts\b|\bstt\b|\bwhisper\b|\baudio\b|\bspeech\b/i.test(name)

  if (isEmbedding) {
    caps.push('embedding')
    return caps
  }
  if (isImageGen) {
    caps.push('image-gen')
    return caps
  }
  if (isAudio) {
    caps.push('audio')
    return caps
  }

  caps.push('llm')

  if (/\bvision\b|\bvl\b|\bv2$\|\b4v\b|\bmultimodal\b/i.test(name) || /\bglm-4v\b/i.test(name)) {
    caps.push('vision')
  }

  if (/\btool\b|\bfunction\b/i.test(name) === false) {
    caps.push('tool-calling')
  }

  if (/\breason\b|\br1\b|\bo1\b|\bo3\b|\bthink\b|\bdeepseek-r/i.test(name)) {
    caps.push('reasoning')
  }

  if (/\bcoder\b|\bcode\b|\bcodeqwen\b|\bcodellama\b/i.test(name)) {
    caps.push('code')
  }

  return caps
}
