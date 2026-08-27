import type { JSONValue } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { LLMConfig, LLMMessage } from '@protocols'
import {
  isBuiltinProvider,
  isOpenAIStyleProtocol,
  supportsFullOpenAIStyleFeatures,
} from '@shared/configuration/aiProviders'
import { resolveCacheProtocol } from './cacheProtocolSpec'

export type RequestProviderOptions = ProviderOptions

export interface ThinkingCompatibilityDecision {
  enabled: boolean
}

const OPENAI_MANAGED_OPTION_KEYS = new Set([
  'logitBias',
  'parallelToolCalls',
  'reasoningEffort',
  'reasoningSummary',
])

const ANTHROPIC_MANAGED_OPTION_KEYS = new Set([
  'thinking',
  'effort',
])

const GOOGLE_MANAGED_OPTION_KEYS = new Set([
  'thinkingConfig',
])

export function usesAnthropicProtocol(config: LLMConfig): boolean {
  return config.provider === 'anthropic' || config.protocol === 'anthropic'
}

export function usesOpenAIProtocol(config: LLMConfig): boolean {
  return isOpenAIStyleProtocol(resolveCacheProtocol(config.protocol, config.provider))
}

function usesOpenAIResponsesProtocol(config: LLMConfig): boolean {
  return resolveCacheProtocol(config.protocol, config.provider) === 'openai-responses'
}

function supportsFullOpenAIProfile(config: LLMConfig): boolean {
  return supportsFullOpenAIStyleFeatures(
    config.provider,
    resolveCacheProtocol(config.protocol, config.provider),
    config.openAICompatibilityProfile,
  )
}

export function resolveThinkingCompatibility(
  config: LLMConfig,
  messages: LLMMessage[] = [],
): ThinkingCompatibilityDecision {
  // 智谱 GLM-5.x：思考强制开启（thinking.type 仅支持 enabled），不能关闭
  if (isZhipuGLM5Model(config.model)) {
    return { enabled: true }
  }
  if (config.enableThinking) {
    return { enabled: true }
  }
  const hasReasoningContent = messages.some(
    m => m.role === 'assistant' && typeof m.reasoning_content === 'string' && m.reasoning_content.length > 0,
  )
  return { enabled: hasReasoningContent }
}

export function buildOpenAIStyleProviderOptions(
  config: LLMConfig,
  options: Record<string, unknown>,
): RequestProviderOptions {
  return Object.fromEntries(
    resolveOpenAIStyleProviderOptionKeys(config).map(key => [key, options]),
  ) as RequestProviderOptions
}

export function buildThinkingProviderOptions(config: LLMConfig): RequestProviderOptions | undefined {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)

  if (config.provider === 'gemini' || protocol === 'google') {
    const isGemini3 = /gemini-3/i.test(config.model)
    const thinkingLevel = resolveGoogleThinkingLevel(config.reasoningEffort)
    return {
      google: {
        thinkingConfig: isGemini3
          ? {
              ...(thinkingLevel ? { thinkingLevel } : {}),
              includeThoughts: true,
            }
          : { thinkingBudget: config.thinkingBudget || 10000, includeThoughts: true },
      },
    }
  }

  if (usesAnthropicProtocol(config)) {
    const effort = resolveAnthropicEffort(config.reasoningEffort)
    return {
      anthropic: {
        thinking: {
          type: 'enabled',
          budgetTokens: config.thinkingBudget || 10000,
        },
        ...(effort ? { effort } : {}),
      },
    }
  }

  if (!usesOpenAIProtocol(config)) {
    return undefined
  }

  // 智谱 GLM-5.x：reasoning_effort 仅支持 low / high / max，需将内部档位映射为智谱合法值
  if (isZhipuGLM5Model(config.model)) {
    const zhipuEffort = resolveZhipuGLM5Effort(config.reasoningEffort)
    if (usesOpenAIResponsesProtocol(config) && supportsFullOpenAIProfile(config)) {
      const configuredReasoningSummary = config.providerOptions?.openai?.reasoningSummary
      return buildOpenAIStyleProviderOptions(config, {
        reasoningEffort: zhipuEffort,
        reasoningSummary: typeof configuredReasoningSummary === 'string'
          ? configuredReasoningSummary
          : 'detailed',
      })
    }
    return buildOpenAIStyleProviderOptions(config, { reasoningEffort: zhipuEffort })
  }

  const reasoningEffort = supportsFullOpenAIProfile(config)
    ? resolveFullOpenAIReasoningEffort(config.reasoningEffort)
    : resolveCompatibleOpenAIReasoningEffort(config.reasoningEffort)

  if (!reasoningEffort) {
    return undefined
  }

  if (usesOpenAIResponsesProtocol(config) && supportsFullOpenAIProfile(config)) {
    const configuredReasoningSummary = config.providerOptions?.openai?.reasoningSummary
    return buildOpenAIStyleProviderOptions(config, {
      reasoningEffort,
      reasoningSummary: typeof configuredReasoningSummary === 'string'
        ? configuredReasoningSummary
        : 'detailed',
    })
  }

  return buildOpenAIStyleProviderOptions(config, { reasoningEffort })
}

