/**
 * LoopController —— 循环回流 / 反思重试
 *
 * 职责：节点失败后判断是否回流重试，而非直接传播失败。
 * 这是 Graph Runtime 升级中价值最大的能力——把现有"失败即中止"升级为"失败即反思重试"。
 *
 * 触发条件（全部满足才回流）：
 * 1. 节点状态为 failed
 * 2. 节点存在 loop 类型出边
 * 3. 当前迭代次数 < maxIterations（硬上限，防无限循环）
 *
 * 回流动作：
 * - 记录迭代次数到 GraphState.metadata
 * - 注入反思上下文（上次失败原因 + 调整提示）到 GraphState.metadata
 * - 返回回流目标节点（loop 边的 target，通常指向自身或上游修复节点）
 * - 调用方负责将目标节点状态重置为 pending 以重新入队
 *
 * @module GraphRuntime
 */

import { logger } from '@toolkit/LogEngine'
import type { GraphNode, GraphEdge, ExecutionGraph, GraphStateAccessor } from './graphTypes'

/** 循环反思上下文的 metadata key 前缀 */
const LOOP_META_PREFIX = 'loop'

/** 构造某个节点的循环元数据 key */
function metaKey(nodeId: string, field: string): string {
  return `${LOOP_META_PREFIX}:${nodeId}:${field}`
}

export class LoopController {
  /**
   * 节点完成后判断是否回流
   *
   * @param graph 执行图
   * @param node 刚完成的节点（通常 status=failed）
   * @param state 状态访问器（用于读写反思上下文）
   * @returns 回流目标节点列表；空数组表示不回流（让失败传播）
   */
  tryLoopBack(
    graph: ExecutionGraph,
    node: GraphNode,
    state: GraphStateAccessor,
  ): GraphNode[] {
    // 仅失败节点考虑回流（成功节点无需重试）
    if (node.status !== 'failed') return []

    const loopEdges = this.collectLoopEdges(node)
    if (loopEdges.length === 0) return []

    // 迭代计数：完全基于 GraphState（跨节点持久，无本地缓存避免跨实例污染）
    const persistedCount = state.getMetadata(metaKey(node.id, 'iteration'))
    const count = (typeof persistedCount === 'number' ? persistedCount : 0) + 1

    const maxIter = this.resolveMaxIterations(node, loopEdges)

    // 超限保护：硬上限，防止无限循环
    if (count > maxIter) {
      logger.agent.warn(
        `[LoopController] Node ${node.id} reached max iterations ${maxIter}, propagating failure`,
      )
      return []
    }

    // 写入迭代次数到 GraphState
    state.setMetadata(metaKey(node.id, 'iteration'), count)

    // 注入反思上下文：供下次执行时读取并调整策略
    const lastError = node.error || 'unknown error'
    const reflection = this.buildReflection(count, lastError, node)
    state.setMetadata(metaKey(node.id, 'lastError'), lastError)
    state.setMetadata(metaKey(node.id, 'reflection'), reflection)

    logger.agent.info(
      `[LoopController] Looping back node ${node.id} (iteration ${count}/${maxIter}): ${lastError}`,
    )

    // 收集回流目标节点（loop 边的 target）
    const targets: GraphNode[] = []
    for (const edge of loopEdges) {
      const target = this.findNode(graph, edge.target)
      if (target) {
        targets.push(target)
      } else {
        logger.agent.warn(
          `[LoopController] Loop edge target not found: ${edge.target} (source: ${node.id})`,
        )
      }
    }

    return targets
  }

  /**
   * 重置节点的循环计数（用于计划重新执行时清空历史）
   */
  resetNode(nodeId: string, state: GraphStateAccessor): void {
    state.setMetadata(metaKey(nodeId, 'iteration'), 0)
    state.setMetadata(metaKey(nodeId, 'lastError'), undefined)
    state.setMetadata(metaKey(nodeId, 'reflection'), undefined)
  }

  /**
   * 重置整个图的循环计数（计划重新执行时调用）
   */
  resetAll(graph: ExecutionGraph, state: GraphStateAccessor): void {
    for (const node of graph.tasks) {
      const gn = node as GraphNode
      if (gn.edges?.some(e => e.type === 'loop')) {
        this.resetNode(node.id, state)
      }
    }
  }

  /**
   * 获取节点当前迭代次数（供 NodeExecutor 注入 prompt）
   */
  getIteration(nodeId: string, state: GraphStateAccessor): number {
    const persisted = state.getMetadata(metaKey(nodeId, 'iteration'))
    return typeof persisted === 'number' ? persisted : 0
  }

  /**
   * 获取节点上次的反思上下文（供 NodeExecutor 注入 prompt）
   */
  getReflection(nodeId: string, state: GraphStateAccessor): string | undefined {
    return state.getMetadata(metaKey(nodeId, 'reflection')) as string | undefined
  }

  // ===== 内部方法 =====

  /** 收集节点的 loop 类型出边 */
  private collectLoopEdges(node: GraphNode): GraphEdge[] {
    return (node.edges || []).filter(e => e.type === 'loop')
  }

  /**
   * 解析节点最大迭代次数
   * 优先级：loop 边的 maxIterations > 节点 maxIterations > 默认值（2，对齐 PlanConfig.maxRetries）
   */
  private resolveMaxIterations(node: GraphNode, loopEdges: GraphEdge[]): number {
    const edgeMaxValues = loopEdges
      .map(e => e.maxIterations)
      .filter((v): v is number => typeof v === 'number' && v > 0)

    if (edgeMaxValues.length > 0) {
      return Math.max(...edgeMaxValues)
    }

    if (typeof node.maxIterations === 'number' && node.maxIterations > 0) {
      return node.maxIterations
    }

    return 2 // 默认 2，对齐 PlanConfig.maxRetries
  }

  /**
   * 构造反思上下文 —— 注入到下次执行的 prompt，引导 LLM 调整策略
   */
  private buildReflection(iteration: number, lastError: string, node: GraphNode): string {
    return [
      `⚠️ 反思重试（第 ${iteration} 次重试）`,
      ``,
      `上次执行失败，原因：${lastError}`,
      ``,
      `请调整策略避免重复错误：`,
      `- 分析失败根因，不要使用与上次完全相同的方式`,
      `- 如果是参数/路径错误，请校验后重试`,
      `- 如果是外部依赖问题，请尝试替代方案`,
      `- 保持任务目标不变：${node.title}`,
    ].join('\n')
  }

  /** 在图中查找节点 */
  private findNode(graph: ExecutionGraph, nodeId: string): GraphNode | undefined {
    return graph.tasks.find(t => t.id === nodeId) as GraphNode | undefined
  }
}

/**
 * 默认单例（一次执行会话复用，确保迭代计数跨节点一致）
 * 注意：每次 runExecutionLoop 应调用 resetAll 清空历史计数
 */
export const loopController = new LoopController()
