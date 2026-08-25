import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { toolManager, initializeToolProviders, setToolLoadingContext, initializeTools } from '@intelligence/toolkit'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { playNotificationSound } from '@utils/notificationSound'
import { getToolApprovalType, getToolDisplayName } from '@configuration/toolDefinitions'
import { getActiveCustomAgent, getAgentToolLoadingFields } from '@renderer-configuration/customAgentTools'
import { approvalService, requiresApprovalGate } from '@intelligence/engine/toolOrchestrator'
import type { LLMConfig, LLMMessage, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '@intelligence/providerTypes'

export interface SubLoopOptions {
  config: LLMConfig
  systemPrompt: string
  userMessage: string
  workspacePath: string | null
  maxIterations?: number
  abortSignal?: AbortSignal
}

export interface SubLoopResult {
  content: string
  iterations: number
  toolCallsCount: number
  error?: string
}

interface CollectedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

interface LLMCallResult {
  content: string
  reasoning: string
  toolCalls: CollectedToolCall[]
  error?: string
}

const DEFAULT_MAX_ITERATIONS = 15

let toolsInitialized = false

async function ensureToolsInitialized(): Promise<void> {
  if (toolsInitialized) return

  logger.agent.info('[AgentSubLoop] Initializing tools...')

  try {
    initializeToolProviders()
    await initializeTools()
    toolsInitialized = true

    const toolCount = toolManager.getAllToolDefinitions().length
    logger.agent.info(`[AgentSubLoop] Tools initialized: ${toolCount} tools available`)
  } catch (err) {
    logger.agent.error('[AgentSubLoop] Failed to initialize tools:', err)
    throw err
  }
}

/**
 * 每次执行时刷新工具加载上下文（场景/智能体可能在会话间切换）
 * 确保子智能体路径始终使用最新的智能体工具白名单
 */
function refreshToolLoadingContext(): void {
  const activeScenarioId = useStore.getState().activeScenarioId
  const activeScenario = scenarioRegistry.getActive()
  const scenarioToolPacks = activeScenario?.capabilities?.toolPacks

  // 自定义智能体工具白名单：激活了智能体时限制其可用工具
  const activeAgent = getActiveCustomAgent()
  const agentToolFields = getAgentToolLoadingFields(activeAgent)

  setToolLoadingContext({
    mode: 'agent',
    templateId: useStore.getState().promptTemplateId,
    scenarioId: activeScenarioId,
    scenarioToolPacks,
    ...agentToolFields,
  })
}

function callLLMWithTools(
  config: LLMConfig,
  messages: LLMMessage[],
  tools: ToolDefinition[],
  requestId: string
): Promise<LLMCallResult> {
  return new Promise((resolve) => {
    let fullContent = ''
    let fullReasoning = ''
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
      resolve({ content: fullContent, reasoning: fullReasoning, toolCalls, error })
    }

    const unsubStream = api.llm.onStream(requestId, (data) => {
      if (settled) return

      switch (data.type) {
        case 'text':
          if (data.content) {
            fullContent += data.content
          }
          break

        case 'reasoning':
          if (data.content) {
            fullReasoning += data.content
          }
          break

        case 'tool_call_start': {
          const toolId = data.id || `tc-${Date.now()}`
          const toolName = data.name || ''
          streamingToolCalls.set(toolId, { id: toolId, name: toolName, argsString: '' })
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
              try {
                const args = tc.argsString ? JSON.parse(tc.argsString) : {}
                const toolCall = { id: tc.id, name: tc.name, arguments: args }
                const existingIdx = toolCalls.findIndex(t => t.id === tc.id)
                if (existingIdx === -1) {
                  toolCalls.push(toolCall)
                } else {
                  toolCalls[existingIdx] = toolCall
                }
              } catch {
                const toolCall = { id: tc.id, name: tc.name, arguments: {} as Record<string, unknown> }
                const existingIdx = toolCalls.findIndex(t => t.id === tc.id)
                if (existingIdx === -1) {
                  toolCalls.push(toolCall)
                } else {
                  toolCalls[existingIdx] = toolCall
                }
              }
              streamingToolCalls.delete(tcId)
            }
          }
          break
        }

        case 'tool_call_available': {
          const tcId = data.id || ''
          const toolName = data.name || ''
          const args = (data.arguments || {}) as Record<string, unknown>
          if (tcId) {
            streamingToolCalls.delete(tcId)
          }
          const toolCall = { id: tcId, name: toolName, arguments: args }
          const existingIdx = toolCalls.findIndex(t => t.id === tcId)
          if (existingIdx === -1) {
            toolCalls.push(toolCall)
          } else {
            toolCalls[existingIdx] = toolCall
          }
          break
        }
      }
    })

    const unsubError = api.llm.onError(requestId, (err) => {
      if (settled) return
      doResolve(err.message || 'LLM error')
    })

    const unsubDone = api.llm.onDone(requestId, (data) => {
      if (settled) return

      if (typeof data?.reasoning === 'string' && data.reasoning.length >= fullReasoning.length) {
        fullReasoning = data.reasoning
      }

      doResolve()
    })

    const sendParams: Record<string, unknown> = {
      config: {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        protocol: config.protocol,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        topP: config.topP,
        topK: config.topK,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        stopSequences: config.stopSequences,
        maxRetries: config.maxRetries,
        toolChoice: config.toolChoice,
        parallelToolCalls: config.parallelToolCalls,
        headers: config.headers,
        openAICompatibilityProfile: config.openAICompatibilityProfile,
        enableThinking: config.enableThinking,
        thinkingBudget: config.thinkingBudget,
        reasoningEffort: config.reasoningEffort,
        providerOptions: config.providerOptions,
        cloudMode: config.cloudMode,
        serverUrl: config.serverUrl,
        accessToken: config.accessToken,
        contextLimit: config.contextLimit,
        timeout: config.timeout,
        seed: config.seed,
        logitBias: config.logitBias,
      },
      messages,
      requestId,
    }

    if (tools.length > 0) {
      sendParams.tools = tools
    }

    logger.agent.info(`[AgentSubLoop] Sending LLM request: model=${config.provider}/${config.model}, messages=${messages.length}, tools=${tools.length}`)

    api.llm.send(sendParams as any).catch((err) => {
      if (settled) return
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.agent.error(`[AgentSubLoop] api.llm.send failed: ${errMsg}`)
      doResolve(errMsg)
    })

    // 取消子任务超时限制，AI 执行不受时间限制
  })
}

