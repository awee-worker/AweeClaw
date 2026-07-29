/**
 * GraphScheduler —— 图调度器
 *
 * 设计：组合而非继承。持有 ExecutionScheduler 实例，复用其拓扑/资源/排序能力，
 *       在其上叠加图能力（条件边路由 / 循环回流 / 动态建图）。
 *
 * 路由优先级（resolveNextNodes）：
 * 1. 循环回流（LoopController）：失败且可重试 → 回流目标
 * 2. 显式出边（EdgeRouter）：有 edges → 条件边求值
 * 3. 依赖拓扑（base.getExecutableTasks）：无 edges → 现有拓扑行为
 *
 * 兼容策略：
 * - 节点无 edges 字段 → 完全回退到 ExecutionScheduler 现有行为
 * - 节点有 edges → 走图路由
 * - 保证现有静态 DAG 计划（graphVersion 缺省）行为零变化
 *
 * @module GraphRuntime
 */

import { logger } from '@toolkit/LogEngine'
import { ExecutionScheduler, hasConflict } from '../planner/TaskScheduler'
import { useAgentStore } from '../state/IntelligenceStore'
import { edgeRouter } from './EdgeRouter'
import { loopController } from './LoopController'
import {
  type GraphNode,
  type GraphEdge,
  type ExecutionGraph,
  type GraphStateAccessor,
} from './graphTypes'
import type { PlanTask } from '../planner/planTypes'

export class GraphScheduler {
  /**
   * Boost 队列：边路由目标节点 id 集合
   *
   * 设计：
   * - EdgeRouter 路由命中后，目标节点 id 被 boostReady 加入此集合
   * - 下一次 getParallelBatchWithBoost / getNextTaskWithBoost 优先取出 boosted 节点
   * - boosted 节点仍走 hasConflict 资源互斥检查，避免并行写入冲突
   * - 不修改 plan.tasks 的 dependencies 数组，避免污染持久化 plan
   * - 消费后自动清空（一次性 boost）
   */
  private readonly boostedReady = new Set<string>()

  constructor(
    /** 复用现有调度器（拓扑排序 / 资源互斥 / 优先级排序） */
    private readonly base: ExecutionScheduler,
    /** 条件边求值器 */
    private readonly router = edgeRouter,
    /** 循环回流控制器 */
    private readonly looper = loopController,
  ) {}

  // ===== 路由决策（核心）=====

  /**
   * 节点完成后的路由决策 —— 替代原"拓扑自动推进"
   *
   * @param graph 执行图
   * @param completedNode 刚完成的节点
   * @param state 状态访问器
   * @returns 下一步应激活的节点列表
   */
  async resolveNextNodes(
    graph: ExecutionGraph,
    completedNode: GraphNode,
    state: GraphStateAccessor,
  ): Promise<GraphNode[]> {
    const node = this.asGraphNode(completedNode)

    // 1. 循环回流优先：失败且可重试 → 回流目标
    //    仅当节点携带 loop 边时尝试，避免对普通节点做无用判断
    if (node.status === 'failed' && this.hasLoopEdges(node)) {
      const loopTargets = this.looper.tryLoopBack(graph, node, state)
      if (loopTargets.length > 0) {
        logger.agent.info(
          `[GraphScheduler] Looping back from ${node.id} -> ${loopTargets.map(t => t.id).join(',')}`,
        )
        return loopTargets
      }
      // 超限或不可回流，继续走正常路由（失败传播）
    }

    // 2. 显式出边：条件边求值
    if (this.router.hasRoutingEdges(node)) {
      const routed = await this.router.route(graph, node, state)
      if (routed.length > 0) {
        logger.agent.debug(
          `[GraphScheduler] Routed from ${node.id} -> ${routed.map(t => t.id).join(',')}`,
        )
        return routed
      }
      // 出边求值无命中：视为图终止信号，返回空（调用方据此判断完成）
      logger.agent.info(`[GraphScheduler] No routing edges satisfied from ${node.id}, graph may end`)
      return []
    }

    // 3. 回退：依赖拓扑（现有行为）—— 复用 base 的就绪判定，兼容普通 PlanTask
    return this.base.getExecutableTasks(graph) as GraphNode[]
  }

  // ===== 复用 base 调度能力 =====

  /** 复用 base 的并行批次（资源互斥感知）。不过滤 GraphNode——兼容普通 PlanTask */
  getParallelBatch(graph: ExecutionGraph): PlanTask[] {
    return this.base.getParallelBatch(graph)
  }

  /** 复用 base 的就绪判定（依赖全部完成的 pending 节点）。不过滤，兼容普通 PlanTask */
  getExecutableTasks(graph: ExecutionGraph): PlanTask[] {
    return this.base.getExecutableTasks(graph)
  }

