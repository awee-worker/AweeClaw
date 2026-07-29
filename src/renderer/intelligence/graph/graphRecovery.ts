/**
 * 图执行崩溃恢复入口（Graph Runtime 阶段五）
 *
 * 职责：应用启动时扫描 runtime/ 目录，将崩溃前持久化的图执行状态恢复到内存。
 *
 * 恢复流程：
 * 1. 模块级 `recoveryInProgress: Set<string>` 防并发（避免重复触发）
 * 2. runtime 目录不存在则直接返回
 * 3. 清理 .tmp 孤儿文件（崩溃可能残留）
 * 4. 遍历 *.runtime.json：
 *    - JSON.parse / schema 校验失败 → 删除文件
 *    - plan 不存在 / graphVersion≠2 / plan 终态 → 删除文件
 *    - planRevision 不匹配（plan 被外部修改）→ 删除文件不恢复
 *    - session 已存在 → 跳过（防并发）
 *    - checkpoint.nodeId / completedNodes 不在 plan.tasks → 删除文件
 * 5. 调 taskExecutor.recoverSession(plan, state, workspacePath) 恢复内存状态
 *
 * 设计要点：
 * - graphRecovery 负责"磁盘层"（遍历/校验/清理）
 * - taskExecutor.recoverSession 负责"内存层"（createSession/loadCheckpoint/分支处理）
 * - 恢复失败不抛错，仅日志告警（崩溃恢复是 best-effort）
 * - 恢复成功后不删 runtime 文件（由 clearSession 在终态删除）
 *
 * @module GraphRuntime/recovery
 */

import { logger } from '@toolkit/LogEngine'
import { useAgentStore } from '../state/IntelligenceStore'
import { isDynamicGraphPlan } from './graphGuard'
import { recoverSession } from '../planner/taskExecutor'
import {
    listRuntimeFiles,
    loadRuntimeState,
    deleteRuntimeState,
    cleanupOrphanTmp,
    extractPlanIdFromFileName,
    getRuntimeDir,
} from './runtimePersistence'
import type { TaskPlan } from '../planner/planTypes'

/**
 * plan 终态状态（无需恢复，应删除 runtime 文件）
 */
const TERMINAL_PLAN_STATUSES = ['completed', 'failed', 'stopped', 'approved', 'archived']

/**
 * 判断 plan 是否处于终态（无需恢复）
 */
function isPlanTerminal(plan: TaskPlan): boolean {
    return TERMINAL_PLAN_STATUSES.includes(plan.status)
}

/**
 * 校验 checkpoint 中的 nodeId / completedNodes 是否都在 plan.tasks 中
 *
 * 防止恢复后引用不存在的节点（plan 被外部编辑导致节点删除）
 */
function validateCheckpointNodes(state: { checkpoint: { nodeId: string; completedNodes: string[] } }, plan: TaskPlan): boolean {
    const taskIds = new Set(plan.tasks.map(t => t.id))
    const { nodeId, completedNodes } = state.checkpoint

    // 入口节点必须存在
    if (!taskIds.has(nodeId)) {
        logger.agent.warn(
            `[GraphRecovery] checkpoint.nodeId ${nodeId} not in plan ${plan.id} tasks`,
        )
        return false
    }

    // 已完成节点校验（不存在的视为脏数据，但允许恢复——恢复时跳过不存在的）
    // 严格模式下应全部存在，这里宽松处理：只要入口节点存在即可恢复
    const missingCompleted = completedNodes.filter(id => !taskIds.has(id))
    if (missingCompleted.length > 0) {
        logger.agent.warn(
            `[GraphRecovery] ${missingCompleted.length} completedNodes not in plan ${plan.id} tasks (will be ignored)`,
        )
    }

    return true
}

/**
 * 应用启动时从磁盘恢复图执行状态
 *
 * 调用时机：WorkspaceStatusBar.tsx 中 loadPlansFromDisk 完成后调用。
 *
 * @param workspacePath 工作区路径
 * @returns 恢复统计（成功/失败/跳过数量）
 */
