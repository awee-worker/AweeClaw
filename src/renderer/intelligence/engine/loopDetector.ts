import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { performanceMonitor, withRetry, isRetryableError } from '@toolkit'
import { useAgentStore } from '../state/IntelligenceStore'
import { useStore } from '@store'
import { toolManager, initializeToolProviders, setToolLoadingContext, initializeTools } from '@intelligence/toolkit'
import { getAgentConfig, READ_TOOLS } from '@intelligence/utils/intelligenceConfig'
import { LoopDetector } from '@intelligence/utils/CycleDetector'
import { getReadOnlyTools, isFileEditTool } from '@configuration/toolDefinitions'
import { pathStartsWith, joinPath } from '@shared/toolkit/pathHelper'
import { createStreamProcessor } from './streamProcessor'
import { orchestrateToolBatch as executeTools } from './toolOrchestrator'
import { EventBus } from './EventDispatcher'
import { estimateMessagesTokens } from '../capabilities/context/ContextCompressor'
import { lintService } from '../runtime/codeAnalysisService'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { resolveRelativeChangePath, isFileWriteToolResult } from '@intelligence/utils/fileMutationHelper'
import { isCodeFile } from '@intelligence/toolkit/fileReadPolicies'
import { composerService } from '@intelligence/runtime/composerEngine'
import { agentHarness } from '../harness'
import type { Span } from '../harness/observability/Trace'
import type { TokenBudgetController } from '../capabilities/budget/TokenQuotaManager'
import type { LintCheckFile, ChatMessage, AssistantMessage, InteractiveContent, FormContent, ToolCall } from '@intelligence/providerTypes'
import type { LLMMessage } from '@intelligence/providerTypes'
import type { WorkMode } from '@/renderer/modes/workModeTypes'
import type { LLMConfig, LLMCallResult, ExecutionContext, LoopCheckResult } from '@intelligence/providerTypes'
import type { AssistantPart } from '../types/conversationModel'
import { pickLocalizedText, translateAgentText } from '@intelligence/utils/intelligenceTextUtils'
import { checkAndHandleCompression as runCompressionCheck } from './contextOptimizer'
import { t, type Language } from '@renderer/i18n'

function getLocalizedText(language: Language, zh: string, en: string): string {
  return pickLocalizedText(zh, en, language as 'en' | 'zh')
}

function translate(language: Language, key: Parameters<typeof translateAgentText>[0], params?: Record<string, string | number>): string {
  return translateAgentText(key, params, language as 'en' | 'zh')
}

function formatCycleAlertMessage(language: Language, cycleCheck: LoopCheckResult): string {
  const details = cycleCheck.details
  if (!details) {
    return cycleCheck.reason || cycleCheck.warning || translate(language, 'agent.loop.generic')
  }

  switch (details.category) {
    case 'exact_repeat':
      return translate(language, 'agent.loop.exactRepeat', {
        tool: details.toolName || 'tool',
        count: details.count || 0,
      })
    case 'same_tool_warning':
      return translate(language, 'agent.loop.sameToolWarning', {
        tool: details.toolName || 'tool',
        count: details.count || 0,
      })
    case 'same_target_warning':
      return cycleCheck.warning || cycleCheck.reason || translate(language, 'agent.loop.generic')
    case 'content_cycle':
      return translate(language, 'agent.loop.contentCycle', {
        target: details.target || '',
        count: details.count || 0,
        states: Math.max(1, details.threshold || 0),
      })
    case 'pattern_loop':
      return translate(language, 'agent.loop.patternLoop', {
        pattern: details.pattern || '',
      })
    case 'semantic_loop':
      return cycleCheck.warning || cycleCheck.reason || translate(language, 'agent.loop.generic')
    default:
      return cycleCheck.reason || cycleCheck.warning || translate(language, 'agent.loop.generic')
  }
}

function formatCycleMitigationAdvice(language: Language, cycleCheck: LoopCheckResult): string | undefined {
  const details = cycleCheck.details
  switch (details?.category) {
    case 'exact_repeat':
      return translate(language, 'agent.loop.suggestion.exactRepeat')
    case 'same_tool_warning':
      return translate(language, 'agent.loop.suggestion.sameToolWarning')
    case 'same_target_warning':
      if (language === 'zh') {
        return '你可能已经从之前的读取中获取了所需信息，尝试基于已有信息继续。如果确实需要最新数据，请说明原因。'
      }
      return 'You likely already have the information from previous reads. Try proceeding with what you know. If you truly need fresh data, explain why.'
    case 'content_cycle':
      return translate(language, 'agent.loop.suggestion.contentCycle')
    case 'pattern_loop':
      return translate(language, 'agent.loop.suggestion.patternLoop')
    case 'semantic_loop':
      if (language === 'zh') {
        return '你正在对少量目标反复执行相似操作。请回顾已获取的信息，考虑是否可以合并操作或换一种方式推进任务。'
      }
      return 'You are repeatedly performing similar operations on few targets. Review what you already know and consider combining operations or trying a different approach.'
    default:
      return cycleCheck.suggestion
  }
}

