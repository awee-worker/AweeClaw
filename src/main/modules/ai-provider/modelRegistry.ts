/**
 * Model Factory - create LLM model instances for different protocols.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { LLMConfig } from '@shared/protocols/modelGateway'
import { BRAND } from '@shared/brand'
import { BUILTIN_PROVIDERS, isBuiltinProvider } from '@shared/configuration/aiProviders'
import { logger } from '@shared/toolkit/LogEngine'
import type { ApiProtocol } from '@shared/configuration/aiProviders'
import { supportsFullOpenAIStyleFeatures } from '@shared/configuration/aiProviders'

export interface ModelOptions {
    enableThinking?: boolean
    cloudMode?: boolean
    serverUrl?: string
    accessToken?: string
    refreshToken?: string
    /** 云端 token 刷新成功后的回调，用于同步新 token 到渲染进程 */
    onTokenRefreshed?: (newAccessToken: string, newRefreshToken?: string) => void
}

interface ResolvedModelRoute {
    providerId: string
    protocol: ApiProtocol
    model: string
    apiKey: string
    baseUrl?: string
    isBuiltin: boolean
    openAICompatibilityProfile?: LLMConfig['openAICompatibilityProfile']
}

/**
 * Normalize base URLs for the provider SDK we are about to use.
 *
 * Notes:
 * - `createOpenAICompatible` expects the full user-provided base URL.
 * - `createAnthropic` works reliably with Anthropic-compatible gateways only
 *   when the versioned `/v1` prefix is present.
 * - Other official SDKs can derive their own versioned paths.
 */
function normalizeBaseUrl(baseUrl: string | undefined, protocol: string): string | undefined {
    if (!baseUrl) return undefined

    let url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl

    if (protocol === 'openai') {
        return url
    }

    if (protocol === 'openai-responses') {
        return /\/v\d+(?:beta)?$/i.test(url) ? url : `${url}/v1`
    }

    if (protocol === 'anthropic') {
        return /\/v1$/i.test(url) ? url : `${url}/v1`
    }

    const versionPattern = /\/v\d+(?:beta)?$/
    if (versionPattern.test(url)) {
        url = url.replace(versionPattern, '')
    }

    return url
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
        return createCloudModel(config, { cloudMode, serverUrl, accessToken, refreshToken })
    }

    logger.llm.info('[modelFactory] Creating local model:', {
        provider: config.provider,
        model: config.model,
        cloudMode,
        hasServerUrl: !!serverUrl,
        hasAccessToken: !!accessToken,
    })
    const route = resolveModelRoute(config)
    return createModelFromRoute(route, options)
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

function resolveModelRoute(config: LLMConfig): ResolvedModelRoute {
    const builtinProvider = isBuiltinProvider(config.provider)
        ? BUILTIN_PROVIDERS[config.provider]
        : undefined

    const protocol = (config.protocol || builtinProvider?.protocol || 'openai') as ApiProtocol

    return {
        providerId: config.provider,
        protocol,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: normalizeBaseUrl(config.baseUrl || builtinProvider?.baseUrl, protocol),
        isBuiltin: Boolean(builtinProvider),
        openAICompatibilityProfile: config.openAICompatibilityProfile,
    }
}

