/**
 * 语音对话 LLM 工具调用循环
 *
 * 让语音对话具备与普通文字对话完全相同的 AI 能力：
 * - 支持工具调用（文件读写、终端、搜索等内置工具）
 * - 支持插件（MCP 工具等）
 * - 工具执行结果自动反馈到 LLM 继续生成
 * - 危险工具需要用户在设置中开启自动批准才能在语音模式中执行
 *
 * 架构说明：
 * - 云端模式和本地模式都走客户端主进程的 api.llm.send()
 * - 云端模式 LLM 配置中包含 cloudMode=true/serverUrl/accessToken，
 *   主进程会自动路由到后端 LLM 代理（支持工具调用）
 * - 本地模式 LLM 配置中包含 apiKey/baseUrl，直连用户配置的模型
 *
 * 参考：AgentSubLoop.ts 的工具调用模式
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import {
  toolManager,
  initializeToolProviders,
  setToolLoadingContext,
  initializeTools,
} from '@intelligence/toolkit'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { useStore } from '@store'
import { getToolApprovalType } from '@configuration/toolDefinitions'
import type {
  LLMConfig,
  LLMMessage,
  ToolDefinition,
  ToolExecutionContext,
} from '@intelligence/providerTypes'

/** 默认最大工具调用迭代次数 */
const DEFAULT_MAX_ITERATIONS = 10
/** 单次 LLM 请求超时（ms） */
const VOICE_LLM_TIMEOUT = 60000

interface CollectedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface VoiceToolLoopOptions {
  /** LLM 配置（云端模式含 cloudMode/serverUrl/accessToken，本地模式含 apiKey/baseUrl） */
  config: LLMConfig
  /** 对话消息（会被本函数 mutate：追加 assistant/tool 消息） */
  messages: LLMMessage[]
  /** 系统提示词 */
  systemPrompt: string
  /** 工作区路径（工具执行上下文） */
  workspacePath: string | null
  /** 最大迭代次数 */
  maxIterations?: number
  /** 流式文本回调（每收到一个 text chunk 触发） */
  onTextChunk?: (text: string) => void
  /** 中断信号 */
  abortSignal?: AbortSignal
}

export interface VoiceToolLoopResult {
  /** 最终文本内容（用于 TTS） */
  content: string
  /** 总工具调用次数 */
  toolCallsCount: number
  /** 错误信息（如果有） */
  error?: string
}

/** 工具初始化标志（与 AgentSubLoop 隔离，避免互相影响） */
let voiceToolsInitialized = false

/**
 * 确保工具系统已初始化
 *
 * 加载内置工具 + 插件工具，与普通对话使用相同的工具集
 */
async function ensureVoiceToolsInitialized(): Promise<void> {
  if (voiceToolsInitialized) return

  logger.agent.info('[VoiceToolLoop] Initializing tools for voice mode...')

  try {
    initializeToolProviders()

    const activeScenarioId = useStore.getState().activeScenarioId
    const activeScenario = scenarioRegistry.getActive()
    const scenarioToolPacks = activeScenario?.capabilities?.toolPacks

    setToolLoadingContext({
      mode: 'agent',
      templateId: useStore.getState().promptTemplateId,
      scenarioId: activeScenarioId,
      scenarioToolPacks,
    })

    await initializeTools()
    voiceToolsInitialized = true

    const toolCount = toolManager.getAllToolDefinitions().length
    logger.agent.info(`[VoiceToolLoop] Tools initialized: ${toolCount} tools available`)
  } catch (err) {
    logger.agent.error('[VoiceToolLoop] Failed to initialize tools:', err)
    // 不 throw，允许在无工具模式下继续（LLM 仍可正常对话）
    voiceToolsInitialized = true
  }
}

/**
 * 调用 LLM（带工具支持）
 *
 * 流式收集文本和工具调用，返回完整结果
 */
