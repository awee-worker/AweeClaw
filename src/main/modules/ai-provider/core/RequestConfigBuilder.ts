import type { LLMConfig } from '@protocols'
import { logger } from '@shared/toolkit/LogEngine'
import { resolveHeaderPlaceholders } from '../modelRegistry'
import { resolveCacheProtocol } from './cacheProtocolSpec'

export interface GenerationSettings {
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  seed?: number
}

export interface RequestExecutionOptions {
  maxRetries?: number
  toolChoice?: LLMConfig['toolChoice']
  headers?: Record<string, string>
  timeout?: number
}

function normalizePositiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

function normalizeNonNegativeInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function normalizeTopK(value: number | undefined): number | undefined {
  return normalizePositiveInteger(value)
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined

  const entries = Object.entries(headers).filter(([, value]) => typeof value === 'string')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function isOpenAIReasoningModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4|computer-use-preview)/i.test(model)
}

function supportsOpenAINonReasoningParameters(model: string): boolean {
  return /^gpt-5\.(1|2)/i.test(model)
}

function supportsOpenAIReasoningSampling(config: LLMConfig): boolean {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)

  if ((protocol === 'openai' || protocol === 'openai-responses') && isOpenAIReasoningModel(config.model)) {
    return config.reasoningEffort === 'none' && supportsOpenAINonReasoningParameters(config.model)
  }

  return true
}

export function buildGenerationSettings(config: LLMConfig): GenerationSettings {
  const supportsOpenAIReasoningExtras = supportsOpenAIReasoningSampling(config)
  const protocol = resolveCacheProtocol(config.protocol, config.provider)
  const isOpenAIReasoningRoute =
    (protocol === 'openai' || protocol === 'openai-responses') &&
    isOpenAIReasoningModel(config.model)
  const supportsFrequencyPenalties =
    protocol !== 'openai-responses' &&
    !isOpenAIReasoningRoute

  // maxTokens 为 0 或未设置时按「不限制」处理：不下发输出上限，
  // 由 Provider 侧按模型自身能力决定（Anthropic 走模型输出上限、OpenAI/Gemini 走服务端默认）。
  const maxOutputTokens = normalizePositiveInteger(config.maxTokens)
  const thinkingBudget = normalizeNonNegativeInteger(config.thinkingBudget)

  // 思考与正文共享同一个输出上限。当思考预算 ≥ 输出上限时，模型可能把额度全部花在
  // 思考上，正文拿不到空间，流会以 finishReason=length 结束且正文为空 ——
  // 这正是「AI 思考几十秒后自动结束会话」的配置诱因。此处只做诊断，
  // 不擅自放大请求参数（避免超出 Provider 的输出上限导致 400）。
  if (maxOutputTokens !== undefined && thinkingBudget !== undefined && thinkingBudget >= maxOutputTokens) {
    logger.llm.warn('[RequestConfig] 思考预算不低于最大输出 tokens，正文可能没有输出空间', {
      provider: config.provider,
      model: config.model,
      maxTokens: maxOutputTokens,
      thinkingBudget,
      hint: '调低思考预算或调高最大输出 tokens 可避免思考占满输出额度',
    })
  } else if (maxOutputTokens === undefined) {
    // 「不限制」模式：不下发输出上限，最终额度由 Provider / 模型决定。
    // 记一条 info 便于排查「正文被截断」类问题时确认上限来源。
    logger.llm.info('[RequestConfig] 未设置最大输出 tokens，改由 Provider 决定输出上限', {
      provider: config.provider,
      model: config.model,
      thinkingBudget: thinkingBudget ?? null,
    })
  }

  return {
    maxOutputTokens,
    temperature: supportsOpenAIReasoningExtras ? config.temperature : undefined,
    topP: supportsOpenAIReasoningExtras ? config.topP : undefined,
    topK: normalizeTopK(config.topK),
    frequencyPenalty: supportsFrequencyPenalties ? config.frequencyPenalty : undefined,
    presencePenalty: supportsFrequencyPenalties ? config.presencePenalty : undefined,
    stopSequences: config.stopSequences?.length ? config.stopSequences : undefined,
    seed: normalizeNonNegativeInteger(config.seed),
  }
}

export function buildRequestExecutionOptions(config: LLMConfig): RequestExecutionOptions {
  return {
    maxRetries: normalizeNonNegativeInteger(config.maxRetries),
    toolChoice: config.toolChoice,
    headers: normalizeHeaders(resolveHeaderPlaceholders(config.headers, config.apiKey)),
    timeout: normalizePositiveNumber(config.timeout),
  }
}
