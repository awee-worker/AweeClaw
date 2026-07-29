/**
 * GraphExecutionBridge —— 图执行会话桥接器
 *
 * 职责：为 LLM 动态建图工具（add_node / add_edge）提供访问当前执行图的入口。
 *
 * 设计背景：
 * - 工具执行器（toolExecutors）通过 ToolExecutionContext 调用，无法直接拿到当前 planId / GraphScheduler
 * - taskExecutor.ts 持有 ExecutionSession（含 scheduler），但为模块私有
 * - 本桥接器作为薄注册表，解耦工具层与执行引擎层，避免循环依赖
 *
 * 图引用策略（关键）：
 * - 不缓存 graph 引用，避免 store 更新后桥接器持有过期快照导致动态建图丢失已完成节点
 * - 仅缓存 planId + scheduler + workspacePath；图通过 useAgentStore.getState().getPlan() 实时获取
 * - 工具层调用 getActiveGraph() 拿到的永远是 store 中的最新图
 *
 * 生命周期：
 * - taskExecutor.startPlanExecution（graphVersion=2 时）→ register()
 * - executeTask 执行每个节点前 → setCurrent(planId) 标记当前活跃图
 * - clearSession → unregister() 释放
 *
 * @module GraphRuntime
 */

import { logger } from '@toolkit/LogEngine'
import { useAgentStore } from '../state/IntelligenceStore'
import type { GraphScheduler } from './GraphScheduler'
import type { ExecutionGraph } from './graphTypes'

/** 活跃图会话句柄（不含 graph 引用，避免过期快照） */
export interface GraphSessionHandle {
  /** 所属 plan / graph id */
  planId: string
  /** 图调度器（组合了 ExecutionScheduler） */
  scheduler: GraphScheduler
  /** 工作区路径 */
  workspacePath: string
  /**
   * 实时获取当前执行图（从 store 读取，保证最新）
   * @returns 当前图；若 plan 已从 store 移除则返回 null
   */
  getGraph(): ExecutionGraph | null
}

/**
 * 图执行桥接器 —— 单例
 *
 * 使用方式：
 * ```ts
 * // taskExecutor 启动图执行时注册
 * graphExecutionBridge.register({ planId, scheduler, workspacePath })
 *
 * // add_node 工具执行时查询
 * const handle = graphExecutionBridge.getCurrent()
 * const graph = handle?.getGraph()
 * if (!graph) return { success: false, error: 'No active graph' }
 * handle.scheduler.addNode(graph, newNode)
 * ```
 */
class GraphExecutionBridge {
  /** planId → 图会话句柄 */
  private readonly sessions = new Map<string, GraphSessionHandle>()

  /** 当前活跃图 planId（最近开始执行的节点所属图） */
  private currentPlanId: string | null = null

  /**
   * 注册图执行会话
   * 在 taskExecutor 创建 GraphScheduler 后调用
   */
  register(input: {
    planId: string
    scheduler: GraphScheduler
    workspacePath: string
  }): void {
    const handle: GraphSessionHandle = {
      planId: input.planId,
      scheduler: input.scheduler,
      workspacePath: input.workspacePath,
      getGraph: () => {
        const plan = useAgentStore.getState().getPlan(input.planId)
        return plan ? (plan as ExecutionGraph) : null
      },
    }
    this.sessions.set(input.planId, handle)
    this.currentPlanId = input.planId
    logger.agent.debug(
      `[GraphExecutionBridge] Registered graph session: ${input.planId} (total: ${this.sessions.size})`,
    )
  }

  /**
   * 注销图执行会话
   * 在 taskExecutor.clearSession 时调用
   */
  unregister(planId: string): void {
    const removed = this.sessions.delete(planId)
    if (this.currentPlanId === planId) {
      // 当前活跃图被注销，回退到任意剩余会话（若有）
      this.currentPlanId = this.sessions.size > 0
        ? this.sessions.keys().next().value ?? null
        : null
    }
    if (removed) {
      logger.agent.debug(
        `[GraphExecutionBridge] Unregistered graph session: ${planId} (remaining: ${this.sessions.size})`,
      )
    }
  }

  /**
   * 设置当前活跃图（节点执行前调用）
   * 确保工具执行时能定位到正确的图（多 plan 并行场景）
   */
  setCurrent(planId: string | null): void {
    if (planId === null) {
      this.currentPlanId = null
      return
    }
    if (this.sessions.has(planId)) {
      this.currentPlanId = planId
    } else {
      logger.agent.warn(
        `[GraphExecutionBridge] Cannot set current to unregistered plan: ${planId}`,
      )
    }
  }

  /**
   * 获取当前活跃图会话（供工具层使用）
   * 无活跃图时返回 null（工具据此返回友好错误）
   */
  getCurrent(): GraphSessionHandle | null {
    if (this.currentPlanId === null) return null
    return this.sessions.get(this.currentPlanId) ?? null
  }

  /**
   * 按 planId 获取图会话
   */
  getByPlanId(planId: string): GraphSessionHandle | null {
    return this.sessions.get(planId) ?? null
  }

  /**
   * 清空所有会话（应用退出 / 重置时调用）
   */
  clearAll(): void {
    const count = this.sessions.size
    this.sessions.clear()
    this.currentPlanId = null
    if (count > 0) {
      logger.agent.debug(`[GraphExecutionBridge] Cleared ${count} graph sessions`)
    }
  }

  /** 当前活跃会话数（诊断用） */
  get size(): number {
    return this.sessions.size
  }
}

/** 图执行桥接器单例 */
export const graphExecutionBridge = new GraphExecutionBridge()