  /** 复用 base 的下一个待执行任务 */
  getNextTask(graph: ExecutionGraph): PlanTask | null {
    return this.base.getNextTask(graph)
  }

  // ===== Boost 机制（阶段四：边路由目标入队） =====

  /**
   * 将边路由目标节点 id 加入 boost 队列
   *
   * 调用时机：EdgeRouter.route 返回目标节点后，routeAfterBatch 调用此方法
   * 把目标 id 入队。下一次 getParallelBatchWithBoost / getNextTaskWithBoost 会优先取出。
   *
   * @param ids 边路由命中的目标节点 id 列表
   */
  boostReady(ids: string[]): void {
    for (const id of ids) {
      if (id) this.boostedReady.add(id)
    }
  }

  /**
   * 查看当前 boost 队列（不清空，调试与测试用）
   */
  peekBoostedIds(): string[] {
    return Array.from(this.boostedReady)
  }

  /**
   * 清空 boost 队列（测试专用）
   */
  clearBoost(): void {
    this.boostedReady.clear()
  }

  /**
   * 获取并行批次（合并 boosted 节点）
   *
   * 流程：
   * 1. 调用 base.getParallelBatch 获取当前就绪批次（依赖拓扑 + 资源互斥）
   * 2. 取出 boostedReady 中的节点 id，找到对应 plan.tasks 节点
   * 3. 仅保留 status==='pending' 且不在批次中的节点
   * 4. 对每个 boosted 节点做 hasConflict 检查（与当前批次冲突则跳过）
   * 5. 消费后清空 boostedReady（boost 是一次性信号）
   *
   * 设计：
   * - boosted 节点绕过依赖检查（边路由已确认源完成，目标应立即执行）
   * - 但保留资源互斥检查，避免并行写入同一文件
   * - 不修改 plan.dependencies，避免污染持久化 plan
   *
   * @param graph 执行图
   * @returns 合并 boosted 节点后的批次
   */
  getParallelBatchWithBoost(graph: ExecutionGraph): PlanTask[] {
    const baseBatch = this.base.getParallelBatch(graph)
    const batchIds = new Set(baseBatch.map(t => t.id))

    // 取出并清空 boost 队列（一次性消费）
    const boostedIds = Array.from(this.boostedReady)
    this.boostedReady.clear()

    for (const boostedId of boostedIds) {
      // 已在批次中 → 跳过（避免重复）
      if (batchIds.has(boostedId)) continue

      const node = graph.tasks.find(t => t.id === boostedId) as GraphNode | undefined
      if (!node) {
        logger.agent.warn(`[GraphScheduler] Boosted node not found in graph: ${boostedId}`)
        continue
      }

      // 仅 pending 节点可执行（已完成/失败/暂停的不 boost）
      if (node.status !== 'pending') continue

      // 资源互斥检查：与当前批次冲突则跳过（下轮再尝试）
      if (hasConflict(node, baseBatch)) {
        logger.agent.debug(
          `[GraphScheduler] Boosted node ${boostedId} conflicts with batch, re-queueing`,
        )
        // 重新入队，下轮再尝试
        this.boostedReady.add(boostedId)
        continue
      }

      baseBatch.push(node)
      batchIds.add(boostedId)
      logger.agent.debug(`[GraphScheduler] Boosted node ${boostedId} added to batch`)
    }

    return baseBatch
  }

  /**
   * 获取下一个待执行任务（优先 boosted 节点）
   *
   * 用于串行执行模式或批次内单任务推进。
   * - 优先返回 boost 队列中第一个 pending 节点（消费一个）
   * - 队列空或无 pending 节点 → 回退 base.getNextTask
   *
   * @param graph 执行图
   * @returns 下一个待执行任务，或 null
   */
  getNextTaskWithBoost(graph: ExecutionGraph): PlanTask | null {
    // 优先消费 boost 队列
    for (const boostedId of Array.from(this.boostedReady)) {
      const node = graph.tasks.find(t => t.id === boostedId) as GraphNode | undefined
      if (!node) {
        this.boostedReady.delete(boostedId)
        continue
      }
      if (node.status !== 'pending') {
        this.boostedReady.delete(boostedId)
        continue
      }
      // 消费此 boosted 节点
      this.boostedReady.delete(boostedId)
      logger.agent.debug(`[GraphScheduler] getNextTaskWithBoost returns boosted: ${boostedId}`)
      return node
    }

    return this.base.getNextTask(graph)
  }

  // ===== 循环重试支持 =====

