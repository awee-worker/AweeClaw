/**
 * 模型工厂 — 为不同协议创建 LLM 模型实例
 *
 * 职责：
 * - 把用户配置解析成一条路由（协议 / baseUrl / 模型 / 密钥）
 * - 交给对应的协议适配器创建模型
 * - 支持云端模式（cloudMode）与 token 自动刷新
 *
 * 设计要点：
 * - Base URL 归一化统一走 `resolveProviderTransport`，与健康检查、模型列表
 *   共用同一实现，避免「对话能发、探测 404」这类地址分叉；
 * - 各协议的建模逻辑集中在 `ProtocolAdapter`，本文件只做路由解析与云端封装；
 * - 云端 token 刷新做并发合并（single-flight）：后端会撤销旧 refreshToken，
 *   重复刷新必然失败并被误判为登录失效。
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { LLMConfig } from '@shared/protocols/modelGateway'
import { BRAND } from '@shared/brand'
import { BUILTIN_PROVIDERS, isBuiltinProvider } from '@shared/configuration/aiProviders'
import {
    resolveProviderProtocol,
    resolveProviderTransport,
} from '@shared/configuration/providerTransport'
import { logger } from '@shared/toolkit/LogEngine'
import { aiFetch } from './core/NetworkDispatcher'
import { resolveProtocolAdapter, type ModelRoute } from './core/ProtocolAdapter'


export interface ModelOptions {
    enableThinking?: boolean
    cloudMode?: boolean
    serverUrl?: string
    accessToken?: string
    refreshToken?: string
    /** 云端 token 刷新成功后的回调，用于同步新 token 到渲染进程 */
    onTokenRefreshed?: (newAccessToken: string, newRefreshToken?: string) => void
    /** 云端认证彻底失效（refresh token 也无效）时的回调，用于通知渲染进程清除认证状态 */
    onAuthFailed?: () => void
}


/* ------------------------------------------------------------------ */
/* 云端 token 刷新                                                     */
/* ------------------------------------------------------------------ */

interface CloudTokenSet {
    accessToken: string
    refreshToken?: string
}

interface CloudRefreshOutcome {
    tokens?: CloudTokenSet
    /** refreshToken 本身已失效（401 / 403），需要清登录态 */
    authInvalid: boolean
}

/**
 * 进行中的刷新任务，按 serverUrl 去重。
 *
 * 后端刷新时会撤销旧的 refreshToken，因此并发的第二个刷新请求拿着旧
 * refreshToken 必然失败，进而被误判为「登录失效」把用户踢下线。
 * 工具循环一轮会并发多个请求，这个场景很容易命中。
 */
const inflightTokenRefresh = new Map<string, Promise<CloudRefreshOutcome>>()

