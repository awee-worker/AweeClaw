/**
 * Provider 传输层解析 — 协议到 Base URL / 端点 / 认证头的唯一实现
 *
 * 同一份 provider 配置会被三条链路读取：对话模型工厂（modelRegistry）、
 * 健康检查、模型列表拉取（providerMonitor）。这三处过去各自做 URL 归一化，
 * 结果是同一个 baseUrl 被解释成不同地址 —— 典型症状是「健康检查通过，
 * 发消息 404」。
 *
 * 这里把解析收敛到一处，三条链路共用同一结果：
 * - `sdkBaseUrl`：直接交给 AI SDK 的 baseURL，SDK 会自行拼接
 *   `/chat/completions`、`/messages`、`/responses`、`/models/{id}:generateContent`；
 * - `apiRoot`：含版本段的协议根地址，用于拼接本应用自有的非 SDK 端点
 *   （模型列表）。
 *
 * 兼容性说明：各官方 SDK 均把 baseURL 当作「已含版本段的前缀」使用，
 * 因此除 OpenAI 兼容协议外都需要显式补齐版本段。Google 的默认前缀是
 * `/v1beta`，缺了它请求会打到 `/models/...` 而不是 `/v1beta/models/...`。
 */

import { BUILTIN_PROVIDERS, type ApiProtocol } from './aiProviders'

/** 末尾版本段：/v1、/v1beta、/v2 等 */
const VERSION_SUFFIX_RE = /\/v\d+(?:beta)?$/i

/** 各协议缺省版本段 */
const DEFAULT_VERSION_SEGMENT: Partial<Record<ApiProtocol, string>> = {
  'openai-responses': '/v1',
  anthropic: '/v1',
  google: '/v1beta',
}

export interface ProviderTransport {
  /** 归一化后的协议（`custom` 视为 `openai` 兼容协议） */
  protocol: ApiProtocol
  /** 传给 AI SDK 的 baseURL */
  sdkBaseUrl: string
  /** 含版本段的协议根地址，用于拼接模型列表等自有端点 */
  apiRoot: string
}

export interface ProviderEndpointRequest {
  url: string
  headers: Record<string, string>
}

/**
 * 解析 provider 实际使用的协议。
 *
 * 未显式配置时按 providerId 推断，与内置定义保持一致。
 */
export function resolveProviderProtocol(
  providerId: string,
  protocol?: ApiProtocol,
): ApiProtocol {
  if (protocol === 'custom') return 'openai'
  if (protocol) return protocol

  const builtin = BUILTIN_PROVIDERS[providerId]
  if (builtin) return builtin.protocol === 'custom' ? 'openai' : builtin.protocol

  if (providerId === 'anthropic') return 'anthropic'
  if (providerId === 'gemini') return 'google'
  return 'openai'
}

/**
 * 解析 provider 的传输参数。
 *
 * @param providerId provider 标识，用于回落到内置 baseUrl
 * @param protocol 显式协议；缺省时按 providerId 推断
 * @param baseUrl 用户配置的 baseUrl；缺省时回落到内置定义
 * @returns 无法确定地址时返回 undefined（调用方需报配置缺失）
 */
export function resolveProviderTransport(
  providerId: string,
  protocol?: ApiProtocol,
  baseUrl?: string,
): ProviderTransport | undefined {
  const effectiveProtocol = resolveProviderProtocol(providerId, protocol)
  const configured = (baseUrl || BUILTIN_PROVIDERS[providerId]?.baseUrl || '').trim()

  if (!configured) return undefined

  const trimmed = configured.replace(/\/+$/, '')
  const versionSegment = DEFAULT_VERSION_SEGMENT[effectiveProtocol]

  if (!versionSegment) {
    return { protocol: effectiveProtocol, sdkBaseUrl: trimmed, apiRoot: trimmed }
  }

  const apiRoot = VERSION_SUFFIX_RE.test(trimmed)
    ? trimmed
    : `${trimmed}${versionSegment}`

  return { protocol: effectiveProtocol, sdkBaseUrl: apiRoot, apiRoot }
}

/**
 * 构建模型列表端点的请求（URL + 认证头）。
 *
 * 与对话请求使用同一个 `apiRoot`，因此「对话能发」与「模型列表能取」
 * 不会出现地址分叉。
 */
export function buildProviderModelsRequest(
  transport: ProviderTransport,
  apiKey?: string,
): ProviderEndpointRequest {
  const key = (apiKey || '').trim()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  switch (transport.protocol) {
    case 'anthropic': {
      if (key) headers['x-api-key'] = key
      headers['anthropic-version'] = '2023-06-01'
      return { url: `${transport.apiRoot}/models`, headers }
    }

    case 'google': {
      const url = key
        ? `${transport.apiRoot}/models?key=${encodeURIComponent(key)}`
        : `${transport.apiRoot}/models`
      return { url, headers }
    }

    default: {
      if (key) headers.Authorization = `Bearer ${key}`
      return { url: `${transport.apiRoot}/models`, headers }
    }
  }
}
