import type { ApiProtocol, OpenAICompatibilityProfile } from '@configuration/aiProviders'
import type { ModelCapabilityHint, ModelCapabilityHintPayload } from '@configuration/modelCapabilityHints'

export type ModelCapability =
  | 'llm'
  | 'embedding'
  | 'vision'
  | 'tool-calling'
  | 'reasoning'
  | 'image-gen'
  | 'video-gen'
  | 'code'
  | 'audio'
  | 'asr'
  | 'tts'
  | '3d-gen'
  | 'world-model'

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
  /** 模型展示名称（可选），为空时界面回退展示模型 id */
  displayName?: string
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

export function isCustomProvider(providerId: string | undefined): boolean {
  return !!providerId && providerId.startsWith('custom-')
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
  'video-gen': { label: { en: 'Video Gen', zh: '视频生成' }, color: 'text-indigo-400', bgColor: 'bg-indigo-400/10 border-indigo-400/20' },
  code: { label: { en: 'Code', zh: '代码' }, color: 'text-cyan-400', bgColor: 'bg-cyan-400/10 border-cyan-400/20' },
  audio: { label: { en: 'Audio', zh: '音频' }, color: 'text-orange-400', bgColor: 'bg-orange-400/10 border-orange-400/20' },
  asr: { label: { en: 'ASR', zh: '语音识别' }, color: 'text-teal-400', bgColor: 'bg-teal-400/10 border-teal-400/20' },
  tts: { label: { en: 'TTS', zh: '语音合成' }, color: 'text-lime-400', bgColor: 'bg-lime-400/10 border-lime-400/20' },
  '3d-gen': { label: { en: '3D Gen', zh: '3D模型生成' }, color: 'text-violet-400', bgColor: 'bg-violet-400/10 border-violet-400/20' },
  'world-model': { label: { en: 'World Model', zh: '世界模型' }, color: 'text-sky-400', bgColor: 'bg-sky-400/10 border-sky-400/20' },
}

/** 单模态模型：能力唯一，命中后不再叠加对话相关标签 */
const EXCLUSIVE_CAPABILITY_GROUPS: ModelCapability[][] = [
  ['embedding'],
  ['world-model'],
  ['3d-gen'],
  ['video-gen'],
  ['image-gen'],
  // 语音组：audio 是兜底项，命中更具体的 asr / tts 时不再保留
  ['asr', 'tts', 'audio'],
]

/**
 * 仅按模型名推断能力。
 *
 * 服务商没有给出任何元数据时的兜底路径，也是 inferCapabilities 的基础层。
 */