export function buildProtocolProviderOptions(config: LLMConfig): RequestProviderOptions | undefined {
  let providerOptions = buildConfiguredProviderOptions(config)

  if (usesOpenAIProtocol(config) && supportsFullOpenAIProfile(config) && config.parallelToolCalls !== undefined) {
    providerOptions = mergeProviderOptions(
      providerOptions,
      buildOpenAIStyleProviderOptions(config, { parallelToolCalls: config.parallelToolCalls }),
    )
  }

  if (usesOpenAIProtocol(config) && supportsFullOpenAIProfile(config) && config.logitBias) {
    providerOptions = mergeProviderOptions(
      providerOptions,
      buildOpenAIStyleProviderOptions(config, { logitBias: config.logitBias }),
    )
  }

  return providerOptions
}

function buildConfiguredProviderOptions(config: LLMConfig): RequestProviderOptions | undefined {
  let providerOptions: RequestProviderOptions | undefined

  if (usesOpenAIProtocol(config)) {
    const openAIOptions = omitManagedOptions(
      config.providerOptions?.openai,
      OPENAI_MANAGED_OPTION_KEYS,
    )

    if (openAIOptions) {
      providerOptions = mergeProviderOptions(
        providerOptions,
        buildOpenAIStyleProviderOptions(config, openAIOptions),
      )
    }
  }

  if (usesAnthropicProtocol(config)) {
    const anthropicOptions = omitManagedOptions(
      config.providerOptions?.anthropic,
      ANTHROPIC_MANAGED_OPTION_KEYS,
    )

    if (anthropicOptions) {
      providerOptions = mergeProviderOptions(providerOptions, {
        anthropic: anthropicOptions,
      })
    }
  }

  if (config.provider === 'gemini' || config.protocol === 'google') {
    const googleOptions = omitManagedOptions(
      config.providerOptions?.google,
      GOOGLE_MANAGED_OPTION_KEYS,
    )

    if (googleOptions) {
      providerOptions = mergeProviderOptions(providerOptions, {
        google: googleOptions,
      })
    }
  }

  return providerOptions
}

function resolveOpenAIStyleProviderOptionKeys(
  config: LLMConfig,
): readonly string[] {
  const protocol = resolveCacheProtocol(config.protocol, config.provider)

  if (protocol === 'openai-responses') {
    return ['openai']
  }

  if (protocol === 'openai' && isBuiltinProvider(config.provider) && config.provider === 'openai') {
    return ['openai']
  }

  if (protocol === 'openai') {
    return ['openaiCompatible', 'custom-openai']
  }

  return ['openaiCompatible']
}

function resolveFullOpenAIReasoningEffort(
  effort: LLMConfig['reasoningEffort'],
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  switch (effort) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return effort
    default:
      return 'medium'
  }
}

function resolveCompatibleOpenAIReasoningEffort(
  effort: LLMConfig['reasoningEffort'],
): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  switch (effort) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
      return effort
    case 'xhigh':
      return 'high'
    case 'none':
      return undefined
    default:
      return 'medium'
  }
}

function resolveGoogleThinkingLevel(
  effort: LLMConfig['reasoningEffort'],
): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  switch (effort) {
    case 'high':
    case 'medium':
    case 'low':
    case 'minimal':
      return effort
    default:
      return undefined
  }
}

/**
 * 判断是否为智谱 GLM-5.x 系列模型。
 *
 * GLM-5 系列 API 行为与 GLM-4 不同：
 * - thinking.type 仅支持 "enabled"，思考强制开启，不允许关闭
 * - reasoning_effort 仅支持 low / high / max 三档（默认 max）
 */
export function isZhipuGLM5Model(model: string): boolean {
  return /^glm-5/i.test(model.trim())
}

/**
 * 将内部 6 档推理强度映射为智谱 GLM-5.x 支持的档位。
 *
 * 映射规则（智谱只接受 low / high / max）：
 * - none / minimal / low   → low（模型强制思考，无法真正关闭，最低档即 low）
 * - medium / high          → high
 * - xhigh / 未设置         → max
 */
function resolveZhipuGLM5Effort(
  effort: LLMConfig['reasoningEffort'],
): 'low' | 'high' | 'max' {
  switch (effort) {
    case 'low':
    case 'minimal':
    case 'none':
      return 'low'
    case 'medium':
    case 'high':
      return 'high'
    case 'xhigh':
      return 'max'
    default:
      return 'max'
  }
}

function resolveAnthropicEffort(
  effort: LLMConfig['reasoningEffort'],
): 'low' | 'medium' | 'high' | undefined {
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    return effort
  }

  return undefined
}

function omitManagedOptions(
  options: Record<string, unknown> | undefined,
  managedKeys: ReadonlySet<string>,
): Record<string, JSONValue> | undefined {
  if (!options || typeof options !== 'object') {
    return undefined
  }

  const filteredEntries = Object.entries(options).filter(([key]) => !managedKeys.has(key))
  return filteredEntries.length > 0
    ? Object.fromEntries(filteredEntries) as Record<string, JSONValue>
    : undefined
}

export function mergeProviderOptions(
  base: RequestProviderOptions | undefined,
  extra: RequestProviderOptions | undefined,
): RequestProviderOptions | undefined {
  if (!extra) return base

  const result: RequestProviderOptions = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(extra)) {
    result[key] = {
      ...(result[key] ?? {}),
      ...value,
    }
  }
  return result
}
