/**
 * GraphStateAdapter —— 图状态适配层
 *
 * 职责：实现 GraphStateAccessor，将节点的状态读写路由到底层 store（taskSlice/conversationSlice），
 *       节点逻辑与 store 实现解耦。
 *
 * 设计要点：
 * - 薄代理，无序列化，高频读写直接命中 store
 * - channels/metadata 为图运行时独有，内存维护（不持久化，节点间临时数据流）
 * - nodeOutputs 代理 PlanTask.output（通过 taskSlice.markTaskCompleted / getPlan）
 * - 绑定 planId，确保所有操作作用于当前执行图
 *
 * @module GraphRuntime
 */

import { useAgentStore } from '../state/IntelligenceStore'
import { logger } from '@toolkit/LogEngine'
import { isGraphNode, type GraphNode, type GraphStateAccessor } from './graphTypes'
import type { TaskPlan } from '../planner/planTypes'

/**
 * 基于 store 的状态访问器实现
 *
 * 用法：const accessor = new StoreGraphStateAdapter(planId)
 *       节点内 accessor.read/write/getNodeOutput ...
 */
export class StoreGraphStateAdapter implements GraphStateAccessor {
  /** 节点间显式数据通道（内存，图运行期生命周期） */
  private channels: Record<string, unknown> = {}
  /** 任意元数据：计数器、标志位、循环反思上下文（内存） */
  private metadata: Record<string, unknown> = {}
  /** 产出物路径列表 */
  private artifacts: string[] = []

  constructor(private readonly planId: string) {}

  // ----- 通用读写 -----

  /** 通用读取：优先 channels，其次 metadata */
  read(key: string): unknown {
    if (key in this.channels) return this.channels[key]
    return this.metadata[key]
  }

  /** 通用写入：默认写 metadata（如需写通道用 writeChannel） */
  write(key: string, value: unknown): void {
    this.metadata[key] = value
  }

  // ----- 节点间数据通道 -----

  readChannel(key: string): unknown {
    return this.channels[key]
  }

  writeChannel(key: string, value: unknown): void {
    this.channels[key] = value
  }

  // ----- 节点输出（代理 PlanTask.output） -----

  /**
   * 读取节点输出 —— 代理到 taskSlice.getPlan，取对应 task.output
   * 优先取内存 channels（最新），其次取持久化 PlanTask.output
   */
  getNodeOutput(nodeId: string): string | undefined {
    // 内存通道优先（回流重试时可能写入中间态）
    const cached = this.channels[`output:${nodeId}`]
    if (typeof cached === 'string') return cached

    // 代理到 store
    const plan = this.getPlan()
    if (!plan) return undefined
    const task = plan.tasks.find(t => t.id === nodeId)
    return task?.output
  }

  /**
   * 写入节点输出 —— 代理到 taskSlice.markTaskCompleted
   * 同时更新内存通道缓存，确保后续读取拿到最新值
   */
  setNodeOutput(nodeId: string, output: string): void {
    // 内存缓存（确保回流时读到最新）
    this.channels[`output:${nodeId}`] = output

    // 代理到 store
    try {
      const store = useAgentStore.getState()
      store.markTaskCompleted(this.planId, nodeId, output)
    } catch (err) {
      logger.agent.error(`[GraphStateAdapter] setNodeOutput failed: ${nodeId}`, err)
    }
  }

  // ----- 元数据 -----

  getMetadata(key: string): unknown {
    return this.metadata[key]
  }

  setMetadata(key: string, value: unknown): void {
    this.metadata[key] = value
  }

  /**
   * 读取全部元数据快照（返回浅拷贝，调用方修改不影响内部状态）
   * 供 EdgeRouter 规则表达式求值遍历场景使用
   */
  getAllMetadata(): Record<string, unknown> {
    return { ...this.metadata }
  }

  // ----- 产出物 -----

  /** 添加产出物（文件路径等） */
  addArtifact(path: string): void {
    if (!this.artifacts.includes(path)) {
      this.artifacts.push(path)
    }
  }

  /** 获取所有产出物 */
  getArtifacts(): string[] {
    return [...this.artifacts]
  }

  // ----- 内部辅助 -----

  /** 获取当前图（plan）—— 代理 taskSlice.getPlan */
  private getPlan(): TaskPlan | null {
    const store = useAgentStore.getState()
    return store.getPlan(this.planId)
  }

  /**
   * 导出 GraphState 快照 —— 用于检查点持久化
   * 仅导出可序列化部分（channels/metadata/artifacts/nodeOutputs）
   */
  exportSnapshot(): {
    channels: Record<string, unknown>
    metadata: Record<string, unknown>
    artifacts: string[]
    nodeOutputs: Record<string, string>
  } {
    const plan = this.getPlan()
    const nodeOutputs: Record<string, string> = {}
    if (plan) {
      for (const task of plan.tasks) {
        if (task.output) nodeOutputs[task.id] = task.output
      }
    }
    return {
      channels: { ...this.channels },
      metadata: { ...this.metadata },
      artifacts: [...this.artifacts],
      nodeOutputs,
    }
  }

  /**
   * 从快照恢复 —— 检查点恢复时调用
   */
  importSnapshot(snapshot: {
    channels?: Record<string, unknown>
    metadata?: Record<string, unknown>
    artifacts?: string[]
    nodeOutputs?: Record<string, string>
  }): void {
    this.channels = { ...snapshot.channels }
    this.metadata = { ...snapshot.metadata }
    this.artifacts = [...(snapshot.artifacts || [])]
    // nodeOutputs 恢复到内存缓存（持久化部分由 taskSlice 管理，此处只补内存）
    if (snapshot.nodeOutputs) {
      for (const [nodeId, output] of Object.entries(snapshot.nodeOutputs)) {
        this.channels[`output:${nodeId}`] = output
      }
    }
  }
}

/**
 * 创建状态访问器工厂
 * 绑定到指定 planId，返回 GraphStateAccessor
 */
export function createStateAccessor(planId: string): GraphStateAccessor {
  return new StoreGraphStateAdapter(planId)
}

/**
 * 读取节点的循环反思上下文（LoopController 注入，供节点执行时使用）
 */
export function readReflection(state: GraphStateAccessor, nodeId: string): string | undefined {
  return state.getMetadata(`loop:${nodeId}:reflection`) as string | undefined
}

/**
 * 读取节点的当前循环迭代次数
 */
export function readIteration(state: GraphStateAccessor, nodeId: string): number {
  return (state.getMetadata(`loop:${nodeId}:iteration`) as number) || 0
}

/**
 * 判断节点是否需要审批（覆盖全局授权方式）
 */
export function nodeRequiresApproval(node: GraphNode): boolean {
  return node.requireApproval === true || node.nodeType === 'human'
}

// 重新导出 isGraphNode 供外部便捷使用
export { isGraphNode }
