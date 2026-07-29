/**
 * GraphRuntime —— 图运行时入口
 *
 * 职责：组装 Graph Runtime 各组件（Scheduler / Executor / Checkpoint），
 *       提供统一的图执行入口。
 *
 * 设计：
 * - 持有 GraphScheduler、NodeExecutor、CheckpointManager、LoopController 实例
 * - runGraph() 为阶段三的统一执行入口（实际接入主执行循环由调用方决定）
 * - 不强制改变现有 taskExecutor.runExecutionLoop 行为，可作为可选执行后端
 *
 * @module GraphRuntime
 *
 * @deprecated Graph Runtime 阶段四已将执行能力接入生产路径
 *             taskExecutor.runExecutionLoop → executeTask → NodeExecutor 分发
 *             本类的 runGraph 路径不再作为生产执行入口，仅保留为测试夹具
 *             （缺乏 store/EventBus/thread/Agent.send/反思注入等生产能力）
 *             新代码请通过 startPlanExecution 启动图执行，通过 resumeHumanNode
 *             处理 HITL 审批。
 */

import { logger } from '@toolkit/LogEngine'
import { ExecutionScheduler } from '../planner/TaskScheduler'
import { GraphScheduler } from './GraphScheduler'
import { NodeExecutor, createNodeExecutor, type NodeTypeExecutor } from './NodeExecutor'
import { CheckpointManager, checkpointManager } from './CheckpointManager'
import { loopController } from './LoopController'
import { StoreGraphStateAdapter } from './GraphStateAdapter'
import type {
  GraphNode,
  ExecutionGraph,
  GraphExecutionContext,
  NodeExecutionResult,
} from './graphTypes'

/**
 * 图运行时配置
 */
export interface GraphRuntimeConfig {
  /** 是否启用节点级检查点（默认 true） */
  enableCheckpoint: boolean
  /** 是否允许动态建图（默认 false，需图自身 allowDynamicExpansion=true） */
  allowDynamicExpansion: boolean
  /** 最大节点执行数（防失控，0=不限） */
  maxNodeExecutions: number
}

/** 默认运行时配置 */
export const DEFAULT_RUNTIME_CONFIG: GraphRuntimeConfig = {
  enableCheckpoint: true,
  allowDynamicExpansion: false,
  maxNodeExecutions: 0,
}

/**
 * 图运行时 —— 组装各组件，提供执行入口
 *
 * 用法：
 * ```ts
 * const runtime = new GraphRuntime(session.scheduler)
 * runtime.registerTaskExecutor(myTaskExecutor)
 * const result = await runtime.runGraph(graph, { workspacePath, traceId })
 * ```
 */
export class GraphRuntime {
  readonly scheduler: GraphScheduler
  readonly executor: NodeExecutor
  readonly checkpoint: CheckpointManager

  private config: GraphRuntimeConfig