async function executeToolCall(
  toolCall: CollectedToolCall,
  workspacePath: string | null,
  requestId: string
): Promise<{ role: string; content: string; name: string }> {
  const context: ToolExecutionContext = {
    workspacePath,
    chatMode: 'agent',
    requestId,
    skipMainApproval: true,
  }

  const approvalType = getToolApprovalType(toolCall.name)
  // 仅 terminal / dangerous 类型需要事前审批；
  // interaction 类型采用事后确认模式（像 VSCode/Trae），工具直接执行，
  // 执行成功后由 FileChangeCard 显示"接受/拒绝"按钮
  if (approvalType === 'terminal' || approvalType === 'dangerous') {
    // 统一复用 requiresApprovalGate，确保授权方式选择对子 Agent 同样生效
    const needsApproval = requiresApprovalGate(toolCall, 'agent')
    if (needsApproval) {
      const toolDisplayName = getToolDisplayName(toolCall.name)

      // 非自动化模式：走原有聊天卡片批准流程
      const agentStore = useAgentStore.getState()
      const activeThreadId = agentStore.currentThreadId
      logger.agent.info(`[AgentSubLoop] Tool needs approval: ${toolCall.name} (id=${toolCall.id}), requestId=${requestId}, activeThreadId=${activeThreadId}, approvalQueueSize=${approvalService.pendingCount}`)

      if (activeThreadId) {
        const pendingToolCall = {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          status: 'awaiting' as const,
          requestId,
        }
        // 追加到现有的 pendingApprovalToolCalls，避免并行工具调用时覆盖
        // 需要重新获取最新状态，因为并行工具调用可能已更新了 pendingApprovalToolCalls
        const freshStore = useAgentStore.getState()
        const existingPending = freshStore.threads[activeThreadId]?.streamState?.pendingApprovalToolCalls || []
        const updatedPending = [...existingPending, pendingToolCall]
        freshStore.setStreamState({
          phase: 'tool_pending',
          streamDetail: 'tool_awaiting',
          requestId,
          currentToolCall: pendingToolCall,
          pendingApprovalToolCalls: updatedPending,
          statusText: updatedPending.length > 1
            ? `Agent 请求执行 ${updatedPending.length} 个操作`
            : `Agent 请求执行: ${toolDisplayName}`,
        }, activeThreadId)
      }

      try {
        // 等待审批属于「需确认操作提醒」，用 approval 类型以正确匹配设置开关
        playNotificationSound('approval')
      } catch (e) { logger.ui.warn('Failed to play notification sound:', e) }

      logger.agent.info(`[AgentSubLoop] Waiting for approval: ${requestId}_${toolCall.id} (tool: ${toolCall.name})`)

      const approved = await approvalService.waitForApproval(`${requestId}_${toolCall.id}`)

      // 从 pendingApprovalToolCalls 中移除当前工具调用
      // 注意：需要重新获取最新状态，因为等待期间状态可能已被其他并行工具调用更新
      const latestStore = useAgentStore.getState()
      const latestThreadId = latestStore.currentThreadId
      if (latestThreadId) {
        const currentPending = latestStore.threads[latestThreadId]?.streamState?.pendingApprovalToolCalls || []
        const remainingPending = currentPending.filter(tc => tc.id !== toolCall.id)
        if (remainingPending.length > 0) {
          latestStore.setStreamState({
            pendingApprovalToolCalls: remainingPending,
            currentToolCall: remainingPending[0],
          }, latestThreadId)
        } else {
          // 所有待审批工具都已处理，恢复 streaming 状态
          latestStore.setStreamState({
            phase: 'streaming',
            streamDetail: 'tool_executing',
            currentToolCall: undefined,
            pendingApprovalToolCalls: undefined,
          }, latestThreadId)
        }
      }

      if (!approved) {
        logger.agent.info(`[AgentSubLoop] Tool ${toolCall.name} rejected by user`)
        return { role: 'tool', content: '用户拒绝了此操作', name: toolCall.name }
      }
    }
  }

  try {
    const result: ToolExecutionResult = await toolManager.execute(
      toolCall.name,
      toolCall.arguments,
      context
    )

    if (result.success) {
      const output = typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
      logger.agent.info(`[AgentSubLoop] Tool ${toolCall.name} executed successfully`)
      return { role: 'tool', content: output || 'Tool executed successfully (no output)', name: toolCall.name }
    } else {
      const errorOutput = result.error || 'Tool execution failed'
      logger.agent.warn(`[AgentSubLoop] Tool ${toolCall.name} failed: ${errorOutput}`)
      return { role: 'tool', content: `Error: ${errorOutput}`, name: toolCall.name }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.agent.error(`[AgentSubLoop] Tool ${toolCall.name} exception: ${errorMsg}`)
    return { role: 'tool', content: `Error: ${errorMsg}`, name: toolCall.name }
  }
}

export async function runAgentSubLoop(options: SubLoopOptions): Promise<SubLoopResult> {
  const {
    config,
    systemPrompt,
    userMessage,
    workspacePath,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    abortSignal,
  } = options

  logger.agent.info(`[AgentSubLoop] Starting sub-loop for task: ${userMessage.slice(0, 100)}...`)

  await ensureToolsInitialized()
  // 每次执行刷新工具加载上下文（智能体可能已切换）
  refreshToolLoadingContext()

  const agentTools = toolManager.getAllToolDefinitions()

  if (agentTools.length === 0) {
    logger.agent.warn('[AgentSubLoop] No tools available, agents will not be able to use tools')
  }

  logger.agent.info(`[AgentSubLoop] Available tools: ${agentTools.length} (${agentTools.slice(0, 5).map(t => t.name).join(', ')}${agentTools.length > 5 ? '...' : ''})`)

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  let totalToolCallsCount = 0
  let iteration = 0
  while (iteration < maxIterations) {
    if (abortSignal?.aborted) {
      return { content: '', iterations: iteration, toolCallsCount: totalToolCallsCount, error: 'Aborted' }
    }

    iteration++
    const requestId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    logger.agent.info(`[AgentSubLoop] Iteration ${iteration}, sending to LLM with ${messages.length} messages...`)

    const result = await callLLMWithTools(config, messages, agentTools, requestId)

    if (result.error) {
      logger.agent.warn(`[AgentSubLoop] LLM error on iteration ${iteration}: ${result.error}`)
      return {
        content: result.content || '',
        iterations: iteration,
        toolCallsCount: totalToolCallsCount,
        error: result.error,
      }
    }

    if (result.toolCalls.length === 0) {
      logger.agent.info(`[AgentSubLoop] No tool calls, loop complete after ${iteration} iterations`)
      return {
        content: result.content,
        iterations: iteration,
        toolCallsCount: totalToolCallsCount,
      }
    }

    totalToolCallsCount += result.toolCalls.length

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

    if (result.reasoning) {
      assistantMsg.reasoning_content = result.reasoning
    }

    messages.push(assistantMsg)

    logger.agent.info(
      `[AgentSubLoop] Executing ${result.toolCalls.length} tool calls: ${result.toolCalls.map(tc => tc.name).join(', ')}`
    )

    const toolPromises = result.toolCalls.map(tc =>
      executeToolCall(tc, workspacePath, requestId)
        .then(toolResult => ({
          tool_call_id: tc.id,
          ...toolResult,
        }))
    )
    const toolResults = await Promise.all(toolPromises)

    for (const toolResult of toolResults) {
      messages.push({
        role: 'tool' as const,
        content: toolResult.content,
        tool_call_id: toolResult.tool_call_id,
        name: toolResult.name,
      })
    }

    if (abortSignal?.aborted) {
      return { content: '', iterations: iteration, toolCallsCount: totalToolCallsCount, error: 'Aborted' }
    }
  }

  logger.agent.warn(`[AgentSubLoop] Max iterations (${maxIterations}) reached`)
  return {
    content: '',
    iterations: iteration,
    toolCallsCount: totalToolCallsCount,
    error: `Max iterations (${maxIterations}) reached`,
  }
}