function buildThresholdInterventionMessage(language: Language, title: string, detail: string, suggestion?: string, cycleCheck?: LoopCheckResult): string {
  const severity = cycleCheck?.details?.severity || 'high'
  const isWarning = !cycleCheck?.isLoop

  if (language === 'zh') {
    const lines: string[] = [
      `系统${isWarning ? '提醒' : '警告'}: ${title}`,
      detail,
    ]
    if (suggestion) lines.push(`建议: ${suggestion}`)

    if (severity === 'low') {
      lines.push(
        '这是一个温和的提醒，你仍然可以继续操作，但请注意避免重复。',
        '请评估是否已有足够信息来推进任务，如果已有，请直接继续。',
      )
    } else if (severity === 'medium' || isWarning) {
      lines.push(
        '请仔细考虑是否需要继续使用相同的工具和参数。',
        '如果你确实需要继续，请换一种方式或使用不同的参数。',
        '如果已有足够信息，请直接基于当前信息给出结论或下一步方案。',
      )
    } else {
      lines.push(
        '你本轮接下来禁止继续调用任何工具。',
        '不要中止会话，也不要把这次限制当作致命错误。',
        '请基于当前已有信息直接完成收束。',
        '优先输出当前结论、已完成内容、缺失信息，或更高效的下一步方案。',
      )
    }

    return lines.filter(Boolean).join('\n')
  }

  const lines: string[] = [
    `System ${isWarning ? 'notice' : 'warning'}: ${title}`,
    detail,
  ]
  if (suggestion) lines.push(`Suggestion: ${suggestion}`)

  if (severity === 'low') {
    lines.push(
      'This is a gentle reminder — you may still proceed, but please avoid unnecessary repetition.',
      'Evaluate whether you already have enough information to move forward. If so, proceed directly.',
    )
  } else if (severity === 'medium' || isWarning) {
    lines.push(
      'Please carefully consider whether you need to continue using the same tool with the same arguments.',
      'If you must continue, try a different approach or different arguments.',
      'If you already have enough information, provide your conclusion or next step directly.',
    )
  } else {
    lines.push(
      'You must not call any more tools in this turn.',
      'Do not abort the conversation and do not treat this limit as a fatal error.',
      'Finish by concluding with the information already available.',
      'Prioritize the current conclusion, completed work, missing information, or a more efficient next step.',
    )
  }

  return lines.filter(Boolean).join('\n')
}

function formatCycleDiagnosticReport(language: Language, cycleCheck?: LoopCheckResult): string {
  const details = cycleCheck?.details
  if (!details) return ''

  const lines: string[] = []
  if (language === 'zh') {
    lines.push('诊断信息:')
    lines.push(`- 类型: ${details.category}`)
    if (details.severity) lines.push(`- 严重程度: ${details.severity}`)
    if (details.toolName) lines.push(`- 工具: ${details.toolName}`)
    if (typeof details.count === 'number') lines.push(`- 次数: ${details.count}`)
    if (typeof details.threshold === 'number') lines.push(`- 阈值: ${details.threshold}`)
    if (details.target) lines.push(`- 目标: ${details.target}`)
    if (details.pattern) lines.push(`- 模式: ${details.pattern}`)
  } else {
    lines.push('Diagnostics:')
    lines.push(`- Category: ${details.category}`)
    if (details.severity) lines.push(`- Severity: ${details.severity}`)
    if (details.toolName) lines.push(`- Tool: ${details.toolName}`)
    if (typeof details.count === 'number') lines.push(`- Count: ${details.count}`)
    if (typeof details.threshold === 'number') lines.push(`- Threshold: ${details.threshold}`)
    if (details.target) lines.push(`- Target: ${details.target}`)
    if (details.pattern) lines.push(`- Pattern: ${details.pattern}`)
  }

  return lines.join('\n')
}

function invokeModePostProcessor(
  mode: WorkMode,
  context: Parameters<import('@configuration/agentProfile').ModePostProcessHook>[0]
): ReturnType<import('@configuration/agentProfile').ModePostProcessHook> {
  const agentConfig = getAgentConfig()
  const hookConfig = agentConfig.modePostProcessHooks?.[mode]

  if (!hookConfig?.enabled || !hookConfig.hook) {
    return null
  }

  try {
    return hookConfig.hook(context)
  } catch (error) {
    logger.agent.error(`[Loop] Mode post-process hook error for ${mode}:`, error)
    return null
  }
}

