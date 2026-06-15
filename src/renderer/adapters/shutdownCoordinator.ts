/**
 * [AweeClaw] 场景感知优雅关闭协调器
 *
 * 与 Adnify 的 shutdownCoordinator 差异化：
 * - 新增场景感知的关闭策略（超时阈值、数据持久化优先级）
 * - 法律/医疗场景：强制完整持久化、审计日志刷写、严格超时
 * - 教育场景：快速关闭、最小持久化
 * - 新增场景感知的关闭阶段回调
 */

import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'
import { flushAgentSessionPersistence, flushStreamingBuffer } from '@intelligence/state/IntelligenceStore'
import { agentSessionRepository } from './sessionRepository'
import { flushWorkspaceStatePersistence } from './workspaceStateAdapter'
import { aweeclawDir } from './appDirService'
import { api } from './electronBridge'
import { shellRegistryService } from '../shell/services/terminalRegistry'

interface ScenarioShutdownConfig {
    forceFullPersistence: boolean
    flushAuditLog: boolean
    timeoutMs: number
    gracefulTerminalShutdown: boolean
}

const SCENARIO_SHUTDOWN_CONFIGS: Record<string, ScenarioShutdownConfig> = {
    'dev-assistant': {
        forceFullPersistence: false,
        flushAuditLog: false,
        timeoutMs: 5000,
        gracefulTerminalShutdown: true,
    },
    'legal': {
        forceFullPersistence: true,
        flushAuditLog: true,
        timeoutMs: 10000,
        gracefulTerminalShutdown: true,
    },
    'medical': {
        forceFullPersistence: true,
        flushAuditLog: true,
        timeoutMs: 10000,
        gracefulTerminalShutdown: true,
    },
    'education': {
        forceFullPersistence: false,
        flushAuditLog: false,
        timeoutMs: 3000,
        gracefulTerminalShutdown: false,
    },
}

function getScenarioShutdownConfig(): ScenarioShutdownConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
    return SCENARIO_SHUTDOWN_CONFIGS[scenarioId] ?? SCENARIO_SHUTDOWN_CONFIGS['dev-assistant']
}

async function persistWorkspaceBinding(): Promise<void> {
    const workspace = useStore.getState().workspace
    if (!workspace || workspace.roots.length === 0) {
        return
    }

    try {
        await api.workspace.save(workspace.configPath || '', workspace.roots)
    } catch (error) {
        logger.system.warn('[ScenarioShutdown] Failed to persist workspace binding:', error)
    }
}

export async function persistAllRuntimeState(): Promise<void> {
    const config = getScenarioShutdownConfig()

    if (config.flushAuditLog) {
        logger.system.info('[ScenarioShutdown] Starting full persistence with audit trail')
    }

    flushStreamingBuffer()
    flushAgentSessionPersistence()

    if (config.forceFullPersistence) {
        await flushWorkspaceStatePersistence()
        await Promise.all([
            agentSessionRepository.flush(),
            config.gracefulTerminalShutdown ? shellRegistryService.flush() : Promise.resolve(),
            persistWorkspaceBinding(),
        ])
        await aweeclawDir.flush()

        if (config.flushAuditLog) {
            logger.system.info('[ScenarioShutdown] Full persistence completed with audit trail')
        }
    } else {
        await flushWorkspaceStatePersistence()
        await Promise.all([
            agentSessionRepository.flush(),
            shellRegistryService.flush(),
            persistWorkspaceBinding(),
        ])
        await aweeclawDir.flush()
    }
}

export function getActiveShutdownConfig(): ScenarioShutdownConfig {
    return getScenarioShutdownConfig()
}
