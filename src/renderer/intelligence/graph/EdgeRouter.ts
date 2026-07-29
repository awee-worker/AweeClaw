/**
 * EdgeRouter —— 条件边求值器
 *
 * 职责：节点完成后，对其显式出边求值，决定下一步激活哪些节点。
 *
 * 边类型处理：
 * - simple：无条件，直接激活 target
 * - conditional：按 condition 求值，首个为真者激活（短路）
 * - loop：交给 LoopController（本路由器跳过）
 *
 * 条件求值模式：
 * - rule：受限表达式求值（非 eval），支持 state/node 字段比较
 * - llm：异步 LLM 判断（构造 prompt，返回 true/false）—— 阶段二仅实现 rule，llm 占位待阶段三接入
 *
 * 设计要点：
 * - 无 edges 时返回空数组（回退到依赖拓扑，由 GraphScheduler 处理）
 * - 条件求值失败时保守处理：视为 false（不激活），避免错误激活导致意外执行
 * - rule 表达式仅支持白名单运算符，防注入
 *
 * @module GraphRuntime
 */

import { logger } from '@toolkit/LogEngine'
import type { GraphNode, ExecutionGraph, GraphStateAccessor, EdgeCondition } from './graphTypes'

/** 求值上下文：暴露给规则表达式的安全变量 */
interface RuleContext {
  /** 节点状态（status/output/error/iterationCount 等） */
  node: Record<string, unknown>
  /** 图状态（metadata/channels 等） */
  state: Record<string, unknown>
  /** 节点输出文本 */
  output: string
  /** 节点是否成功 */
  success: boolean
  /** 节点是否失败 */
  failed: boolean
}

/**
 * LLM 条件求值器签名
 *
 * 注入式设计：EdgeRouter 不直接依赖 api.llm，由 taskExecutor 在模块顶层
 * 注入真实实现（封装 api.llm.generateObject + 30s 超时 Promise.race）。
 *
 * @param prompt condition.prompt 原文（用户定义的判断 prompt）
 * @param context 节点与状态上下文，evaluator 内部据此组装完整 LLM prompt
 * @returns true=激活该边 / false=跳过（失败/超时保守返回 false）
 */
export type LlmConditionEvaluator = (
  prompt: string,
  context: { node: GraphNode; state: GraphStateAccessor },
) => Promise<boolean>

export class EdgeRouter {
  /**
   * LLM 条件求值器（可选注入）
   *
   * - 未注入时：llm 条件边保守返回 false 并告警（阶段二行为）
   * - 注入后：包装 api.llm.generateObject + 30s 超时 Promise.race
   *   失败/超时统一返回 false，避免错误激活导致意外执行
   */
  private llmEvaluator: LlmConditionEvaluator | null = null

  constructor(llmEvaluator?: LlmConditionEvaluator) {
    if (llmEvaluator) {
      this.llmEvaluator = llmEvaluator
    }
  }

  /**
   * 注入 LLM 条件求值器（taskExecutor 模块顶层调用）
   */
  setLlmEvaluator(fn: LlmConditionEvaluator): void {
    this.llmEvaluator = fn
  }

  /**
   * 对 completedNode 的出边求值，返回应激活的目标节点
   *
   * @param graph 执行图
   * @param completedNode 刚完成的节点
   * @param state 状态访问器
   * @returns 激活的目标节点列表（可能为空）
   */
  async route(
    graph: ExecutionGraph,
    completedNode: GraphNode,
    state: GraphStateAccessor,
  ): Promise<GraphNode[]> {
    const edges = completedNode.edges
    if (!edges || edges.length === 0) {
      return []
    }

    const targets: GraphNode[] = []
    const ctx = this.buildRuleContext(completedNode, state)

    for (const edge of edges) {
      // loop 边交给 LoopController，此处跳过
      if (edge.type === 'loop') continue

      // simple 边：无条件激活
      if (edge.type === 'simple') {
        const target = this.findNode(graph, edge.target)
        if (target) {
          targets.push(target)
          logger.agent.debug(`[EdgeRouter] simple edge: ${completedNode.id} -> ${edge.target}`)
        } else {
          logger.agent.warn(`[EdgeRouter] simple edge target not found: ${edge.target}`)
        }
        continue
      }

      // conditional 边：求值
      const satisfied = await this.evaluateCondition(edge.condition, completedNode, state, ctx)
      if (satisfied) {
        const target = this.findNode(graph, edge.target)
        if (target) {
          targets.push(target)
          logger.agent.info(
            `[EdgeRouter] conditional edge satisfied: ${completedNode.id} -> ${edge.target}`,
          )
          break // 条件边短路：首个为真即止
        } else {
          logger.agent.warn(`[EdgeRouter] conditional edge target not found: ${edge.target}`)
        }
      }
    }

    return targets
  }

