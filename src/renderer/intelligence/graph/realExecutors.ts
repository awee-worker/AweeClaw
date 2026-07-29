/**
 * 真实节点执行器工厂（阶段四）
 *
 * 职责：为 tool/llm 节点类型提供真实执行器实现，通过 GraphExecutionContext 上
 *       的执行回调（executeToolCall/executeLlmCall）调用真实能力，
 *       避免 NodeExecutor 直接依赖 ToolExecutionContext/ThreadBoundStore 等重上下文。
 *
 * 解耦设计：
 * - 执行器只依赖 GraphExecutionContext 上的闭包回调
 * - 闭包由 executeTask 构造 ctx 时注入，内部封装 orchestrateToolBatch / api.llm.generateObject
 * - 这样 NodeExecutor 保持轻量，可独立单测（mock 回调即可）
 *
 * @module GraphRuntime
 */

import { logger } from '@toolkit/LogEngine'
import type { NodeTypeExecutor } from './NodeExecutor'
import type { NodeExecutionResult } from './graphTypes'

/** 构造失败结果（统一格式） */
function failureResult(nodeId: string, error: string): NodeExecutionResult {
  return {
    taskId: nodeId,
    success: false,
    error,
    output: '',
  } as NodeExecutionResult
}

/**
 * 创建 tool 节点真实执行器
 *
 * 流程：
 * 1. 从 node.toolCall 读取工具名与参数（缺省则报错，明显可诊断）
 * 2. 调用 ctx.executeToolCall 回调（executeTask 注入，内部封装 orchestrateToolBatch）
 * 3. 归一化结果为 NodeExecutionResult
 *
 * @returns NodeTypeExecutor —— 注册到 NodeExecutor 的 'tool' 类型
 */
export function createToolExecutor(): NodeTypeExecutor {
  return {
    async execute(node, ctx): Promise<NodeExecutionResult> {
      const toolCall = node.toolCall
      if (!toolCall || !toolCall.name) {
        logger.agent.warn(`[ToolExecutor] Node ${node.id} missing toolCall field`)
        return failureResult(node.id, 'Tool node missing toolCall field (name and arguments required)')
      }

      if (!ctx.executeToolCall) {
        logger.agent.warn(`[ToolExecutor] Node ${node.id} context has no executeToolCall injected`)
        return failureResult(node.id, 'executeToolCall not injected in context (executeTask should provide it)')
      }

      try {
        const { success, output, error } = await ctx.executeToolCall(toolCall)
        return {
          taskId: node.id,
          success,
          output: output || '',
          error,
        } as NodeExecutionResult
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.agent.error(`[ToolExecutor] Node ${node.id} execution threw: ${errorMsg}`)
        return failureResult(node.id, errorMsg)
      }
    },
  }
}

/**
 * 创建 llm 节点真实执行器
 *
 * 流程：
 * 1. prompt = node.llmPrompt || node.description（缺省则报错）
 * 2. 调用 ctx.executeLlmCall 回调（executeTask 注入，内部封装 api.llm.generateObject）
 * 3. 归一化结果为 NodeExecutionResult
 *
 * @returns NodeTypeExecutor —— 注册到 NodeExecutor 的 'llm' 类型
 */
export function createLlmExecutor(): NodeTypeExecutor {
  return {
    async execute(node, ctx): Promise<NodeExecutionResult> {
      const prompt = node.llmPrompt || node.description
      if (!prompt) {
        logger.agent.warn(`[LlmExecutor] Node ${node.id} has neither llmPrompt nor description`)
        return failureResult(node.id, 'LLM node missing llmPrompt and description (at least one required)')
      }

      if (!ctx.executeLlmCall) {
        logger.agent.warn(`[LlmExecutor] Node ${node.id} context has no executeLlmCall injected`)
        return failureResult(node.id, 'executeLlmCall not injected in context (executeTask should provide it)')
      }

      try {
        const { success, output, error } = await ctx.executeLlmCall(prompt)
        return {
          taskId: node.id,
          success,
          output: output || '',
          error,
        } as NodeExecutionResult
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.agent.error(`[LlmExecutor] Node ${node.id} execution threw: ${errorMsg}`)
        return failureResult(node.id, errorMsg)
      }
    },
  }
}
