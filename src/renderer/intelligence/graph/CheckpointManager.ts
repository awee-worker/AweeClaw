/**
 * CheckpointManager —— 节点级检查点 / 恢复
 *
 * 职责：在节点入口打 checkpoint，支持从指定 checkpoint 恢复执行。
 *       解决现有 sessionCheckpoint 仅消息级、长任务中断后无法从节点恢复的痛点。
 *
 * 设计要点：
 * - 复用 StoreGraphStateAdapter 的 exportSnapshot/importSnapshot（状态快照）
 * - 复用 taskSlice 的 getPlan/markTaskPending（节点状态重置）
 * - checkpoint 存储在内存 Map（图执行会话生命周期），可按需扩展持久化
 * - 恢复时：重置 running 节点为 pending，注入 GraphState 快照，返回恢复点
 *
 * @module GraphRuntime
 */

import { logger } from '@toolkit/LogEngine'
import { useAgentStore } from '../state/IntelligenceStore'
import type { StoreGraphStateAdapter } from './GraphStateAdapter'
import type { GraphNode, ExecutionGraph, GraphState } from './graphTypes'
import type { PlanTask } from '../planner/planTypes'

/**
 * 节点检查点
 */
export interface NodeCheckpoint {
  /** 检查点 id */
  checkpointId: string
  /** 所属图 id */
  graphId: string
  /** 节点 id（入口节点） */
  nodeId: string
  /** 节点入口时的 GraphState 快照 */
  stateSnapshot: ReturnType<StoreGraphStateAdapter['exportSnapshot']>
  /** 时间戳 */
  timestamp: number
  /** 已完成节点 id 列表（恢复时跳过） */
  completedNodes: string[]
  /** 关联的 traceId */
  traceId?: string
}

/**
 * 恢复结果
 */
export interface RestoreResult {
  /** 恢复后的图（running 节点已重置为 pending） */
  restoredGraph: ExecutionGraph
  /** 恢复起点节点 id */
  resumeFrom: string
  /** 注入的 GraphState 快照 */
  restoredState: GraphState
}

export class CheckpointManager {
  /** 检查点存储：checkpointId → checkpoint（内存，图执行会话生命周期） */
  private checkpoints = new Map<string, NodeCheckpoint>()

  /** 图 → 最新检查点 id（便于快速恢复到最近状态） */
  private latestByGraph = new Map<string, string>()

  /** 检查点 id 计数器 */
  private counter = 0

  /**
   * 节点入口打 checkpoint
   *
   * @param graph 执行图
   * @param node 即将执行的节点
   * @param stateAdapter 状态适配器（导出快照）
   * @param traceId 追踪 id
   * @returns 检查点 id
   */
  checkpoint(
    graph: ExecutionGraph,
    node: GraphNode,
    stateAdapter: StoreGraphStateAdapter,
    traceId?: string,
  ): string {
    this.counter++
    const checkpointId = `ckpt-${graph.id}-${this.counter}-${Date.now().toString(36)}`

    // 收集已完成节点（恢复时跳过）
    const completedNodes = graph.tasks
      .filter(t => t.status === 'completed')
      .map(t => t.id)

    // 导出当前状态快照
    const stateSnapshot = stateAdapter.exportSnapshot()

    const checkpoint: NodeCheckpoint = {
      checkpointId,
      graphId: graph.id,
      nodeId: node.id,
      stateSnapshot,
      timestamp: Date.now(),
      completedNodes,
      traceId,
    }

    this.checkpoints.set(checkpointId, checkpoint)
    this.latestByGraph.set(graph.id, checkpointId)

    logger.agent.debug(
      `[CheckpointManager] Checkpoint ${checkpointId} created for node ${node.id} (graph ${graph.id}, ${completedNodes.length} completed)`,
    )

    return checkpointId
  }

  /**
   * 从指定 checkpoint 恢复
   *
   * 恢复动作：
   * 1. 重置 running 节点为 pending（复用 taskSlice.updateTask）
   * 2. 跳过已完成节点（completedNodes）
   * 3. 注入 GraphState 快照到 stateAdapter
   * 4. 返回恢复起点
   *
   * @param checkpointId 检查点 id
   * @param stateAdapter 状态适配器（注入快照）
   * @returns 恢复结果；检查点不存在返回 null
   */
  restore(
    checkpointId: string,
    stateAdapter: StoreGraphStateAdapter,
  ): RestoreResult | null {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      logger.agent.warn(`[CheckpointManager] Checkpoint ${checkpointId} not found`)
      return null
    }

    // 从 store 获取当前图
    const store = useAgentStore.getState()
    const plan = store.getPlan(checkpoint.graphId)
    if (!plan) {
      logger.agent.warn(`[CheckpointManager] Graph ${checkpoint.graphId} not found in store`)
      return null
    }

    const graph = plan as ExecutionGraph

    // 重置 running 节点为 pending（保留 completed 节点）
    for (const task of graph.tasks) {
      if (task.status === 'running') {
        store.updateTask(checkpoint.graphId, task.id, {
          status: 'pending',
          error: undefined,
          startedAt: undefined,
        } as Partial<PlanTask>)
      }
    }

    // 注入状态快照
    stateAdapter.importSnapshot(checkpoint.stateSnapshot)

    logger.agent.info(
      `[CheckpointManager] Restored from ${checkpointId}, resuming from node ${checkpoint.nodeId}`,
    )

