import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { performanceMonitor, withRetry, isRetryableError } from '@toolkit'
import { useAgentStore } from '../state/IntelligenceStore'
import { useStore } from '@store'
import { toolManager, initializeToolProviders, setToolLoadingContext, initializeTools } from '@intelligence/toolkit'
import { isExternalAgentToolsExposed } from '@intelligence/toolkit/externalAgentToolsGate'
import { getAgentConfig, READ_TOOLS } from '@intelligence/utils/intelligenceConfig'
import { LoopDetector } from '@intelligence/utils/CycleDetector'
import { getReadOnlyTools, isFileEditTool } from '@configuration/toolDefinitions'
import { pathStartsWith, joinPath } from '@shared/toolkit/pathHelper'
import { createStreamProcessor } from './streamProcessor'
import { orchestrateToolBatch as executeTools } from './toolOrchestrator'
import { EventBus } from './EventDispatcher'
import {
  scheduleAutoResume,
  resetAutoResumeCounter,
  resetFreeModeRounds,
  scheduleFreeModeContinuation,
} from './autoResume'
import { estimateMessagesTokens } from '../capabilities/context/ContextCompressor'
import { lintService } from '../runtime/codeAnalysisService'
import {
  drainSteers,
  buildSteerInstruction,
  resolveTaskId,
  createTakeoverSession,
} from '../runtime/deviceTaskControl'
import { drainLocalSteers, discardLocalSteers } from '../runtime/localSteer'
import { redactArgs } from '@shared/toolkit/redact'
import { checkAnswerGrounding } from '../verify/answerGrounding'
import {
  buildSelfCheckPrompt,
  selfCheckRound,
  DEFAULT_TASK_STEP_BUDGET,
  type SelfCheckStage,
} from '../decision/taskOutcome'
import {
  parseTakeoverError,
  TAKEOVER_ERROR_PREFIX,
  TAKEOVER_REASON_LABEL,
} from '../decision/takeoverClassifier'
import { createToolExpansionState } from './toolExpansion'
import {
  collectExecutionSignals,
  resolveExecutionRole,
  buildExecutionRoleSwitchMessage,
} from '../capabilities/role/executionRoleSwitch'
import { isRoleAgentEnabled } from '../capabilities/role/RoleDescriptor'
import { useRoleLibraryStore } from '@renderer/modes/roleLibraryStore'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getActiveCustomAgent, getAgentToolLoadingFields } from '@renderer-configuration/customAgentTools'
import { resolveSceneToolsIntentFromMessages, resolveGitToolsIntentFromMessages } from '../decision/intentResolvers'
import { resolveRelativeChangePath, isFileWriteToolResult } from '@intelligence/utils/fileMutationHelper'
import {
  isVisualUnsupportedError,
  messagesContainImages,
  stripImagesFromMessages,
  markVisionUnsupported,
  isVisionKnownUnsupported,
} from '@intelligence/utils/toolResultImages'
import { isCodeFile } from '@intelligence/toolkit/fileReadPolicies'
import { composerService } from '@intelligence/runtime/composerEngine'
import { agentHarness } from '../harness'
import type { Span } from '../harness/observability/Trace'
import type { TokenBudgetController } from '../capabilities/budget/TokenQuotaManager'
import type { LintCheckFile, ChatMessage, AssistantMessage, InteractiveContent, FormContent, ToolCall } from '@intelligence/providerTypes'
import type { LLMMessage } from '@intelligence/providerTypes'
import type { WorkMode } from '@/renderer/modes/workModeTypes'
import type { LLMConfig, LLMCallResult, ExecutionContext, LoopCheckResult } from '@intelligence/providerTypes'
import type { ExecutionPhase, ModelResolver } from '../runtime/modelRouter'
import type { ComplexityScore } from '../capabilities/planning/TaskComplexityDetector'
import type { AssistantPart } from '../types/conversationModel'
import { pickLocalizedText, translateAgentText } from '@intelligence/utils/intelligenceTextUtils'
import { checkAndHandleCompression as runCompressionCheck } from './contextOptimizer'
import {
  beginSessionTrace,
  finishSessionTrace,
  recordCompression,
  recordLoopInterception,
  recordTokenUsage,
  recordToolCall,
} from '../decision/eval/sessionTrajectory'
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

/**
 * 主循环轮次硬上限
 *
 * 正常收敛依赖「AI 主动收尾 + 循环检测 + 异常自动续接」，其中循环检测允许被
 * 用户在设置里关闭。三者同时失效时，模型可能持续「调用工具但无实质进展」而不收尾。
 * 这里保留一个足够宽松、正常任务几乎不会触及的硬上限作为最后兜底，到顶即强制
 * 走一次收尾（产出结论并停止继续调用工具），避免无终止地消耗额度。
 */
const MAX_LOOP_ITERATIONS = 200

/**
 * 单次用户请求内，lint 自动修复报告的连续回灌上限。
 * lint 结果改为静默回灌给模型后，界面上不再有卡片提示这一中间态，
 * 因此必须自己兜住「反复改不好、来回空转」的情况：超过次数就不再回灌，
 * 让这轮循环按正常流程收尾，而不是一直隐式续跑。
 */
