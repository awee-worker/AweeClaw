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
import { AppError, formatErrorMessage } from '@shared/exceptions'
import { useAgentStore } from '../state/IntelligenceStore'
import {
  buildPersistedAgentSessionState,
  persistCriticalAgentSessionState,
  resumeAgentStorageWrites,
  suspendAgentStorageWrites,
} from '../state/intelligenceStorage'
import { fileCacheService } from '../runtime/fileCacheManager'
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
import { executeMultiAgent, continueMultiAgent, type RunningTask } from './MultiAgentExecution'
import { useStore } from '@renderer/state'
import { terminalManager } from '@services/TerminalAdapter'

export class AgentClass {
  /** 运行中的任务（按线程追踪） */
  private runningTasks: Map<string, RunningTask> = new Map()

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
      if (agentHarness.isInitialized) {
        harnessSpan = agentHarness.observability.startSpan('agent.send', `thread-${threadId ?? 'new'}`, undefined, { chatMode, workspacePath })
      }
      suspendAgentStorageWrites()
      persistSuspended = true
      // 1. 【性能关键】批量初始化消息环境（合并用户消息、助手气泡、上下文清理）
      const { assistantId, threadId: preparedThreadId } = store.prepareExecution(userMessage, contextItems, executionOptions?.threadId)

      threadId = preparedThreadId
      if (!threadId) {
        logger.agent.error('[Agent] No thread ID after prepareExecution')
        throw new Error('No thread ID after prepareExecution')
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
      taskRegistered = true

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
        const canContinueSession = existingSession
          && existingSession.status === 'completed'
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

      // 5. 创建检查点（用于撤销）
      const checkpointImages = this.extractCheckpointImages(userMessage)
      const messageText = typeof userMessage === 'string' ? userMessage.slice(0, 50) : 'User message'
      const userMessageId = useAgentStore.getState().threads[threadId]?.messages.filter(m => m.role === 'user').at(-1)?.id
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
        contextLimit: config.contextLimit,
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
        config,
        llmMessages: preparation.messages,
        context: executionContext,
        assistantId,
        budgetController: preparation.budgetController,
      })

      return { threadId, assistantId, requestId }
    } catch (error) {
      if (harnessSpan) {
        agentHarness.observability.endSpan(harnessSpan, 'error')
        harnessSpan = null
      }
      const appError = AppError.fromError(error)
      logger.agent.error('[Agent] Error:', appError.toJSON())
      this.showError(formatErrorMessage(appError))
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
        this.cleanupTask(threadId)
      }
    }
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
    logger.agent.warn('[Agent.abort] Called. Stack:', new Error().stack?.slice(0, 800))

    const store = useAgentStore.getState()
    const targetThreadId = threadId || store.currentThreadId

    // 中止当前线程的任务
    if (targetThreadId && this.runningTasks.has(targetThreadId)) {
      const task = this.runningTasks.get(targetThreadId)!
      task.abortController.abort()

      const thread = store.threads[targetThreadId]
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
              }, targetThreadId)
            }
          }
        }
        store.finalizeAssistant(task.assistantId, targetThreadId)
      }

      this.runningTasks.delete(targetThreadId)
    }

    api.llm.abort()

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

    if (targetThreadId) {
      const thread = useAgentStore.getState().threads[targetThreadId]
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

    const thread = targetThreadId ? store.threads[targetThreadId] : store.getCurrentThread()
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

    if (targetThreadId) {
      const threadStore = store.forThread(targetThreadId)
      threadStore.updateExecutionMeta({ loopState: 'aborted' })
      threadStore.setStreamPhase('idle')
      threadStore.setStreamState({ streamDetail: undefined })
      threadStore.clearExecutionMeta()
    } else {
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
   */
  private showError(message: string): void {
    const store = useAgentStore.getState()
    const id = store.addAssistantMessage()
    store.addSystemAlertPart(id, {
      alertType: 'error',
      title: translateAgentText('error'),
      message,
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
    }

    // 重置该线程的流状态
    if (threadId) {
      const threadStore = store.forThread(threadId)
      threadStore.setStreamPhase('idle')
      threadStore.setStreamState({ streamDetail: undefined })
      threadStore.clearExecutionMeta()
    }
  }

}

// 导出单例
export const Agent = new AgentClass()