async function refreshCloudToken(
    serverUrl: string,
    refreshToken: string,
    fetchImpl: typeof globalThis.fetch,
): Promise<CloudRefreshOutcome> {
    const existing = inflightTokenRefresh.get(serverUrl)
    if (existing) return await existing

    const task = (async (): Promise<CloudRefreshOutcome> => {
        try {
            const response = await fetchImpl(`${serverUrl}/api/v1/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            })

            if (response.ok) {
                const data = (await response.json()) as {
                    accessToken?: string
                    refreshToken?: string
                }

                if (typeof data.accessToken === 'string' && data.accessToken) {
                    return {
                        tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
                        authInvalid: false,
                    }
                }

                return { authInvalid: false }
            }

            return { authInvalid: response.status === 401 || response.status === 403 }
        } catch (error) {
            logger.llm.error('[ModelRegistry] Token refresh exception:', error)
            return { authInvalid: false }
        }
    })()

    inflightTokenRefresh.set(serverUrl, task)
    try {
        return await task
    } finally {
        inflightTokenRefresh.delete(serverUrl)
    }
}


export function createModel(config: LLMConfig, options: ModelOptions = {}): LanguageModel {
    const cloudMode = options.cloudMode ?? config.cloudMode
    const serverUrl = options.serverUrl ?? config.serverUrl
    const accessToken = options.accessToken ?? config.accessToken
    const refreshToken = options.refreshToken ?? config.refreshToken

    if (cloudMode && serverUrl && (accessToken || refreshToken)) {
        logger.llm.info('[modelFactory] Creating cloud model:', {
            provider: config.provider,
            model: config.model,
            serverUrl,
            hasAccessToken: !!accessToken,
            accessTokenLength: accessToken?.length,
        })
        return createCloudModel(config, { ...options, cloudMode, serverUrl, accessToken, refreshToken })
    }

    logger.llm.info('[modelFactory] Creating local model:', {
        provider: config.provider,
        model: config.model,
        cloudMode,
        hasServerUrl: !!serverUrl,
        hasAccessToken: !!accessToken,
    })

    const route = resolveModelRoute(config)
    return resolveProtocolAdapter(route).createModel(route)
}


export function resolveHeaderPlaceholders(
    headers?: Record<string, string>,
    apiKey?: string
): Record<string, string> | undefined {
    if (!headers) return undefined

    const resolved: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
        resolved[key] = typeof value === 'string' ? value.replace(/\{\{apiKey\}\}/g, apiKey || '') : value
    }
    return resolved
}

/**
 * 解析 provider 路由。
 *
 * baseUrl 在这一步完成归一化，后续所有协议实现拿到的都是可直接拼接端点的地址。
 */
function resolveModelRoute(config: LLMConfig): ModelRoute {
    const builtinProvider = isBuiltinProvider(config.provider)
        ? BUILTIN_PROVIDERS[config.provider]
        : undefined

    const protocol = resolveProviderProtocol(
        config.provider,
        config.protocol || builtinProvider?.protocol,
    )

    const transport = resolveProviderTransport(
        config.provider,
        protocol,
        config.baseUrl || builtinProvider?.baseUrl,
    )

    return {
        providerId: config.provider,
        protocol,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: transport?.sdkBaseUrl,
        isBuiltin: Boolean(builtinProvider),
        openAICompatibilityProfile: config.openAICompatibilityProfile,
    }
}


function createCloudModel(config: LLMConfig, options: ModelOptions): LanguageModel {
    const serverUrl = options.serverUrl!.replace(/\/+$/, '')
    // 视觉模式走 /api/v1/llm/vision/chat/completions，普通模式走 /api/v1/llm/chat/completions
    const baseURL = config.cloudVisionMode
        ? `${serverUrl}/api/v1/llm/vision`
        : `${serverUrl}/api/v1/llm`

    // 统一复用带自定义 dispatcher 的 fetch：
    // bodyTimeout / headersTimeout 关闭（长思考静默不掐断）+ TCP keepalive + 连接池保活
    const baseFetch = aiFetch

    // 当前有效的 token（可能被刷新更新）
    let currentAccessToken = options.accessToken || ''
    let currentRefreshToken = options.refreshToken
    const onTokenRefreshed = options.onTokenRefreshed
    const onAuthFailedCallback = options.onAuthFailed

    // 认证失效只通知一次：一次请求可能经历多轮 401 检查
    let authFailureNotified = false

    const notifyAuthFailure = (): void => {
        if (authFailureNotified) return
        authFailureNotified = true
        logger.llm.warn('[ModelRegistry] Refresh token invalid, notifying renderer of auth failure')
        onAuthFailedCallback?.()
    }

    /** 应用刷新结果；返回是否拿到了可用的新 token */
    const applyRefresh = (outcome: CloudRefreshOutcome): boolean => {
        if (!outcome.tokens) return false

        currentAccessToken = outcome.tokens.accessToken
        // 必须同步更新 refreshToken，否则后续刷新会用已撤销的旧 token 失败
        if (outcome.tokens.refreshToken) {
            currentRefreshToken = outcome.tokens.refreshToken
        }
        authFailureNotified = false
        // 同步新 token 到渲染进程，避免后续请求因 refreshToken 被撤销而失败
        onTokenRefreshed?.(outcome.tokens.accessToken, outcome.tokens.refreshToken)
        return true
    }

    // 带 401 自动刷新的自定义 fetch
    const cloudFetch: typeof globalThis.fetch = async (input, init) => {
        const makeRequest = (token: string) => {
            const headers = new Headers(init?.headers as Record<string, string> | undefined)
            headers.set('Authorization', `Bearer ${token}`)
            return baseFetch(input, { ...init, headers })
        }

        // 没有 accessToken 时先用 refreshToken 换一次
        if (!currentAccessToken && currentRefreshToken) {
            const outcome = await refreshCloudToken(serverUrl, currentRefreshToken, baseFetch)
            if (!applyRefresh(outcome) && outcome.authInvalid) {
                notifyAuthFailure()
                currentRefreshToken = undefined
            }
        }

        let response = await makeRequest(currentAccessToken)

        // 401 时刷新 token 并重试一次
        if (response.status === 401 && currentRefreshToken) {
            const outcome = await refreshCloudToken(serverUrl, currentRefreshToken, baseFetch)

            if (applyRefresh(outcome)) {
                response = await makeRequest(currentAccessToken)
            } else if (outcome.authInvalid) {
                notifyAuthFailure()
                currentRefreshToken = undefined
            } else {
                logger.llm.warn('[ModelRegistry] Token refresh failed on 401 (refresh token still valid)', {
                    url: serverUrl,
                })
            }
        }

        return response
    }

    const isCustomProvider = config.provider.startsWith('custom-')
    const providerHeader = isCustomProvider ? 'CUSTOM' : config.provider

    const headers: Record<string, string> = {
        'X-Provider': providerHeader,
        'X-Model': config.model,
    }

    if (isCustomProvider) {
        if (config.baseUrl) {
            headers['X-Base-Url'] = config.baseUrl
        }

        // 凭证引用优先：带上凭据 id 后，明文密钥不再随请求头穿过网关；
        // 后端未开该能力时保持原有的 X-Api-Key 透传（兼容回落）。
        if (config.providerCredentialId) {
            headers['X-Provider-Credential-Id'] = config.providerCredentialId
        } else if (config.apiKey) {
            headers['X-Api-Key'] = config.apiKey
        }
    }

    const provider = createOpenAICompatible({
        name: BRAND.cloud.providerId,
        apiKey: currentAccessToken,
        baseURL,
        headers,
        fetch: cloudFetch,
    })
    return provider(config.model)
}