function callLLMWithTools(
  config: LLMConfig,
  messages: LLMMessage[],
  tools: ToolDefinition[],
  systemPrompt: string,
  requestId: string,
  onTextChunk?: (text: string) => void,
): Promise<{ content: string; toolCalls: CollectedToolCall[]; error?: string }> {
  return new Promise((resolve) => {
    let fullContent = ''
    const toolCalls: CollectedToolCall[] = []
    const streamingToolCalls = new Map<string, { id: string; name: string; argsString: string }>()
    let settled = false

    const cleanup = () => {
      unsubStream()
      unsubError()
      unsubDone()
    }

    const doResolve = (error?: string) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ content: fullContent, toolCalls, error })
    }

    // 订阅流式响应
    const unsubStream = api.llm.onStream(requestId, (data) => {
      switch (data.type) {
        case 'text':
          if (data.content) {
            fullContent += data.content
            onTextChunk?.(data.content)
          }
          break

        case 'tool_call_start': {
          const toolId = data.id || ''
          const toolName = data.name || ''
          if (toolId) {
            streamingToolCalls.set(toolId, { id: toolId, name: toolName, argsString: '' })
          }
          break
        }

        case 'tool_call_delta': {
          const tcId = data.id
          if (tcId) {
            const tc = streamingToolCalls.get(tcId)
            if (tc && data.argumentsDelta) {
              tc.argsString += data.argumentsDelta
            }
            if (tc && data.name && data.name !== tc.name) {
              tc.name = data.name
            }
          }
          break
        }

        case 'tool_call_delta_end': {
          const tcId = data.id
          if (tcId) {
            const tc = streamingToolCalls.get(tcId)
            if (tc) {
              const args = parseToolArgs(tc.argsString)
              upsertToolCall(toolCalls, tc.id, tc.name, args)
              streamingToolCalls.delete(tcId)
            }
          }
          break
        }

        case 'tool_call_available': {
          const tcId = data.id || ''
          const toolName = data.name || ''
          const args = (data.arguments || {}) as Record<string, unknown>
          if (tcId) streamingToolCalls.delete(tcId)
          upsertToolCall(toolCalls, tcId, toolName, args)
          break
        }
      }
    })

    const unsubError = api.llm.onError(requestId, (err) => {
      if (settled) return
      doResolve(err.message || 'LLM error')
    })

    const unsubDone = api.llm.onDone(requestId, () => {
      if (settled) return
      doResolve()
    })

    // 构建发送参数
    const sendParams: Record<string, unknown> = {
      config,
      messages,
      systemPrompt,
      requestId,
    }
    if (tools.length > 0) {
      sendParams.tools = tools
    }

    api.llm.send(sendParams as any).catch((err) => {
      if (settled) return
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.agent.error(`[VoiceToolLoop] api.llm.send failed: ${errMsg}`)
      doResolve(errMsg)
    })

    // 超时保护
    setTimeout(() => {
      if (settled) return
      doResolve('语音 LLM 请求超时')
    }, VOICE_LLM_TIMEOUT)
  })
}

/**
 * 执行单个工具调用
 *
 * 语音模式下的审批策略：
 * - none / interaction 类型：直接执行
 * - terminal / dangerous 类型：检查 autoApprove 设置
 *   - 已开启自动批准 → 执行
 *   - 未开启 → 跳过并返回提示消息（不在语音模式中弹审批框）
 */