async function invokeModelCall(
  config: LLMConfig,
  messages: LLMMessage[],
  assistantId: string | null,
  threadStore: import('../state/IntelligenceStore').ThreadBoundStore,
  requestId: string,
  tools: import('@protocols/modelGateway').ToolDefinition[],
  options?: { allowToolCalls?: boolean; abortSignal?: AbortSignal }
): Promise<LLMCallResult> {
  performanceMonitor.start(`llm:${config.model}`, 'llm', { provider: config.provider, messageCount: messages.length })

  const llmHandler = async (): Promise<LLMCallResult> => {
    const processor = createStreamProcessor(assistantId, threadStore, requestId, options)

    let span: Span | null = null
    if (agentHarness.isInitialized) {
      span = agentHarness.observability.startSpan('llm.call', requestId, undefined, {
        provider: config.provider,
        model: config.model,
        messageCount: messages.length,
      })
    }

    try {
      await api.llm.send({
        config: config as import('@shared/protocols/modelGateway').LLMConfig,
        messages: messages as LLMMessage[],
        tools,
        systemPrompt: '',
        requestId,
      })

      const result = await processor.wait()
      performanceMonitor.end(`llm:${config.model}`, !result.error)

      if (span) {
        agentHarness.observability.endSpan(span, result.error ? 'error' : 'ok')
      }

      if (assistantId && result.usage) {
        useAgentStore.getState().updateMessage(assistantId, {
          usage: result.usage,
        } as Partial<AssistantMessage>)
      } else if (assistantId && !result.usage) {
        logger.agent.warn('[Loop] No usage data in LLM result')
      }

      if (assistantId && result.reasoning) {
        useAgentStore.getState().updateMessage(assistantId, {
          reasoning: result.reasoning,
        } as Partial<AssistantMessage>)
      }

      processor.cleanup()
      return result
    } catch (error) {
      if (span) {
        agentHarness.observability.endSpan(span, 'error')
      }
      processor.cleanup()
      logger.agent.error('[Loop] Error in invokeModelCall:', error)
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  let pipelineResult: LLMCallResult | null = null

  if (agentHarness.isInitialized) {
    try {
      await agentHarness.llmPipeline.execute(
        {
          messages,
          config,
        },
        async () => {
          pipelineResult = await llmHandler()
          return {
            content: pipelineResult.content ?? undefined,
            toolCalls: pipelineResult.toolCalls as unknown[] ?? undefined,
            usage: pipelineResult.usage ?? undefined,
            error: pipelineResult.error ?? undefined,
          }
        },
        { provider: config.provider, model: config.model, requestId }
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes('Circuit breaker')) {
        logger.agent.error('[Loop] LLM circuit breaker is open, failing fast')
        return { error: 'LLM service temporarily unavailable (circuit breaker open). Please wait and try again.' }
      }
      return { error: error instanceof Error ? error.message : String(error) }
    }

    if (pipelineResult) return pipelineResult
  }

  return llmHandler()
}

async function invokeModelCallWithRetry(
  config: LLMConfig,
  messages: LLMMessage[],
  assistantId: string | null,
  threadStore: import('../state/IntelligenceStore').ThreadBoundStore,
  abortSignal?: AbortSignal,
  requestId?: string,
  tools: import('@protocols/modelGateway').ToolDefinition[] = [],
  options?: { allowToolCalls?: boolean }
): Promise<LLMCallResult> {
  const retryConfig = getAgentConfig()
  const reqId = requestId || crypto.randomUUID()

  try {
    return await withRetry(
      async () => {
        if (abortSignal?.aborted) throw new Error('Aborted')

        let snapshot: { content: string; parts: AssistantPart[]; toolCalls: ToolCall[] } | null = null
        if (assistantId) {
          const msg = threadStore.getMessages().find(m => m.id === assistantId)
          if (msg?.role === 'assistant') {
            const assistantMsg = msg as AssistantMessage
            snapshot = {
              content: assistantMsg.content,
              parts: [...(assistantMsg.parts || [])],
              toolCalls: [...(assistantMsg.toolCalls || [])],
            }
          }
        }

        try {
          const result = await invokeModelCall(config, messages, assistantId, threadStore, reqId, tools, {
            ...options,
            abortSignal,
          })
          if (result.error) {
            const errorMsg = result.error.toLowerCase()
            const isToolParseError = errorMsg.includes('tool call parse')
              || errorMsg.includes('invalid input for tool')
              || errorMsg.includes('type validation failed')

            if (isToolParseError) {
              logger.agent.warn('[Loop] Tool parse error, will be handled in loop:', result.error)
              return result
            }

            const err = new Error(result.error) as Error & { retryable?: boolean }
            err.retryable = result.retryable
            throw err
          }

          return result
        } catch (err) {
          if (assistantId && snapshot) {
            threadStore.updateMessage(assistantId, snapshot)
          }
          throw err
        }
      },
      {
        maxRetries: retryConfig.maxRetries,
        initialDelayMs: retryConfig.retryDelayMs,
        backoffMultiplier: retryConfig.retryBackoffMultiplier,
        abortSignal,
        isRetryable: error => {
          const msg = error instanceof Error ? error.message : String(error)
          if (msg === 'Aborted') return false
          const retryableError = error instanceof Error ? error as Error & { retryable?: boolean } : null
          if (retryableError?.retryable === true) return true
          if (retryableError?.retryable === false) return false
          return isRetryableError(error)
        },
        onRetry: (attempt, error, delay) => {
          logger.agent.info(`[Loop] LLM retry ${attempt}, waiting ${delay}ms...`, error)
          threadStore.setStreamState({ retryAttempt: attempt, retryDelay: delay, waitPhase: 'connecting' })
        },
      }
    )
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

interface AutoFixResult {
  content: string
  files: LintCheckFile[]
}

async function detectLintIssues(toolCalls: ToolCall[], workspacePath: string): Promise<AutoFixResult | null> {
  const writeToolCalls = toolCalls.filter(tc => !READ_TOOLS.includes(tc.name))
  if (writeToolCalls.length === 0) return null

  const editedFiles = writeToolCalls
    .filter(tc => isFileEditTool(tc.name))
    .map(tc => {
      const path = (tc.arguments.path as string) || ''
      return pathStartsWith(path, workspacePath) ? path : joinPath(workspacePath, path)
    })
    .filter(path => !path.endsWith('/'))

  if (editedFiles.length === 0) return null

  const uniqueEditedFiles = Array.from(new Set(editedFiles))
  const lintResults = await lintService.getLintErrorsForFiles(uniqueEditedFiles, true)
  const allFiles: LintCheckFile[] = []

  for (const filePath of uniqueEditedFiles) {
    const result = lintResults.get(filePath)
    const errorItems = (result?.errors || []).filter(e => e.severity === 'error')
    allFiles.push({
      filePath,
      errors: errorItems.map(e => ({
        severity: e.severity as 'error' | 'warning',
        message: e.message,
        line: e.startLine ?? 1,
      })),
    })
  }

  const filesWithErrors = allFiles.filter(f => f.errors.length > 0)
  if (filesWithErrors.length === 0) return null

  const lines = filesWithErrors.map(f => {
    const errLines = f.errors.map(e => `  [${e.severity}] Line ${e.line}: ${e.message}`).join('\n')
    return `File: ${f.filePath}\n${errLines}`
  })

  return {
    content: `Auto-check detected lint errors in ${filesWithErrors.length} file(s). Please fix them:\n\n${lines.join('\n\n')}`,
    files: allFiles,
  }
}

export async function executeAgentCycle(
  config: LLMConfig,
  llmMessages: LLMMessage[],
  context: ExecutionContext,
  assistantId: string,
  budgetController?: TokenBudgetController
): Promise<void> {
  const store = useAgentStore.getState()
  const mainStore = useStore.getState()

  const threadId = context.threadId || store.currentThreadId
  if (!threadId) {
    logger.agent.error('[Loop] No thread ID available')
    return
  }

  const threadStore = store.forThread(threadId)
  const agentConfig = getAgentConfig()
  const maxIterations = mainStore.agentConfig.maxToolLoops || agentConfig.maxToolLoops
  const enableAutoFix = mainStore.agentConfig.enableAutoFix
  const enableLLMSummary = mainStore.agentConfig.enableLLMSummary
  const autoHandoff = mainStore.agentConfig.autoHandoff ?? agentConfig.autoHandoff
  const contextLimit = config.contextLimit || 128_000
  const requestId = context.requestId || crypto.randomUUID()

  threadStore.setExecutionMeta({
    requestId,
    assistantId,
    planTaskId: context.planTaskId,
    loopState: 'running',
  })
  threadStore.setStreamState({ requestId, assistantId, waitPhase: 'connecting', streamStartTime: Date.now() })

  initializeToolProviders()
  await initializeTools()

  const activeScenarioId = useStore.getState().activeScenarioId
  const activeScenario = scenarioRegistry.getActive()
  const scenarioToolPacks = activeScenario?.capabilities?.toolPacks

  setToolLoadingContext({
    mode: context.chatMode,
    templateId: useStore.getState().promptTemplateId,
    planPhase: context.chatMode === 'plan' ? context.planPhase : undefined,
    scenarioId: activeScenarioId,
    scenarioToolPacks,
  })

  const agentTools = toolManager.getAllToolDefinitions()
  const loopDetector = new LoopDetector()
  let iteration = 0
  let shouldContinue = true
  threadStore.setStreamState({ waitPhase: 'waiting_model' })

  const concludeWithThresholdIntervention = async (
    title: string,
    detail: string,
    suggestion?: string,
    loopCheck?: LoopCheckResult
  ): Promise<void> => {
    const { language } = useStore.getState()
    const diagnosticText = formatCycleDiagnosticReport(language, loopCheck)

    llmMessages.push({
      role: 'user',
      content: [buildThresholdInterventionMessage(language, title, detail, suggestion, loopCheck), diagnosticText]
        .filter(Boolean)
        .join('\n\n'),
    })

    const finalResult = await invokeModelCallWithRetry(
      config,
      llmMessages,
      assistantId,
      threadStore,
      context.abortSignal,
      requestId,
      [],
      { allowToolCalls: false }
    )

    if (finalResult.error) {
      logger.agent.error('[Loop] Soft-limit recovery failed:', finalResult.error)
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'error',
        title: getLocalizedText(language, '模型错误', 'Model Error'),
        message: finalResult.error,
      })
      threadStore.updateExecutionMeta({ loopState: 'failed' })
      EventBus.emit({ type: 'loop:end', reason: 'error', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      return
    }

    threadStore.updateExecutionMeta({ loopState: 'completed' })
    EventBus.emit({ type: 'loop:end', reason: 'complete', threadId, assistantId, requestId, planTaskId: context.planTaskId })
  }

  const prunePendingToolInvocations = (toolCallsToClear?: Array<{ id: string }>) => {
    if (!assistantId) return

    const assistantMessage = threadStore.getMessages().find(m => m.id === assistantId)
    if (assistantMessage?.role !== 'assistant') return

    const pendingIds = new Set((toolCallsToClear || []).map(tc => tc.id))
    threadStore.updateMessage(assistantId, {
      parts: assistantMessage.parts.filter(part =>
        part.type !== 'tool_call'
        || (!pendingIds.has(part.toolCall.id) && !['pending', 'running', 'awaiting'].includes(part.toolCall.status))
      ),
      toolCalls: (assistantMessage.toolCalls || []).filter(tc =>
        !pendingIds.has(tc.id) && !['pending', 'running', 'awaiting'].includes(tc.status)
      ),
    })
  }

  EventBus.emit({ type: 'loop:start', threadId, assistantId, requestId, planTaskId: context.planTaskId })

  let loopSpan: Span | null = null
  if (agentHarness.isInitialized) {
    loopSpan = agentHarness.observability.startSpan('agent.loop', requestId, undefined, {
      mode: context.chatMode,
      workspacePath: context.workspacePath,
    })
  }

  while (shouldContinue && iteration < maxIterations && !context.abortSignal?.aborted) {
    iteration++
    shouldContinue = false
    EventBus.emit({ type: 'loop:iteration', count: iteration, threadId, assistantId, requestId, planTaskId: context.planTaskId })

    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    if (llmMessages.length === 0) {
      const { language } = useStore.getState()
      logger.agent.error('[Loop] No messages to send')
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'error',
        title: getLocalizedText(language, '请求异常', 'Request Error'),
        message: getLocalizedText(language, '当前没有可发送给模型的消息。', 'No messages were available to send to the model.'),
      })
      threadStore.updateExecutionMeta({ loopState: 'failed' })
      EventBus.emit({ type: 'loop:end', reason: 'no_messages', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    threadStore.setStreamState({ waitPhase: 'waiting_model', iterationIndex: iteration })

    const result = await invokeModelCallWithRetry(
      config,
      llmMessages,
      assistantId,
      threadStore,
      context.abortSignal,
      requestId,
      agentTools
    )

    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    if (result.error) {
      const errorMsg = result.error.toLowerCase()
      const isToolParseError = errorMsg.includes('tool call parse')
        || errorMsg.includes('invalid input for tool')
        || errorMsg.includes('type validation failed')

      if (isToolParseError) {
        const { language } = useStore.getState()
        logger.agent.warn('[Loop] Tool parse error, adding as feedback:', result.error)

        llmMessages.push({
          role: 'user',
          content: t('ai.toolcallerrorpleasefix', language as Language, { error: result.error }),
        })

        shouldContinue = true
        continue
      }

      const { language, cloudMode, isAuthenticated } = useStore.getState()
      logger.agent.error('[Loop] LLM error:', result.error, {
        configCloudMode: config.cloudMode,
        storeCloudMode: cloudMode,
        isAuthenticated,
        hasAccessToken: !!config.accessToken,
        accessTokenLength: config.accessToken?.length || 0,
        hasRefreshToken: !!config.refreshToken,
        isChannel: context.isChannel,
      })

      // 错误类型分类
      const errText = result.error || ''

      // 类型1: 客户端 accessToken 失效（错误不含 "LLM API returned"，说明不是后端上游 LLM 报错）
      // 这类错误可以通过刷新 accessToken 解决
      const isClientTokenAuthError = config.cloudMode && cloudMode === 'cloud' && !errText.includes('LLM API returned') && (
        errText.includes('API_KEY_INVALID') ||
        errText.includes('Invalid API key') ||
        errText.includes('API Key 无效') ||
        errText.includes('认证') ||
        /(?:^|\s|:|\-|_)401(?:\s|$|:)/.test(errText) ||
        /(?:^|\s)unauthorized(?:\s|$)/i.test(errText) ||
        /(?:^|\s)forbidden(?:\s|$)/i.test(errText) ||
        /status[:\s]+(?:401|403)/i.test(errText) ||
        /http[:\s]+(?:401|403)/i.test(errText)
      )

      // 类型2: 后端上游 LLM API key 失效（错误含 "LLM API returned 401" 或 "Invalid API Key"）
      // 这类错误客户端无法修复——后端管理员需要更新 provider 的 API key
      const isUpstreamApiKeyError = errText.includes('LLM API returned') && (
        /LLM API returned 401/.test(errText) ||
        /LLM API returned 403/.test(errText) ||
        /Invalid API Key/.test(errText) ||
        /invalid_key/.test(errText)
      )

      // 类型3: 可重试的网络/服务器错误
      const isRetryableNetworkError = config.cloudMode && cloudMode === 'cloud' && (
        /timeout|timed?\s*out|etimedout|econnreset|econnrefused|fetch failed|network|503|502|500/i.test(errText)
      )

      // 类型4: 云端认证错误（兼容旧判断）
      const isCloudAuthError = isClientTokenAuthError || isUpstreamApiKeyError

      logger.agent.info('[Loop] Error classification:', {
        isClientTokenAuthError,
        isUpstreamApiKeyError,
        isRetryableNetworkError,
        isCloudAuthError,
        errPreview: errText.substring(0, 200),
      })

      // 只对客户端 token 错误和可重试网络错误触发重试
      // 后端上游 API key 失效是后端配置问题，重试不会成功
      let cloudAuthRecovered = false
      if (isClientTokenAuthError || (isRetryableNetworkError && !isUpstreamApiKeyError)) {
        try {
          const { getEffectiveLLMConfigAsync } = await import('@services/modelConfigHelper')
          logger.agent.info(`[Loop] Cloud error (tokenAuth=${isClientTokenAuthError}, network=${isRetryableNetworkError}), refreshing config and retrying`)
          const refreshedConfig = await getEffectiveLLMConfigAsync(config)
          logger.agent.info('[Loop] Cloud refresh result:', {
            refreshedCloudMode: refreshedConfig.cloudMode,
            hasAccessToken: !!refreshedConfig.accessToken,
            accessTokenLength: refreshedConfig.accessToken?.length || 0,
            tokenChanged: refreshedConfig.accessToken !== config.accessToken,
            hasRefreshToken: !!refreshedConfig.refreshToken,
          })
          if (refreshedConfig.cloudMode) {
            // 用刷新后的 config 重试（即使 token 没变，重试可能成功，因为可能是临时网络问题）
            const newConfig = {
              ...config,
              accessToken: refreshedConfig.accessToken || config.accessToken,
              refreshToken: refreshedConfig.refreshToken || config.refreshToken,
              serverUrl: refreshedConfig.serverUrl || config.serverUrl,
            }
            if (refreshedConfig.accessToken !== config.accessToken) {
              logger.agent.info('[Loop] Cloud error, token refreshed, retrying with new token')
            } else {
              logger.agent.info('[Loop] Cloud error, retrying with refreshed config (token unchanged)')
            }
            const retryResult = await invokeModelCallWithRetry(
              newConfig, llmMessages, assistantId, threadStore, context.abortSignal, requestId, agentTools
            )
            if (!retryResult.error) {
              // 重试成功，用重试结果替换原始错误结果，继续正常循环
              result.content = retryResult.content
              result.reasoning = retryResult.reasoning
              result.toolCalls = retryResult.toolCalls
              result.sources = retryResult.sources
              result.usage = retryResult.usage
              result.error = undefined
              result.retryable = undefined
              cloudAuthRecovered = true
            } else {
              logger.agent.warn('[Loop] Cloud retry still failed:', retryResult.error)
            }
          } else {
            logger.agent.warn('[Loop] Refreshed config is not in cloud mode, cannot retry')
          }
        } catch (retryErr) {
          logger.agent.warn('[Loop] Cloud token refresh failed:', retryErr)
        }
      } else if (isUpstreamApiKeyError) {
        logger.agent.error('[Loop] Upstream LLM API key invalid - backend admin needs to update the provider API key. Client-side token refresh cannot fix this.')
      }

      // 未恢复时，显示错误提示并终止循环
      if (!cloudAuthRecovered) {
        if (isCloudAuthError) {
          if (isUpstreamApiKeyError) {
            // 后端上游 LLM API key 失效 - 客户端无法修复
            if (context.isChannel) {
              threadStore.addSystemAlertPart(assistantId, {
                alertType: 'error',
                title: getLocalizedText(language, '服务暂不可用', 'Service Unavailable'),
                message: getLocalizedText(language, '服务暂时不可用，请稍后重试。', 'The service is temporarily unavailable. Please try again later.'),
              })
            } else {
              threadStore.addSystemAlertPart(assistantId, {
                alertType: 'error',
                title: getLocalizedText(language, '云端 LLM 配置异常', 'Cloud LLM Configuration Error'),
                message: getLocalizedText(
                  language,
                  '云端 LLM 服务的 API Key 已失效或配置错误，请联系管理员检查后端 Provider 配置。\n\n原始错误：' + (result.error || 'Unknown'),
                  'The cloud LLM service API key is invalid or misconfigured. Please contact the administrator to check the backend provider configuration.\n\nOriginal error: ' + (result.error || 'Unknown')
                ),
              })
            }
          } else if (isClientTokenAuthError) {
            // 客户端 accessToken 失效 - 渠道消息用通用提示，桌面端引导重新登录
            if (context.isChannel) {
              threadStore.addSystemAlertPart(assistantId, {
                alertType: 'error',
                title: getLocalizedText(language, '服务暂不可用', 'Service Unavailable'),
                message: getLocalizedText(language, '服务暂时不可用，请稍后重试。', 'The service is temporarily unavailable. Please try again later.'),
              })
            } else {
              threadStore.addSystemAlertPart(assistantId, {
                alertType: 'error',
                title: getLocalizedText(language, '登录已过期', 'Session Expired'),
                message: getLocalizedText(language, '您的云端登录已过期，请重新登录后继续。点击左下角头像进行登录。', 'Your cloud session has expired. Please sign in again to continue. Click the avatar in the bottom left to sign in.'),
              })
            }
          } else {
            // 其他云端认证错误
            if (context.isChannel) {
              threadStore.addSystemAlertPart(assistantId, {
                alertType: 'error',
                title: getLocalizedText(language, '服务暂不可用', 'Service Unavailable'),
                message: getLocalizedText(language, '服务暂时不可用，请稍后重试。', 'The service is temporarily unavailable. Please try again later.'),
              })
            } else {
              threadStore.addSystemAlertPart(assistantId, {
                alertType: 'error',
                title: getLocalizedText(language, '登录已过期', 'Session Expired'),
                message: getLocalizedText(language, '您的云端登录已过期，请重新登录后继续。点击左下角头像进行登录。', 'Your cloud session has expired. Please sign in again to continue. Click the avatar in the bottom left to sign in.'),
              })
            }
          }
        } else {
          // 基于后端错误码做差异化 UI 提示
          const errorCode = result.errorCode
          const errorSuggestion = result.errorSuggestion

          if (errorCode === 'MODEL_NO_VISION') {
            // 模型不支持图片 → 静默等待（后端已自动路由到视觉模型）
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'info',
              title: getLocalizedText(language, '图片处理中', 'Processing Image'),
              message: getLocalizedText(language, '当前模型不支持图片识别，系统已自动使用视觉模型分析图片内容，请稍等...', 'The current model does not support image recognition. The system is automatically analyzing the image with a vision model. Please wait...'),
              suggestion: errorSuggestion,
              compact: true,
            })
          } else if (errorCode === 'VISION_MODEL_FAILED') {
            // 视觉模型处理失败 → 提示配置问题
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'error',
              title: getLocalizedText(language, '视觉模型异常', 'Vision Model Error'),
              message: result.error || getLocalizedText(language, '视觉模型分析图片失败', 'Vision model failed to process the image'),
              suggestion: errorSuggestion || getLocalizedText(language, '请前往后台管理 → 系统配置，检查视觉模型配置是否正确', 'Please go to Admin Panel → System Config to check the vision model configuration'),
              action: { label: getLocalizedText(language, '前往设置', 'Go to Settings'), actionType: 'open-settings' },
            })
          } else if (errorCode === 'INVALID_API_KEY') {
            // API Key 无效 → 弹窗引导用户去设置
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'error',
              title: getLocalizedText(language, 'API Key 配置异常', 'API Key Configuration Error'),
              message: result.error || getLocalizedText(language, 'API Key 无效或已过期', 'API Key is invalid or expired'),
              suggestion: errorSuggestion || getLocalizedText(language, '请前往后台管理 → AI 服务商，更新对应的 API Key', 'Please go to Admin Panel → AI Providers to update the API Key'),
              action: { label: getLocalizedText(language, '前往设置', 'Go to Settings'), actionType: 'open-settings' },
            })
          } else if (errorCode === 'QUOTA_EXCEEDED') {
            // 额度不足 → 提示充值
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'error',
              title: getLocalizedText(language, 'API 额度不足', 'Quota Exceeded'),
              message: result.error || getLocalizedText(language, 'API 额度已用完', 'API quota has been exhausted'),
              suggestion: errorSuggestion || getLocalizedText(language, '请前往模型服务商平台查看账户余额和用量', 'Please check your account balance and usage on the provider platform'),
            })
          } else if (errorCode === 'RATE_LIMITED') {
            // 频率限制 → 提示稍后重试
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'warning',
              title: getLocalizedText(language, '请求频率过高', 'Rate Limited'),
              message: result.error || getLocalizedText(language, '请求频率过高，请稍后重试', 'Request rate limit exceeded. Please try again later.'),
              suggestion: errorSuggestion || getLocalizedText(language, '建议等待 30 秒后再试', 'Please wait 30 seconds and try again'),
              action: { label: getLocalizedText(language, '重试', 'Retry'), actionType: 'retry' },
            })
          } else if (errorCode === 'CONTEXT_TOO_LONG') {
            // 上下文过长 → 提示缩短内容
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'warning',
              title: getLocalizedText(language, '对话内容过长', 'Context Too Long'),
              message: result.error || getLocalizedText(language, '对话内容超出模型上下文限制', 'Conversation exceeds model context limit'),
              suggestion: errorSuggestion || getLocalizedText(language, '请尝试：1) 减少图片数量 2) 缩短对话历史 3) 开启新对话', 'Try: 1) Reduce images 2) Shorten history 3) Start a new chat'),
            })
          } else if (errorCode === 'MODEL_NOT_FOUND') {
            // 模型不存在 → 提示更换模型
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'error',
              title: getLocalizedText(language, '模型不存在', 'Model Not Found'),
              message: result.error || getLocalizedText(language, '模型不存在或已下线', 'Model not found or discontinued'),
              suggestion: errorSuggestion || getLocalizedText(language, '请前往后台管理 → 系统配置，更换其他可用模型', 'Please go to Admin Panel → System Config to switch models'),
              action: { label: getLocalizedText(language, '切换模型', 'Switch Model'), actionType: 'switch-model' },
            })
          } else if (errorCode === 'PROVIDER_UNAVAILABLE') {
            // 服务商不可用 → 提示稍后重试
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'error',
              title: getLocalizedText(language, '服务商不可用', 'Provider Unavailable'),
              message: result.error || getLocalizedText(language, 'AI 服务商暂时不可用', 'AI provider is temporarily unavailable'),
              suggestion: errorSuggestion || getLocalizedText(language, '服务商可能正在维护，请稍后重试或切换其他服务商', 'The provider may be under maintenance. Please try again later or switch to another provider.'),
              action: { label: getLocalizedText(language, '重试', 'Retry'), actionType: 'retry' },
            })
          } else {
            // 通用错误 → 重试按钮
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'error',
              title: getLocalizedText(language, '模型错误', 'Model Error'),
              message: result.error || 'Unknown error',
              suggestion: errorSuggestion,
              action: { label: getLocalizedText(language, '重试', 'Retry'), actionType: 'retry' },
            })
          }
        }
        threadStore.updateExecutionMeta({ loopState: 'failed' })
        EventBus.emit({ type: 'loop:end', reason: 'error', threadId, assistantId, requestId, planTaskId: context.planTaskId })
        break
      }
      // cloudAuthRecovered === true: result 已更新为成功结果，继续正常处理
    }

    const usageData = Array.isArray(result.usage) ? result.usage[0] : result.usage

    if (usageData && usageData.totalTokens > 0) {
      const usage = {
        input: usageData.promptTokens || 0,
        output: usageData.completionTokens || 0,
      }

      const compressionResult = await runCompressionCheck(
        usage,
        contextLimit,
        threadStore,
        threadId,
        context,
        assistantId,
        enableLLMSummary,
        autoHandoff,
        budgetController
      )

      if (compressionResult.needsHandoff) {
        threadStore.updateExecutionMeta({ loopState: 'completed' })
        EventBus.emit({ type: 'loop:end', reason: 'handoff_required', threadId, assistantId, requestId, planTaskId: context.planTaskId })
        break
      }
    } else {
      logger.agent.warn('[Loop] No valid usage data from LLM, using estimated tokens')

      const estimatedTokens = estimateMessagesTokens(llmMessages as ChatMessage[])
      const usage = {
        input: Math.floor(estimatedTokens * 0.9),
        output: Math.floor(estimatedTokens * 0.1),
      }

      if (assistantId) {
        store.updateMessage(assistantId, {
          usage: {
            promptTokens: usage.input,
            completionTokens: usage.output,
            totalTokens: usage.input + usage.output,
          },
        } as Partial<AssistantMessage>)
      }

      const compressionResult = await runCompressionCheck(
        usage,
        contextLimit,
        threadStore,
        threadId,
        context,
        assistantId,
        enableLLMSummary,
        autoHandoff,
        budgetController
      )

      if (compressionResult.needsHandoff) {
        threadStore.updateExecutionMeta({ loopState: 'completed' })
        EventBus.emit({ type: 'loop:end', reason: 'handoff_required', threadId, assistantId, requestId, planTaskId: context.planTaskId })
        break
      }
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
      const hookResult = invokeModePostProcessor(context.chatMode, {
        mode: context.chatMode,
        messages: llmMessages,
        hasWriteOps: llmMessages.some(m => {
          const readOnlyTools = getReadOnlyTools()
          if (m.role !== 'assistant') return false
          const assistantMsg = m as AssistantMessage
          return assistantMsg.toolCalls?.some(tc => !readOnlyTools.includes(tc.name)) ?? false
        }),
        hasSpecificTool: (toolName: string) => llmMessages.some(m => {
          if (m.role !== 'assistant') return false
          const assistantMsg = m as AssistantMessage
          return assistantMsg.toolCalls?.some(tc => tc.name === toolName) ?? false
        }),
        iteration,
        maxIterations,
      })

      if (hookResult?.shouldContinue && hookResult.reminderMessage) {
        llmMessages.push({ role: 'user', content: hookResult.reminderMessage })
        shouldContinue = true
        continue
      }

      threadStore.updateExecutionMeta({ loopState: 'completed' })
      EventBus.emit({ type: 'loop:end', reason: 'complete', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    if (result.content) {
      loopDetector.signalProgress()
    }
    const loopDetectionEnabled = useStore.getState().agentConfig?.loopDetection?.enabled
    if (loopDetectionEnabled === false) {
      // skip
    } else {
      const loopCheck = loopDetector.checkLoop(result.toolCalls)
      if (loopCheck.isLoop) {
        const { language } = useStore.getState()
        const loopTitle = getLocalizedText(language, '检测到循环执行', 'Loop Detected')
        const cycleMessage = formatCycleAlertMessage(language, loopCheck)
        const cycleAdvice = formatCycleMitigationAdvice(language, loopCheck)

        logger.agent.warn(`[Loop] Loop detected: ${loopCheck.reason}`)
        prunePendingToolInvocations(result.toolCalls)
        threadStore.addSystemAlertPart(assistantId, {
          alertType: 'warning',
          title: loopTitle,
          message: cycleMessage,
          suggestion: cycleAdvice,
          compact: true,
        })
        EventBus.emit({ type: 'loop:warning', message: cycleMessage, threadId, assistantId, requestId, planTaskId: context.planTaskId })
        await concludeWithThresholdIntervention(loopTitle, cycleMessage, cycleAdvice, loopCheck)
        break
      }

      if (loopCheck.warning) {
        const { language } = useStore.getState()
        const warningTitle = getLocalizedText(language, '循环预警', 'Loop Warning')
        const warningMessage = formatCycleAlertMessage(language, loopCheck)
        const warningSuggestion = formatCycleMitigationAdvice(language, loopCheck)

        logger.agent.warn(`[Loop] Non-blocking loop warning: ${loopCheck.warning}`)
        prunePendingToolInvocations(result.toolCalls)
        threadStore.addSystemAlertPart(assistantId, {
          alertType: 'warning',
          title: warningTitle,
          message: warningMessage,
          suggestion: warningSuggestion,
          compact: true,
        })
        EventBus.emit({ type: 'loop:warning', message: warningMessage, threadId, assistantId, requestId, planTaskId: context.planTaskId })

        llmMessages.push({
          role: 'user',
          content: [
            buildThresholdInterventionMessage(language, warningTitle, warningMessage, warningSuggestion, loopCheck),
            formatCycleDiagnosticReport(language, loopCheck),
          ].filter(Boolean).join('\n\n'),
        })

        shouldContinue = true
        continue
      }
    }

    const assistantLLMMsg: LLMMessage = {
      role: 'assistant',
      content: result.content || (result.reasoning ? ' ' : null),
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    }
    if (result.reasoning) {
      assistantLLMMsg.reasoning_content = result.reasoning
    }
    llmMessages.push(assistantLLMMsg)

    const { results: toolResults, userRejected } = await executeTools(
      result.toolCalls,
      {
        workspacePath: context.workspacePath,
        currentAssistantId: assistantId,
        assistantId,
        threadId,
        requestId,
        chatMode: context.chatMode,
        checkpointId: context.checkpointId,
      },
      threadStore,
      context.abortSignal
    )

    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    const waitingResult = toolResults.find(r => r.result.meta?.waitingForUser)
    if (waitingResult) {
      const interactive = waitingResult.result.meta?.interactive as InteractiveContent | undefined
      const form = waitingResult.result.meta?.form as FormContent | undefined
      if (interactive) {
        threadStore.setInteractive(assistantId, interactive)
      } else if (form) {
        threadStore.addFormPart(assistantId, form)
      } else {
        threadStore.finalizeAssistant(assistantId)
      }

      threadStore.setStreamPhase('idle')
      threadStore.setStreamState({ streamDetail: undefined })
      threadStore.updateExecutionMeta({ loopState: 'waiting_for_user' })
      EventBus.emit({ type: 'loop:end', reason: 'waiting_for_user', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    const stopLoopResult = toolResults.find(r => r.result.meta?.stopLoop)
    if (stopLoopResult) {
      threadStore.finalizeAssistant(assistantId)
      threadStore.setStreamPhase('idle')
      threadStore.setStreamState({ streamDetail: undefined })
      threadStore.updateExecutionMeta({ loopState: 'completed' })
      EventBus.emit({ type: 'loop:end', reason: 'tool_requested_stop', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    for (const { toolCall, result: toolResult } of toolResults) {
      llmMessages.push({
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: toolResult.content,
      })

      const success = !toolResult.content.startsWith('Error:')
      loopDetector.recordExecutedTool({
        name: toolCall.name,
        arguments: toolCall.arguments,
      }, success)

      const meta = toolResult.meta
      if (isFileWriteToolResult(toolCall.name, meta)) {
        if (typeof meta.postHash === 'string') {
          loopDetector.updateContentHashBySignature(meta.filePath, meta.postHash)
        } else if (typeof meta.newContent === 'string') {
          loopDetector.updateContentHash(meta.filePath, meta.newContent)
        }

        const relativePath = resolveRelativeChangePath(meta.filePath, context.workspacePath ?? null, meta.relativePath)

        // 只有代码文件才需要用户接受/拒绝，非代码文件（文档、配置等）自动接受
        if (!isCodeFile(meta.filePath)) {
          // 非代码文件：记录到 fileChangeHistory（标记为已接受），不进入待确认列表
          store.addPendingChange({
            filePath: meta.filePath,
            relativePath,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            changeType: meta.oldContent ? 'modify' : 'create',
            snapshot: {
              path: meta.filePath,
              content: (meta.oldContent as string) || null,
              timestamp: Date.now(),
            },
            newContent: typeof meta.newContent === 'string' ? meta.newContent : null,
            linesAdded: (meta.linesAdded as number) || 0,
            linesRemoved: (meta.linesRemoved as number) || 0,
          })
          // 立即自动接受（从 pendingChanges 移除，保留在 fileChangeHistory 中标记为 accepted）
          store.acceptChange(meta.filePath)
          // 同步清除编辑器的 diff 状态（若有该文件的 diff 视图打开）
          void composerService.acceptChange(meta.filePath)
          continue
        }

        store.addPendingChange({
          filePath: meta.filePath,
          relativePath,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          changeType: meta.oldContent ? 'modify' : 'create',
          snapshot: {
            path: meta.filePath,
            content: (meta.oldContent as string) || null,
            timestamp: Date.now(),
          },
          newContent: typeof meta.newContent === 'string' ? meta.newContent : null,
          linesAdded: (meta.linesAdded as number) || 0,
          linesRemoved: (meta.linesRemoved as number) || 0,
        })
      }
    }

    if (enableAutoFix && !userRejected && context.workspacePath) {
      const lintIssueReport = await detectLintIssues(result.toolCalls, context.workspacePath)
      if (lintIssueReport) {
        threadStore.addLintCheckPart(assistantId)
        threadStore.updateLintCheckPart(assistantId, {
          files: lintIssueReport.files,
          status: 'failed',
        })
        llmMessages.push({ role: 'user', content: lintIssueReport.content })
        shouldContinue = true
        threadStore.setStreamPhase('streaming')
        threadStore.setStreamState({ streamDetail: 'reasoning' })
        continue
      }
    }

    if (userRejected) {
      const { language } = useStore.getState()
      const rejectMsg = t('ai.theuserrejectedthetool', language as Language)
      llmMessages.push({ role: 'user', content: rejectMsg })
      shouldContinue = true
      threadStore.setStreamPhase('streaming')
      threadStore.setStreamState({ streamDetail: 'reasoning' })
      continue
    }

    shouldContinue = true
    threadStore.setStreamPhase('streaming')
    threadStore.setStreamState({ streamDetail: 'reasoning' })
  }

  if (iteration >= maxIterations) {
    // 自由模式：自动继续，无需用户点击"继续"按钮
    const freeModeEnabled = useStore.getState().freeModeEnabled
    if (freeModeEnabled) {
      logger.agent.info('[Loop] Free mode: auto-continue after max iterations')
      threadStore.updateExecutionMeta({ loopState: 'completed' })
      EventBus.emit({ type: 'loop:end', reason: 'max_iterations', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      // 延迟派发事件，等待 IntelligenceCore.finalizeExecution 清理 runningTasks 执行锁后再触发新一轮
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('chat-send-message', {
            detail: { content: '继续执行未完成的任务', messageId: '' }
          }))
        }, 100)
      }
    } else {
      const { language } = useStore.getState()
      const limitTitle = getLocalizedText(language, '达到工具调用上限', 'Tool Call Limit Reached')
      const limitMessage = getLocalizedText(language, '当前轮次已达到最大工具调用次数。', 'The agent reached the maximum tool call limit for this turn.')

      logger.agent.warn('[Loop] Reached maximum iterations')
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'warning',
        title: limitTitle,
        message: limitMessage,
        compact: true,
        action: {
          label: getLocalizedText(language, '继续', 'Continue'),
          actionType: 'continue',
        },
      })
      EventBus.emit({ type: 'loop:warning', message: 'Max iterations reached', threadId, assistantId, requestId, planTaskId: context.planTaskId })

      threadStore.updateExecutionMeta({ loopState: 'completed' })
      EventBus.emit({ type: 'loop:end', reason: 'max_iterations', threadId, assistantId, requestId, planTaskId: context.planTaskId })
    }
  }

  if (loopSpan) {
    agentHarness.observability.endSpan(loopSpan)
  }
}

// 适配 AgentRuntime 接口的包装函数
export async function runLoopAdapter(params: {
  config: LLMConfig
  llmMessages: LLMMessage[]
  context: ExecutionContext
  assistantId: string
  budgetController?: TokenBudgetController
}): Promise<void> {
  return executeAgentCycle(
    params.config,
    params.llmMessages,
    params.context,
    params.assistantId,
    params.budgetController
  )
}