const MAX_LINT_AUTO_FIX_ROUNDS = 3

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

        // 快照需覆盖本次请求期间会被流式改写的全部字段：只恢复 content/parts/toolCalls
        // 会把 reasoning 留在流式后的状态，导致消息上的推理文本与推理分段不一致。
        let snapshot: { content: string; parts: AssistantPart[]; toolCalls: ToolCall[]; reasoning?: string } | null = null
        if (assistantId) {
          const msg = threadStore.getMessages().find(m => m.id === assistantId)
          if (msg?.role === 'assistant') {
            const assistantMsg = msg as AssistantMessage
            snapshot = {
              content: assistantMsg.content,
              parts: [...(assistantMsg.parts || [])],
              toolCalls: [...(assistantMsg.toolCalls || [])],
              reasoning: assistantMsg.reasoning,
            }
          }
        }

        // 视觉兜底（1/2）：该模型此前已确认拒收图片，直接去图，不再每轮都先撞一次墙
        const knownNoVision = isVisionKnownUnsupported(config)
        const outboundMessages = knownNoVision ? stripImagesFromMessages(messages) : messages

        try {
          const result = await invokeModelCall(config, outboundMessages, assistantId, threadStore, reqId, tools, {
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

            // 视觉兜底（2/2）：模型拒收图片输入（本地直连常见）时去掉图片重试一次，
            // 让不支持看图的模型也能照常作答。成功后本模型记入缓存，后续轮次直接去图，
            // 把「多一次请求」的代价限制在首次探测上（见 toolResultImages）。
            if (
              !knownNoVision
              && isVisualUnsupportedError(result.error)
              && messagesContainImages(messages)
            ) {
              markVisionUnsupported(config)
              logger.agent.warn('[Loop] Model rejected image input, retrying without images:', result.error)
              const retryResult = await invokeModelCall(
                config,
                stripImagesFromMessages(messages),
                assistantId,
                threadStore,
                reqId,
                tools,
                { ...options, abortSignal },
              )
              return retryResult
            }

            // 非 tool parse 错误：直接返回 result，由主循环（第 611 行）基于 errorCode 做差异化 UI 提示
            // 不要 throw，否则 errorCode/errorSuggestion 信息会丢失，主循环的 QUOTA_EXCEEDED 等分支无法匹配
            return result
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

/* ------------------------------------------------------------------ */
/* 异常中断自动续接                                                   */
/* 实现已抽到 ./autoResume，供单 Agent 主循环与多 Agent 协作共用       */
/* （scheduleAutoResume / resetAutoResumeCounter / dispatchContinuation）*/
/* ------------------------------------------------------------------ */


export async function executeAgentCycle(
  config: LLMConfig,
  llmMessages: LLMMessage[],
  context: ExecutionContext,
  assistantId: string,
  budgetController?: TokenBudgetController,
  /**
   * 模型分级下沉的入口
   *
   * 不传时全程使用 config，行为与改造前逐字节一致。
   * 传入后按阶段解析，并在本次循环内缓存：同一阶段只解析一次，
   * 避免循环中途反复换模型把 prompt cache 打掉。
   */
  routing?: { resolver?: ModelResolver; complexity?: ComplexityScore }
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
  const enableAutoFix = mainStore.agentConfig.enableAutoFix
  // 本请求内 lint 报告已回灌给模型的次数，用于限制连续自动修复轮次
  let lintAutoFixRounds = 0
  const enableLLMSummary = mainStore.agentConfig.enableLLMSummary
  const autoHandoff = mainStore.agentConfig.autoHandoff ?? agentConfig.autoHandoff
  const contextLimit = config.contextLimit || 128_000
  const requestId = context.requestId || crypto.randomUUID()

  // 阶段 → 已解析配置。同一阶段在一次循环内只解析一次：
  // 反复切换会让 prompt cache 失效，成本反而高于保留主模型。
  const phaseConfigCache = new Map<ExecutionPhase, LLMConfig>()
  const resolvePhaseConfig = (phase: ExecutionPhase): LLMConfig => {
    if (!routing?.resolver) return config
    const cached = phaseConfigCache.get(phase)
    if (cached) return cached
    try {
      const resolved = routing.resolver(phase, { complexity: routing.complexity?.total ?? 0 })
      phaseConfigCache.set(phase, resolved)
      if (resolved.model !== config.model) {
        logger.agent.info(`[Loop] Phase "${phase}" uses ${resolved.provider}/${resolved.model}`)
      }
      return resolved
    } catch (err) {
      logger.agent.warn('[Loop] Model resolution failed, using main model:', err)
      phaseConfigCache.set(phase, config)
      return config
    }
  }

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

  // 会话轨迹采集：这里只登记缓冲，指标在会话结束时一次算出并交主进程落库
  beginSessionTrace(threadId, activeScenarioId)
  const scenarioToolPacks = activeScenario?.capabilities?.toolPacks
  const scenarioTools = activeScenario?.capabilities?.tools || []

  // 自定义智能体工具白名单：激活了智能体时限制其可用工具
  const activeAgent = getActiveCustomAgent()
  const agentToolFields = getAgentToolLoadingFields(activeAgent)

  setToolLoadingContext({
    mode: context.chatMode,
    templateId: useStore.getState().promptTemplateId,
    planPhase: context.chatMode === 'expert' ? context.planPhase : undefined,
    // 任务计划模式：与 planPhase='planning' 等价地收窄工具集（快速模式无工具调用能力，忽略）
    taskPlanMode: context.chatMode !== 'chat' && context.taskPlanMode === true,
    scenarioId: activeScenarioId,
    scenarioToolPacks,
    scenarioTools,
    isChannel: context.isChannel,
    // 场景工具按需暴露：仅当用户最新消息带有明确的场景数据记录/查询/管理意图时
    // 才对 LLM 可见；执行任务/开发时 AI 任务跟踪应使用系统内置 todo_write 等（致命问题 #4）
    sceneToolsEnabled: resolveSceneToolsIntentFromMessages(llmMessages).value,
    // Git 工具按需暴露：用户没有提出 Git 操作时不把 git_* 下发给 LLM。
    // 工作空间并非都是 Git 仓库，AI 自己「探路」（git_status / git_log）会稳定失败
    gitToolsEnabled: resolveGitToolsIntentFromMessages(llmMessages).value,
    externalAgentEnabled: isExternalAgentToolsExposed(),
    ...agentToolFields,
  })

  const agentTools = toolManager.getAllToolDefinitions()
  // 工具分层懒展开：未展开的组只发入口工具（见 toolExpansion）。
  // 状态按「一次执行」为粒度，任务结束即丢弃。
  const toolExpansion = createToolExpansionState(agentTools.map((t) => t.name))
  const loopDetector = new LoopDetector()
  let iteration = 0
  let shouldContinue = true
  /**
   * 任务步数预算
   *
   * 与 MAX_LOOP_ITERATIONS（200，纯安全兜底）不是一回事：那是「防止无界循环」的
   * 硬阀，这里是「这个任务大概给多少轮合适」。在预算的 50%、75% 各做一次自查，
   * 用尽时收窄工具只留「说明」—— 用户等 30 步换来一个失败，远差于第 8 步就
   * 被告知「这里要登录，我做不了」。
   */
  const stepBudget = context.stepBudget ?? DEFAULT_TASK_STEP_BUDGET
  const halfCheckRound = selfCheckRound(stepBudget, 'half')
  const threeQuarterCheckRound = selfCheckRound(stepBudget, 'threeQuarter')
  /** 预算用尽的轮次：这一轮不发工具，只要求文字收尾 */
  const finalRound = stepBudget
  let halfCheckDone = false
  let threeQuarterCheckDone = false
  /**
   * 计划阶段纠偏是否已用掉。
   *
   * 计划阶段的工具集已收窄到「建计划 + 只读取证」，但模型仍可能读完资料后
   * 直接输出一段文字方案了事 —— 用户选的是「任务计划模式」，要的是可确认、
   * 可分派的计划，不是一段自由文本。这里只纠偏一次：给足机会，也避免
   * 模型反复不服从时把循环拖成死转。
   */
  let planStageNudged = false
  /**
   * 执行期专家切换记录
   *
   * 一轮任务可能经过多个工种，但切换必须收敛：
   * 已切过的角色不再参与判定（避免 A→B→A 来回跳），总量也有上限，
   * 超过后模型已带着完整上下文，继续换人设只会打散注意力。
   */
  const switchedRoleIds: string[] = context.activeRoleId ? [context.activeRoleId] : []
  const MAX_EXECUTION_ROLE_SWITCHES = 4
  let roleSwitchRounds = 0
  threadStore.setStreamState({ waitPhase: 'waiting_model' })

  /**
   * 插话生效：把它按「此刻」嵌进助手消息
   *
   * 不写成独立的用户消息：那会被追加到消息列表末尾，而 AI 的后续输出继续写进同
   * 一条助手消息，视觉上就成了 AI 先说完、才看到用户的补充，因果颠倒。作为 part
   * 插在当前位置后，后续文本自然另起一段落在它下方。
   *
   * 也不再额外弹一条「已采纳」提示：卡片本身就出现在插话该出现的地方，那就是
   * 最直接的证据，再加一条系统提示只是噪音。
   */
  const recordAdoptedSteers = (texts: string[]) => {
    for (const text of texts) {
      if (!text) continue
      threadStore.addUserSteerPart(assistantId, text)
    }
  }


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
      // 区分「用户主动停止」与「异常中断」：此前一律提示「模型错误」且无续接入口，
      // 与其他中断分支不一致，用户看到 AI 无提示停下（连「继续」按钮都没有）。
      const aborted = Boolean(context.abortSignal?.aborted)
        || /aborted|abort|已取消|已中止|interrupt/i.test(finalResult.error)
      logger.agent.error('[Loop] Soft-limit recovery failed:', finalResult.error)
      threadStore.updateExecutionMeta({ loopState: aborted ? 'aborted' : 'failed' })
      threadStore.addSystemAlertPart(assistantId, {
        alertType: aborted ? 'warning' : 'error',
        title: aborted
          ? getLocalizedText(language, '执行已停止', 'Execution Stopped')
          : getLocalizedText(language, '模型错误', 'Model Error'),
        message: aborted
          ? getLocalizedText(language, '本次执行已中断，任务尚未完成。', 'This execution was interrupted before the task completed.')
          : finalResult.error,
        suggestion: getLocalizedText(language, '可点击继续以续接未完成的任务。', 'Click Continue to resume the unfinished task.'),
        action: { label: getLocalizedText(language, '继续', 'Continue'), actionType: 'continue' },
      })
      EventBus.emit({ type: 'loop:end', reason: aborted ? 'aborted' : 'error', threadId, assistantId, requestId, planTaskId: context.planTaskId })

      // 非用户主动停止的异常中断 → 自动续接（内部限次），避免用户被迫手动点「继续」
      if (!aborted) {
        scheduleAutoResume(threadId, 'soft-limit-recovery-failed')
      }
      return
    }

    threadStore.updateExecutionMeta({ loopState: 'completed' })
    EventBus.emit({ type: 'loop:end', reason: 'complete', threadId, assistantId, requestId, planTaskId: context.planTaskId })
  }

  /**
   * 以「被中止」收尾：更新 loopState 并给出明确提示。
   * 此前 abort 分支是静默 break —— 既无任何提示，loopState 还停留在 'running'，
   * 导致用户看到"AI 无原因自行中断"，且断点续接/状态判断均失准。
   */
  const concludeAsAborted = (): void => {
    const { language } = useStore.getState()
    logger.agent.warn('[Loop] Aborted, concluding with user-visible notice')
    resetAutoResumeCounter(threadId)
    resetFreeModeRounds(threadId)
    threadStore.updateExecutionMeta({ loopState: 'aborted' })
    threadStore.addSystemAlertPart(assistantId, {
      alertType: 'warning',
      title: getLocalizedText(language, '执行已停止', 'Execution Stopped'),
      message: getLocalizedText(language, '本次执行已中断，任务尚未完成。', 'This execution was interrupted before the task completed.'),
      suggestion: getLocalizedText(language, '可点击继续以续接未完成的任务。', 'Click Continue to resume the unfinished task.'),
      compact: true,
      action: { label: getLocalizedText(language, '继续', 'Continue'), actionType: 'continue' },
    })
    EventBus.emit({ type: 'loop:end', reason: 'aborted', threadId, assistantId, requestId, planTaskId: context.planTaskId })
  }

  const prunePendingToolInvocations = (toolCallsToClear?: Array<{ id: string }>) => {
    if (!assistantId) return

    // 流式预览是「工具声明」的界面投影，正常情况下由编排层在工具开始执行时清除。
    // 被循环检测拦下的调用不会进入执行阶段，编排层也就没有机会清它 —— 条目会一直
    // 停留在 toolStreamingPreviews 里，消息末位常驻一张永远 pending 的卡片（用户
    // 看到的「一直显示读取中」），其扫光动画还会让渲染进程回不到空闲帧。
    for (const tc of toolCallsToClear || []) {
      threadStore.clearToolStreamingPreview(tc.id)
    }

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

  // ⚠️ 循环条件刻意不包含 abortSignal 检查：abort 的回调只在 await 让出时执行，
  //    若把中止判定放在 while 条件里，一旦中止发生在循环体尾部（如工具执行完成后），
  //    条件会直接失败退出循环 —— 既不调用 concludeAsAborted()，也不发 loop:end，
  //    表现为「AI 无任何提示自行中断」且 loopState 卡在 running。
  //    中止判定统一放在循环体内（模型调用前后、工具执行后），确保总能收尾。
  // 轮次不设「工具调用次数」意义上的正常上限：循环主要由 AI 主动收尾（无工具调用即结束）、
  // 循环检测（CycleDetector）、用户中止与异常中断自动续接机制收敛；另设一个宽松的
  // MAX_LOOP_ITERATIONS 硬上限作为兜底（见循环体开头），防止软机制同时失效时无界循环。
  while (shouldContinue) {
    iteration++
    shouldContinue = false
    EventBus.emit({ type: 'loop:iteration', count: iteration, threadId, assistantId, requestId, planTaskId: context.planTaskId })

    // 硬上限兜底：软性收敛机制（循环检测）可被关闭，到顶即强制收尾，防止无界循环
    if (iteration > MAX_LOOP_ITERATIONS) {
      const { language } = useStore.getState()
      const limitTitle = getLocalizedText(language, '已达执行轮次上限', 'Iteration Limit Reached')
      const limitDetail = getLocalizedText(
        language,
        `本次执行已连续进行 ${MAX_LOOP_ITERATIONS} 轮，为安全起见停止继续调用工具。`,
        `This execution reached ${MAX_LOOP_ITERATIONS} consecutive rounds; tool calls were stopped for safety.`,
      )
      logger.agent.warn('[Loop] Hard iteration limit reached', { iteration, limit: MAX_LOOP_ITERATIONS })
      await concludeWithThresholdIntervention(limitTitle, limitDetail)
      break
    }

    if (context.abortSignal?.aborted) {
      concludeAsAborted()
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

    // 中途自查：预算过半 / 四分之三时各提醒一次，让模型有机会主动承认「走不通」，
    // 而不是把步数磕到上限才吐一个错误。提醒直接拼在本次请求里，不多花一轮。
    let selfCheckStage: SelfCheckStage | null = null
    if (!halfCheckDone && halfCheckRound !== null && iteration === halfCheckRound) {
      selfCheckStage = 'half'
      halfCheckDone = true
    } else if (
      !threeQuarterCheckDone &&
      threeQuarterCheckRound !== null &&
      iteration === threeQuarterCheckRound
    ) {
      selfCheckStage = 'threeQuarter'
      threeQuarterCheckDone = true
    }
    if (selfCheckStage) {
      const { language } = useStore.getState()
      logger.agent.info(`[Loop] Step self-check injected: ${selfCheckStage} (budget=${stepBudget}, iteration=${iteration})`)
      llmMessages.push({ role: 'user', content: buildSelfCheckPrompt(language, selfCheckStage) })
    }

    // 最后一轮：预算用尽就只给收尾通道 —— 不再发任何工具，要求文字写清做完了什么、
    // 卡在哪、下一步怎么做。继续发工具只会让用户在无望的尝试上多看几屏日志。
    const isFinalRound = iteration >= finalRound
    if (isFinalRound) {
      const { language } = useStore.getState()
      logger.agent.warn(`[Loop] Final budget round reached (budget=${stepBudget}), tools withheld`)
      llmMessages.push({ role: 'user', content: buildSelfCheckPrompt(language, 'final') })
    }

    // 每轮都是「执行」阶段：解析结果首轮确定后复用，循环内不再变动
    const result = await invokeModelCallWithRetry(
      resolvePhaseConfig('act'),
      llmMessages,
      assistantId,
      threadStore,
      context.abortSignal,
      requestId,
      isFinalRound ? [] : (toolExpansion.filter(agentTools) as typeof agentTools),
      isFinalRound ? { allowToolCalls: false } : undefined,
    )

    // 最后一轮就算模型仍报工具调用，也不执行：降级成文字收尾，避免预算形同虚设
    if (isFinalRound && (result.toolCalls?.length ?? 0) > 0) {
      logger.agent.warn('[Loop] Final round returned tool calls; discarding them and finishing with text')
      result.toolCalls = []
    }

    if (context.abortSignal?.aborted) {
      concludeAsAborted()
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
          } else if (errorCode === 'QUOTA_EXCEEDED' || errorCode === 'LLM_QUOTA_EXCEEDED') {
            // 额度不足 → 提示充值/升级套餐
            threadStore.addSystemAlertPart(assistantId, {
              alertType: 'error',
              title: getLocalizedText(language, 'API 额度不足', 'Quota Exceeded'),
              message: result.error || getLocalizedText(language, 'API 额度已用完', 'API quota has been exhausted'),
              suggestion: errorSuggestion || getLocalizedText(language, '请前往设置->云端服务查看账户余额和用量', 'Please go to Settings -> Cloud Service to check your account balance and usage'),
              actions: [
                { label: getLocalizedText(language, '重试', 'Retry'), actionType: 'retry' },
                { label: getLocalizedText(language, '升级套餐', 'Upgrade Plan'), actionType: 'upgrade' },
              ],
            })
          } else if (errorCode === 'RATE_LIMITED' || errorCode === 'API_RATE_LIMIT') {
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
            // 通用错误 → 重试按钮；若错误消息包含配额关键词，追加升级套餐按钮
            const errMsg = (result.error || '').toLowerCase()
            const isQuotaRelated = errMsg.includes('配额') || errMsg.includes('quota') || errMsg.includes('额度')
            // 识别"被意外中止"（非用户主动停止）场景：给出明确的中断说明 + 续接入口，
            // 而不是笼统的"模型错误"，避免用户以为 AI 无原因自行中断。
            const interrupted = /aborted|abort|已取消|已中止|interrupt/i.test(result.error || '')
            threadStore.addSystemAlertPart(assistantId, {
              alertType: interrupted ? 'warning' : 'error',
              title: interrupted
                ? getLocalizedText(language, '响应已中断', 'Response Interrupted')
                : getLocalizedText(language, '模型错误', 'Model Error'),
              message: result.error || 'Unknown error',
              suggestion: interrupted
                ? getLocalizedText(language, '响应被意外中止（非您主动停止），任务未完成。可点击继续以续接。', 'The response was aborted unexpectedly (not by you). The task is incomplete — click Continue to resume.')
                : errorSuggestion,
              actions: isQuotaRelated
                ? [
                    { label: getLocalizedText(language, '重试', 'Retry'), actionType: 'retry' },
                    { label: getLocalizedText(language, '升级套餐', 'Upgrade Plan'), actionType: 'upgrade' },
                  ]
                : undefined,
              action: interrupted
                ? { label: getLocalizedText(language, '继续', 'Continue'), actionType: 'continue' }
                : !isQuotaRelated
                  ? { label: getLocalizedText(language, '重试', 'Retry'), actionType: 'retry' }
                  : undefined,
            })

            // 非用户主动停止的「意外中止」→ 自动续接，避免用户看到 AI 无提示停下、
            // 也避免用户被迫手动点「继续」。（用户点停止时 abortSignal 已 aborted，
            // 早在上方 abort 检查处即走 concludeAsAborted 收尾，不会进入此分支。）
            if (interrupted && !context.abortSignal?.aborted) {
              scheduleAutoResume(threadId, 'error-interrupted')
            }
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

      recordTokenUsage(threadId, usage.input, usage.output)

      // 传入 llmMessages：压缩检查发现上下文超限（L2+）且 AI 仍要继续执行时，
      // 会就地清理较早的低价值工具结果，确保下一轮 LLM 请求不超限 ——
      // 压缩后 AI 直接基于压缩后的上下文继续执行，绝不中断主循环。
      // 压缩检查内部含摘要/上下文交接等重逻辑，失败不应中断主循环
      try {
        const compression = await runCompressionCheck(
          usage,
          contextLimit,
          threadStore,
          threadId,
          context,
          assistantId,
          enableLLMSummary,
          autoHandoff,
          budgetController,
          (result.toolCalls?.length ?? 0) > 0,
          llmMessages
        )
        recordCompression(threadId, compression.level)
      } catch (compressionErr) {
        logger.agent.warn('[Loop] Compression check failed, continuing main loop:', compressionErr)
      }
    } else {
      logger.agent.warn('[Loop] No valid usage data from LLM, using estimated tokens')

      const estimatedTokens = estimateMessagesTokens(llmMessages as ChatMessage[])
      const usage = {
        input: Math.floor(estimatedTokens * 0.9),
        output: Math.floor(estimatedTokens * 0.1),
      }

      recordTokenUsage(threadId, usage.input, usage.output)

      if (assistantId) {
        store.updateMessage(assistantId, {
          usage: {
            promptTokens: usage.input,
            completionTokens: usage.output,
            totalTokens: usage.input + usage.output,
          },
        } as Partial<AssistantMessage>)
      }

      // 传入 llmMessages：压缩检查发现上下文超限（L2+）且 AI 仍要继续执行时，
      // 会就地清理较早的低价值工具结果，确保下一轮 LLM 请求不超限 ——
      // 压缩后 AI 直接基于压缩后的上下文继续执行，绝不中断主循环。
      // 压缩检查内部含摘要/上下文交接等重逻辑，失败不应中断主循环
      try {
        const compression = await runCompressionCheck(
          usage,
          contextLimit,
          threadStore,
          threadId,
          context,
          assistantId,
          enableLLMSummary,
          autoHandoff,
          budgetController,
          (result.toolCalls?.length ?? 0) > 0,
          llmMessages
        )
        recordCompression(threadId, compression.level)
      } catch (compressionErr) {
        logger.agent.warn('[Loop] Compression check failed, continuing main loop:', compressionErr)
      }
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
      // 收尾接缝：模型打算以纯文本收尾，但用户可能刚插了话（本地会话或移动端）。
      // 先取空队列：有内容就不收尾，把话作为一条 user 消息推进去继续跑。
      // 这里不消耗 autoResume 额度 —— 用户主动说的话不该被限次。
      const closingSteers = await pullPendingSteers(requestId, threadId)
      if (closingSteers.length > 0) {
        logger.agent.info(`[Loop] Closing seam: injecting ${closingSteers.length} steer(s), continue instead of finishing`)
        const steerLanguage = useStore.getState().language === 'en' ? 'en' : 'zh'
        llmMessages.push({ role: 'user', content: buildSteerInstruction(closingSteers, steerLanguage) })
        recordAdoptedSteers(closingSteers)
        shouldContinue = true
        continue
      }

      // 计划阶段纠偏：本轮要求先建计划，模型却打算用纯文本收尾。
      // 这是「工具已收窄但模型不服从」的唯一出口 —— 不收尾，明确要求它调用
      // create_task_plan（只纠偏一次，见 planStageNudged）。
      const planStageActive = context.taskPlanMode === true || context.planPhase === 'planning'
      if (planStageActive && !planStageNudged && !context.abortSignal?.aborted) {
        const planAlreadyCreated = llmMessages.some((m) => {
          if (m.role !== 'assistant') return false
          const assistantMsg = m as AssistantMessage
          return assistantMsg.toolCalls?.some((tc) => tc.name === 'create_task_plan') ?? false
        })
        if (!planAlreadyCreated) {
          planStageNudged = true
          const { language } = useStore.getState()
          logger.agent.warn('[Loop] Plan stage: model tried to finish without create_task_plan, nudging once')
          llmMessages.push({
            role: 'user',
            content: language === 'zh'
              ? '【计划阶段硬性要求】你还未创建任务计划。本轮处于「任务计划模式 / 计划阶段」，不允许以纯文字方案收尾，也不能直接动手执行。\n请立即调用 `create_task_plan`：把任务拆成可执行子任务（每个子任务含标题、说明、必要时含依赖与建议角色），然后停下等待用户确认。\n注意：计划内容必须通过该工具提交，不要只在回复文字里复述计划。'
              : '【Plan stage requirement】No task plan has been created yet. This turn is in Task Plan mode — you may not finish with a text-only proposal, and you may not start executing.\nCall `create_task_plan` now: break the work into executable subtasks (title, description, dependencies and suggested role where relevant), then stop and wait for the user to confirm.\nSubmit the plan through the tool — do not merely restate it in prose.',
          })
          shouldContinue = true
          continue
        }
      }

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
      })

      if (hookResult?.shouldContinue && hookResult.reminderMessage) {
        llmMessages.push({ role: 'user', content: hookResult.reminderMessage })
        shouldContinue = true
        continue
      }

      // 完成判定只认「正文输出」：推理（reasoning）属于过程，不能当作"任务已完成"的依据。
      // 否则模型把输出额度全花在思考上（正文为空、finishReason=length）时会被判为正常完成，
      // 主循环直接收尾 —— 用户看到的就是"AI 思考几十秒后自行结束会话"。
      //
      // 三种收尾形态分别处理：
      // 1) 有正文 → 正常完成（下方逻辑）
      // 2) 只思考、无正文 → 判为未完成，说明原因并自动续接（限次）
      // 3) 完全无输出（流被截断/内容被过滤）→ 沿用原有「执行中断」提示
      const hasTextOutput = Boolean(result.content && result.content.trim())
      const hasReasoningOutput = Boolean(result.reasoning && result.reasoning.trim())
      if (!hasTextOutput) {
        const { language } = useStore.getState()
        // length：思考吃满了输出额度，正文没有空间产出（配置上体现为
        // 思考预算 ≥ 最大输出 tokens），这是最容易表现为"思考到一半就断"的形态
        const truncated = result.finishReason === 'length'
        logger.agent.warn('[Loop] Ended with no tool calls and no text output → treating as incomplete', {
          reason: truncated ? 'output-limit-reached' : (hasReasoningOutput ? 'reasoning-only' : 'no-output'),
          finishReason: result.finishReason,
          reasoningLength: result.reasoning?.length ?? 0,
        })

        threadStore.addSystemAlertPart(assistantId, hasReasoningOutput
          ? {
              alertType: 'warning',
              title: truncated
                ? getLocalizedText(language, '思考已达到输出上限', 'Thinking Hit the Output Limit')
                : getLocalizedText(language, '思考后未产出结果', 'No Result After Thinking'),
              message: truncated
                ? getLocalizedText(
                    language,
                    '本轮思考占满了模型的输出额度，正文没有产出，任务尚未完成。',
                    'This round spent the whole output budget on thinking, so no answer was produced and the task is unfinished.',
                  )
                : getLocalizedText(
                    language,
                    '模型只给出了思考过程，没有产生结果，任务尚未完成。',
                    'The model produced reasoning only, without a result; the task is unfinished.',
                  ),
              suggestion: truncated
                ? getLocalizedText(
                    language,
                    '可在「设置 → 模型 → 高级设置」调大「最大 Token」（或设为「不限」），或调低「思考 Token 预算」后点击继续。',
                    'In Settings → Model → Advanced, raise "Max Tokens" (or set it to "Unlimited") or lower the "Thinking Budget", then click Continue.',
                  )
                : getLocalizedText(language, '可直接点击继续，或重新发送以续接任务。', 'Click Continue, or resend to resume the task.'),
              action: { label: getLocalizedText(language, '继续', 'Continue'), actionType: 'continue' },
            }
          : {
              alertType: 'warning',
              title: getLocalizedText(language, '执行中断', 'Execution Interrupted'),
              message: getLocalizedText(language, 'AI 在未产生任何输出时中断了本次执行。', 'The AI stopped without producing any output.'),
              suggestion: getLocalizedText(language, '可直接点击继续，或重新发送以续接任务。', 'Click Continue, or resend to resume the task.'),
              action: { label: getLocalizedText(language, '继续', 'Continue'), actionType: 'continue' },
            })
        threadStore.updateExecutionMeta({ loopState: 'aborted' })
        EventBus.emit({ type: 'loop:end', reason: 'interrupted', threadId, assistantId, requestId, planTaskId: context.planTaskId })

        // 非用户意愿的收尾 → 自动续接（内部限次），避免用户看到 AI 无提示停下
        scheduleAutoResume(threadId, truncated ? 'output-limit' : 'interrupted')
        break
      }

      // 正文有输出、但撞上输出上限：这不是任务完成。用户看到的是一段写到一半的
      // 回复，按 completed 收尾就再没有补齐的机会了，必须显式告知并给出续接入口。
      if (result.finishReason === 'length' && hasTextOutput) {
        const { language } = useStore.getState()
        logger.agent.warn('[Loop] Text output reached the output limit → treating as incomplete', {
          finishReason: result.finishReason,
          contentLength: result.content?.length ?? 0,
        })

        threadStore.addSystemAlertPart(assistantId, {
          alertType: 'warning',
          title: getLocalizedText(language, '输出已达上限', 'Output Limit Reached'),
          message: getLocalizedText(
            language,
            '本轮回复在达到模型的最大输出 Token 后被截断，内容并不完整。',
            'This reply was cut off at the model\'s max output tokens, so it is incomplete.',
          ),
          suggestion: getLocalizedText(
            language,
            '可在「设置 → 模型 → 高级设置」调大「最大 Token」（或设为「不限」）后点击继续。',
            'Raise "Max Tokens" (or set it to "Unlimited") in Settings → Model → Advanced, then click Continue.',
          ),
          action: { label: getLocalizedText(language, '继续', 'Continue'), actionType: 'continue' },
        })
        threadStore.updateExecutionMeta({ loopState: 'aborted' })
        EventBus.emit({ type: 'loop:end', reason: 'truncated', threadId, assistantId, requestId, planTaskId: context.planTaskId })

        // 同「无正文」路径：非用户意愿的收尾自动续接（内部限次）
        scheduleAutoResume(threadId, 'output-limit')
        break
      }

      // 事实核对（B7）：回答里出现的路径、日期、URL、带小数数字，必须能在本任务
      // 读到的材料里找到原文。核对不上只标记「未确认」，照常交付 —— 拦死会让用户
      // 觉得 AI 又在啰嗦，最终所有人都去把这项关掉。
      if (result.content && result.content.trim()) {
        void (() => {
          try {
            const toolTexts = llmMessages
              .filter((m) => m.role === 'tool')
              .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
              .filter(Boolean)
            const hadToolCalls = llmMessages.some(
              (m) => m.role === 'assistant' && ((m as AssistantMessage).toolCalls?.length ?? 0) > 0,
            )
            const grounding = checkAnswerGrounding({
              answer: result.content as string,
              toolTexts,
              hadToolCalls,
            })
            if (grounding.checked && grounding.gaps.length > 0) {
              const { language } = useStore.getState()
              logger.agent.warn('[Loop] Answer grounding gaps found', { gaps: grounding.gaps.slice(0, 5) })
              threadStore.addSystemAlertPart(assistantId, {
                alertType: 'warning',
                title: getLocalizedText(language, '部分内容未确认', 'Some details are unconfirmed'),
                message: getLocalizedText(
                  language,
                  `以下内容未在本次读取的材料中找到依据：${grounding.gaps.slice(0, 5).join('、')}`,
                  `These details could not be traced back to the material read in this task: ${grounding.gaps.slice(0, 5).join(', ')}`,
                ),
                compact: true,
              })
            }
          } catch (groundingErr) {
            // 核对失败不影响交付
            logger.agent.warn('[Loop] Answer grounding failed:', groundingErr)
          }
        })()
      }


      resetAutoResumeCounter(threadId)
      // 任务收尾（有可见输出）→ 新一轮任务的自由模式轮次预算重新计数
      resetFreeModeRounds(threadId)
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
        // 被拦下的调用没有执行，但它们是绕路的直接证据，必须进轨迹
        recordLoopInterception(
          threadId,
          result.toolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments })),
        )
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
        recordLoopInterception(
          threadId,
          result.toolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments })),
        )
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

    // 工具编排整体加保护：orchestrateToolBatch 内部的文件快照、审批派发等步骤位于
    // 单工具 try/catch 之外，若抛出会直接窜出主循环 —— 越过尾部的终态兜底，
    // 表现为「AI 无提示停下」且 loopState 卡在 running。
    // 这里把编排级异常降级为工具错误结果回传给模型，让 AI 自行修正并继续推进主线。
    let toolResults: Awaited<ReturnType<typeof executeTools>>['results'] = []
    let userRejected = false
    try {
      const batchOutcome = await executeTools(
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
      toolResults = batchOutcome.results
      userRejected = batchOutcome.userRejected
    } catch (toolExecError) {
      const toolExecMessage = toolExecError instanceof Error ? toolExecError.message : String(toolExecError)
      logger.agent.error('[Loop] Tool orchestration threw, degrading to tool error results:', toolExecError)
      threadStore.setStreamPhase('streaming')
      // 工具编排异常后降级重发同样要等首包，不能提前标成「思考中」
      threadStore.setStreamState({ streamDetail: undefined })
      // 编排整体抛出时，之前已置为 running / awaiting 的卡片不会走任何单工具收口分支，
      // 必须在降级路径上补一个终态，否则用户会停在「执行中」。
      const orchestrationLanguage = useStore.getState().language as 'en' | 'zh'
      const orchestrationFallback = t('agent.tool.interruptedOrParseFailed', orchestrationLanguage)
      toolResults = result.toolCalls.map(tc => {
        threadStore.updateToolCall(assistantId, tc.id, {
          status: 'error',
          result: orchestrationFallback,
          streamingState: undefined,
          endTime: Date.now(),
          errorCode: 'ORCHESTRATION_ERROR',
        })
        return {
          toolCall: tc,
          result: { content: `Error: tool orchestration failed — ${toolExecMessage}` },
        }
      })
    }

    if (context.abortSignal?.aborted) {
      concludeAsAborted()
      break
    }

    // 本轮调用过的工具 → 展开所属组：下一轮构建工具列表时该组换回全量。
    // 传原始调用名（不是过滤后的列表），入口工具的调用同样会解锁整组。
    toolExpansion.noteCalls(result.toolCalls.map((tc) => tc.name))

    const waitingResult = toolResults.find(r => r.result.meta?.waitingForUser)
    if (waitingResult) {
      const interactive = waitingResult.result.meta?.interactive as InteractiveContent | undefined
      const form = waitingResult.result.meta?.form as FormContent | undefined
      const taskPlan = waitingResult.result.meta?.taskPlan as { planId?: string } | undefined
      if (interactive) {
        threadStore.setInteractive(assistantId, interactive)
      } else if (form) {
        threadStore.addFormPart(assistantId, form)
      } else if (taskPlan?.planId) {
        threadStore.addTaskPlanPart(assistantId, taskPlan.planId)
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

      // 与界面口径一致：命令/脚本跑完但报错属于业务结果，不算工具调用失败
      const success = !(toolResult.callFailed ?? toolResult.content.startsWith('Error:'))
      loopDetector.recordExecutedTool({
        name: toolCall.name,
        arguments: toolCall.arguments,
      }, success)
      recordToolCall(threadId, {
        name: toolCall.name,
        // 轨迹会落库并可能被导出，参数先脱敏；界面与模型仍用原始参数
        arguments: redactArgs(toolCall.name, toolCall.arguments) as Record<string, unknown> | undefined,
        isError: !success,
      })

      const meta = toolResult.meta
      if (isFileWriteToolResult(toolCall.name, meta)) {
        if (typeof meta.postHash === 'string') {
          loopDetector.updateContentHashBySignature(meta.filePath, meta.postHash)
        } else if (typeof meta.newContent === 'string') {
          loopDetector.updateContentHash(meta.filePath, meta.newContent)
        }

        const relativePath = resolveRelativeChangePath(meta.filePath, context.workspacePath ?? null, meta.relativePath)

        // 判断是否需要用户确认接受/拒绝：
        // 1. 手动审批（every-step）→ 一律进入待确认：写入已经在执行阶段放行，AI 继续往下走，
        //    由输入框上方的变更条决定保留还是撤销（新建文件同样可撤回，撤销即删除）
        // 2. 自动审批（dangerous-only）→ 只有编辑现有代码文件需要确认，文档与新建文件自动接受
        // 3. 完全访问（never）→ 自动接受
        // 4. 授权方式未显式设置（旧版本回退）→ 沿用 autoApprove 时代的规则：界面上展示的
        //    默认方式是「自动审批」，实际行为要跟它一致
        const isModify = !!meta.oldContent
        const authMode = useStore.getState().authorizationMode
        const shouldAutoAccept = authMode === 'never'
          ? true
          : authMode === 'every-step'
            ? false
            : !isCodeFile(meta.filePath) || !isModify

        if (shouldAutoAccept) {
          // 自动接受：记录到 fileChangeHistory（标记为已接受），不进入待确认列表
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
          }, threadId)
          // 立即自动接受（从 pendingChanges 移除，保留在 fileChangeHistory 中标记为 accepted）
          store.acceptChange(meta.filePath, threadId)
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
        }, threadId)
      }
    }

    // 接管：工具返回 `TAKEOVER:<reason>` 时，「等人处理」是正常结局而非失败。
    // 用户处理完再续跑；无人值守来源不阻塞，直接收尾并写明需要人工做什么。
    const takeoverCode = toolResults
      .map((r) => {
        const content = typeof r.result.content === 'string' ? r.result.content : ''
        // 业务码可能被包在 `Error: ` 前缀里，从出现位置截取到结尾再解析
        const idx = content.indexOf(TAKEOVER_ERROR_PREFIX)
        return idx >= 0 ? content.slice(idx).trim() : ''
      })
      .find((content) => parseTakeoverError(content) !== null)
    if (takeoverCode && !context.abortSignal?.aborted) {
      const { language } = useStore.getState()
      // 有 id 对照表映射说明这次运行来自移动端下发 → 按 reachable 处理（5 分钟等待）；
      // 本地 UI 下发的任务按 present（10 分钟），用户就在电脑前
      const fromRemote = resolveTaskId(requestId) !== requestId
      const session = createTakeoverSession(requestId, async () => true)
      const takeoverResult = await session.run({
        errorCode: takeoverCode,
        origin: fromRemote ? 'channel' : 'ui',
      })

      if (takeoverResult.status === 'continued') {
        logger.agent.info('[Loop] Takeover resolved by user, continuing', {
          reason: takeoverResult.reason,
          attempts: takeoverResult.attempts,
        })
        llmMessages.push({
          role: 'user',
          content: getLocalizedText(
            language,
            '用户已在桌面端处理完拦截，请继续执行后续步骤。',
            'The user has resolved the blocker on the desktop. Continue with the remaining steps.',
          ),
        })
        continue
      }

      const reasonLabel = takeoverResult.reason
        ? TAKEOVER_REASON_LABEL[takeoverResult.reason]
        : getLocalizedText(language, '需要人工处理', 'Needs manual handling')
      const detail = takeoverResult.note || ''
      logger.agent.warn('[Loop] Takeover ended without continuing', {
        status: takeoverResult.status,
        reason: takeoverResult.reason,
        attempts: takeoverResult.attempts,
      })

      threadStore.finalizeAssistant(assistantId)
      threadStore.setStreamPhase('idle')
      threadStore.setStreamState({ streamDetail: undefined })
      threadStore.updateExecutionMeta({ loopState: 'completed' })
      threadStore.addSystemAlertPart(assistantId, {
        alertType: 'warning',
        title: getLocalizedText(language, '任务暂停，需要你处理', 'Task paused, needs your action'),
        message: getLocalizedText(
          language,
          `未能自动完成：${reasonLabel}。${detail}`,
          `Could not finish automatically: ${reasonLabel}. ${detail}`,
        ),
        suggestion: getLocalizedText(
          language,
          '处理完成后可在移动端或客户端点击继续。',
          'After handling it, tap Continue on mobile or in the desktop app.',
        ),
      })
      EventBus.emit({ type: 'loop:end', reason: 'takeover', threadId, assistantId, requestId, planTaskId: context.planTaskId })
      break
    }

    // 工具批次边界：把用户在执行中补的话取出来注入，下一轮模型据此调整做法。
    // 与「收尾接缝」互补：这里管「正跑着」，那里管「要收尾了」。
    const batchSteers = await pullPendingSteers(requestId, threadId)
    if (batchSteers.length > 0) {
      logger.agent.info(`[Loop] Injecting ${batchSteers.length} steer(s) at tool batch boundary`)
      const steerLanguage = useStore.getState().language === 'en' ? 'en' : 'zh'
      llmMessages.push({ role: 'user', content: buildSteerInstruction(batchSteers, steerLanguage) })
      recordAdoptedSteers(batchSteers)
    }

    // lint 自动修复：检测结果只回灌给模型，不在会话界面渲染检查卡片。
    // 会话界面出现「Found N errors in N file」会让用户误以为是执行失败在报错，
    // 实际上这只是 AI 自我校正的中间态，改完就正常收尾。
    // 轮次用尽后连检测一并跳过，避免反复扫描却在空转。
    if (enableAutoFix && !userRejected && context.workspacePath && lintAutoFixRounds < MAX_LINT_AUTO_FIX_ROUNDS) {
      // 自动修复检查涉及文件读写与 lint 服务，失败不应中断主循环
      let lintIssueReport: Awaited<ReturnType<typeof detectLintIssues>> = null
      try {
        lintIssueReport = await detectLintIssues(result.toolCalls, context.workspacePath)
      } catch (lintErr) {
        logger.agent.warn('[Loop] Lint auto-check failed, continuing main loop:', lintErr)
      }
      if (lintIssueReport) {
        lintAutoFixRounds += 1
        logger.agent.info('[Loop] Lint auto-fix report fed back to model', {
          round: lintAutoFixRounds,
          limit: MAX_LINT_AUTO_FIX_ROUNDS,
          filesWithErrors: lintIssueReport.files.filter(f => f.errors.length > 0).length,
        })
        if (lintAutoFixRounds >= MAX_LINT_AUTO_FIX_ROUNDS) {
          logger.agent.warn('[Loop] Lint auto-fix round limit reached, further reports will not be fed back')
        }
        llmMessages.push({ role: 'user', content: lintIssueReport.content })
        shouldContinue = true
        threadStore.setStreamPhase('streaming')
        // 新一轮请求在途，等模型首包；真实推理增量到达后才显示「思考中」
        threadStore.setStreamState({ streamDetail: undefined })
        continue
      }
    }


    // ===== 执行期专家切换 =====
    // 入场匹配只看用户消息，而一轮任务常跨工种：先写页面、再写接口、最后跑部署。
    // 这里按本轮工具的目标文件与命令补一次判定，命中与当前专家不同的角色时
    // 追加一条阶段专家指令。只追加不替换，场景边界与会话级人设始终有效。
    if (
      context.executionRoleSwitchAllowed &&
      isRoleAgentEnabled(context.chatMode) &&
      useRoleLibraryStore.getState().executionRoleSwitchEnabled &&
      roleSwitchRounds < MAX_EXECUTION_ROLE_SWITCHES
    ) {
      const signals = collectExecutionSignals(
        result.toolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments as Record<string, unknown> | undefined })),
      )
      if (signals.paths.length > 0 || signals.commands.length > 0) {
        const stageMatch = resolveExecutionRole(
          useSceneModeStore.getState().currentSceneMode,
          signals,
          switchedRoleIds,
        )
        if (stageMatch.role) {
          roleSwitchRounds += 1
          switchedRoleIds.push(stageMatch.role.id)
          const { language } = useStore.getState()
          logger.agent.info(
            `[Loop] Stage expert switched to ${stageMatch.role.id} ` +
            `(score=${stageMatch.score.toFixed(2)}, hits=${stageMatch.hits.join(',')})`,
          )
          llmMessages.push({
            role: 'user',
            content: buildExecutionRoleSwitchMessage(stageMatch.role, language === 'zh' ? 'zh' : 'en'),
          })
          shouldContinue = true
          threadStore.setStreamPhase('streaming')
          threadStore.setStreamState({ streamDetail: undefined })
          continue
        }
      }
    }

    if (userRejected) {
      const { language } = useStore.getState()
      const rejectMsg = t('ai.theuserrejectedthetool', language as Language)
      llmMessages.push({ role: 'user', content: rejectMsg })
      shouldContinue = true
      threadStore.setStreamPhase('streaming')
      threadStore.setStreamState({ streamDetail: undefined })
      continue
    }

    shouldContinue = true
    threadStore.setStreamPhase('streaming')
    // 进入下一轮模型请求：首包未到之前保持「等待模型响应」
    threadStore.setStreamState({ streamDetail: undefined })
  }

  // 主循环收尾：把没赶上注入的插话作废
  //
  // 队列只在「工具批次边界」与「收尾接缝」两处被取走。走到这里的路径（等待用户、
  // 工具主动结束、接管超时等）都是直接 break，队列里的内容既没进过模型上下文，
  // 又不会随本轮作废 —— 下一次用户发消息时它会被当成一条孤立的 user 消息注入，
  // 那就是跨轮串话。入队时没有写过会话气泡，这里只需清空队列。
  {
    const discardedSteers = discardLocalSteers(threadId)
    if (discardedSteers > 0) {
      logger.agent.info(`[Loop] Discarding ${discardedSteers} unadopted steer(s) at loop exit`)
    }
  }


  // 主循环收尾统一清理残留的流式预览。
  //
  // 预览条目只在「模型声明调用 → 工具开始执行」这一小段窗口内有效：正常路径由编排层
  // 在执行起点清除，循环拦截、任务中止、参数解析失败等分支不会走到那里，条目就会
  // 留在 toolStreamingPreviews 中，以一张永远 pending 的卡片常驻消息末位。逐条清理
  // 各有各的触发点、容易漏，这里在唯一出口统一收口，保证线程离开主循环时不留残影。
  threadStore.clearToolStreamingPreviews()

  // 兜底收尾：若主循环退出时 loopState 仍停留在 'running'（静默退出/异常路径未收尾），
  // 补一次「异常中断」处理，避免用户看到「AI 无提示自行停下」，并保证断点续接能识别未完成状态。
  {
    const metaAfterLoop = useAgentStore.getState().threads[threadId]?.executionMeta
    if (metaAfterLoop?.loopState === 'running') {
      logger.agent.warn('[Loop] Loop exited without terminal state → concluding as interrupted')
      concludeAsAborted()
      // 自由模式：AI 未收尾即结束本轮 → 自动派发续接消息推进任务，
      // 受 MAX_FREE_MODE_ROUNDS 连续轮次硬上限兜底（防死循环烧额度）。
      // 若自由模式连续自动轮次达上限仍未收尾，暂停自动续接并交还用户。
      const freeModeEnabled = useStore.getState().freeModeEnabled
      if (freeModeEnabled) {
        threadStore.updateExecutionMeta({ loopState: 'completed' })
        if (!scheduleFreeModeContinuation(threadId)) {
          const { language } = useStore.getState()
          threadStore.addSystemAlertPart(assistantId, {
            alertType: 'warning',
            title: getLocalizedText(language, '已暂停自动继续', 'Auto-continue Paused'),
            message: getLocalizedText(
              language,
              '为避免持续消耗额度，已暂停自动继续。',
              'Auto-continue was paused to avoid draining your quota.',
            ),
            suggestion: getLocalizedText(
              language,
              '可补充更明确的要求，或点击继续再推进一轮。',
              'Add clearer instructions, or click Continue to run one more round.',
            ),
            action: { label: getLocalizedText(language, '继续', 'Continue'), actionType: 'continue' },
          })
        }
      }
    }
  }

  // 会话收尾：结算轨迹指标并交主进程落库。采集是旁路，失败不影响会话结果
  finishSessionTrace(threadId)

  if (loopSpan) {
    agentHarness.observability.endSpan(loopSpan)
  }
}

