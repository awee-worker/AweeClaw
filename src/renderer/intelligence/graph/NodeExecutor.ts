/**
 * NodeExecutor —— 节点执行器（多类型分发 + Span 强制校验）
 *
 * 职责：按 GraphNode.nodeType 分发到对应执行器，每个节点执行强制生成 Span。
 *
 * 节点类型分发：
 * - task（缺省）：执行子 Agent 子循环，复用 runAgentSubLoop
 * - llm：单次 LLM 调用（maxIterations=1 的轻量子循环）
 * - tool：直接执行工具（不走子循环，复用 toolOrchestrator）
 * - decision：纯路由节点，不求值副作用，仅返回成功（由 EdgeRouter 决定下一步）
 * - human：HITL 节点，返回 pending 状态暂停，等待外部恢复
 *
 * Span 强制校验（可观测性硬性要求）：
 * - 每个节点入口必须 createSpan
 * - 执行成功 endSpan(ok)，失败 endSpan(error)
 * - 异常时 addSpanEvent('exception') 记录
 * - 无 Span 的节点执行视为违规，防止动态图退化为不可调试
 *
 * @module GraphRuntime
 */

import { logger } from '@toolkit/LogEngine'
import { createSpan, endSpan, addSpanEvent, type Span } from '@aweeclaw/harness-core/observability'
import type {
  GraphNode,
  GraphNodeType,
  GraphExecutionContext,
  NodeExecutionResult,
} from './graphTypes'

/** 节点执行器抽象：各类型节点实现此接口 */
export interface NodeTypeExecutor {
  /** 执行节点，返回结果 */
  execute(node: GraphNode, ctx: GraphExecutionContext): Promise<NodeExecutionResult>
}

/**
 * 节点执行器 —— 按类型分发，强制 Span
 *
 * 设计：
 * - 持有各类型执行器的映射，可扩展注册新类型
 * - execute() 入口统一生成 Span，委托给具体执行器
 * - 中止信号检查：执行前检查 abortSignal
 */
export class NodeExecutor {
  /** 节点类型执行器注册表：nodeType → executor */
  private readonly executors = new Map<GraphNodeType | 'default', NodeTypeExecutor>()

  constructor(
    taskExecutor?: NodeTypeExecutor,
    toolExecutor?: NodeTypeExecutor,
    llmExecutor?: NodeTypeExecutor,
  ) {
    // 注册默认执行器（可被外部覆盖）
    if (taskExecutor) this.executors.set('task', taskExecutor)
    if (toolExecutor) this.executors.set('tool', toolExecutor)
    if (llmExecutor) this.executors.set('llm', llmExecutor)
  }

  /**
   * 执行节点 —— 统一入口，强制生成 Span
   *
   * @param node 图节点
   * @param ctx 执行上下文
   * @returns 执行结果（含成功/失败状态）
   */
  async execute(
    node: GraphNode,
    ctx: GraphExecutionContext,
  ): Promise<NodeExecutionResult> {
    // 中止信号检查
    if (ctx.abortSignal?.aborted) {
      logger.agent.warn(`[NodeExecutor] Node ${node.id} aborted before execution`)
      return this.failureResult(node.id, 'Execution aborted')
    }

    // 强制生成 Span —— 可观测性硬性要求
    const span = this.createNodeSpan(node, ctx)

    try {
      const executor = this.resolveExecutor(node)
      const result = await executor.execute(node, ctx)

      // 记录结果到 Span
      addSpanEvent(span, 'node.completed', {
        success: result.success,
        looped: result.looped,
        iteration: result.iteration,
      })

      endSpan(span, result.success ? 'ok' : 'error')
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      addSpanEvent(span, 'exception', { error: errorMsg })
      endSpan(span, 'error')
      logger.agent.error(`[NodeExecutor] Node ${node.id} execution failed: ${errorMsg}`, err)

      return this.failureResult(node.id, errorMsg)
    }
  }

  /**
   * 注册自定义节点类型执行器（可扩展）
   */
  registerExecutor(nodeType: GraphNodeType, executor: NodeTypeExecutor): void {
    this.executors.set(nodeType, executor)
  }

  /**
   * 清空所有已注册执行器（测试专用）
   *
   * 用途：单测 beforeEach 隔离上一次注册污染。
   * 注意：生产代码不应调用，避免误清空真实执行器。
   */
  clear(): void {
    this.executors.clear()
  }

  // ===== 内部方法 =====

  /** 解析节点对应的执行器 */
  private resolveExecutor(node: GraphNode): NodeTypeExecutor {
    const nodeType = node.nodeType || 'task'
    const executor = this.executors.get(nodeType)

    if (executor) return executor

    // 内置默认执行器（未注册外部实现时）
    switch (nodeType) {
      case 'task':
      case 'llm':
        return this.defaultTaskExecutor
      case 'tool':
        return this.defaultToolExecutor
      case 'decision':
        return this.defaultDecisionExecutor
      case 'human':
        return this.defaultHumanExecutor
      default:
        return this.defaultTaskExecutor
    }
  }