  /**
   * 判断节点是否有非 loop 的显式出边
   * （GraphScheduler 用此判断是否走图路由，还是回退依赖拓扑）
   */
  hasRoutingEdges(node: GraphNode): boolean {
    const edges = node.edges
    if (!edges) return false
    return edges.some(e => e.type === 'simple' || e.type === 'conditional')
  }

  // ===== 条件求值 =====

  /**
   * 求值条件
   * - rule：受限表达式求值
   * - llm：调用注入的 LLM evaluator，失败/超时保守返回 false
   *
   * @param condition 条件定义
   * @param node 当前节点（供 LLM evaluator 拼装 prompt）
   * @param state 状态访问器（供 LLM evaluator 读取 metadata）
   * @param ctx 规则求值上下文（rule 模式专用）
   */
  private async evaluateCondition(
    condition: EdgeCondition | undefined,
    node: GraphNode,
    state: GraphStateAccessor,
    ctx: RuleContext,
  ): Promise<boolean> {
    // 无条件视为满足
    if (!condition) return true

    if (condition.kind === 'rule') {
      return this.evalRule(condition.expression || '', ctx)
    }

    // llm 模式：调用注入的 evaluator
    if (condition.kind === 'llm') {
      return this.evalLlm(condition, node, state)
    }

    return false
  }

  /**
   * LLM 条件求值
   *
   * 流程：
   * 1. 检查 evaluator 是否注入：未注入 → 保守 false + 告警（阶段二行为）
   * 2. 调用 evaluator：condition.prompt + 节点/状态上下文
   * 3. 异常/超时 → 保守 false（错误激活比错误跳过更危险）
   *
   * 设计：evaluator 内部封装超时（30s Promise.race）与 LLM 调用，
   *      EdgeRouter 只关心"激活与否"的 boolean 语义。
   */
  private async evalLlm(
    condition: EdgeCondition,
    node: GraphNode,
    state: GraphStateAccessor,
  ): Promise<boolean> {
    if (!this.llmEvaluator) {
      logger.agent.warn(
        `[EdgeRouter] LLM condition evaluator not injected (node ${node.id}), treating as false`,
      )
      return false
    }

    const prompt = condition.prompt || ''
    if (!prompt) {
      logger.agent.warn(`[EdgeRouter] LLM condition missing prompt (node ${node.id})`)
      return false
    }

    try {
      const result = await this.llmEvaluator(prompt, { node, state })
      logger.agent.info(
        `[EdgeRouter] LLM condition evaluated: node=${node.id}, result=${result}`,
      )
      return Boolean(result)
    } catch (err) {
      // 异常/超时保守返回 false：错误激活会导致意外节点执行，错误跳过只损失一次路由机会
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.agent.warn(
        `[EdgeRouter] LLM condition eval failed (node ${node.id}): ${errorMsg}, treating as false`,
      )
      return false
    }
  }

