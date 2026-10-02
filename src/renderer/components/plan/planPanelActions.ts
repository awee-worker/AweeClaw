/**
 * 计划任务面板的共用动作
 *
 * 状态栏的 chip 与任务面板头部的删除按钮共用同一套语义：运行中拦截 → 二次确认 → 删除。
 * 三者缺一都会留下「看不见还在跑」的孤儿执行，或让用户误删正在跑的计划，
 * 因此收敛到一个函数里，避免两处各写一遍再走样。
 */

import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { stopPlanExecution } from '@intelligence/planner/taskExecutor'
import { toast } from '@components/foundation/NotificationProvider'
import type { PlanStatus } from '@intelligence/planner/providerTypes'

/** 正在执行的状态：此时不允许删除，避免打断正在运行的任务线程 */
const RUNNING_STATUSES: PlanStatus[] = ['executing', 'pausing', 'stopping']

/** 需要先停执行再删除的状态：paused 可恢复，同样先停再删 */
const LIVE_STATUSES: PlanStatus[] = ['executing', 'pausing', 'stopping', 'paused']

/** 计划是否正在执行（据此外置删除按钮的可用状态） */
export function isPlanRunning(status: PlanStatus): boolean {
    return RUNNING_STATUSES.includes(status)
}

/**
 * 彻底删除一个计划任务
 *
 * @param planId 计划 id
 */
export function deletePlanCompletely(planId: string): void {
    const agent = useAgentStore.getState()
    const plan = agent.getPlan(planId)
    if (!plan) return

    if (LIVE_STATUSES.includes(plan.status)) {
        stopPlanExecution(planId)
    }

    agent.deletePlan(planId)

    // 被删的计划若正开在右侧面板里，同步收起，避免面板僵在空状态
    const layout = useStore.getState()
    if (layout.planPanelPlanId === planId) {
        layout.closePlanPanel()
    }
}

/** 确认弹窗的选项（与 foundation/ConfirmationModal 的 ConfirmOptions 结构一致） */
export interface PlanConfirmOptions {
    title?: string
    message: string
    confirmText?: string
    cancelText?: string
    variant?: 'danger' | 'warning' | 'info'
}

/**
 * 删除计划的统一入口：运行中拦截 → 二次确认 → 删除
 *
 * @param planId 计划 id
 * @param confirm 确认弹窗函数（由调用组件通过 useConfirmDialog 提供）
 * @param isZh 是否中文界面
 */
export async function confirmAndDeletePlan(
    planId: string,
    confirm: (options: PlanConfirmOptions) => Promise<boolean>,
    isZh: boolean,
): Promise<void> {
    const plan = useAgentStore.getState().getPlan(planId)
    if (!plan) return

    // 执行中的任务不提供删除：中途删除会让正在跑的子任务线程失去归属
    if (isPlanRunning(plan.status)) {
        toast.error(
            isZh ? '当前任务正在执行中，不能删除' : 'Task is running and cannot be deleted',
            isZh ? '请先暂停并停止该任务，再删除。' : 'Pause and stop it first, then delete.',
        )
        return
    }

    const ok = await confirm({
        title: isZh ? '删除任务' : 'Delete task',
        message: isZh
            ? `确定删除「${plan.name}」吗？删除后该任务将从列表移除，且无法恢复。`
            : `Delete "${plan.name}"? It will be removed from the list and cannot be recovered.`,
        confirmText: isZh ? '删除' : 'Delete',
        variant: 'danger',
    })
    if (!ok) return

    deletePlanCompletely(planId)
}
