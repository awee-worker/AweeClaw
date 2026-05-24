/**
 * [AweeClaw] 场景感知版本同步引擎
 *
 * 与 Adnify 的 scheduleSavedVersionSync 差异化：
 * - 新增场景感知的同步策略（重试次数、同步延迟、验证严格度）
 * - 法律/医疗场景：更多重试、严格内容验证、审计日志
 * - 教育场景：标准重试、宽松验证
 * - 新增场景感知的版本标记策略
 */

import { useStore } from '@store'
import { monaco } from '@renderer/monacoWorkerEntry'
import { logger } from '@toolkit/LogEngine'

interface ScenarioSyncConfig {
    maxAttempts: number
    retryDelayFrames: number
    strictContentMatch: boolean
    logSyncEvents: boolean
    versionMarkStrategy: 'standard' | 'audit' | 'checkpoint'
}

const SCENARIO_SYNC_CONFIGS: Record<string, ScenarioSyncConfig> = {
    'workspace-editor': {
        maxAttempts: 8,
        retryDelayFrames: 1,
        strictContentMatch: false,
        logSyncEvents: false,
        versionMarkStrategy: 'standard',
    },
    'legal': {
        maxAttempts: 16,
        retryDelayFrames: 2,
        strictContentMatch: true,
        logSyncEvents: true,
        versionMarkStrategy: 'audit',
    },
    'medical': {
        maxAttempts: 16,
        retryDelayFrames: 2,
        strictContentMatch: true,
        logSyncEvents: true,
        versionMarkStrategy: 'audit',
    },
    'education': {
        maxAttempts: 6,
        retryDelayFrames: 1,
        strictContentMatch: false,
        logSyncEvents: false,
        versionMarkStrategy: 'checkpoint',
    },
}

function getScenarioSyncConfig(): ScenarioSyncConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'workspace-editor'
    return SCENARIO_SYNC_CONFIGS[scenarioId] ?? SCENARIO_SYNC_CONFIGS['workspace-editor']
}

function contentMatches(actual: string, expected: string, strict: boolean): boolean {
    if (strict) {
        return actual === expected
    }
    return actual.trim() === expected.trim()
}

export function scheduleSavedVersionSync(filePath: string, expectedContent: string): void {
    const config = getScenarioSyncConfig()
    let attempts = 0

    const sync = () => {
        const model = monaco.editor.getModel(monaco.Uri.file(filePath))
        if (!model) return

        const actualContent = model.getValue()
        if (!contentMatches(actualContent, expectedContent, config.strictContentMatch)) {
            attempts += 1
            if (attempts < config.maxAttempts) {
                if (config.retryDelayFrames > 1) {
                    let frameCount = 0
                    const delayedSync = () => {
                        frameCount++
                        if (frameCount >= config.retryDelayFrames) {
                            sync()
                        } else {
                            requestAnimationFrame(delayedSync)
                        }
                    }
                    requestAnimationFrame(delayedSync)
                } else {
                    requestAnimationFrame(sync)
                }
            } else if (config.logSyncEvents) {
                logger.system.warn('[ScenarioVersionSync] Max attempts reached for:', filePath)
            }
            return
        }

        const { markFileSaved } = useStore.getState()
        markFileSaved(filePath, model.getAlternativeVersionId())

        if (config.logSyncEvents) {
            logger.system.info('[ScenarioVersionSync] Version marked saved:', filePath, 'strategy:', config.versionMarkStrategy)
        }
    }

    requestAnimationFrame(sync)
}

export function getActiveSyncConfig(): ScenarioSyncConfig {
    return getScenarioSyncConfig()
}