function createCloudModel(config: LLMConfig, options: ModelOptions): LanguageModel {
    const serverUrl = options.serverUrl!.replace(/\/+$/, '')
    const baseURL = `${serverUrl}/api/v1/llm`

    const baseFetch = (() => {
        try {
            const undici = require('undici')
            return undici.fetch as typeof globalThis.fetch
        } catch {
            return globalThis.fetch.bind(globalThis)
        }
    })()

    // 当前有效的 access token（可能被刷新更新）
    let currentAccessToken = options.accessToken || ''
    let currentRefreshToken = options.refreshToken
    const onTokenRefreshed = options.onTokenRefreshed

    // 带 401 自动刷新的自定义 fetch
    const cloudFetch: typeof globalThis.fetch = async (input, init) => {
        const makeRequest = (token: string) => {
            const headers = new Headers(init?.headers as Record<string, string> | undefined)
            headers.set('Authorization', `Bearer ${token}`)
            return baseFetch(input, { ...init, headers })
        }

        // 同步更新 token 的辅助函数
        const updateTokens = (newAccessToken: string, newRefreshToken?: string) => {
            currentAccessToken = newAccessToken
            // 必须同步更新 refreshToken，否则后续刷新会用已撤销的旧 token 失败
            if (newRefreshToken) {
                currentRefreshToken = newRefreshToken
            }
        }

        // 如果没有 accessToken，先尝试用 refreshToken 刷新
        if (!currentAccessToken && currentRefreshToken) {
            try {
                const refreshRes = await baseFetch(`${serverUrl}/api/v1/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: currentRefreshToken }),
                })

                if (refreshRes.ok) {
                    const data = await refreshRes.json() as { accessToken: string; refreshToken?: string }
                    updateTokens(data.accessToken, data.refreshToken)
                    onTokenRefreshed?.(data.accessToken, data.refreshToken)
                }
            } catch {
                // refresh 失败，继续用空 token 请求（会得到 401）
            }
        }

        let response = await makeRequest(currentAccessToken)

        // 401 时尝试刷新 token 并重试一次
        if (response.status === 401 && currentRefreshToken) {
            try {
                const refreshRes = await baseFetch(`${serverUrl}/api/v1/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: currentRefreshToken }),
                })

                if (refreshRes.ok) {
                    const data = await refreshRes.json() as { accessToken: string; refreshToken?: string }
                    // 同步更新主进程闭包中的 token（包括 refreshToken，因为后端会撤销旧 refreshToken）
                    updateTokens(data.accessToken, data.refreshToken)
                    // 同步新 token 到渲染进程，避免后续请求因 refreshToken 被撤销而失败
                    onTokenRefreshed?.(data.accessToken, data.refreshToken)
                    // 用新 token 重试原始请求
                    response = await makeRequest(currentAccessToken)
                } else {
                    logger.llm.warn('[ModelRegistry] Token refresh failed on 401:', {
                        status: refreshRes.status,
                        url: serverUrl,
                    })
                }
            } catch (err) {
                logger.llm.error('[ModelRegistry] Token refresh exception on 401:', err)
                // refresh 失败，返回原始 401 响应
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
        if (config.apiKey) {
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

function createModelFromRoute(
    route: ResolvedModelRoute,
    _options: ModelOptions = {}
): LanguageModel {
    if (route.isBuiltin) {
        return createBuiltinModel(route)
    }

    return createCustomModel(route)
}

function createBuiltinModel(route: ResolvedModelRoute): LanguageModel {
    switch (route.providerId) {
        case 'openai': {
            const openai = createOpenAI({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })

            if (route.protocol === 'openai-responses') {
                return openai.responses(route.model)
            }

            return openai.chat(route.model)
        }

        case 'anthropic': {
            const anthropic = createAnthropic({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return anthropic(route.model)
        }

        case 'gemini': {
            const google = createGoogleGenerativeAI({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return google(route.model)
        }

        default: {
            if (!route.baseUrl) {
                throw new Error(`Builtin provider ${route.providerId} requires baseUrl`)
            }

            switch (route.protocol) {
                case 'openai': {
                    const provider = createOpenAICompatible({
                        name: route.providerId,
                        apiKey: route.apiKey,
                        baseURL: route.baseUrl,
                        supportsStructuredOutputs: supportsFullOpenAIStyleFeatures(
                            route.providerId,
                            route.protocol,
                            route.openAICompatibilityProfile,
                        ),
                    })
                    return provider(route.model)
                }

                case 'openai-responses': {
                    const openai = createOpenAI({
                        apiKey: route.apiKey,
                        baseURL: route.baseUrl,
                    })
                    return openai.responses(route.model)
                }

                case 'anthropic': {
                    const anthropic = createAnthropic({
                        apiKey: route.apiKey,
                        baseURL: route.baseUrl,
                    })
                    return anthropic(route.model)
                }

                case 'google': {
                    const google = createGoogleGenerativeAI({
                        apiKey: route.apiKey,
                        baseURL: route.baseUrl,
                    })
                    return google(route.model)
                }

                default: {
                    const fallback = createOpenAICompatible({
                        name: route.providerId,
                        apiKey: route.apiKey,
                        baseURL: route.baseUrl,
                    })
                    return fallback(route.model)
                }
            }
        }
    }
}

function createCustomModel(
    route: ResolvedModelRoute
): LanguageModel {
    if (!route.baseUrl) {
        throw new Error('Custom provider requires baseUrl')
    }

    switch (route.protocol) {
        case 'openai': {
            const provider = createOpenAICompatible({
                name: 'custom-openai',
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
                supportsStructuredOutputs: supportsFullOpenAIStyleFeatures(
                    route.providerId,
                    route.protocol,
                    route.openAICompatibilityProfile,
                ),
            })
            return provider(route.model)
        }

        case 'openai-responses': {
            const openai = createOpenAI({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return openai.responses(route.model)
        }

        case 'anthropic': {
            const anthropic = createAnthropic({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return anthropic(route.model)
        }

        case 'google': {
            const google = createGoogleGenerativeAI({
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
            })
            return google(route.model)
        }

        default: {
            const fallback = createOpenAICompatible({
                name: 'custom',
                apiKey: route.apiKey,
                baseURL: route.baseUrl,
                supportsStructuredOutputs: supportsFullOpenAIStyleFeatures(
                    route.providerId,
                    route.protocol,
                    route.openAICompatibilityProfile,
                ),
            })
            return fallback(route.model)
        }
    }
}
