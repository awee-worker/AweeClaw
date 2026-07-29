/**
 * Graph Runtime 守卫逻辑（纯函数）
 *
 * 设计：从 taskExecutor.ts 提取的纯函数，便于：
 * 1. 单元测试不引入 taskExecutor 的重依赖（offlineModeService/preferencesService 等）
 * 2. 复用到其他需要判断图分支的模块
 *
 * @module GraphRuntime
 */

import type { TaskPlan, PlanTask } from '../planner/planTypes'
import { isGraphNode, type GraphNode, type ExecutionGraph } from './graphTypes'

/**
 * 判断 plan 是否启用了动态图能力（graphVersion=2）
 *
 * graphVersion=2 或 allowDynamicExpansion=true 时为动态图
 * graphVersion=1 或未设置时为静态 DAG（现有行为）
 */
export function isDynamicGraphPlan(plan: TaskPlan): plan is ExecutionGraph {
    return plan.graphVersion === 2 || (plan as ExecutionGraph).allowDynamicExpansion === true
}

/**
 * 判断任务是否应分发到 NodeExecutor（而非 runTaskWithAgent）
 *
 * 三重守卫（graphVersion=1 时永远返回 false，保证现有行为零变化）：
 * 1. plan 是动态图（graphVersion=2 或 allowDynamicExpansion=true）
 * 2. 任务是 GraphNode（携带 nodeType 或 edges 字段）
 * 3. nodeType 存在且不为 'task'（task 走原路径，需 session/threadId/requestId）
 *
 * @param plan 当前 plan
 * @param task 当前任务
 * @returns true=走 NodeExecutor / false=走原 runTaskWithAgent
 */
export function shouldDispatchToNodeExecutor(plan: TaskPlan, task: PlanTask): task is GraphNode {
    if (!isDynamicGraphPlan(plan)) return false
    if (!isGraphNode(task)) return false
    const nodeType = task.nodeType
    return nodeType !== undefined && nodeType !== 'task'
}