  constructor(
    baseScheduler: ExecutionScheduler,
    config: Partial<GraphRuntimeConfig> = {},
  ) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config }
    this.scheduler = new GraphScheduler(baseScheduler)
    this.executor = createNodeExecutor()
    this.checkpoint = checkpointManager
  }

  /**
   * 注册 task 节点执行器（实际执行由外部注入，避免循环依赖）
   * taskExecutor.ts 的 runTaskWithAgent 可包装为此接口
   */
  registerTaskExecutor(executor: NodeTypeExecutor): void {
    this.executor.registerExecutor('task', executor)
    logger.agent.debug('[GraphRuntime] Task executor registered')
  }

  /**
   * 注册 tool 节点执行器
   */
  registerToolExecutor(executor: NodeTypeExecutor): void {
    this.executor.registerExecutor('tool', executor)
    logger.agent.debug('[GraphRuntime] Tool executor registered')
  }

  /**
   * 注册 llm 节点执行器
   */
  registerLlmExecutor(executor: NodeTypeExecutor): void {
    this.executor.registerExecutor('llm', executor)
    logger.agent.debug('[GraphRuntime] LLM executor registered')
  }

  /**
   * 执行图 —— 阶段三统一入口
   *
   * 流程：
   * 1. 重置循环计数（清空历史反思）
   * 2. 循环调度：getExecutableTasks → execute → resolveNextNodes
   * 3. 节点入口打 checkpoint（若启用）
   * 4. 循环回流由 GraphScheduler.resolveNextNodes 处理
   * 5. 无可执行节点时结束
   *
   * @param graph 执行图
   * @param options 执行选项（workspacePath / traceId / abortSignal）
   * @returns 执行结果汇总
   *
   * @deprecated 阶段四已接入生产路径，本方法仅作测试夹具。
   *             生产执行请用 taskExecutor.startPlanExecution，
   *             HITL 审批请用 taskExecutor.resumeHumanNode。
   */
  async runGraph(
    graph: ExecutionGraph,
    options: {
      workspacePath: string
      traceId: string
      parentSpanId?: string
      abortSignal?: AbortSignal
    },
  ): Promise<GraphRunResult> {
    const state = new StoreGraphStateAdapter(graph.id)

    // 重置循环计数（防止跨执行污染）
    loopController.resetAll(graph, state)

    const executedNodes: string[] = []
    const results: NodeExecutionResult[] = []
    let iteration = 0
    const maxIter = this.config.maxNodeExecutions || Infinity

    logger.agent.info(`[GraphRuntime] Starting graph ${graph.id} (${graph.tasks.length} nodes)`)

    while (iteration < maxIter) {
      // 中止检查
      if (options.abortSignal?.aborted) {
        logger.agent.info(`[GraphRuntime] Graph ${graph.id} aborted at iteration ${iteration}`)
        return this.buildResult(graph, executedNodes, results, 'aborted')
      }

      // 获取可执行节点
      const executable = this.scheduler.getExecutableTasks(graph) as GraphNode[]
      if (executable.length === 0) {
        // 无可执行节点：检查是否全部完成或存在失败
        const hasFailed = graph.tasks.some(t => t.status === 'failed')
        const allDone = graph.tasks.every(t =>
          t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled',
        )
        if (allDone) {
          logger.agent.info(`[GraphRuntime] Graph ${graph.id} completed (${executedNodes.length} executed, ${hasFailed ? 'with failures' : 'all success'})`)
          return this.buildResult(graph, executedNodes, results, hasFailed ? 'failed' : 'completed')
        }
        // 等待中（如 human 节点暂停）
        logger.agent.info(`[GraphRuntime] Graph ${graph.id} paused (no executable nodes, waiting)`)
        return this.buildResult(graph, executedNodes, results, 'paused')
      }

      // 执行批次（并行执行就绪节点）
      const batch = this.scheduler.getParallelBatch(graph) as GraphNode[]
      const nodesToExecute = batch.length > 0 ? batch : executable

      // 构造执行上下文
      const ctx: GraphExecutionContext = {
        graph,
        node: nodesToExecute[0], // 批次内各节点独立构造
        state,
        workspacePath: options.workspacePath,
        traceId: options.traceId,
        parentSpanId: options.parentSpanId,
        abortSignal: options.abortSignal,
      }

      // 并行执行批次
      const batchResults = await Promise.all(
        nodesToExecute.map(async (node) => {
          // 节点入口打 checkpoint
          if (this.config.enableCheckpoint) {
            this.checkpoint.checkpoint(graph, node, state, options.traceId)
          }

          const nodeCtx: GraphExecutionContext = { ...ctx, node }
          return this.executor.execute(node, nodeCtx)
        }),
      )

      results.push(...batchResults)
      executedNodes.push(...nodesToExecute.map(n => n.id))

      // 处理结果：更新节点状态
      for (let i = 0; i < nodesToExecute.length; i++) {
        const node = nodesToExecute[i]
        const result = batchResults[i]

        if (result.success) {
          state.setNodeOutput(node.id, result.output || '')
        }
        // 失败节点由 resolveNextNodes 判断是否回流
      }

      // 解析下一步（路由 / 回流 / 拓扑）
      for (const node of nodesToExecute) {
        const updatedNode = graph.tasks.find(t => t.id === node.id) as GraphNode | undefined
        if (updatedNode) {
          await this.scheduler.resolveNextNodes(graph, updatedNode, state)
        }
      }

      iteration++
    }

    logger.agent.warn(`[GraphRuntime] Graph ${graph.id} reached max iterations ${maxIter}`)
    return this.buildResult(graph, executedNodes, results, 'failed')
  }

  /**
   * 从检查点恢复执行
   */
  async resumeFromCheckpoint(
    graphId: string,
    options: {
      workspacePath: string
      traceId: string
      parentSpanId?: string
      abortSignal?: AbortSignal
    },
  ): Promise<GraphRunResult | null> {
    const state = new StoreGraphStateAdapter(graphId)
    const restored = this.checkpoint.restoreLatest(graphId, state)
    if (!restored) {
      logger.agent.warn(`[GraphRuntime] No checkpoint to resume for graph ${graphId}`)
      return null
    }

    logger.agent.info(`[GraphRuntime] Resuming graph ${graphId} from node ${restored.resumeFrom}`)
    return this.runGraph(restored.restoredGraph, options)
  }

  // ===== 内部方法 =====

  /** 构造运行结果 */
  private buildResult(
    graph: ExecutionGraph,
    executedNodes: string[],
    results: NodeExecutionResult[],
    status: GraphRunStatus,
  ): GraphRunResult {
    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success && !r.looped).length
    return {
      graphId: graph.id,
      status,
      executedNodeCount: executedNodes.length,
      succeededCount: succeeded,
      failedCount: failed,
      results,
    }
  }
}

/**
 * 图运行结果
 */
export interface GraphRunResult {
  graphId: string
  status: GraphRunStatus
  executedNodeCount: number
  succeededCount: number
  failedCount: number
  results: NodeExecutionResult[]
}

/** 图运行状态 */
export type GraphRunStatus = 'completed' | 'failed' | 'aborted' | 'paused'

/**
 * 创建图运行时实例
 */
export function createGraphRuntime(
  baseScheduler: ExecutionScheduler,
  config?: Partial<GraphRuntimeConfig>,
): GraphRuntime {
  return new GraphRuntime(baseScheduler, config)
}