    return {
      restoredGraph: graph,
      resumeFrom: checkpoint.nodeId,
      restoredState: {
        channels: checkpoint.stateSnapshot.channels,
        messages: [],
        artifacts: checkpoint.stateSnapshot.artifacts,
        nodeOutputs: checkpoint.stateSnapshot.nodeOutputs,
        metadata: checkpoint.stateSnapshot.metadata,
      },
    }
  }

  /**
   * 恢复到图的最新检查点
   */
  restoreLatest(graphId: string, stateAdapter: StoreGraphStateAdapter): RestoreResult | null {
    const latestId = this.latestByGraph.get(graphId)
    if (!latestId) {
      logger.agent.warn(`[CheckpointManager] No checkpoint for graph ${graphId}`)
      return null
    }
    return this.restore(latestId, stateAdapter)
  }

  /**
   * 获取检查点信息（不恢复）
   */
  getCheckpoint(checkpointId: string): NodeCheckpoint | undefined {
    return this.checkpoints.get(checkpointId)
  }

  /**
   * 列出图的所有检查点
   */
  listCheckpoints(graphId: string): NodeCheckpoint[] {
    return Array.from(this.checkpoints.values())
      .filter(c => c.graphId === graphId)
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * 清理图的检查点（图执行完成后调用，释放内存）
   */
  clearGraph(graphId: string): void {
    const toDelete: string[] = []
    for (const [id, checkpoint] of this.checkpoints) {
      if (checkpoint.graphId === graphId) {
        toDelete.push(id)
      }
    }
    for (const id of toDelete) {
      this.checkpoints.delete(id)
    }
    this.latestByGraph.delete(graphId)
    logger.agent.debug(`[CheckpointManager] Cleared ${toDelete.length} checkpoints for graph ${graphId}`)
  }

  /**
   * 清理所有检查点
   */
  clearAll(): void {
    const count = this.checkpoints.size
    this.checkpoints.clear()
    this.latestByGraph.clear()
    this.counter = 0
    logger.agent.debug(`[CheckpointManager] Cleared all ${count} checkpoints`)
  }

  // ============================================
  // 磁盘持久化支持（阶段五）
  // ============================================

  /**
   * 从持久化文件恢复 checkpoint 到内存
   *
   * 与 checkpoint() 的差异：
   * - 不递增 counter（保留持久化的 checkpointId）
   * - 不重新生成 timestamp（保留原始时间戳）
   * - 仅注入内存 Map + 更新 latestByGraph 指针
   *
   * 恢复后不立即调用 restore()（restore 会重置 running 节点 + 注入快照），
   * 由调用方（graphRecovery）按 session.status 决定后续动作。
   *
   * @param ckpt 持久化文件反序列化后的 checkpoint 对象
   * @returns 注入成功返回 true；同 id 已存在则跳过返回 false（幂等防护）
   */
  loadPersistedCheckpoint(ckpt: NodeCheckpoint): boolean {
    // 幂等防护：同 checkpointId 已存在则跳过（避免重复恢复覆盖内存状态）
    if (this.checkpoints.has(ckpt.checkpointId)) {
      logger.agent.debug(
        `[CheckpointManager] loadPersistedCheckpoint skipped (already exists): ${ckpt.checkpointId}`,
      )
      return false
    }

    // 校验 graphId 与 checkpointId 的一致性（轻量校验，防止脏数据）
    if (!ckpt.graphId || !ckpt.checkpointId || !ckpt.nodeId) {
      logger.agent.warn(
        `[CheckpointManager] loadPersistedCheckpoint rejected (invalid checkpoint):`,
        ckpt,
      )
      return false
    }

    // 深拷贝避免外部引用修改影响内存状态
    const injected: NodeCheckpoint = {
      checkpointId: ckpt.checkpointId,
      graphId: ckpt.graphId,
      nodeId: ckpt.nodeId,
      stateSnapshot: {
        channels: { ...ckpt.stateSnapshot.channels },
        metadata: { ...ckpt.stateSnapshot.metadata },
        artifacts: [...(ckpt.stateSnapshot.artifacts || [])],
        nodeOutputs: { ...(ckpt.stateSnapshot.nodeOutputs || {}) },
      },
      timestamp: ckpt.timestamp,
      completedNodes: [...(ckpt.completedNodes || [])],
      traceId: ckpt.traceId,
    }

    this.checkpoints.set(injected.checkpointId, injected)
    this.latestByGraph.set(injected.graphId, injected.checkpointId)

    logger.agent.info(
      `[CheckpointManager] Loaded persisted checkpoint ${injected.checkpointId} for graph ${injected.graphId} (node ${injected.nodeId}, ${injected.completedNodes.length} completed)`,
    )

    return true
  }

  /**
   * 序列化图最新 checkpoint（供磁盘持久化）
   *
   * 返回深拷贝，避免外部序列化/修改影响内存状态。
   * 持久化层（runtimePersistence）会将其写入 `${planId}.runtime.json`。
   *
   * @param graphId 图 id
   * @returns 最新 checkpoint 的深拷贝；图无 checkpoint 返回 null
   */
  serializeLatest(graphId: string): NodeCheckpoint | null {
    const latestId = this.latestByGraph.get(graphId)
    if (!latestId) return null

    const ckpt = this.checkpoints.get(latestId)
    if (!ckpt) return null

    // 深拷贝：stateSnapshot 内部也需独立（channels/metadata 为对象）
    return {
      checkpointId: ckpt.checkpointId,
      graphId: ckpt.graphId,
      nodeId: ckpt.nodeId,
      stateSnapshot: {
        channels: { ...ckpt.stateSnapshot.channels },
        metadata: { ...ckpt.stateSnapshot.metadata },
        artifacts: [...ckpt.stateSnapshot.artifacts],
        nodeOutputs: { ...ckpt.stateSnapshot.nodeOutputs },
      },
      timestamp: ckpt.timestamp,
      completedNodes: [...ckpt.completedNodes],
      traceId: ckpt.traceId,
    }
  }
}

/**
 * 默认单例（一次应用会话复用）
 */
export const checkpointManager = new CheckpointManager()