/**
 * 取走执行中补的说明（两个来源合并）
 *
 * 来源一：本地会话的插话，按 threadId 存在 renderer 内存里（localSteer）。
 * 来源二：移动端远程下发任务的补充说明，按服务端 taskId 经主进程队列取回。
 *
 * 两者可以同时存在：同一个线程既可能被用户在客户端里插话，也可能是移动端发起
 * 的任务在跑。先取本地（同步、无 IO），再取远端，远端不可达不影响本地插话生效。
 *
 * 远端一侧的换算说明：移动端与后端都按服务端 taskId 归属，而执行层手上只有本次
 * 下发的 requestId，因此按对照表换算，换算不到就原样使用（旧后端没有 taskId 时，
 * 队列本就不会有内容，返回空是正确结果）。通道不可用（Web 预览、未登录设备联动）
 * 时同样只返回本地部分，不抛错 —— 这条链路是旁路，不能因为远端不可达而影响本地执行。
 */
async function pullPendingSteers(
  requestId: string | undefined,
  threadId: string | undefined,
): Promise<string[]> {
  const local = threadId ? drainLocalSteers(threadId) : []
  if (!requestId) return local
  try {
    const taskId = resolveTaskId(requestId)
    if (!taskId) return local
    const remote = await drainSteers(taskId)
    return [...local, ...remote]
  } catch {
    return local
  }
}

// 适配 AgentRuntime 接口的包装函数
export async function runLoopAdapter(params: {
  config: LLMConfig
  llmMessages: LLMMessage[]
  context: ExecutionContext
  assistantId: string
  budgetController?: TokenBudgetController
  resolver?: ModelResolver
  complexity?: ComplexityScore
}): Promise<void> {
  return executeAgentCycle(
    params.config,
    params.llmMessages,
    params.context,
    params.assistantId,
    params.budgetController,
    // 未传 resolver 时 routing 为空对象，executeAgentCycle 内部退化为全程用 config
    params.resolver || params.complexity
      ? { resolver: params.resolver, complexity: params.complexity }
      : undefined
  )
}