function inferCapabilitiesByName(modelName: string): ModelCapability[] {
  const name = modelName.toLowerCase()
  const caps: ModelCapability[] = []

  const isEmbedding = /\bembed\b|\bembedding\b|\bbge\b|\bgte\b|\bm3e\b|\bnomic-embed\b|\bjina-embed\b/i.test(name)
  // 图像生成：命名风格跨度很大，除了老牌 dall/stable/sdxl，还要覆盖
  // gpt-image / qwen-image / wan2.7-image / seedream / flux / kolors 这类主流命名，
  // 否则用户配好的图像模型在插件里筛不出来（下拉空着，看着像没配）
  const isImageGen =
    /\bdall\b|\bstable\b|\bdiffus\b|\bsdxl\b|\bimage.gen\b|\bimagen\b|\bflux\b|\bkolors\b|\bseedream\b|\bgpt-image\b|\bqwen-image\b|\bwan[\d._-]*image\b|\bwanx[\d._-]*image\b|\bhunyuan-image\b|\bideogram\b|\brecraft\b|\bmidjourney\b|\bniji\b|\bhidream\b|\bjanus\b/i.test(
      name,
    )
  const isAudio = /\btts\b|\bstt\b|\bwhisper\b|\baudio\b|\bspeech\b/i.test(name)
  // 语音识别 / 语音合成：比通用 audio 更具体，命中时优先落到对应标签
  const isAsr = /\basr\b|\bstt\b|\bwhisper\b|\btranscrib|\bspeech-to-text\b|\bsensevoice\b|\bfunasr\b|\bparaformer\b/i.test(name)
  const isTts = /\btts\b|\bspeech-synthesis\b|\btext-to-speech\b|\bcosyvoice\b|\bsovits\b|\bvits\b|\bchattts\b|\bfish-speech\b/i.test(name)
  // 3D 模型生成：图像/文本转三维网格
  const is3dGen =
    /\b3d\b|\bhunyuan3d\b|\btripo\b|\btrellis\b|\bmeshy\b|\brodin\b|\bpoint-e\b|\bshape-e\b|\btext-to-3d\b|\bimage-to-3d\b/i.test(
      name,
    )
  // 世界模型：可交互环境生成 / 世界模拟
  const isWorldModel =
    /\bworld[-_ ]?model\b|\bgenie\b|\bcosmos\b|\bworldlabs\b|\bdecart\b|\bmarble\b|\bdreamer\b/i.test(name)
  // 视频生成：主流服务商的模型命名基本都会带上这几个词根
  const isVideoGen =
    /\bseedance\b|\bsora\b|\bkling\b|\bkeling\b|\bveo\b|\bhailuo\b|\bcogvideo\b|\bwanx?[\d._-]*(?:t2v|i2v|video)\b|\bwan[\d._-]+-?(?:t2v|i2v)\b|\bt2v\b|\bi2v\b|\btext-to-video\b|\bvideo-gen\b|\bpika\b|\bvidu\b|\brunway\b|\bminimax-video\b|\bseedance\b/i.test(
      name,
    )

  if (isEmbedding) {
    caps.push('embedding')
    return caps
  }
  if (isWorldModel) {
    caps.push('world-model')
    return caps
  }
  if (is3dGen) {
    caps.push('3d-gen')
    return caps
  }
  if (isVideoGen) {
    caps.push('video-gen')
    return caps
  }
  if (isImageGen) {
    caps.push('image-gen')
    return caps
  }
  // 语音识别 / 合成要在通用 audio 之前判定，避免 whisper、tts 这类模型只落到「音频」
  if (isAsr) {
    caps.push('asr')
    return caps
  }
  if (isTts) {
    caps.push('tts')
    return caps
  }
  if (isAudio) {
    caps.push('audio')
    return caps
  }

  caps.push('llm')

  if (/\bvision\b|\bvl\b|\b4v\b|\bmultimodal\b/i.test(name) || /\bglm-4v\b/i.test(name)) {
    caps.push('vision')
  }

  // 主流对话模型普遍声明了 function calling，名称层面没有反证时按支持处理；
  // 服务商元数据明确说不支持时会在 inferCapabilities 里被剔除
  if (!/\bbase\b|\bcompletion-only\b|\bdavinci\b/i.test(name)) {
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

/**
 * 推断模型能力标签。
 *
 * 优先使用服务商 `/models` 返回的元数据（`hint`），只有元数据缺失或不足以判断的
 * 维度才回落到模型名。这样同一批模型在不同服务商下都能得到合理的标签，
 * 也不会出现「全都是 LLM + 工具」的默认结果。
 *
 * @param modelName 模型 id
 * @param hint 服务商元数据提炼出的线索，可为单条线索数组或完整载荷
 */
export function inferCapabilities(
  modelName: string,
  hint?: ModelCapabilityHintPayload | ModelCapabilityHint[] | null,
): ModelCapability[] {
  const payload: ModelCapabilityHintPayload | undefined = Array.isArray(hint)
    ? { capabilities: hint }
    : hint ?? undefined

  const hinted = new Set<ModelCapability>(payload?.capabilities ?? [])
  const byName = inferCapabilitiesByName(modelName)

  // 单模态模型：元数据命中即定论，不再叠加名称推断的结果
  for (const group of EXCLUSIVE_CAPABILITY_GROUPS) {
    const hits = group.filter(cap => hinted.has(cap) || byName.includes(cap))
    if (hits.length === 0) continue
    // 语音组里 audio 只是兜底，已经有 asr / tts 时不必再带上
    return hits.length > 1 && hits.includes('audio') ? hits.filter(cap => cap !== 'audio') : hits
  }

  const caps: ModelCapability[] = ['llm']

  if (hinted.has('vision') || byName.includes('vision')) {
    caps.push('vision')
  }

  // supportsTools 是明确声明（true 支持 / false 不支持），优先级高于名称推断
  const wantsToolCalling =
    payload?.supportsTools ?? (hinted.has('tool-calling') || byName.includes('tool-calling'))
  if (wantsToolCalling) {
    caps.push('tool-calling')
  }

  if (hinted.has('reasoning') || byName.includes('reasoning')) {
    caps.push('reasoning')
  }

  if (hinted.has('code') || byName.includes('code')) {
    caps.push('code')
  }

  return caps
}
