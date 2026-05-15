import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { BUILTIN_PROVIDERS, isBuiltinProvider } from '@shared/configuration/aiProviders'
import { createModel, resolveHeaderPlaceholders } from '../modules/ai-provider/modelRegistry'
import { generateText } from 'ai'
import { IpcChannelGuard } from './ipcGuard'

export interface ProviderHealthReport {
    provider: string
    status: 'healthy' | 'unhealthy' | 'degraded' | 'unknown'
    latency?: number
    error?: string
    checkedAt: Date
    consecutiveFailures: number
    scenarioAvailability: Record<string, boolean>
}

export interface ModelTestReport {
    success: boolean
    content?: string
    latency?: number
    error?: string
    modelId?: string
    protocol?: string
}

const PROVIDER_DEFAULT_ENDPOINTS: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    gemini: 'https://generativelanguage.googleapis.com',
    deepseek: 'https://api.deepseek.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    mistral: 'https://api.mistral.ai/v1',
    ollama: 'http://localhost:11434/v1',
    nvidia: 'https://integrate.api.nvidia.com/v1',
}

const SCENARIO_REQUIRED_CAPABILITIES: Record<string, string[]> = {
    legal: ['structured_output', 'long_context'],
    education: ['function_calling', 'streaming'],
    medical: ['structured_output', 'high_accuracy'],
}

const healthHistory = new Map<string, ProviderHealthReport[]>()
const MAX_HISTORY = 50

function recordHealth(report: ProviderHealthReport): void {
    const history = healthHistory.get(report.provider) || []
    history.push(report)
    if (history.length > MAX_HISTORY) history.shift()
    healthHistory.set(report.provider, history)
}

function getConsecutiveFailures(provider: string): number {
    const history = healthHistory.get(provider) || []
    let count = 0
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].status === 'unhealthy') count++
        else break
    }
    return count
}

function normalizeResponsesBaseUrl(baseUrl?: string): string | undefined {
    if (!baseUrl) return undefined
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    return /\/v\d+(?:beta)?$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
}

function extractResponsesOutputText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return ''

    const maybePayload = payload as {
        output_text?: unknown
        output?: Array<{
            type?: string
            content?: Array<{ type?: string; text?: string }>
        }>
    }

    if (typeof maybePayload.output_text === 'string' && maybePayload.output_text.trim()) {
        return maybePayload.output_text.trim()
    }

    const parts: string[] = []
    for (const item of maybePayload.output || []) {
        if (item?.type !== 'message' || !Array.isArray(item.content)) continue
        for (const content of item.content) {
            if (content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
                parts.push(content.text.trim())
            }
        }
    }

    return parts.join('\n').trim()
}