  /** 创建节点 Span */
  private createNodeSpan(node: GraphNode, ctx: GraphExecutionContext): Span {
    return createSpan(
      `node:${node.nodeType || 'task'}:${node.id}`,
      ctx.traceId,
      ctx.parentSpanId,
      {
        nodeId: node.id,
        nodeType: node.nodeType || 'task',
        nodeTitle: node.title,
      },
    )
  }

  /** 构造失败结果 */
  private failureResult(nodeId: string, error: string): NodeExecutionResult {
    return {
      taskId: nodeId,
      success: false,
      error,
      output: '',
    } as NodeExecutionResult
  }

  // ===== 内置默认执行器（当未注册外部实现时使用）=====

  /** 默认 task 节点执行器：委托给外部注入的执行器，或返回占位 */
  private defaultTaskExecutor: NodeTypeExecutor = {
    async execute(node, _ctx): Promise<NodeExecutionResult> {
      // 实际执行由 taskExecutor.ts 的 runTaskWithAgent 完成
      // 此处为图运行时未注入外部执行器时的占位（不应在正常运行中走到）
      logger.agent.warn(
        `[NodeExecutor] No task executor registered for node ${node.id}, using placeholder`,
      )
      return {
        taskId: node.id,
        success: false,
        error: 'Task executor not registered',
        output: '',
      } as NodeExecutionResult
    },
  }

  /** 默认 tool 节点执行器：直接执行工具（阶段三占位，待接入 toolOrchestrator） */
  private defaultToolExecutor: NodeTypeExecutor = {
    async execute(node, _ctx): Promise<NodeExecutionResult> {
      logger.agent.info(`[NodeExecutor] Tool node ${node.id} executed (placeholder)`)
      return {
        taskId: node.id,
        success: true,
        output: node.output || '',
      } as NodeExecutionResult
    },
  }

  /** decision 节点执行器：纯路由，无副作用，直接成功 */
  private defaultDecisionExecutor: NodeTypeExecutor = {
    async execute(node, _ctx): Promise<NodeExecutionResult> {
      logger.agent.debug(`[NodeExecutor] Decision node ${node.id} resolved (no side effect)`)
      return {
        taskId: node.id,
        success: true,
        output: '',
      } as NodeExecutionResult
    },
  }

  /** human 节点执行器：HITL 暂停，返回 pending 等待外部恢复 */
  private defaultHumanExecutor: NodeTypeExecutor = {
    async execute(node, _ctx): Promise<NodeExecutionResult> {
      logger.agent.info(`[NodeExecutor] Human node ${node.id} awaiting approval`)
      // 返回 pending 状态：节点未完成但需暂停等待人工审批
      // success=false + pending=true 区别于普通失败，调用方据此走暂停分支
      return {
        taskId: node.id,
        success: false,
        pending: true,
        error: 'Awaiting human approval',
        output: '',
      } as NodeExecutionResult
    },
  }
}

// ===== 模块单例（与 edgeRouter/loopController/checkpointManager 风格一致） =====
//
// 设计理由：
// - 阶段四生产路径（taskExecutor.ts）通过模块单例调用 nodeExecutor.execute(node, ctx)
//   统一注入点，避免每次构造新实例带来状态不一致
// - 启动期（taskExecutor 模块顶层）调用 registerRealExecutors 注入真实执行器
// - 现有 NodeExecutor.test.ts 使用局部 `new NodeExecutor()`，不受单例污染

/**
 * 模块级单例 NodeExecutor
 *
 * 默认注册内置占位执行器；启动期由 taskExecutor.ts 调用
 * `registerRealExecutors({ toolExecutor, llmExecutor })` 注入真实实现。
 */
export const nodeExecutor = new NodeExecutor()

/**
 * 注册真实执行器（启动期调用）
 *
 * 仅注册 tool / llm 两类执行器：
 * - task 节点不注册到 NodeExecutor（runTaskWithAgent 需要 session/threadId/requestId，
 *   不适合 NodeTypeExecutor 接口），由 executeTask 直接分发
 * - decision / human 保持默认执行器（语义已对）
 *
 * @param executors 可选注入的真实执行器集合
 * - toolExecutor: 来自 createToolExecutor()
 * - llmExecutor: 来自 createLlmExecutor()
 */
export function registerRealExecutors(executors?: {
  toolExecutor?: NodeTypeExecutor
  llmExecutor?: NodeTypeExecutor
}): void {
  if (executors?.toolExecutor) {
    nodeExecutor.registerExecutor('tool', executors.toolExecutor)
  }
  if (executors?.llmExecutor) {
    nodeExecutor.registerExecutor('llm', executors.llmExecutor)
  }
}

/**
 * 清空所有已注册执行器（测试专用）
 *
 * 用途：单测 beforeEach 隔离上一次注册污染。
 * 注意：生产代码不应调用，避免误清空真实执行器。
 */
export function clearExecutors(): void {
  nodeExecutor.clear()
}

/**
 * 创建默认 NodeExecutor（使用内置占位执行器）
 * 兼容旧调用方；新代码应直接使用 `nodeExecutor` 单例。
 * @deprecated 使用 `nodeExecutor` 模块单例
 */
export function createNodeExecutor(): NodeExecutor {
  return new NodeExecutor()
}
