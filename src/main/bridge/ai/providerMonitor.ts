/**
 * Provider 健康监控 — LLM 服务商可用性检测与模型测试
 *
 * 职责：
 * - 暴露 Provider 健康检查、模型测试等 IPC 接口
 * - 通过 `IpcChannelGuard` 进行速率限制，避免频繁探测
 * - 支持场景级可用性查询（不同场景可用的 Provider 集合）
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import type { ApiProtocol } from '@shared/configuration/aiProviders'
import { resolveProviderCapabilities } from '@shared/configuration/providerCapabilities'
import {
    buildProviderModelsRequest,
    resolveProviderTransport,
} from '@shared/configuration/providerTransport'
import type { ProviderTransport } from '@shared/configuration/providerTransport'
import { createModel, resolveHeaderPlaceholders } from '../../modules/ai-provider/modelRegistry'
import { parseModelCatalogPayload } from '../../modules/ai-provider/modelCatalogSync'
import { generateText } from 'ai'
import { IpcChannelGuard } from '../core/ipcGuard'

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
    // 该函数只在 Responses 协议下调用，缺省协议需显式声明，
    // 否则自定义 provider 会被推断成 openai 兼容协议而漏掉 /v1 版本段
    const transport = resolveTransport(
        config.provider,
        config.baseUrl,
        config.protocol || 'openai-responses',
    )


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
        const response = await fetch(`${transport.apiRoot}/responses`, {
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

/**
 * 解析 provider 传输参数。
 *
 * 与对话链路共用 `resolveProviderTransport`：同一份 baseUrl 在「发消息」
 * 与「健康检查 / 拉模型列表」两条路径上被解释成同一个地址，不会出现
 * 一边通一边 404。
 */
function resolveTransport(
    provider: string,
    baseUrl?: string,
    protocol?: string,
): ProviderTransport {
    const transport = resolveProviderTransport(
        provider,
        protocol as ApiProtocol | undefined,
        baseUrl,
    )

    if (!transport) {
        throw new Error(`Provider ${provider} 未配置可用的 baseUrl`)
    }

    return transport
}


/**
 * 场景可用性 — 由服务商能力声明推导，而不是一律返回 true。
 *
 * 需求项与技术能力名的对应关系见 SCENARIO_REQUIRED_CAPABILITIES；
 * 无法映射的能力项（如 structured_output）不参与判定，避免误报不可用。
 */
function assessScenarioAvailability(provider: string): Record<string, boolean> {
    const capabilities = resolveProviderCapabilities(provider)
    const result: Record<string, boolean> = {}

    for (const [scenario, required] of Object.entries(SCENARIO_REQUIRED_CAPABILITIES)) {
        result[scenario] = required.every((item) => {
            switch (item) {
                case 'function_calling':
                    return capabilities.tools
                case 'streaming':
                    return capabilities.streaming
                default:
                    return true
            }
        })
    }

    return result
}

export function registerHealthCheckHandlers() {
    const guard = IpcChannelGuard.getInstance()

    ipcMain.handle('healthCheck:check', async (_, provider: string, apiKey: string, baseUrl?: string, timeout = 10000, protocol?: string) => {
        const startTime = Date.now()

        try {
            const transport = resolveTransport(provider, baseUrl, protocol)
            const activeProtocol = transport.protocol

            logger.ipc.info(`[HealthMonitor] Checking ${provider} at ${transport.apiRoot} (protocol: ${activeProtocol})`)

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)

            const { url: fetchUrl, headers } = buildProviderModelsRequest(transport, apiKey)


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

            const transport = resolveTransport(provider, baseUrl, protocol)
            const activeProtocol = transport.protocol
            const { url: fetchUrl, headers } = buildProviderModelsRequest(transport, apiKey)


            logger.ipc.info(`[HealthMonitor] Requesting models from: ${fetchUrl}`)

            const response = await fetch(fetchUrl, { method: 'GET', headers })
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`)
            }

            const data = await response.json() as unknown
            // 解析统一走 modelCatalogSync：启动时的自动同步与这里的手动拉取
            // 共用同一份实现，避免两条链路对同一接口的理解出现分歧
            const models = parseModelCatalogPayload(data, activeProtocol)
                .filter(Boolean)
                .sort()
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