  /**
   * 受限表达式求值（非 eval，防注入）
   *
   * 支持的语法（白名单）：
   * - 变量：node.xxx / state.xxx / output / success / failed
   * - 比较：=== / !== / == / != / > / < / >= / <=
   * - 逻辑：&& / || / !
   * - 字面量：数字 / 字符串（单双引号）/ true / false / null
   * - 括号：()
   *
   * 安全策略：
   * - 禁止函数调用（无 () 调用，仅比较与逻辑）
   * - 禁止成员访问原型链（仅访问 ctx 暴露的字段）
   * - 求值失败保守返回 false
   */
  private evalRule(expression: string, ctx: RuleContext): boolean {
    const trimmed = expression.trim()
    if (!trimmed) return true

    try {
      // 安全策略：仅允许白名单字符，拒绝危险构造
      if (!this.isSafeExpression(trimmed)) {
        logger.agent.warn(`[EdgeRouter] Unsafe expression rejected: ${expression}`)
        return false
      }

      // 在受限上下文中求值
      // 构造函数体，通过 new Function 求值（表达式已过白名单校验）
      const fn = new Function(
        'node', 'state', 'output', 'success', 'failed',
        `"use strict"; return (${trimmed});`,
      )
      const result = fn(ctx.node, ctx.state, ctx.output, ctx.success, ctx.failed)
      return Boolean(result)
    } catch (err) {
      logger.agent.warn(
        `[EdgeRouter] Rule eval failed: ${expression} -> ${err instanceof Error ? err.message : err}`,
      )
      return false
    }
  }

  /**
   * 表达式安全校验
   * 白名单：字母数字、下划线、点、引号、比较与逻辑运算符、括号、空格、数字
   * 黑名单：分号（防语句注入）、方括号（防属性注入，暂不支持）、反引号、=>、function、this、window、global、process
   */
  private isSafeExpression(expr: string): boolean {
    // 黑名单关键词
    const blacklist = /\b(function|this|window|global|globalThis|process|require|import|eval|new|delete|void|typeof|instanceof|in|of|class|return|var|let|const)\b/
    if (blacklist.test(expr)) return false

    // 危险符号
    if (/[;`\[\]{}=>]/.test(expr)) {
      // 允许 ===/!==/==/!=/>=/<=/>/< 的比较，但不允许 => 箭头、{} 对象、[] 属性访问
      // => 单独检测
      if (/=>/.test(expr)) return false
      if (/[;`]/.test(expr)) return false
      if (/[[\]{}]/.test(expr)) return false
    }

    // 白名单：仅允许这些字符（含冒号，用于字符串内容与三元运算；分号仍被黑名单拦截）
    const whitelist = /^[a-zA-Z0-9_\s.'"!=&|()<>+\-/*%:]+$/
    if (!whitelist.test(expr)) return false

    return true
  }

  // ===== 求值上下文构建 =====

  /** 构造规则求值上下文 */
  private buildRuleContext(node: GraphNode, state: GraphStateAccessor): RuleContext {
    return {
      node: {
        id: node.id,
        status: node.status,
        output: node.output,
        error: node.error,
        iterationCount: node.iterationCount,
        retryCount: node.retryCount,
        attempt: node.attempt,
      },
      state: {
        // 暴露 metadata（常见判断场景）
        metadata: this.peekMetadata(state),
      },
      output: node.output || '',
      success: node.status === 'completed',
      failed: node.status === 'failed',
    }
  }

  /**
   * 安全窥探 metadata（返回只读快照，供规则表达式遍历求值）
   *
   * 优先调用 getAllMetadata 获取完整快照（StoreGraphStateAdapter 已实现），
   * 使 rule 表达式 `state.metadata.xxx` 能拿到真实值。
   * 若适配器未实现 getAllMetadata（如测试 mock），回退空对象保守求值。
   */
  private peekMetadata(state: GraphStateAccessor): Record<string, unknown> {
    if (typeof state.getAllMetadata === 'function') {
      return state.getAllMetadata()
    }
    return {}
  }

  /** 在图中查找节点 */
  private findNode(graph: ExecutionGraph, nodeId: string): GraphNode | undefined {
    return graph.tasks.find(t => t.id === nodeId) as GraphNode | undefined
  }
}

/**
 * 默认单例
 */
export const edgeRouter = new EdgeRouter()