async function testOpenAIResponsesModel(config: any): Promise<string> {
    const builtinProvider = isBuiltinProvider(config.provider)
        ? BUILTIN_PROVIDERS[config.provider]
        : undefined
    const baseUrl = normalizeResponsesBaseUrl(config.baseUrl || builtinProvider?.baseUrl)
    if (!baseUrl) {
        throw new Error('OpenAI Responses provider requires baseUrl')
    }

    const timeoutMs = typeof config.timeout === 'number' && config.timeout > 0
        ? config.timeout
        : 30000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(resolveHeaderPlaceholders(config.headers, config.apiKey) || {}),
    }

    const hasAuthorizationHeader = Object.keys(headers).some(key => key.toLowerCase() === 'authorization')
    if (!hasAuthorizationHeader) {
        headers['Authorization'] = `Bearer ${config.apiKey || ''}`
    }

    try {
        const response = await fetch(`${baseUrl}/responses`, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
                model: config.model,
                input: 'hi,Please tell me directly what model you are?',
                max_output_tokens: 10,
                text: { format: { type: 'text' } },
            }),
        })

        const responseText = await response.text()
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${responseText}`)
        }

        let payload: unknown
        try {
            payload = JSON.parse(responseText)
        } catch {
            throw new Error(`Invalid JSON response: ${responseText}`)
        }

        const outputText = extractResponsesOutputText(payload)
        if (!outputText) {
            throw new Error('Model returned no text output')
        }

        return outputText
    } finally {
        clearTimeout(timeoutId)
    }
}

function resolveProviderEndpoint(provider: string, baseUrl?: string): string {
    const url = (baseUrl || PROVIDER_DEFAULT_ENDPOINTS[provider] || PROVIDER_DEFAULT_ENDPOINTS.openai).replace(/\/$/, '')
    return url
}

function resolveProtocol(provider: string, protocol?: string): string {
    return protocol || (provider === 'gemini' ? 'google' : provider === 'anthropic' ? 'anthropic' : 'openai')
}

function buildHealthCheckRequest(_provider: string, url: string, apiKey: string, activeProtocol: string) {
    let fetchUrl: string
    let headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (activeProtocol === 'google') {
        if (url.includes('/v1beta') || url.includes('/v1')) {
            fetchUrl = `${url}/models`
        } else {
            fetchUrl = `${url}/v1beta/models`
        }
        if (apiKey) fetchUrl += `?key=${apiKey}`
    } else if (activeProtocol === 'anthropic') {
        if (url.includes('/v1')) {
            fetchUrl = `${url}/models`
        } else {
            fetchUrl = `${url}/v1/models`
        }
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
    } else {
        if (/\/v\d+/.test(url)) {
            fetchUrl = `${url}/models`
        } else {
            fetchUrl = `${url}/v1/models`
        }
        headers['Authorization'] = `Bearer ${apiKey}`
    }

    return { fetchUrl, headers }
}

function assessScenarioAvailability(_provider: string, _modelList?: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    for (const [scenario, _capabilities] of Object.entries(SCENARIO_REQUIRED_CAPABILITIES)) {
        result[scenario] = true
    }
    return result
}

export function registerHealthCheckHandlers() {
    const guard = IpcChannelGuard.getInstance()

    ipcMain.handle('healthCheck:check', async (_, provider: string, apiKey: string, baseUrl?: string, timeout = 10000, protocol?: string) => {
        const startTime = Date.now()
        const url = resolveProviderEndpoint(provider, baseUrl)
        const activeProtocol = resolveProtocol(provider, protocol)

        try {
            logger.ipc.info(`[HealthMonitor] Checking ${provider} at ${url} (protocol: ${activeProtocol})`)

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)

            const { fetchUrl, headers } = buildHealthCheckRequest(provider, url, apiKey, activeProtocol)

            const response = await fetch(fetchUrl, { method: 'GET', headers, signal: controller.signal })
            clearTimeout(timeoutId)
            const latency = Date.now() - startTime

            const consecutiveFailures = 0
            const scenarioAvailability = assessScenarioAvailability(provider)

            if (response.ok) {
                logger.ipc.info(`[HealthMonitor] ${provider} is healthy (${latency}ms)`)
                const report: ProviderHealthReport = {
                    provider, status: 'healthy', latency,
                    checkedAt: new Date(), consecutiveFailures, scenarioAvailability,
                }
                recordHealth(report)
                guard.recordCall('healthCheck:check', true)
                return report
            } else {
                logger.ipc.warn(`[HealthMonitor] ${provider} returned HTTP ${response.status}`)
                const failures = getConsecutiveFailures(provider) + 1
                const report: ProviderHealthReport = {
                    provider, status: failures >= 3 ? 'degraded' : 'unhealthy',
                    latency, error: `HTTP ${response.status}`,
                    checkedAt: new Date(), consecutiveFailures: failures,
                    scenarioAvailability: assessScenarioAvailability(provider),
                }
                recordHealth(report)
                guard.recordCall('healthCheck:check', false)
                return report
            }
        } catch (err) {
            const error = toAppError(err)
            logger.ipc.error(`[HealthMonitor] ${provider} check failed:`, error.message)
            const failures = getConsecutiveFailures(provider) + 1
            const report: ProviderHealthReport = {
                provider, status: failures >= 3 ? 'degraded' : 'unhealthy',
                error: error.message || 'Connection failed',
                checkedAt: new Date(), consecutiveFailures: failures,
                scenarioAvailability: assessScenarioAvailability(provider),
            }
            recordHealth(report)
            guard.recordCall('healthCheck:check', false)
            return report
        }
    })

    ipcMain.handle('healthCheck:testModel', async (_, config: any) => {
        const startTime = Date.now()
        try {
            if (!config || !config.provider || !config.model) {
                throw new Error('Invalid model configuration: missing provider or model')
            }

            logger.ipc.info(`[HealthMonitor] Testing model ${config.model} for provider ${config.provider}`)

            let text: string
            if (config.protocol === 'openai-responses') {
                text = await testOpenAIResponsesModel(config)
            } else {
                const model = createModel(config)
                const result = await generateText({
                    model,
                    messages: [{ role: 'user', content: 'hi,Please tell me directly what model you are?' }],
                    maxOutputTokens: 10,
                })
                text = result.text
            }

            const latency = Date.now() - startTime
            logger.ipc.info(`[HealthMonitor] Model test success: ${text.slice(0, 20)}... (${latency}ms)`)
            guard.recordCall('healthCheck:testModel', true)

            return {
                success: true, content: text, latency,
                modelId: config.model, protocol: config.protocol,
            } as ModelTestReport
        } catch (err) {
            const error = toAppError(err)
            const latency = Date.now() - startTime
            logger.ipc.error(`[HealthMonitor] Model test failed:`, error)
            guard.recordCall('healthCheck:testModel', false)

            return {
                success: false, error: error.message || 'Model test failed',
                latency, modelId: config?.model, protocol: config?.protocol,
            } as ModelTestReport
        }
    })

    ipcMain.handle('healthCheck:fetchModels', async (_, provider: string, apiKey: string, baseUrl?: string, protocol?: string) => {
        try {
            logger.ipc.info(`[HealthMonitor] Fetching models for ${provider} (protocol: ${protocol})`)

            let url = baseUrl || PROVIDER_DEFAULT_ENDPOINTS[provider] || PROVIDER_DEFAULT_ENDPOINTS.openai
            url = url.endsWith('/') ? url.slice(0, -1) : url

            const activeProtocol = resolveProtocol(provider, protocol)
            const { fetchUrl, headers } = buildHealthCheckRequest(provider, url, apiKey, activeProtocol)

            logger.ipc.info(`[HealthMonitor] Requesting models from: ${fetchUrl}`)

            const response = await fetch(fetchUrl, { method: 'GET', headers })
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`)
            }

            const data = await response.json() as unknown
            let models: string[] = []

            if (activeProtocol === 'google' || provider === 'gemini') {
                if (data && typeof data === 'object' && 'models' in data && Array.isArray(data.models)) {
                    models = data.models.map((m: any) => m.name.replace('models/', ''))
                }
            } else {
                if (data && typeof data === 'object' && 'data' in data && Array.isArray(data.data)) {
                    models = data.data.map((m: any) => m.id)
                } else if (Array.isArray(data)) {
                    models = data.map((m: any) => typeof m === 'string' ? m : (m.id || m.name))
                }
            }

            models = models.filter(Boolean).sort()
            logger.ipc.info(`[HealthMonitor] Successfully fetched ${models.length} models`)
            guard.recordCall('healthCheck:fetchModels', true)
            return { success: true, models }
        } catch (err) {
            const error = toAppError(err)
            logger.ipc.error(`[HealthMonitor] Fetch models failed:`, error.message)
            guard.recordCall('healthCheck:fetchModels', false)
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('healthMonitor:getHistory', async (_, provider?: string) => {
        if (provider) {
            return healthHistory.get(provider) || []
        }
        return Object.fromEntries(healthHistory)
    })

    ipcMain.handle('healthMonitor:getStats', async () => {
        return guard.getAllStats()
    })

    logger.ipc.info('[HealthMonitor] Health monitoring handlers registered')
}