async function executeVoiceToolCall(
  toolCall: CollectedToolCall,
  workspacePath: string | null,
  requestId: string,
): Promise<{ role: 'tool'; content: string; tool_call_id: string; name: string }> {
  const context: ToolExecutionContext = {
    workspacePath,
    chatMode: 'agent',
    requestId,
    skipMainApproval: true,
  }

  // 检查是否需要审批
  const approvalType = getToolApprovalType(toolCall.name)
  if (approvalType === 'terminal' || approvalType === 'dangerous') {
    const mainStoreState = useStore.getState()
    const isAutoApproved =
      mainStoreState.freeModeEnabled ||
      (approvalType === 'terminal' && mainStoreState.autoApprove?.terminal) ||
      (approvalType === 'dangerous' && mainStoreState.autoApprove?.dangerous)

    if (!isAutoApproved) {
      logger.agent.info(`[VoiceToolLoop] Tool ${toolCall.name} skipped (requires approval in voice mode)`)
      return {
        role: 'tool',
        content: '此操作需要用户确认，请在文字对话模式中执行，或在设置中开启自动批准。',
        tool_call_id: toolCall.id,
        name: toolCall.name,
      }
    }
  }

  try {
    const result = await toolManager.execute(toolCall.name, toolCall.arguments, context)

    if (result.success) {
      const output = typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
      logger.agent.info(`[VoiceToolLoop] Tool ${toolCall.name} executed successfully`)
      return {
        role: 'tool',
        content: output || '工具执行成功（无输出）',
        tool_call_id: toolCall.id,
        name: toolCall.name,
      }
    } else {
      const errorOutput = result.error || '工具执行失败'
      logger.agent.warn(`[VoiceToolLoop] Tool ${toolCall.name} failed: ${errorOutput}`)
      return {
        role: 'tool',
        content: `错误: ${errorOutput}`,
        tool_call_id: toolCall.id,
        name: toolCall.name,
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.agent.error(`[VoiceToolLoop] Tool ${toolCall.name} exception: ${errorMsg}`)
    return {
      role: 'tool',
      content: `错误: ${errorMsg}`,
      tool_call_id: toolCall.id,
      name: toolCall.name,
    }
  }
}

/**
 * 语音对话 LLM 工具调用循环
 *
 * 流程：
 * 1. 调用 LLM（带工具定义）
 * 2. 如果 LLM 返回工具调用 → 执行工具 → 结果反馈到 LLM → 继续循环
 * 3. 如果 LLM 没有工具调用 → 返回最终文本（用于 TTS）
 * 4. 达到最大迭代次数 → 返回当前文本
 *
 * @param options 配置选项
 * @returns 最终文本内容和工具调用统计
 */
export async function runVoiceToolLoop(options: VoiceToolLoopOptions): Promise<VoiceToolLoopResult> {
  const {
    config,
    messages,
    systemPrompt,
    workspacePath,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    onTextChunk,
    abortSignal,
  } = options

  // 确保工具系统已初始化（失败也不阻塞，只是没有工具可用）
  await ensureVoiceToolsInitialized()

  // 获取可用工具列表（与普通对话完全相同）
  const tools = toolManager.getAllToolDefinitions()
  if (tools.length === 0) {
    logger.agent.warn('[VoiceToolLoop] No tools available, LLM will respond without tool support')
  } else {
    logger.agent.info(
      `[VoiceToolLoop] Available tools: ${tools.length} (${tools.slice(0, 5).map(t => t.name).join(', ')}${tools.length > 5 ? '...' : ''})`,
    )
  }

  let totalToolCallsCount = 0
  let iteration = 0
  let lastContent = ''

  while (iteration < maxIterations) {
    if (abortSignal?.aborted) {
      return { content: lastContent, toolCallsCount: totalToolCallsCount, error: 'Aborted' }
    }

    iteration++
    const requestId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    logger.agent.info(
      `[VoiceToolLoop] Iteration ${iteration}, messages=${messages.length}, tools=${tools.length}`,
    )

    const result = await callLLMWithTools(
      config,
      messages,
      tools,
      systemPrompt,
      requestId,
      onTextChunk,
    )

    if (result.error) {
      logger.agent.warn(`[VoiceToolLoop] LLM error on iteration ${iteration}: ${result.error}`)
      return {
        content: result.content || lastContent,
        toolCallsCount: totalToolCallsCount,
        error: result.error,
      }
    }

    lastContent = result.content

    // 没有工具调用 → 循环结束，返回最终文本
    if (result.toolCalls.length === 0) {
      logger.agent.info(`[VoiceToolLoop] Loop complete after ${iteration} iterations, tool calls: ${totalToolCallsCount}`)
      return { content: result.content, toolCallsCount: totalToolCallsCount }
    }

    totalToolCallsCount += result.toolCalls.length

    // 构建 assistant 消息（包含 tool_calls）
    const assistantMsg: LLMMessage = {
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    }
    messages.push(assistantMsg)

    logger.agent.info(
      `[VoiceToolLoop] Executing ${result.toolCalls.length} tool calls: ${result.toolCalls.map(tc => tc.name).join(', ')}`,
    )

    // 并行执行工具调用
    const toolPromises = result.toolCalls.map(tc =>
      executeVoiceToolCall(tc, workspacePath, requestId),
    )
    const toolResults = await Promise.all(toolPromises)

    // 将工具结果添加到消息历史
    for (const toolResult of toolResults) {
      messages.push(toolResult)
    }

    // 继续下一轮 LLM 调用（工具结果已反馈，LLM 将基于结果生成回复）
  }

  logger.agent.warn(`[VoiceToolLoop] Max iterations (${maxIterations}) reached`)
  return {
    content: lastContent,
    toolCallsCount: totalToolCallsCount,
    error: `达到最大迭代次数 (${maxIterations})`,
  }
}

// ==================== 工具函数 ====================

/** 解析工具参数 JSON 字符串，失败时返回空对象 */
function parseToolArgs(argsString: string): Record<string, unknown> {
  if (!argsString) return {}
  try {
    return JSON.parse(argsString)
  } catch {
    return {}
  }
}

/** 更新或插入工具调用到列表（按 id 去重） */
function upsertToolCall(
  list: CollectedToolCall[],
  id: string,
  name: string,
  args: Record<string, unknown>,
): void {
  const existingIdx = list.findIndex(t => t.id === id)
  const toolCall = { id, name, arguments: args }
  if (existingIdx === -1) {
    list.push(toolCall)
  } else {
    list[existingIdx] = toolCall
  }
}
