/**
 * 协议适配层 — 把「协议」实现为一个可注册的对象
 *
 * 之前每种协议在 modelRegistry 里被写了三遍（内置 provider、内置默认分支、
 * 自定义 provider），新增协议要同步改三处，漏一处就会出现「内置能用、
 * 自定义不能用」这类问题。
 *
 * 现在协议只有一份实现：新建模型、providerOptions 的顶层 key 都由适配器给出。
 * 新增 Azure OpenAI、Bedrock、Vertex 等协议时，只需实现一个 ProtocolAdapter
 * 并登记到 REGISTRY。
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import {
  supportsFullOpenAIStyleFeatures,
  type ApiProtocol,
  type OpenAICompatibilityProfile,
} from '@shared/configuration/aiProviders'
import type { ProviderTransport } from '@shared/configuration/providerTransport'
import { aiFetch } from './NetworkDispatcher'

/** 创建模型所需的最小路由信息 */
export interface ModelRoute {
  providerId: string
  /** 已归一化的协议（`custom` 已在解析阶段映射为 `openai`） */
  protocol: ApiProtocol
  model: string
  apiKey: string
  /** 已归一化的 SDK baseURL */
  baseUrl?: string
  isBuiltin: boolean
  openAICompatibilityProfile?: OpenAICompatibilityProfile
}

export interface ProtocolAdapter {
  readonly kind: ProtocolAdapterKind
  createModel(route: ModelRoute): LanguageModel
  /** providerOptions 的顶层 key：AI SDK 按此 key 读取协议相关参数 */
  providerOptionsKeys(): readonly string[]
}

export type ProtocolAdapterKind =
  | 'openai'
  | 'openai-responses'
  | 'openai-compatible'
  | 'anthropic'
  | 'google'

function requireBaseUrl(route: ModelRoute): string {
  if (!route.baseUrl) {
    throw new Error(`Provider ${route.providerId} requires baseUrl`)
  }
  return route.baseUrl
}

/**
 * OpenAI 官方协议（chat completions）。
 * 只有内置 `openai` provider 使用它 —— 它支持 OpenAI 专有的完整参数集。
 */
const openAIAdapter: ProtocolAdapter = {
  kind: 'openai',
  createModel(route) {
    const openai = createOpenAI({
      apiKey: route.apiKey,
      baseURL: route.baseUrl,
      fetch: aiFetch,
    })
    return openai.chat(route.model)
  },
  providerOptionsKeys: () => ['openai'],
}

/** OpenAI Responses API */
const openAIResponsesAdapter: ProtocolAdapter = {
  kind: 'openai-responses',
  createModel(route) {
    const openai = createOpenAI({
      apiKey: route.apiKey,
      baseURL: requireBaseUrl(route),
      fetch: aiFetch,
    })
    return openai.responses(route.model)
  },
  providerOptionsKeys: () => ['openai'],
}

/**
 * OpenAI 兼容协议。
 *
 * SDK 会从三个位置依次读取 providerOptions：`openaiCompatible`（规范 key）、
 * `<providerName>`（本 provider 的专属 key）、以及已废弃的 `openai-compatible`。
 * 这里对两个规范 key 同时下发同一份参数，任一命名都能生效。
 */
const openAICompatibleAdapter: ProtocolAdapter = {
  kind: 'openai-compatible',
  createModel(route) {
    const provider = createOpenAICompatible({
      name: route.isBuiltin ? route.providerId : 'custom-openai',
      apiKey: route.apiKey,
      baseURL: requireBaseUrl(route),
      fetch: aiFetch,
      supportsStructuredOutputs: supportsFullOpenAIStyleFeatures(
        route.providerId,
        route.protocol,
        route.openAICompatibilityProfile,
      ),
    })
    return provider(route.model)
  },
  providerOptionsKeys: () => ['openaiCompatible', 'custom-openai'],
}

const anthropicAdapter: ProtocolAdapter = {
  kind: 'anthropic',
  createModel(route) {
    const anthropic = createAnthropic({
      apiKey: route.apiKey,
      baseURL: requireBaseUrl(route),
      fetch: aiFetch,
    })
    return anthropic(route.model)
  },
  providerOptionsKeys: () => ['anthropic'],
}

const googleAdapter: ProtocolAdapter = {
  kind: 'google',
  createModel(route) {
    const google = createGoogleGenerativeAI({
      apiKey: route.apiKey,
      baseURL: requireBaseUrl(route),
      fetch: aiFetch,
    })
    return google(route.model)
  },
  providerOptionsKeys: () => ['google'],
}

/**
 * 解析路由应使用的适配器。
 *
 * 注意 `openai` 协议有两个实现：内置 OpenAI 走官方 SDK（完整参数集），
 * 其余一律走 OpenAI 兼容 SDK（参数集受兼容层限制）。判定依据是 providerId
 * 而非协议名，因此这里不能只按 protocol 查表。
 */
export function resolveProtocolAdapter(
  route: Pick<ModelRoute, 'providerId' | 'protocol' | 'isBuiltin'>,
): ProtocolAdapter {
  switch (route.protocol) {
    case 'openai-responses':
      return openAIResponsesAdapter
    case 'anthropic':
      return anthropicAdapter
    case 'google':
      return googleAdapter
    case 'openai':
    default:
      return route.isBuiltin && route.providerId === 'openai'
        ? openAIAdapter
        : openAICompatibleAdapter
  }
}

/**
 * 便捷函数：解析传输参数并创建模型。
 */
export function createTransportModel(
  route: ModelRoute,
  _transport?: ProviderTransport,
): LanguageModel {
  return resolveProtocolAdapter(route).createModel(route)
}