export async function recoverGraphRuntimeFromDisk(
    workspacePath: string,
): Promise<{ recovered: number; skipped: number; failed: number }> {
    // 防并发：同一 workspace 不重复恢复
    if (recoveryInProgress.has(workspacePath)) {
        logger.agent.info(
            `[GraphRecovery] Recovery already in progress for workspace ${workspacePath}, skipping`,
        )
        return { recovered: 0, skipped: 0, failed: 0 }
    }

    recoveryInProgress.add(workspacePath)

    let recovered = 0
    let skipped = 0
    let failed = 0

    try {
        const runtimeDir = getRuntimeDir(workspacePath)

        // 1. 清理 .tmp 孤儿文件（崩溃可能残留）
        await cleanupOrphanTmp(workspacePath)

        // 2. 列出所有 runtime 文件
        const files = await listRuntimeFiles(workspacePath)
        if (files.length === 0) {
            logger.agent.debug(`[GraphRecovery] No runtime files in ${runtimeDir}`)
            return { recovered: 0, skipped: 0, failed: 0 }
        }

        logger.agent.info(`[GraphRecovery] Found ${files.length} runtime file(s) to recover`)

        const store = useAgentStore.getState()

        // 3. 逐个处理 runtime 文件
        for (const fileName of files) {
            const planId = extractPlanIdFromFileName(fileName)

            try {
                const result = await processRuntimeFile(planId, workspacePath, store.getPlan.bind(store))
                if (result === 'recovered') recovered++
                else if (result === 'skipped') skipped++
                else failed++
            } catch (err) {
                logger.agent.warn(
                    `[GraphRecovery] Unexpected error processing ${fileName}:`,
                    err,
                )
                failed++
            }
        }

        logger.agent.info(
            `[GraphRecovery] Recovery complete: ${recovered} recovered, ${skipped} skipped, ${failed} failed`,
        )

        return { recovered, skipped, failed }
    } finally {
        recoveryInProgress.delete(workspacePath)
    }
}

/**
 * 处理单个 runtime 文件
 *
 * @returns 'recovered' | 'skipped' | 'failed'
 */
async function processRuntimeFile(
    planId: string,
    workspacePath: string,
    getPlan: (planId: string) => TaskPlan | null,
): Promise<'recovered' | 'skipped' | 'failed'> {
    // 加载并校验 runtime 状态
    const state = await loadRuntimeState(workspacePath, planId)
    if (!state) {
        // 加载/校验失败，loadRuntimeState 内部已处理，文件可能已损坏或已删除
        return 'failed'
    }

    // plan 不存在 → 删除 runtime 文件（plan 已被删除）
    const plan = getPlan(planId)
    if (!plan) {
        logger.agent.info(
            `[GraphRecovery] Plan ${planId} not found, deleting orphan runtime file`,
        )
        await deleteRuntimeState(workspacePath, planId)
        return 'skipped'
    }

    // graphVersion≠2 → 非动态图，删除 runtime 文件（不应有 runtime 文件）
    if (!isDynamicGraphPlan(plan)) {
        logger.agent.info(
            `[GraphRecovery] Plan ${planId} is not dynamic graph (graphVersion≠2), deleting runtime file`,
        )
        await deleteRuntimeState(workspacePath, planId)
        return 'skipped'
    }

    // plan 终态 → 删除 runtime 文件（已完成/失败，无需恢复）
    if (isPlanTerminal(plan)) {
        logger.agent.info(
            `[GraphRecovery] Plan ${planId} is in terminal status '${plan.status}', deleting runtime file`,
        )
        await deleteRuntimeState(workspacePath, planId)
        return 'skipped'
    }

    // planRevision 不匹配 → plan 被外部修改，删除 runtime 文件不恢复
    if (state.planRevision !== (plan.revision || 1)) {
        logger.agent.warn(
            `[GraphRecovery] Plan ${planId} revision mismatch (runtime=${state.planRevision}, current=${plan.revision || 1}), plan was externally modified, deleting runtime file`,
        )
        await deleteRuntimeState(workspacePath, planId)
        return 'skipped'
    }

    // checkpoint 节点校验
    if (!validateCheckpointNodes(state, plan)) {
        logger.agent.warn(
            `[GraphRecovery] Plan ${planId} checkpoint nodes invalid, deleting runtime file`,
        )
        await deleteRuntimeState(workspacePath, planId)
        return 'failed'
    }

    // 调 taskExecutor.recoverSession 恢复内存状态
    const result = await recoverSession(plan, state, workspacePath)
    if (result.success) {
        return 'recovered'
    }

    // 恢复失败（session 已存在等），不删 runtime 文件（保留供下次尝试）
    logger.agent.info(
        `[GraphRecovery] recoverSession returned non-success for plan ${planId}: ${result.message}`,
    )
    return 'skipped'
}

/**
 * 模块级防并发：正在恢复的 workspace 集合
 */
const recoveryInProgress = new Set<string>()

// ============================================
// 测试专用导出
// ============================================

/**
 * 测试专用：重置防并发状态（单测 beforeEach 用）
 */
export function __resetRecoveryState(): void {
    recoveryInProgress.clear()
}

/**
 * 测试专用：暴露内部校验函数
 */
export const __testHelpers = {
    isPlanTerminal,
    validateCheckpointNodes,
    processRuntimeFile,
}
