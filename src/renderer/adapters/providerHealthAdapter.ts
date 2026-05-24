/**
 * [AweeClaw] 场景感知健康监控引擎
 *
 * 与 Adnify 的 providerHealthAdapter 差异化：
 * - 新增场景感知的健康检查策略（超时阈值、重试策略、关键性分级）
 * - 法律/医疗场景：更严格的超时、更短缓存TTL、关键性标记
 * - 教育场景：宽松超时、更长缓存、非关键性标记
 * - 新增场景感知的批量健康检查和聚合状态
 */

import { CacheService } from '@shared/toolkit/CacheManager'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { getCacheConfig } from '@configuration/agentProfile'
import { getEditorConfig } from '@shared/configuration/preferenceSync'
import { LLMConfig } from '@shared/protocols/modelGateway'
import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'

export interface HealthCheckResult {
    provider: string
    status: 'healthy' | 'unhealthy' | 'unknown'
    latency?: number
    error?: string
    checkedAt: Date
    criticality?: 'critical' | 'important' | 'normal'
}

interface ScenarioHealthConfig {
    timeoutMultiplier: number
    cacheTtlMultiplier: number
    retryCount: number
    retryDelayMs: number
    criticality: 'critical' | 'important' | 'normal'
    failoverEnabled: boolean
}

const SCENARIO_HEALTH_CONFIGS: Record<string, ScenarioHealthConfig> = {
    'workspace-editor': {
        timeoutMultiplier: 1.0,
        cacheTtlMultiplier: 1.0,
        retryCount: 1,
        retryDelayMs: 500,
        criticality: 'normal',
        failoverEnabled: false,
    },
    'legal': {
        timeoutMultiplier: 1.5,
        cacheTtlMultiplier: 0.5,
        retryCount: 3,
        retryDelayMs: 1000,
        criticality: 'critical',
        failoverEnabled: true,
    },
    'medical': {
        timeoutMultiplier: 2.0,
        cacheTtlMultiplier: 0.5,
        retryCount: 3,
        retryDelayMs: 1500,
        criticality: 'critical',
        failoverEnabled: true,
    },
    'education': {
        timeoutMultiplier: 0.8,
        cacheTtlMultiplier: 2.0,
        retryCount: 1,
        retryDelayMs: 300,
        criticality: 'normal',
        failoverEnabled: false,
    },
}

function getScenarioHealthConfig(): ScenarioHealthConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'workspace-editor'
    return SCENARIO_HEALTH_CONFIGS[scenarioId] ?? SCENARIO_HEALTH_CONFIGS['workspace-editor']
}

const cacheConfig = getCacheConfig('healthCheck')
const healthCache = new CacheService<HealthCheckResult>('HealthCheck', {
    maxSize: cacheConfig.maxSize,
    defaultTTL: cacheConfig.ttlMs,
    evictionPolicy: cacheConfig.evictionPolicy || 'fifo',
})

async function checkWithRetry(
    provider: string,
    apiKey: string,
    baseUrl?: string,
    protocol?: string
): Promise<HealthCheckResult> {
    const config = getScenarioHealthConfig()
    const baseTimeout = getEditorConfig().performance.healthCheckTimeoutMs
    const timeout = Math.round(baseTimeout * config.timeoutMultiplier)

    let lastError: string | undefined

    for (let attempt = 0; attempt <= config.retryCount; attempt++) {
        try {
            const rawResult = await window.electronAPI.healthCheckProvider(
                provider,
                apiKey,
                baseUrl,
                timeout,
                protocol
            )

            const result: HealthCheckResult = {
                ...rawResult,
                checkedAt: new Date(rawResult.checkedAt),
                criticality: config.criticality,
            }
            healthCache.set(provider, result)
            return result
        } catch (err) {
            lastError = toAppError(err).message || 'Connection failed'
            if (attempt < config.retryCount) {
                await new Promise(resolve => setTimeout(resolve, config.retryDelayMs))
            }
        }
    }

    const result: HealthCheckResult = {
        provider,
        status: 'unhealthy',
        error: lastError,
        checkedAt: new Date(),
        criticality: config.criticality,
    }
    healthCache.set(provider, result)
    return result
}

export async function checkProviderHealth(
    provider: string,
    apiKey: string,
    baseUrl?: string,
    protocol?: string
): Promise<HealthCheckResult> {
    return checkWithRetry(provider, apiKey, baseUrl, protocol)
}

export async function checkAllProviders(
    providers: Array<{ provider: string; apiKey: string; baseUrl?: string; protocol?: string }>
): Promise<HealthCheckResult[]> {
    const results = await Promise.all(
        providers.map(p => checkProviderHealth(p.provider, p.apiKey, p.baseUrl, p.protocol))
    )

    const config = getScenarioHealthConfig()
    if (config.failoverEnabled) {
        const unhealthy = results.filter(r => r.status === 'unhealthy' && r.criticality === 'critical')
        if (unhealthy.length > 0) {
            logger.system.warn('[ScenarioHealthMonitor] Critical providers unhealthy:', unhealthy.map(r => r.provider))
        }
    }

    return results
}

export function getAggregatedHealthStatus(): 'healthy' | 'degraded' | 'unhealthy' {
    const allResults = healthCache.values()
    if (allResults.length === 0) return 'healthy'

    const config = getScenarioHealthConfig()
    const criticalResults = allResults.filter(r => r.criticality === 'critical')
    const hasUnhealthyCritical = criticalResults.some(r => r.status === 'unhealthy')
    const hasUnhealthyAny = allResults.some(r => r.status === 'unhealthy')

    if (config.criticality === 'critical' && hasUnhealthyCritical) return 'unhealthy'
    if (hasUnhealthyAny) return 'degraded'
    return 'healthy'
}

export function getCachedHealthStatus(provider: string): HealthCheckResult | null {
    return healthCache.get(provider) ?? null
}

export function clearHealthCache() {
    healthCache.clear()
}

export function getAllHealthStatus(): HealthCheckResult[] {
    return healthCache.values()
}

export async function testModelCall(config: LLMConfig) {
    try {
        const result = await window.electronAPI.testModel(config)
        return result
    } catch (err) {
        return {
            success: false,
            error: toAppError(err).message || 'Test failed',
        }
    }
}

export async function fetchModelsCall(provider: string, apiKey: string, baseUrl?: string, protocol?: string) {
    try {
        const result = await window.electronAPI.fetchModels(provider, apiKey, baseUrl, protocol)
        return result
    } catch (err) {
        return {
            success: false,
            error: toAppError(err).message || 'Fetch failed',
        }
    }
}

export function getHealthCacheStats() {
    return healthCache.getStats()
}

export function getActiveHealthConfig(): ScenarioHealthConfig {
    return getScenarioHealthConfig()
}
