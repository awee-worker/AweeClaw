/**
 * Agent 核心类
 * 
 * 职责：
 * - 提供统一的公共 API
 * - 管理 Agent 生命周期（运行状态、中止、清理）
 * - 协调所有子模块（MessageBuilder, runLoop, EventBus）
 * - 处理错误和异常情况
 * 
 * 使用示例：
 * ```typescript
 * await Agent.send(
 *   "你好",
 *   config,
 *   workspacePath,
 *   systemPrompt,
 *   'agent'
 * )
 * ```
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { AppError, formatErrorMessage, ErrorCodes } from '@shared/exceptions'
import { useAgentStore } from '../state/IntelligenceStore'
import {
  buildPersistedAgentSessionState,
  persistCriticalAgentSessionState,
  resumeAgentStorageWrites,
  suspendAgentStorageWrites,
} from '../state/intelligenceStorage'
import { fileCacheService } from '../runtime/fileCacheManager'
import { proceduralSkillLearner } from '../runtime/proceduralSkillLearner'
import { modelRouter } from '../runtime/modelRouter'
import { approvalService } from './toolOrchestrator'
import { EventBus } from './EventDispatcher'
import { agentHarness } from '../harness'
import type { Span } from '../harness/observability/Trace'
import type { WorkMode } from '@/renderer/modes/workModeTypes'
import type { MessageContent, TextContent, ImageContent } from '@intelligence/providerTypes'
import type { CheckpointImage } from '@intelligence/providerTypes'
import type { LLMConfig, ExecutionContext } from '@intelligence/providerTypes'
import { agentExecutor } from '../application/AgentExecutor'
import { loadPerceptionContext } from './perceptionContextLoader'
import type { ExecutionConfig } from '../application/AgentExecutor'
import { translateAgentText } from '@intelligence/utils/intelligenceTextUtils'
import { agentRuntime } from './AgentRuntime'
import { buildAgentSystemPrompt } from '../prompt-engine/PromptComposer'
import { taskComplexityDetector } from '../capabilities/planning/TaskComplexityDetector'
import { buildResumeNotice } from '../utils/resumeContext'
import { executeMultiAgent, continueMultiAgent, type RunningTask } from './MultiAgentExecution'
import { useStore } from '@renderer/state'
import { terminalManager } from '@services/TerminalAdapter'
// ⚠️ 注意别名差异：`@services/*` 指向 renderer/adapters，
// 而本文件位于 renderer/services，必须走 `@renderer/services/*`
import {
  beginAgentTaskPowerGuard,
  endAgentTaskPowerGuard,
} from '@renderer/services/powerGuard'

export class AgentClass {
  /** 运行中的任务（按线程追踪） */
  private runningTasks: Map<string, RunningTask> = new Map()

  /**
   * 本窗口「Agent 会话」层发起过的 requestId 集合。
   *
   * 用途：停止按钮的兜底分支需要「精确」中止 Agent 自己的请求。
   * 无参 api.llm.abort() 等价于 abortAll()，会把同窗口内并发的
   * 悬浮球对话 / 代码补全 / 场景工具 / 多 Agent 子任务一起杀掉，
   * 表现为「点一次停止，别处的 AI 也莫名中断」。
   */
  private readonly agentRequestIds = new Set<string>()

  // ===== 公共 API =====

  /**
   * 发送消息并运行 Agent
   * 
   * @param userMessage - 用户消息（文本或多模态内容）
   * @param config - LLM 配置
   * @param workspacePath - 工作区路径
   * @param chatMode - 工作模式（chat/plan）
   * @param promptOptions - 构建系统提示词所需的元数据
   */
  async send(
    userMessage: MessageContent,
    config: LLMConfig,
    workspacePath: string | null,
    chatMode: WorkMode = 'agent',
    promptOptions?: {
      openFiles?: string[]
      activeFile?: string
      customInstructions?: string
      promptTemplateId?: string
      planPhase?: 'planning' | 'executing'
      mentionedSkills?: string[]
    },
    executionOptions?: {
      threadId?: string
      requestId?: string
      planTaskId?: string
      /** 是否来自外部渠道消息（飞书/微信/WhatsApp等） */
      isChannel?: boolean
      /**
       * 是否为主动式助手触发的对话（阶段10 s10-04 新增）
       * - true 表示由 ProactiveActionTrigger 通过 IPC 触发
       * - 用于在对话结束后回写 ProactiveProposal 状态
       */
      isProactive?: boolean
      /** 关联的 ProactiveProposal ID（isProactive=true 时必填） */
      proposalId?: string
      /**
       * 静默注入模式（不显示为用户消息气泡）
       *
       * 用于任务执行等场景：项目上下文/任务详情需要发送给 AI，
       * 但不应像用户手动输入的消息那样显示在对话界面中。
       *
       * - true：用户消息会标记为 hidden=true，轻量视图（LightweightMessageView）
       *   会跳过渲染，但消息仍正常发送给 LLM。
       * - false / undefined：正常显示为用户消息气泡。
       */
      silent?: boolean
    }
  ): Promise<{ threadId: string; assistantId: string; requestId: string }> {
    const store = useAgentStore.getState()

    // 第一次对话时可能还没有 threadId，需要在 addUserMessage 后获取
    let threadId = executionOptions?.threadId || store.currentThreadId

    // 防止同一线程重复运行
    if (threadId && this.runningTasks.has(threadId)) {
      logger.agent.warn('[Agent] Thread already running, ignoring new request')
      throw new Error(`Thread ${threadId} is already running`)
    }

    // 验证 API Key
    if (!config.apiKey && !config.cloudMode) {
      this.showError(translateAgentText('apiKeyWarning'))
      throw new Error('Missing API key')
    }

    const abortController = new AbortController()
    const requestId = executionOptions?.requestId || crypto.randomUUID()
    const contextItems = threadId
      ? (store.threads[threadId]?.contextItems || [])
      : (store.getCurrentThread()?.contextItems || [])

    let persistSuspended = false
    let taskRegistered = false
    let harnessSpan: Span | null = null

    try {
      // 断点续接附加（致命问题 #1）：
      // 上次执行被中断（用户停止/失败/达到工具调用上限）后，若用户再次发送
      // （尤其是“继续”等短消息），自动在消息前附加续接说明，让 AI 知道要续接什么，
      // 而不是“从头再来”。若线程已正常完成或消息与上次任务无关则返回 null 不附加。
      if (typeof userMessage === 'string' || Array.isArray(userMessage)) {
        const resumeThread = threadId ? store.threads[threadId] : undefined
        const incomingText = typeof userMessage === 'string'
          ? userMessage
          : userMessage.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')
        const resumeNotice = resumeThread ? buildResumeNotice(resumeThread, incomingText) : null
        if (resumeNotice) {
          logger.agent.info('[Agent] 检测到断点续接请求，已附加续接说明')
          userMessage = typeof userMessage === 'string'
            ? `${resumeNotice}\n\n${userMessage}`
            : [{ type: 'text', text: resumeNotice }, ...userMessage]
        }
      }

      if (agentHarness.isInitialized) {
        harnessSpan = agentHarness.observability.startSpan('agent.send', `thread-${threadId ?? 'new'}`, undefined, { chatMode, workspacePath })
      }
      suspendAgentStorageWrites()
      persistSuspended = true
      // 1. 【性能关键】批量初始化消息环境（合并用户消息、助手气泡、上下文清理）
      const { userMessageId, assistantId, threadId: preparedThreadId } = store.prepareExecution(userMessage, contextItems, executionOptions?.threadId)

      threadId = preparedThreadId
      if (!threadId) {
        logger.agent.error('[Agent] No thread ID after prepareExecution')
        throw new Error('No thread ID after prepareExecution')
      }

      // 静默注入模式：将用户消息标记为 hidden，轻量视图不渲染为用户气泡
      // 消息仍正常发送给 LLM（存在于 thread.messages 中），仅 UI 层面隐藏
      if (executionOptions?.silent && userMessageId) {
        store.updateMessage(userMessageId, { hidden: true } as Partial<import('../types/conversationModel').UserMessage>, threadId)
      }

      const threadStore = useAgentStore.getState().forThread(threadId)
      threadStore.setExecutionMeta({
        requestId,
        assistantId,
        planTaskId: executionOptions?.planTaskId,
        loopState: 'running',
      })
      threadStore.setStreamState({ requestId, assistantId, phase: 'streaming' })

      // 2. 记录任务并绑定助手消息 ID
      this.runningTasks.set(threadId, {
        abortController,
        assistantId,
        requestId,
        planTaskId: executionOptions?.planTaskId,
      })
      
      // 登记本次 Agent 请求，供停止时的兜底中止使用
      this.agentRequestIds.add(requestId)
      taskRegistered = true

      // 长任务期间阻止系统休眠（是否真的生效由主进程按配置裁决）。
      // 与下面 finally 中的 release 严格配对：引用计数错配会让断言永久滞留。
      beginAgentTaskPowerGuard()

      // 【核心优化】立即让出主线程，确保用户消息和助手气泡瞬间在 UI 渲染
      await new Promise(resolve => setTimeout(resolve, 0))

      // 3. 提取提到的 Skills
      const mentionedSkills = contextItems
        .filter(item => item.type === 'Skill')
        .map(item => (item as import('../providerTypes').SkillContext).skillId)

      // 4. 构建系统提示词（异步执行）
      const userMsgText = typeof userMessage === 'string' ? userMessage : ''

      // 4.1 阶段2：异步加载感知预测上下文（带超时保护，失败静默）
      const perceptionContext = await loadPerceptionContext({
        activeFile: promptOptions?.activeFile,
        openFiles: promptOptions?.openFiles,
        workspacePath,
        userMessage: userMsgText,
      }).catch((e) => {
        logger.agent?.warn(`[Agent] 感知上下文加载失败: ${e instanceof Error ? e.message : String(e)}`)
        return null
      })

      const { prompt: systemPrompt, appliedSkills } = await buildAgentSystemPrompt(chatMode, workspacePath, {
        ...promptOptions,
        mentionedSkills: mentionedSkills.length > 0 ? mentionedSkills : undefined,
        userMessage: userMsgText,
        perceptionContext,
        isChannel: executionOptions?.isChannel,
      })

      // 提前提取，避免后续重复声明
      const userQueryText = userMsgText

      // 仅将"关键词匹配触发完整注入"的技能追加到 assistant message（排除已 @mention 的）
      // 注意：所有 auto 技能的 name+description 索引都会注入系统提示词，但只有匹配的才显示"已应用"
      const mentionedSet = new Set(mentionedSkills)
      const autoSelectedSkills = appliedSkills.filter(s => !mentionedSet.has(s.name))
      if (autoSelectedSkills.length > 0) {
        store.addSkillsToMessage(assistantId, autoSelectedSkills, threadId)
      }

      // ===== 多 Agent 协作路由 =====
      const complexityResult = taskComplexityDetector.analyze(userQueryText)

      const globalStore = useStore.getState()
      const teamModeEnabled = globalStore.teamModeEnabled

      const shouldUseMultiAgent = teamModeEnabled && chatMode === 'agent'

      if (shouldUseMultiAgent) {
        const existingSession = globalStore.activeWorkspaceSession
        // status === 'failed' 也允许续接：团队任务异常中断后，无论用户点「继续」
        // 还是自动续接，都应回到原团队与原项目成果上继续，而不是丢掉已有成果
        // 重新发起一次全新的协作。
        const canContinueSession = existingSession
          && (existingSession.status === 'completed' || existingSession.status === 'failed')
          && existingSession.agents.length > 0
          && existingSession.projectPath

        if (canContinueSession) {
          logger.agent.info('[Agent] Continuing existing multi-agent session')

          await continueMultiAgent(
            userQueryText,
            config,
            workspacePath,
            threadId,
            assistantId,
            existingSession,
            this.runningTasks
          )

          return { threadId, assistantId, requestId }
        }

        logger.agent.info(
          `[Agent] Team mode enabled, triggering multi-agent collaboration, ` +
          `features: [${complexityResult.features.join(', ')}]`
        )

        await executeMultiAgent(
          userQueryText,
          config,
          workspacePath,
          threadId,
          assistantId,
          requestId,
          { enabled: true, mode: 'always', threshold: 0, requireConsensus: true, maxAgents: 6 },
          this.runningTasks
        )

        return { threadId, assistantId, requestId }
      }

      // ===== 模型路由分层 =====
      // 单 Agent 路径：根据复杂度在同提供商内选择合适层级模型
      // - 简单对话（打招呼/闲聊）路由到轻量模型，降低 token 消耗与延迟
      // - 中等/复杂任务保留用户主模型，确保能力充足
      // 多 Agent 协作路径已在上方提前返回，此处仅处理单 Agent
      const routingDecision = modelRouter.route(config, complexityResult, userQueryText)
      const effectiveConfig = routingDecision.config
      if (routingDecision.swapped) {
        logger.agent.info(
          `[Agent] Model routed: ${routingDecision.originalModel} → ${routingDecision.routedModel} ` +
          `(tier=${routingDecision.tier})`
        )
      }

      // 5. 创建检查点（用于撤销）
      const checkpointImages = this.extractCheckpointImages(userMessage)
      const messageText = typeof userMessage === 'string' ? userMessage.slice(0, 50) : 'User message'
      // userMessageId 已从 prepareExecution 返回值获取（步骤1），无需重复查询
      const checkpointId = userMessageId
        ? await store.createMessageCheckpoint(userMessageId, messageText, checkpointImages, contextItems)
        : undefined

      // 6. 使用 AgentExecutor 准备执行
      const executionConfig: ExecutionConfig = {
        mode: chatMode,
        workspacePath,
        threadId,
        assistantId,
        requestId,
        planTaskId: executionOptions?.planTaskId,
        contextLimit: effectiveConfig.contextLimit,
      }

      const preparation = await agentExecutor.prepare(
        userMessage,
        contextItems,
        store.threads[threadId]?.messages || [],
        systemPrompt,
        executionConfig
      )

      // 7. 开始流式响应
      store.setStreamPhase('streaming', threadId)
      store.setStreamState({ streamDetail: 'reasoning' }, threadId)

      // 8. 运行主循环
      const executionContext: ExecutionContext = {
        workspacePath,
        chatMode,
        planPhase: promptOptions?.planPhase,
        abortSignal: abortController.signal,
        threadId,
        requestId,
        planTaskId: executionOptions?.planTaskId,
        checkpointId,
        isChannel: executionOptions?.isChannel,
      }

      if (agentHarness.isInitialized && threadId) {
        agentHarness.createThreadScope(threadId)
      }

      await agentRuntime.get().runLoop({
        config: effectiveConfig,
        llmMessages: preparation.messages,
        context: executionContext,
        assistantId,
        budgetController: preparation.budgetController,
      })

      // 程序性技能学习：任务完成后记录工具调用序列（不阻塞主流程）
      const threadForLearning = useAgentStore.getState().threads[threadId]
      if (threadForLearning && !abortController.signal.aborted) {
        void proceduralSkillLearner.recordTaskCompletion({
          userMessage,
          threadMessages: threadForLearning.messages,
          assistantId,
          success: true,
        }).catch(err => logger.agent.warn('[Agent] Procedural skill record failed:', err))
      }

      return { threadId, assistantId, requestId }
    } catch (error) {
      if (harnessSpan) {
        agentHarness.observability.endSpan(harnessSpan, 'error')
        harnessSpan = null
      }
      // 兜底收尾：主循环若从「未捕获异常」路径逃逸（如工具编排、压缩检查、文件快照
      // 等 await 抛出），会越过 loopDetector 尾部的终态兜底，导致 loopState 卡在
      // 'running' —— 用户看到「AI 无提示停下」，断点续接也无法识别未完成状态。
      // 此处补齐终态与「继续」入口，保证异常始终对用户可见、可续接。
      if (threadId) {
        try {
          const agentState = useAgentStore.getState()
          const boundStore = agentState.forThread(threadId)
          const meta = agentState.threads[threadId]?.executionMeta
          if (meta?.loopState === 'running' && meta.assistantId) {
            const { language } = useStore.getState()
            const isZh = language === 'zh'
            logger.agent.warn('[Agent] Loop escaped without terminal state → finalizing as failed')
            boundStore.updateExecutionMeta({ loopState: 'failed' })
            boundStore.addSystemAlertPart(meta.assistantId, {
              alertType: 'error',
              title: isZh ? '执行异常中断' : 'Execution Interrupted',
              message: isZh
                ? '本次执行因未预期的错误中断，任务尚未完成。'
                : 'This execution was interrupted by an unexpected error before the task completed.',
              suggestion: isZh
                ? '可点击继续以续接未完成的任务。'
                : 'Click Continue to resume the unfinished task.',
              action: { label: isZh ? '继续' : 'Continue', actionType: 'continue' },
            })
            EventBus.emit({
              type: 'loop:end',
              reason: 'error',
              threadId,
              assistantId: meta.assistantId,
              requestId,
              planTaskId: meta.planTaskId,
            })
          }
        } catch (finalizeErr) {
          logger.agent.warn('[Agent] Failed to finalize loop state after error:', finalizeErr)
        }
      }
      const appError = AppError.fromError(error)
      logger.agent.error('[Agent] Error:', appError.toJSON())
      // 配额用完：显示「重试」+「升级套餐」两个动作按钮
      if (appError.code === ErrorCodes.LLM_QUOTA_EXCEEDED) {
        this.showError(formatErrorMessage(appError), [
          { label: translateAgentText('agent.retry'), actionType: 'retry' },
          { label: translateAgentText('agent.upgradePlan'), actionType: 'upgrade' },
        ])
      } else {
        this.showError(formatErrorMessage(appError))
      }
      throw error
    } finally {
      if (harnessSpan) {
        agentHarness.observability.endSpan(harnessSpan)
      }
      if (persistSuspended) {
        resumeAgentStorageWrites()
        void persistCriticalAgentSessionState(
          buildPersistedAgentSessionState(useAgentStore.getState())
        )
      }

      if (taskRegistered) {
        endAgentTaskPowerGuard()
        this.cleanupTask(threadId)
      }
    }
  }

  /**
   * 指定线程当前是否正在执行（存在执行锁）。
   *
   * 供自动续接等场景判断「执行锁是否已释放」——直接派发续接消息若早于
   * cleanupTask 释放锁，Agent.send 会因 "Thread already running" 抛错并静默失败，
   * 表现为「AI 中断后没有继续执行」。调用方可据此轮询等待。
   *
   * @param threadId 目标线程；为空时判断是否存在任意运行中任务
   */
  isRunning(threadId: string | null): boolean {
    if (!threadId) return this.runningTasks.size > 0
    return this.runningTasks.has(threadId)
  }

  /**
   * 中止当前运行的 Agent
   *
   * 会：
   * - 中止视觉智能体（若运行中，联动 emergencyStop 彻底中断主进程闭环）
   * - 中止 LLM 请求
   * - 拒绝待审批的工具
   * - 更新所有运行中的工具状态为 error
   * - 清理资源
   */
  abort(threadId?: string): void {
    // 记录调用栈，诊断非用户主动停止时的意外 abort
    logger.agent.warn('[Agent.abort] Called. threadId:', threadId, 'Stack:', new Error().stack?.slice(0, 800))

    const store = useAgentStore.getState()
    const targetThreadId = threadId || store.currentThreadId

    // 收集需要中止的线程 ID 列表
    // 优先中止指定线程；若未找到则全量中止（兜底，确保停止按钮始终生效）
    const threadIdsToAbort: string[] = []
    if (targetThreadId && this.runningTasks.has(targetThreadId)) {
      threadIdsToAbort.push(targetThreadId)
    } else if (this.runningTasks.size > 0) {
      // ⚠️ 兜底机制：指定线程未在 runningTasks 中找到（可能因 currentThreadId 闭包过期、
      //   多窗口线程 ID 不一致等），此时中止所有运行中的任务，确保用户点击停止后 AI 真正停下
      logger.agent.warn(
        `[Agent.abort] Thread "${targetThreadId}" not found in runningTasks (size=${this.runningTasks.size}), aborting all as fallback`,
      )
      threadIdsToAbort.push(...this.runningTasks.keys())
    }


    // 先收集各线程的 requestId —— 权威来源是 runningTasks（send() 注册时写入），
    // 其次才是 store 里的 executionMeta / streamState（可能尚未写入或已被清理）。
    // ⚠️ 必须在下面的中止循环之前收集：循环会把条目从 runningTasks 中移除。
    const requestIdsByThread = new Map<string, string>()
    for (const tid of threadIdsToAbort) {
      const id =
        this.runningTasks.get(tid)?.requestId
        ?? store.threads[tid]?.executionMeta?.requestId
        ?? store.threads[tid]?.streamState?.requestId
      if (id) requestIdsByThread.set(tid, id)
    }

    // 中止所有目标线程的任务
    for (const tid of threadIdsToAbort) {
      const task = this.runningTasks.get(tid)
      if (!task) continue

      task.abortController.abort()

      const thread = store.threads[tid]
      if (task.assistantId && thread) {
        const msg = thread.messages.find(m => m.id === task.assistantId)
        if (msg?.role === 'assistant') {
          const assistantMsg = msg as import('../providerTypes').AssistantMessage
          for (const tc of assistantMsg.toolCalls || []) {
            if (['running', 'awaiting', 'pending'].includes(tc.status)) {
              store.updateToolCall(task.assistantId, tc.id, {
                status: 'error',
                error: 'Aborted by user',
                streamingState: undefined,
              }, tid)
            }
          }
        }
        store.finalizeAssistant(task.assistantId, tid)
      }

      this.runningTasks.delete(tid)
    }

    // 精确中止各线程自己的 LLM 请求：带 requestId 避免误杀同窗口内其他并发流
    // （悬浮球 / 代码补全 / 场景工具 / 多 Agent 子任务等可能同时在运行）
    const abortedRequestIds = [...requestIdsByThread.values()]
    for (const id of abortedRequestIds) {
      api.llm.abort(id)
      this.agentRequestIds.delete(id)
    }

    // 兜底：仍未取到 requestId 时（例如 currentThreadId 闭包过期），只中止
    // 「本窗口 Agent 会话」登记过的请求，确保停止按钮依然生效。
    // ⚠️ 此处不再调用无参 api.llm.abort()。
    if (abortedRequestIds.length === 0) {
      for (const id of this.agentRequestIds) {
        api.llm.abort(id)
      }
      this.agentRequestIds.clear()
    }

    // 中断所有正在执行的 Agent 终端命令（如 npm install 等长命令）
    // 确保用户点击"结束对话"后，后台 shell 命令不再继续执行
    try {
      terminalManager.abortActiveAgentCommands()
    } catch (err) {
      logger.agent.warn('[Agent.abort] Failed to abort active terminal commands:', err)
    }

    const globalStore = useStore.getState()
    const activeSession = globalStore.activeWorkspaceSession
    if (activeSession && activeSession.status !== 'completed' && activeSession.status !== 'failed') {
      globalStore.updateWorkspaceSession({
        status: 'failed',
        currentAgentId: undefined,
      })
    }

    // 拒绝所有被中止线程的待审批工具
    for (const tid of threadIdsToAbort) {
      const thread = useAgentStore.getState().threads[tid]
      const reqId = thread?.executionMeta?.requestId
      const pendingToolCalls = thread?.streamState?.pendingApprovalToolCalls
      if (reqId && pendingToolCalls && pendingToolCalls.length > 0) {
        for (const tc of pendingToolCalls) {
          approvalService.reject(`${reqId}_${tc.id}`)
        }
      } else if (reqId) {
        approvalService.reject(reqId)
      }
    }

    // 终结所有被中止线程中正在流式输出的助手消息
    for (const tid of threadIdsToAbort) {
      const thread = store.threads[tid]
      if (thread) {
        for (const msg of thread.messages) {
          if (msg.role === 'assistant') {
            const assistantMsg = msg as import('../providerTypes').AssistantMessage
            if (assistantMsg.isStreaming) {
              store.finalizeAssistant(msg.id, thread.id)
            }
          }
        }
      }
    }

    // 清理所有被中止线程的执行状态
    // ⚠️ 顺序至关重要：先设置 loopState: 'aborted'，再触发 running → idle 转换
    //   任务完成监控 effect 在检测到 running → idle 转换时，会读取 loopState 判断是否被中止。
    //   必须确保 effect 执行时 loopState 已是 'aborted'，否则会误判为正常完成。
    //   （React effect 在渲染后异步执行，但 Zustand 的 setState 是同步的，
    //    所以 setStreamPhase('idle') 触发的重渲染中 loopState 已是 'aborted'）
    for (const tid of threadIdsToAbort) {
      const threadStore = store.forThread(tid)
      threadStore.setStreamState({ streamDetail: undefined })
      threadStore.clearExecutionMeta()
      // 先设置 loopState: 'aborted'（在触发 idle 转换之前）
      threadStore.updateExecutionMeta({ loopState: 'aborted' })
      // 再设置 phase: 'idle'，触发 running → idle 转换
      // 此时 effect 读取到的 loopState 已是 'aborted'
      threadStore.setStreamPhase('idle')
    }

    // 兜底：若未中止任何线程（runningTasks 为空），仍强制将当前线程状态设为 idle
    if (threadIdsToAbort.length === 0) {
      store.setStreamPhase('idle')
    }
  }

  /**
   * 批准当前待审批的工具
   */
  approve(requestId?: string): void {
    const state = useAgentStore.getState()
    const currentThread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    const effectiveRequestId = requestId
      || currentThread?.streamState?.requestId
      || currentThread?.executionMeta?.requestId
    const pendingToolCalls = currentThread?.streamState?.pendingApprovalToolCalls

    logger.agent.info(`[Agent.approve] requestId=${requestId}, streamState.requestId=${currentThread?.streamState?.requestId}, executionMeta.requestId=${currentThread?.executionMeta?.requestId}, effectiveRequestId=${effectiveRequestId}, pendingToolCalls=${pendingToolCalls?.length}, approvalQueueSize=${approvalService.pendingCount}`)

    if (pendingToolCalls && pendingToolCalls.length > 0) {
      // 优先使用每个待审批工具自带的 requestId，支持多智能体并行审批
      for (const tc of pendingToolCalls) {
        const reqId = tc.requestId || effectiveRequestId
        const approvalId = reqId ? `${reqId}_${tc.id}` : tc.id
        logger.agent.info(`[Agent.approve] Approving tool: ${approvalId} (tc.requestId=${tc.requestId})`)
        approvalService.approve(approvalId)
      }
    } else if (effectiveRequestId) {
      logger.agent.info(`[Agent.approve] No pendingToolCalls, approving by requestId: ${effectiveRequestId}`)
      approvalService.approve(effectiveRequestId)
    } else {
      logger.agent.warn(`[Agent.approve] No pendingToolCalls and no requestId, falling back to queue`)
      approvalService.approve()
    }

    // 注意：不清除 pendingApprovalToolCalls，由子循环在 waitForApproval 返回后自行处理
    // 这样可以支持多个并行工具调用时的逐个批准
  }

  /**
   * 拒绝当前待审批的工具
   */
  reject(requestId?: string): void {
    const state = useAgentStore.getState()
    const currentThread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    const effectiveRequestId = requestId
      || currentThread?.streamState?.requestId
      || currentThread?.executionMeta?.requestId
    const pendingToolCalls = currentThread?.streamState?.pendingApprovalToolCalls

    logger.agent.info(`[Agent.reject] requestId=${requestId}, streamState.requestId=${currentThread?.streamState?.requestId}, executionMeta.requestId=${currentThread?.executionMeta?.requestId}, effectiveRequestId=${effectiveRequestId}, pendingToolCalls=${pendingToolCalls?.length}, approvalQueueSize=${approvalService.pendingCount}`)

    if (pendingToolCalls && pendingToolCalls.length > 0) {
      // 优先使用每个待审批工具自带的 requestId，支持多智能体并行审批
      for (const tc of pendingToolCalls) {
        const reqId = tc.requestId || effectiveRequestId
        const approvalId = reqId ? `${reqId}_${tc.id}` : tc.id
        logger.agent.info(`[Agent.reject] Rejecting tool: ${approvalId} (tc.requestId=${tc.requestId})`)
        approvalService.reject(approvalId)
      }
    } else if (effectiveRequestId) {
      logger.agent.info(`[Agent.reject] No pendingToolCalls, rejecting by requestId: ${effectiveRequestId}`)
      approvalService.reject(effectiveRequestId)
    } else {
      logger.agent.warn(`[Agent.reject] No pendingToolCalls and no requestId, falling back to queue`)
      approvalService.reject()
    }

    // 注意：不清除 pendingApprovalToolCalls，由子循环在 waitForApproval 返回后自行处理
    // 这样可以支持多个并行工具调用时的逐个拒绝
  }

  approveAll(): void {
    const state = useAgentStore.getState()
    const currentThread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    const requestId = currentThread?.streamState?.requestId || currentThread?.executionMeta?.requestId
    const pendingToolCalls = currentThread?.streamState?.pendingApprovalToolCalls

    if (!pendingToolCalls || pendingToolCalls.length === 0) {
      approvalService.approveAll()
      return
    }

    for (const tc of pendingToolCalls) {
      const reqId = tc.requestId || requestId
      approvalService.approve(reqId ? `${reqId}_${tc.id}` : tc.id)
    }
  }

  rejectAll(): void {
    const state = useAgentStore.getState()
    const currentThread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    const requestId = currentThread?.streamState?.requestId || currentThread?.executionMeta?.requestId
    const pendingToolCalls = currentThread?.streamState?.pendingApprovalToolCalls

    if (!pendingToolCalls || pendingToolCalls.length === 0) {
      approvalService.rejectAll()
      return
    }

    for (const tc of pendingToolCalls) {
      const reqId = tc.requestId || requestId
      approvalService.reject(reqId ? `${reqId}_${tc.id}` : tc.id)
    }
  }

  /**
   * 清除会话缓存
   *
   * 用于：
   * - 切换工作区时清除缓存
   * - 手动刷新时清除缓存
   */
  clearSession(): void {
    fileCacheService.clear()
    EventBus.clear()
    logger.agent.info('[Agent] Session cleared')
  }

  /**
   * 获取诊断信息（用于调试）
   */
  getDiagnostics() {
    const { getActiveListenerCount } = require('./stream')
    return {
      runningTaskCount: this.runningTasks.size,
      runningThreadIds: Array.from(this.runningTasks.keys()),
      activeListeners: getActiveListenerCount(),
      cacheStats: fileCacheService.getStats(),
    }
  }

  /**
   * 检查是否有任务正在运行
   */
  get running(): boolean {
    return this.runningTasks.size > 0
  }

  /**
   * 检查指定线程是否正在运行
   */
  isThreadRunning(threadId: string): boolean {
    return this.runningTasks.has(threadId)
  }

  /**
   * 获取 EventBus（用于外部订阅）
   */
  get events() {
    return EventBus
  }

  // ===== 文件缓存 API =====

  /**
   * 检查文件是否有有效缓存
   */
  hasValidFileCache(filePath: string): boolean {
    return fileCacheService.hasValidCache(filePath)
  }

  /**
   * 标记文件已读取（用于缓存）
   */
  markFileAsRead(filePath: string, content: string): void {
    fileCacheService.markFileAsRead(filePath, content)
  }

  /**
   * 获取文件缓存哈希
   */
  getFileCacheHash(filePath: string): string | null {
    return fileCacheService.getFileHash(filePath)
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return fileCacheService.getStats()
  }

  // ===== 私有方法 =====

  /**
   * 从消息中提取文本查询
   */
  // @ts-expect-error - Method kept for potential future use
  private extractUserQuery(message: MessageContent): string {
    if (typeof message === 'string') return message
    if (Array.isArray(message)) {
      return message
        .filter(p => p.type === 'text')
        .map(p => (p as TextContent).text)
        .join('')
    }
    return ''
  }

  /**
   * 从消息中提取图片（用于检查点）
   */
  private extractCheckpointImages(message: MessageContent): CheckpointImage[] {
    if (typeof message === 'string') return []
    if (Array.isArray(message)) {
      return message
        .filter((p): p is ImageContent => p.type === 'image')
        .map(p => ({
          id: crypto.randomUUID(),
          mimeType: (p.source.media_type || 'image/png') as string,
          base64: p.source.data,
        }))
    }
    return []
  }

  /**
   * 显示错误消息给用户
   * @param actions 可选的动作按钮列表（如配额用完时提供「重试」+「升级套餐」）
   */
  private showError(message: string, actions?: Array<{ label: string; actionType: 'continue' | 'retry' | 'dismiss' | 'open-settings' | 'switch-model' | 'upgrade' }>): void {
    const store = useAgentStore.getState()
    const id = store.addAssistantMessage()
    store.addSystemAlertPart(id, {
      alertType: 'error',
      title: translateAgentText('error'),
      message,
      actions,
    })
    store.finalizeAssistant(id)
  }

  /**
   * 清理指定线程的任务资源（唯一的"完成"处理点）
   * 
   * 职责：
   * - 完成助手消息（设置 isStreaming: false）
   * - 重置流状态（设置 phase: 'idle'）
   * - 清理任务记录
   */
  private cleanupTask(threadId: string | null): void {
    const store = useAgentStore.getState()

    if (threadId && this.runningTasks.has(threadId)) {
      const task = this.runningTasks.get(threadId)!
      if (task.assistantId) {
        store.finalizeAssistant(task.assistantId, threadId)
      }
      this.runningTasks.delete(threadId)
      // 同步释放兜底中止用的登记，避免集合无限增长
      if (task.requestId) this.agentRequestIds.delete(task.requestId)
    }

    // 重置该线程的流状态
    if (threadId) {
      const threadStore = store.forThread(threadId)
      // 先读取当前 loopState，判断是否被用户中止
      // Agent.abort() 会设置 loopState: 'aborted'，需要在清理后保留此标志
      // 任务完成监控 effect 通过此标志区分"正常完成"和"被中止"，
      // 决定标记任务为 DONE 还是 CANCELED，是否继续推进下一个任务
      const currentLoopState = store.threads[threadId]?.executionMeta?.loopState
      const wasAborted = currentLoopState === 'aborted'

      threadStore.setStreamPhase('idle')
      threadStore.setStreamState({ streamDetail: undefined })
      threadStore.clearExecutionMeta()
      // 若是被用户中止的，清理后重新设置 loopState: 'aborted'
      // 确保 effect 执行时仍能检测到此标志
      if (wasAborted) {
        threadStore.updateExecutionMeta({ loopState: 'aborted' })
      }
    }
  }

}

// 导出单例
export const Agent = new AgentClass()