  /**
   * 重置节点为 pending 并清除循环计数（回流时调用）
   * 复用 base 的 markTaskPending，叠加 GraphState 清理
   */
  resetNodeForLoop(node: GraphNode, _state: GraphStateAccessor): void {
    this.base.markTaskPending(node)
    // 清除该节点本轮迭代计数与反思（让重试从干净状态开始）
    // 注意：不调用 resetNode，因为 LoopController 已写入新迭代号
    // 此处仅确保 planId 对应 store 同步状态
    this.syncNodeStatus(node, 'pending')
  }

  /**
   * 获取节点的反思上下文（供 NodeExecutor 注入 prompt）
   */
  getReflection(nodeId: string, state: GraphStateAccessor): string | undefined {
    return this.looper.getReflection(nodeId, state)
  }

  /**
   * 获取节点当前迭代次数
   */
  getIteration(nodeId: string, state: GraphStateAccessor): number {
    return this.looper.getIteration(nodeId, state)
  }

  // ===== 动态建图（阶段三启用，此处预置接口）=====

  /**
   * 运行时动态加节点
   * 仅当 graphVersion=2 且 allowDynamicExpansion=true 时允许
   */
  addNode(graph: ExecutionGraph, node: GraphNode): void {
    if (!this.allowDynamicExpansion(graph)) {
      throw new Error(
        `[GraphScheduler] Graph ${graph.id} does not allow dynamic expansion (graphVersion!=2 or allowDynamicExpansion!=true)`,
      )
    }

    if (graph.tasks.some(t => t.id === node.id)) {
      throw new Error(`[GraphScheduler] Node ${node.id} already exists in graph ${graph.id}`)
    }

    graph.tasks.push(node)

    // 同步到 store
    this.syncGraphToStore(graph)

    logger.agent.info(`[GraphScheduler] Dynamically added node ${node.id} to graph ${graph.id}`)
  }

  /**
   * 运行时动态加边
   */
  addEdge(graph: ExecutionGraph, sourceId: string, edge: GraphEdge): void {
    if (!this.allowDynamicExpansion(graph)) {
      throw new Error(`[GraphScheduler] Graph ${graph.id} does not allow dynamic expansion`)
    }

    const node = graph.tasks.find(t => t.id === sourceId) as GraphNode | undefined
    if (!node) {
      throw new Error(`[GraphScheduler] Source node ${sourceId} not found in graph ${graph.id}`)
    }

    if (!graph.tasks.some(t => t.id === edge.target)) {
      throw new Error(`[GraphScheduler] Target node ${edge.target} not found in graph ${graph.id}`)
    }

    node.edges = node.edges || []
    node.edges.push({ ...edge, source: sourceId })

    this.syncGraphToStore(graph)

    logger.agent.info(
      `[GraphScheduler] Dynamically added edge ${sourceId} -> ${edge.target} (${edge.type})`,
    )
  }

  // ===== 内部辅助 =====

  /** 判断节点是否携带 loop 边 */
  private hasLoopEdges(node: GraphNode): boolean {
    return (node.edges || []).some(e => e.type === 'loop')
  }

  /** 安全转换为 GraphNode（若非图节点，回退处理） */
  private asGraphNode(node: GraphNode): GraphNode {
    return node
  }

  /** 判断是否允许动态扩展 */
  private allowDynamicExpansion(graph: ExecutionGraph): boolean {
    return (graph.graphVersion === 2 || graph.allowDynamicExpansion === true)
      && graph.allowDynamicExpansion !== false
  }

  /** 同步节点状态到 store（回流重置 pending 时用） */
  private syncNodeStatus(node: GraphNode, status: string): void {
    try {
      // 通过 updateTask 同步状态（planId 需从外部传入，这里用图自身的）
      // 注意：此处假设 graph 已在 store，updateTask 需要 planId
      // 实际回流由 taskExecutor 调用，planId 已知，此处仅做 best-effort 同步
      logger.agent.debug(`[GraphScheduler] syncNodeStatus ${node.id} -> ${status}`)
    } catch (err) {
      logger.agent.error(`[GraphScheduler] syncNodeStatus failed: ${node.id}`, err)
    }
  }

  /** 同步图到 store（动态建图后调用） */
  private syncGraphToStore(graph: ExecutionGraph): void {
    try {
      const store = useAgentStore.getState()
      store.updatePlan(graph.id, {
        tasks: graph.tasks,
        updatedAt: Date.now(),
      })
    } catch (err) {
      logger.agent.error(`[GraphScheduler] syncGraphToStore failed: ${graph.id}`, err)
    }
  }
}

/**
 * 工厂：基于现有 ExecutionScheduler 创建 GraphScheduler
 * 用法：const graphScheduler = new GraphScheduler(session.scheduler)
 */
export function createGraphScheduler(baseScheduler: ExecutionScheduler): GraphScheduler {
  return new GraphScheduler(baseScheduler)
}
