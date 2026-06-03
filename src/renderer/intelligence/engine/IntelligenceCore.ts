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
import type { ExecutionConfig } from '../application/AgentExecutor'
import { translateAgentText } from '@intelligence/utils/intelligenceTextUtils'
import { agentRuntime } from './AgentRuntime'
// import type { RunLoopFn } from './AgentRuntime'

import { buildAgentSystemPrompt } from '../prompt-engine/PromptComposer'
import { taskComplexityDetector } from '../capabilities/planning/TaskComplexityDetector'
import { smartOrchestrator, extractFilesFromOutput, type ExtractedFile, type AgentProgressEvent } from '../multiAgent/SmartOrchestrator'
import { runAgentSubLoop } from '../multiAgent/AgentSubLoop'
import { TeamCollaborationProtocol } from '../multiAgent/TeamCollaborationProtocol'
import { useStore } from '@renderer/state'
import type { WorkspaceAgent } from '@renderer/state/slices/agentWorkspaceSlice'
import { playNotificationSound } from '@utils/notificationSound'

export class AgentClass {
  /** 运行中的任务（按线程追踪） */
  private runningTasks: Map<string, {
    abortController: AbortController
    assistantId: string
    requestId?: string
    planTaskId?: string
  }> = new Map()

  /** 多 Agent 协作是否已初始化 */


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
      const { prompt: systemPrompt, activeSkills } = await buildAgentSystemPrompt(chatMode, workspacePath, {
        ...promptOptions,
        mentionedSkills: mentionedSkills.length > 0 ? mentionedSkills : undefined,
        userMessage: userMsgText,
      })

      // 提前提取，避免后续重复声明
      const userQueryText = userMsgText

      // 将 auto 选中的 skills 追加到 assistant message（排除已 @mention 的）
      const mentionedSet = new Set(mentionedSkills)
      const autoSelectedSkills = activeSkills.filter(s => !mentionedSet.has(s.name))
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

          await this.continueMultiAgent(
            userQueryText,
            config,
            workspacePath,
            threadId,
            assistantId,
            existingSession
          )

          return { threadId, assistantId, requestId }
        }

        logger.agent.info(
          `[Agent] Team mode enabled, triggering multi-agent collaboration, ` +
          `features: [${complexityResult.features.join(', ')}]`
        )

        await this.executeMultiAgent(
          userQueryText,
          config,
          workspacePath,
          threadId,
          assistantId,
          requestId,
          { enabled: true, mode: 'always', threshold: 0, requireConsensus: true, maxAgents: 6 }
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
   * - 中止 LLM 请求
   * - 拒绝待审批的工具
   * - 更新所有运行中的工具状态为 error
   * - 清理资源
   */
  abort(threadId?: string): void {
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

    if (effectiveRequestId && pendingToolCalls && pendingToolCalls.length > 0) {
      for (const tc of pendingToolCalls) {
        approvalService.approve(`${effectiveRequestId}_${tc.id}`)
      }
    } else if (effectiveRequestId) {
      approvalService.approve(effectiveRequestId)
    }
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

    if (effectiveRequestId && pendingToolCalls && pendingToolCalls.length > 0) {
      for (const tc of pendingToolCalls) {
        approvalService.reject(`${effectiveRequestId}_${tc.id}`)
      }
    } else if (effectiveRequestId) {
      approvalService.reject(effectiveRequestId)
    }
  }

  approveAll(): void {
    const state = useAgentStore.getState()
    const currentThread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    const requestId = currentThread?.streamState?.requestId || currentThread?.executionMeta?.requestId
    const pendingToolCalls = currentThread?.streamState?.pendingApprovalToolCalls

    if (!requestId || !pendingToolCalls || pendingToolCalls.length === 0) {
      approvalService.approveAll()
      return
    }

    for (const tc of pendingToolCalls) {
      approvalService.approve(`${requestId}_${tc.id}`)
    }
  }

  rejectAll(): void {
    const state = useAgentStore.getState()
    const currentThread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
    const requestId = currentThread?.streamState?.requestId || currentThread?.executionMeta?.requestId
    const pendingToolCalls = currentThread?.streamState?.pendingApprovalToolCalls

    if (!requestId || !pendingToolCalls || pendingToolCalls.length === 0) {
      approvalService.rejectAll()
      return
    }

    for (const tc of pendingToolCalls) {
      approvalService.reject(`${requestId}_${tc.id}`)
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
   * 执行多 Agent 协作任务
   *
   * 将复杂任务分解为子任务，分配给不同角色的 Agent 并行执行，
   * 最后汇总结果并更新到 UI。
   */
  private async executeMultiAgent(
    task: string,
    config: LLMConfig,
    workspacePath: string | null,
    threadId: string,
    assistantId: string,
    _requestId: string,
    _multiAgentConfig: { enabled: boolean; mode: 'auto' | 'always'; threshold: number; requireConsensus: boolean; maxAgents: number }
  ): Promise<void> {
    const agentStore = useAgentStore.getState()
    const globalStore = useStore.getState()

    agentStore.setStreamPhase('streaming', threadId)
    agentStore.setStreamState({ streamDetail: 'reasoning' }, threadId)

    const sessionId = `ma-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const abortController = this.runningTasks.get(threadId)?.abortController

    const callLLM = async (systemPrompt: string, userMessage: string): Promise<string> => {
      if (abortController?.signal.aborted) {
        throw new Error('Aborted by user')
      }

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userMessage },
      ]

      const subRequestId = crypto.randomUUID()
      let fullContent = ''
      let fullReasoning = ''
      let settled = false

      return new Promise<string>((resolve, reject) => {
        let checkInterval: ReturnType<typeof setInterval> | null = null

        const cleanup = () => {
          if (checkInterval) clearInterval(checkInterval)
          unsubStream()
          unsubError()
          unsubDone()
        }

        const onAbort = () => {
          if (settled) return
          settled = true
          cleanup()
          api.llm.abort()
          reject(new Error('Aborted by user'))
        }

        abortController?.signal.addEventListener('abort', onAbort, { once: true })

        const unsubStream = api.llm.onStream(subRequestId, (data) => {
          if (data.type === 'text' && data.content) {
            fullContent += data.content
          }
          if (data.type === 'reasoning' && data.content) {
            fullReasoning += data.content
          }
        })

        const unsubError = api.llm.onError(subRequestId, (err) => {
          if (settled) return
          settled = true
          abortController?.signal.removeEventListener('abort', onAbort)
          cleanup()
          reject(new Error(err.message))
        })

        const unsubDone = api.llm.onDone(subRequestId, (data) => {
          if (settled) return
          settled = true
          abortController?.signal.removeEventListener('abort', onAbort)
          if (typeof data?.reasoning === 'string' && data.reasoning.length >= fullReasoning.length) {
            fullReasoning = data.reasoning
          }
          cleanup()
          resolve(fullContent || '无响应')
        })

        api.llm.send({
          config,
          messages,
          requestId: subRequestId,
        }).catch((err) => {
          if (settled) return
          settled = true
          abortController?.signal.removeEventListener('abort', onAbort)
          cleanup()
          reject(err)
        })

        checkInterval = setInterval(() => {
          if (settled && checkInterval) {
            clearInterval(checkInterval)
          }
          if (abortController?.signal.aborted && !settled) {
            settled = true
            cleanup()
            api.llm.abort()
            reject(new Error('Aborted by user'))
          }
        }, 200)

        setTimeout(() => {
          if (settled) return
          settled = true
          abortController?.signal.removeEventListener('abort', onAbort)
          cleanup()
          reject(new Error('Sub-task timeout (120s)'))
        }, 120000)
      })
    }

    try {
      globalStore.setActiveWorkspaceSession({
        sessionId,
        threadId,
        status: 'planning',
        summary: '',
        agents: [],
        teamChat: [],
        createdAt: Date.now(),
      })
      globalStore.setWorkspaceViewVisible(true)

      agentStore.appendToAssistant(assistantId, '🧠 **多智能体协作已启动**，已切换到智能体工作台查看详情', threadId)

      const context = workspacePath ? `Workspace: ${workspacePath}` : ''
      const plan = await smartOrchestrator.plan(task, context, callLLM)

      const projectName = plan.projectName
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        || 'project'
      const dirName = `${projectName}_${sessionId.slice(-6)}`

      let projectDir: string | null = null
      if (workspacePath) {
        projectDir = `${workspacePath}/${dirName}`
        try {
          await api.file.ensureDir(projectDir)
        } catch {
          // directory may already exist
        }
      }

      globalStore.updateWorkspaceSession({
        projectPath: projectDir || undefined,
      })

      const collaborationProtocol = new TeamCollaborationProtocol({
        onStateChange: (state) => {
          useStore.getState().updateWorkspaceSession({
            collaborationPhase: state.phase,
          })
        },
        onChatMessage: (message) => {
          useStore.getState().addTeamChatMessage(message)
        },
        callLLM,
        userLanguage: useStore.getState().language || 'zh',
      })

      const executeAgent = async (systemPrompt: string, userMessage: string): Promise<string> => {
        const lang = useStore.getState().language || 'zh'
        const langDirective = lang === 'zh'
          ? '\n\n【语言要求】你必须使用中文进行所有交流和输出，包括讨论、分析、文档、注释等。代码变量名和文件路径保持英文。'
          : '\n\n[Language] You MUST use English for all communication and output.'
        const result = await runAgentSubLoop({
          config,
          systemPrompt: systemPrompt + langDirective,
          userMessage,
          workspacePath: projectDir,
          maxIterations: 15,
          abortSignal: abortController?.signal,
        })

        if (result.error && !result.content) {
          throw new Error(result.error)
        }

        return result.content || ''
      }

      const saveExtractedFiles = async (
        agentId: string,
        agentName: string,
        content: string,
        extractedFiles: ExtractedFile[]
      ): Promise<string[]> => {
        if (!projectDir) return []
        const savedPaths: string[] = []

        if (extractedFiles.length > 0) {
          for (const file of extractedFiles) {
            try {
              const dirPart = file.path.includes('/')
                ? file.path.substring(0, file.path.lastIndexOf('/'))
                : ''
              if (dirPart) {
                await api.file.ensureDir(`${projectDir}/${dirPart}`)
              }
              const fullPath = `${projectDir}/${file.path}`
              await api.file.write(fullPath, file.content)
              savedPaths.push(fullPath)
            } catch (err) {
              logger.agent.warn(`[SmartOrchestrator] Failed to save file ${file.path}:`, err)
            }
          }
        } else {
          const ROLE_FILE_NAMES: Record<string, string> = {
            pm: 'pm_project-plan',
            architect: 'architect_design',
            frontend: 'frontend_ui',
            backend: 'backend_api',
            designer: 'designer_visual',
            tester: 'tester_test-plan',
            devops: 'devops_deploy',
            analyst: 'analyst_report',
          }
          const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
          const roleKey = Object.keys(ROLE_FILE_NAMES).find(k => safeId.includes(k))
          const fileBaseName = roleKey ? ROLE_FILE_NAMES[roleKey] : `agent_${safeId}`
          const outputPath = `${projectDir}/${fileBaseName}.md`
          try {
            await api.file.write(outputPath, content)
            savedPaths.push(outputPath)
          } catch (err) {
            logger.agent.warn(`[SmartOrchestrator] Failed to save output for ${agentName}:`, err)
          }
        }

        return savedPaths
      }

      const ROLE_MAP: Record<string, WorkspaceAgent['role']> = {
        'architect': 'architect',
        'developer': 'backend',
        'reviewer': 'analyst',
        'tester': 'tester',
        'coordinator': 'pm',
        'frontend': 'frontend',
        'designer': 'designer',
        'devops': 'devops',
      }

      const workspaceAgents: WorkspaceAgent[] = plan.agents.map(a => {
        const idLower = a.id.toLowerCase()
        const detectedRole: WorkspaceAgent['role'] = Object.entries(ROLE_MAP).find(([key]) => idLower.includes(key))?.[1] ?? 'custom'
        return {
          id: a.id,
          name: a.name,
          icon: a.icon,
          role: detectedRole,
          status: 'waiting' as const,
          taskDescription: a.taskDescription,
          scope: a.scope,
          forbidden: a.forbidden,
          outputFiles: [],
          progress: 0,
          currentStep: '',
          toolCalls: [],
          progressEvents: [],
          outputPreview: '',
          iterationCount: 0,
          retryCount: 0,
        }
      })

      const agentStatusMap = new Map<string, 'waiting' | 'working' | 'completed' | 'failed'>()
      for (const a of workspaceAgents) {
        agentStatusMap.set(a.id, 'waiting')
      }

      globalStore.updateWorkspaceSession({
        status: 'plan_review',
        agents: workspaceAgents,
        summary: plan.summary,
        collaborationPhase: 'meeting',
        plan: {
          agents: plan.agents.map(a => ({
            id: a.id,
            name: a.name,
            icon: a.icon,
            taskDescription: a.taskDescription,
            scope: a.scope,
            forbidden: a.forbidden,
          })),
          executionOrder: plan.executionOrder,
          summary: plan.summary,
        },
      })

      const agentInfoList = workspaceAgents.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
      }))

      await collaborationProtocol.startMeeting(task, agentInfoList)

      agentStore.appendToAssistant(assistantId, `\n\n📋 **协作计划已生成**: ${plan.summary}，共 ${plan.agents.length} 个智能体，请在工作台审核`, threadId)

      await new Promise<void>((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (abortController?.signal.aborted) {
            clearInterval(checkInterval)
            reject(new Error('Aborted by user'))
            return
          }
          const currentSession = useStore.getState().activeWorkspaceSession
          if (!currentSession || currentSession.sessionId !== sessionId) {
            clearInterval(checkInterval)
            reject(new Error('Session cancelled'))
            return
          }
          if (currentSession.status === 'executing') {
            clearInterval(checkInterval)
            resolve()
          }
          if (currentSession.status === 'failed') {
            clearInterval(checkInterval)
            reject(new Error('Plan rejected'))
          }
        }, 300)

        setTimeout(() => {
          clearInterval(checkInterval)
          const currentSession = useStore.getState().activeWorkspaceSession
          if (currentSession?.status === 'plan_review') {
            useStore.getState().updateWorkspaceSession({ status: 'executing' })
            resolve()
          }
        }, 30000)
      })

      await collaborationProtocol.startDiscussion(agentInfoList, task)

      await collaborationProtocol.startVoting(
        agentInfoList,
        ['按计划执行', '优化后执行']
      )

      collaborationProtocol.delegateTasks(
        workspaceAgents.map(a => ({
          agentId: a.id,
          agentName: a.name,
          task: a.taskDescription,
        }))
      )

      collaborationProtocol.startExecution()

      await smartOrchestrator.execute(plan, {
        onPlanCreated: () => {},

        onAgentStart: (agentId: string) => {
          agentStatusMap.set(agentId, 'working')
          useStore.getState().updateWorkspaceAgent(agentId, {
            status: 'working',
            startedAt: Date.now(),
            currentStep: '开始执行任务...',
          })
          useStore.getState().updateWorkspaceSession({ currentAgentId: agentId })

          const agent = plan.agents.find(a => a.id === agentId)
          if (agent) {
            useStore.getState().addTeamChatMessage({
              id: `chat-${Date.now()}-${agentId}-start`,
              fromAgentId: agentId,
              fromAgentName: agent.name,
              type: 'announce',
              content: `开始执行任务：${agent.taskDescription.slice(0, 100)}`,
              timestamp: Date.now(),
            })
          }
        },

        onAgentProgress: (agentId: string, event: AgentProgressEvent) => {
          const store = useStore.getState()
          store.addAgentProgressEvent(agentId, {
            type: event.type,
            content: event.content,
            toolName: event.toolName,
            timestamp: event.timestamp,
          })

          if (event.type === 'thinking') {
            store.updateWorkspaceAgent(agentId, {
              currentStep: event.content.length > 50 ? event.content.slice(0, 50) + '...' : event.content,
            })
          }

          if (event.type === 'tool_call' && event.toolName) {
            store.addAgentToolCall(agentId, {
              id: `tc-${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: event.toolName,
              arguments: {},
              status: 'running',
              timestamp: event.timestamp,
            })
          }

          if (event.type === 'tool_result' && event.toolName) {
            const agent = store.activeWorkspaceSession?.agents.find(a => a.id === agentId)
            if (agent) {
              const lastToolCall = [...agent.toolCalls].reverse().find(tc => tc.name === event.toolName && tc.status === 'running')
              if (lastToolCall) {
                store.updateAgentToolCall(agentId, lastToolCall.id, {
                  status: 'completed',
                  result: event.content.length > 500 ? event.content.slice(0, 500) + '...' : event.content,
                })
              }
            }
          }
        },

        onAgentRetry: (agentId: string, retryCount: number, maxRetries: number) => {
          useStore.getState().updateWorkspaceAgent(agentId, {
            retryCount,
            currentStep: `重试中 (${retryCount}/${maxRetries})...`,
          })

          const agent = plan.agents.find(a => a.id === agentId)
          if (agent) {
            agentStore.appendToAssistant(assistantId, `\n\n🔄 **${agent.icon} ${agent.name}** 正在重试 (${retryCount}/${maxRetries})`, threadId)
          }
        },

        onAgentComplete: async (agentId: string, _result: string, files: ExtractedFile[]) => {
          agentStatusMap.set(agentId, 'completed')
          const agent = plan.agents.find(a => a.id === agentId)
          const savedFiles = await saveExtractedFiles(agentId, agent?.name || agentId, _result, files)

          const session = useStore.getState().activeWorkspaceSession
          const wsAgent = session?.agents.find(a => a.id === agentId)
          const toolCreatedFiles: string[] = []
          if (wsAgent) {
            for (const tc of wsAgent.toolCalls) {
              if ((tc.name === 'write_file' || tc.name === 'create_file_or_folder') && tc.status === 'completed') {
                try {
                  const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments
                  const filePath = args?.path || args?.filePath || args?.file_path
                  if (filePath && projectDir) {
                    const fullPath = filePath.startsWith('/') ? filePath : `${projectDir}/${filePath}`
                    if (!toolCreatedFiles.includes(fullPath)) {
                      toolCreatedFiles.push(fullPath)
                    }
                  }
                } catch {}
              }
            }
          }

          const allOutputFiles = [...new Set([...savedFiles, ...toolCreatedFiles])]

          const outputPreview = _result.length > 500 ? _result.slice(0, 500) + '...' : _result

          useStore.getState().updateWorkspaceAgent(agentId, {
            status: 'completed',
            completedAt: Date.now(),
            outputFiles: allOutputFiles,
            progress: 100,
            currentStep: '已完成',
            outputPreview,
          })

          if (agent) {
            const store = useStore.getState()
            store.addTeamChatMessage({
              id: `chat-${Date.now()}-${agentId}`,
              fromAgentId: agentId,
              fromAgentName: agent.name,
              type: 'announce',
              content: allOutputFiles.length > 0
                ? `任务完成！已产出 ${allOutputFiles.length} 个文件：${allOutputFiles.map(f => f.split('/').pop()).join(', ')}`
                : '任务已完成！',
              attachments: allOutputFiles,
              timestamp: Date.now(),
            })

            const fileCount = savedFiles.length
            const fileNames = savedFiles.map(f => f.split('/').pop()).join(', ')
            const fileNote = fileCount > 0
              ? `（产出 ${fileCount} 个文件: ${fileNames}）`
              : ''
            agentStore.appendToAssistant(assistantId, `\n\n✅ **${agent.icon} ${agent.name}** 已完成 ${fileNote}`, threadId)

            const nextLayerAgents = plan.executionOrder
              .flatMap(layer => layer)
              .filter(id => !agentStatusMap.has(id) || agentStatusMap.get(id) === 'waiting')
            const nextAgentId = nextLayerAgents[0]
            if (nextAgentId) {
              const nextAgent = plan.agents.find(a => a.id === nextAgentId)
              if (nextAgent) {
                collaborationProtocol.createHandoff(
                  agentId,
                  agent.name,
                  nextAgentId,
                  nextAgent.name,
                  savedFiles.length > 0
                    ? `我已完成任务，产出文件：${savedFiles.map(f => f.split('/').pop()).join(', ')}，请继续。`
                    : '我已完成任务，请继续。',
                  savedFiles,
                )
              }
            }
          }
        },

        onAgentError: (agentId: string, error: string) => {
          agentStatusMap.set(agentId, 'failed')
          useStore.getState().updateWorkspaceAgent(agentId, {
            status: 'failed',
            completedAt: Date.now(),
            errorMessage: error,
            currentStep: '执行失败',
          })

          const agent = plan.agents.find(a => a.id === agentId)
          if (agent) {
            agentStore.appendToAssistant(assistantId, `\n\n❌ **${agent.icon} ${agent.name}** 执行失败: ${error}`, threadId)
          }
        },

        onAllComplete: async (_results: Map<string, string>, finalAnswer: string) => {
          collaborationProtocol.startReview()

          const failedCount = [...agentStatusMap.values()].filter(s => s === 'failed').length
          const completedCount = [...agentStatusMap.values()].filter(s => s === 'completed').length
          const allCompleted = failedCount === 0 && completedCount === workspaceAgents.length
          const finalStatus = allCompleted ? 'completed' : (completedCount > 0 ? 'completed' : 'failed')

          const session = useStore.getState().activeWorkspaceSession
          const totalDuration = session ? Date.now() - session.createdAt : undefined

          const allOutputFiles = session?.agents.flatMap(a => a.outputFiles) || []
          const deliverableFiles = allOutputFiles.filter(f => {
            const name = f.split('/').pop() || ''
            return !name.startsWith('pm_') && !name.startsWith('architect_') && !name.startsWith('frontend_') && !name.startsWith('backend_') && !name.startsWith('designer_') && !name.startsWith('tester_') && !name.startsWith('devops_') && !name.startsWith('analyst_') && !name.startsWith('agent_')
          })
          const roleRecordFiles = allOutputFiles.filter(f => !deliverableFiles.includes(f))

          let projectFilesList: string[] = []
          if (projectDir) {
            try {
              const listResult = await api.file.readDir(projectDir)
              if (Array.isArray(listResult)) {
                projectFilesList = listResult
                  .filter((item: { isDirectory?: boolean }) => !item.isDirectory)
                  .map((item: { name: string }) => item.name)
                  .filter((name: string) => !name.startsWith('.'))
              }
            } catch {}
          }

          const resultFiles = deliverableFiles.length > 0 ? deliverableFiles : projectFilesList.map((name: string) => projectDir ? `${projectDir}/${name}` : name)
          const resultFileNames = resultFiles.map(f => f.split('/').pop() || f)

          useStore.getState().updateWorkspaceSession({
            status: finalStatus,
            currentAgentId: undefined,
            totalDuration,
          })

          collaborationProtocol.complete()

          if (finalAnswer) {
            agentStore.appendToAssistant(assistantId, `\n\n---\n\n${finalAnswer}`, threadId)
          }

          const statusIcon = finalStatus === 'completed' ? '✅' : '⚠️'
          const statusText = finalStatus === 'completed' ? '全部完成' : `完成 ${completedCount} 项，失败 ${failedCount} 项`

          let resultSummary = `\n\n${statusIcon} **多智能体协作${statusText}**`

          if (projectDir) {
            resultSummary += `\n\n📁 **项目位置**: \`${projectDir}\``
          }

          if (resultFileNames.length > 0) {
            const isZh = useStore.getState().language === 'zh'
            resultSummary += isZh
              ? `\n\n📦 **项目结果文件** (${resultFileNames.length} 个):`
              : `\n\n📦 **Project Result Files** (${resultFileNames.length}):`
            const displayFiles = resultFileNames.slice(0, 15)
            for (const name of displayFiles) {
              resultSummary += `\n  - \`${name}\``
            }
            if (resultFileNames.length > 15) {
              resultSummary += `\n  - ... 及其他 ${resultFileNames.length - 15} 个文件`
            }
          }

          if (roleRecordFiles.length > 0) {
            resultSummary += `\n\n📝 *角色工作记录*: ${roleRecordFiles.map(f => f.split('/').pop()).join(', ')}`
          }

          if (projectDir) {
            const isZh = useStore.getState().language === 'zh'
            resultSummary += isZh
              ? '\n\n💡 **提示**: 点击上方项目位置路径可打开文件夹，或在"产出"标签页中点击文件名预览内容。'
              : '\n\n💡 **Tip**: Click the project path above to open the folder, or click file names in the "Output" tab to preview.'
          }

          agentStore.appendToAssistant(assistantId, resultSummary, threadId)

          try {
            playNotificationSound(finalStatus === 'completed' ? 'success' : 'attention')
          } catch {}
        },

        callLLM,
        executeAgent,
      }, projectDir)

      agentStore.finalizeAssistant(assistantId, threadId)
      agentStore.setStreamPhase('idle', threadId)

      logger.agent.info(
        `[SmartOrchestrator] Collaboration completed: agents=${plan.agents.length}, project=${projectName}`
      )
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.agent.error('[SmartOrchestrator] Collaboration failed:', errorMsg)

      const isAborted = errorMsg === 'Aborted by user'
      useStore.getState().updateWorkspaceSession({
        status: 'failed',
        currentAgentId: undefined,
      })

      try {
        playNotificationSound('error')
      } catch {}

      if (isAborted) {
        agentStore.appendToAssistant(assistantId, '\n\n⏹️ **多智能体协作已停止**', threadId)
      } else {
        agentStore.appendToAssistant(assistantId, `\n\n❌ **多智能体协作出错**: ${errorMsg}`, threadId)
      }
      agentStore.finalizeAssistant(assistantId, threadId)
      agentStore.setStreamPhase('idle', threadId)
    }
  }

  private async continueMultiAgent(
    task: string,
    config: LLMConfig,
    _workspacePath: string | null,
    threadId: string,
    assistantId: string,
    existingSession: import('@renderer/state/slices/agentWorkspaceSlice').AgentWorkspaceSession
  ): Promise<void> {
    const agentStore = useAgentStore.getState()
    const globalStore = useStore.getState()

    agentStore.setStreamPhase('streaming', threadId)
    agentStore.setStreamState({ streamDetail: 'reasoning' }, threadId)

    const projectDir = existingSession.projectPath!
    const existingAgents = existingSession.agents

    const abortController = this.runningTasks.get(threadId)?.abortController

    const callLLM = async (systemPrompt: string, userMessage: string): Promise<string> => {
      if (abortController?.signal.aborted) {
        throw new Error('Aborted by user')
      }

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userMessage },
      ]

      const subRequestId = crypto.randomUUID()
      let fullContent = ''
      let settled = false

      return new Promise<string>((resolve, reject) => {
        let checkInterval: ReturnType<typeof setInterval> | null = null

        const cleanup = () => {
          if (checkInterval) clearInterval(checkInterval)
          unsubStream()
          unsubError()
          unsubDone()
        }

        const onAbort = () => {
          if (settled) return
          settled = true
          cleanup()
          api.llm.abort()
          reject(new Error('Aborted by user'))
        }

        abortController?.signal.addEventListener('abort', onAbort, { once: true })

        const unsubStream = api.llm.onStream(subRequestId, (data) => {
          if (data.type === 'text' && data.content) {
            fullContent += data.content
          }
        })

        const unsubError = api.llm.onError(subRequestId, (err) => {
          if (settled) return
          settled = true
          abortController?.signal.removeEventListener('abort', onAbort)
          cleanup()
          reject(new Error(err.message))
        })

        const unsubDone = api.llm.onDone(subRequestId, () => {
          if (settled) return
          settled = true
          abortController?.signal.removeEventListener('abort', onAbort)
          cleanup()
          resolve(fullContent || '无响应')
        })

        api.llm.send({
          config,
          messages,
          requestId: subRequestId,
        }).catch((err) => {
          if (settled) return
          settled = true
          abortController?.signal.removeEventListener('abort', onAbort)
          cleanup()
          reject(err)
        })

        checkInterval = setInterval(() => {
          if (settled && checkInterval) {
            clearInterval(checkInterval)
          }
          if (abortController?.signal.aborted && !settled) {
            settled = true
            cleanup()
            api.llm.abort()
            reject(new Error('Aborted by user'))
          }
        }, 200)

        setTimeout(() => {
          if (settled) return
          settled = true
          abortController?.signal.removeEventListener('abort', onAbort)
          cleanup()
          reject(new Error('Sub-task timeout (120s)'))
        }, 120000)
      })
    }

    try {
      globalStore.updateWorkspaceSession({
        status: 'executing',
        collaborationPhase: 'discussion',
      })
      globalStore.setWorkspaceViewVisible(true)

      agentStore.appendToAssistant(assistantId, `\n\n🔄 **基于现有团队继续协作**，分析调整需求...`, threadId)

      const agentList = existingAgents.map(a => `- ${a.icon} ${a.name} (${a.role}): ${a.taskDescription.slice(0, 80)}`).join('\n')
      const lang = globalStore.language || 'zh'
      const analyzePrompt = lang === 'zh'
        ? `你是一个项目经理，团队已完成一轮协作。现在用户提出了新的需求或修改意见。

现有团队成员：
${agentList}

项目目录：${projectDir}

用户新需求：${task}

请分析需求，确定需要哪些角色来处理，以JSON格式输出：
{
  "assignments": [
    { "agentId": "角色ID", "task": "具体任务描述" }
  ],
  "summary": "简要说明调整方案"
}

只输出JSON，不要其他内容。agentId必须是现有团队成员之一。`
        : `You are a project manager. The team has completed a collaboration round. Now the user has a new request or modification.

Current team members:
${agentList}

Project directory: ${projectDir}

User's new request: ${task}

Analyze the request and determine which roles need to handle it. Output in JSON format:
{
  "assignments": [
    { "agentId": "agent-id", "task": "specific task description" }
  ],
  "summary": "brief adjustment plan"
}

Output ONLY JSON, nothing else. agentId must be one of the existing team members.`

      const analysisResult = await callLLM(analyzePrompt, task)

      let assignments: Array<{ agentId: string; task: string }> = []
      let summary = ''
      try {
        const jsonMatch = analysisResult.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          assignments = parsed.assignments || []
          summary = parsed.summary || ''
        }
      } catch {
        assignments = [{ agentId: existingAgents[0]?.id || 'pm', task }]
      }

      if (assignments.length === 0) {
        assignments = [{ agentId: existingAgents[0]?.id || 'pm', task }]
      }

      const resetAgents = existingAgents.map(a => ({
        ...a,
        status: 'waiting' as const,
        progress: 0,
        currentStep: '',
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: undefined,
        retryCount: 0,
      }))

      globalStore.updateWorkspaceSession({
        agents: resetAgents,
        collaborationPhase: 'execution',
      })

      agentStore.appendToAssistant(assistantId, `\n\n📋 **调整方案**: ${summary || '基于现有团队处理新需求'}`, threadId)

      const executeAgent = async (systemPrompt: string, userMessage: string): Promise<string> => {
        const langDirective = lang === 'zh'
          ? '\n\n【语言要求】你必须使用中文进行所有交流和输出。代码变量名和文件路径保持英文。'
          : '\n\n[Language] You MUST use English for all communication and output.'
        const result = await runAgentSubLoop({
          config,
          systemPrompt: systemPrompt + langDirective,
          userMessage,
          workspacePath: projectDir,
          maxIterations: 15,
          abortSignal: abortController?.signal,
        })

        if (result.error && !result.content) {
          throw new Error(result.error)
        }

        return result.content || ''
      }

      for (const assignment of assignments) {
        const agent = existingAgents.find(a => a.id === assignment.agentId)
        if (!agent) continue

        if (abortController?.signal.aborted) {
          throw new Error('Aborted by user')
        }

        globalStore.updateWorkspaceAgent(assignment.agentId, {
          status: 'working',
          startedAt: Date.now(),
          currentStep: assignment.task.slice(0, 50),
        })
        globalStore.updateWorkspaceSession({ currentAgentId: assignment.agentId })

        const langDirective = lang === 'zh'
          ? '\n\n【语言要求】你必须使用中文进行所有交流和输出。代码变量名和文件路径保持英文。'
          : '\n\n[Language] You MUST use English for all communication and output.'

        const systemPrompt = `你是${agent.name}，负责${agent.scope}。你的职责范围：${agent.scope}。禁止做：${agent.forbidden}。项目目录：${projectDir}。你必须使用工具（write_file等）创建实际文件。${langDirective}`

        try {
          const result = await executeAgent(systemPrompt, assignment.task)

          const files = extractFilesFromOutput(result)
          const savedPaths: string[] = []

          if (projectDir && files.length > 0) {
            for (const file of files) {
              try {
                const dirPart = file.path.includes('/')
                  ? file.path.substring(0, file.path.lastIndexOf('/'))
                  : ''
                if (dirPart) {
                  await api.file.ensureDir(`${projectDir}/${dirPart}`)
                }
                const fullPath = `${projectDir}/${file.path}`
                await api.file.write(fullPath, file.content)
                savedPaths.push(fullPath)
              } catch (err) {
                logger.agent.warn(`[ContinueMultiAgent] Failed to save file ${file.path}:`, err)
              }
            }
          }

          globalStore.updateWorkspaceAgent(assignment.agentId, {
            status: 'completed',
            completedAt: Date.now(),
            outputFiles: [...agent.outputFiles, ...savedPaths],
            progress: 100,
            currentStep: '已完成',
          })

          agentStore.appendToAssistant(
            assistantId,
            `\n\n✅ **${agent.icon} ${agent.name}** 已完成调整 ${savedPaths.length > 0 ? `（产出 ${savedPaths.length} 个文件）` : ''}`,
            threadId
          )
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          if (errorMsg === 'Aborted by user') throw err

          globalStore.updateWorkspaceAgent(assignment.agentId, {
            status: 'failed',
            completedAt: Date.now(),
            errorMessage: errorMsg,
            currentStep: '执行失败',
          })

          agentStore.appendToAssistant(assistantId, `\n\n❌ **${agent.icon} ${agent.name}** 执行失败: ${errorMsg}`, threadId)
        }
      }

      const finalAgents = globalStore.activeWorkspaceSession?.agents || []
      const allCompleted = finalAgents.every(a => a.status === 'completed' || a.status === 'waiting')
      const hasFailed = finalAgents.some(a => a.status === 'failed')

      globalStore.updateWorkspaceSession({
        status: allCompleted && !hasFailed ? 'completed' : 'completed',
        currentAgentId: undefined,
        collaborationPhase: 'completed',
      })

      agentStore.appendToAssistant(
        assistantId,
        `\n\n✅ **团队调整任务已完成**\n\n📁 **项目位置**: \`${projectDir}\`\n\n💡 继续提出修改需求，团队将基于现有成果进行调整。`,
        threadId
      )

      try {
        playNotificationSound('success')
      } catch {}

      agentStore.finalizeAssistant(assistantId, threadId)
      agentStore.setStreamPhase('idle', threadId)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.agent.error('[ContinueMultiAgent] Failed:', errorMsg)

      const isAborted = errorMsg === 'Aborted by user'
      globalStore.updateWorkspaceSession({
        status: 'failed',
        currentAgentId: undefined,
      })

      try {
        playNotificationSound('error')
      } catch {}

      if (isAborted) {
        agentStore.appendToAssistant(assistantId, '\n\n⏹️ **团队调整已停止**', threadId)
      } else {
        agentStore.appendToAssistant(assistantId, `\n\n❌ **团队调整出错**: ${errorMsg}`, threadId)
      }
      agentStore.finalizeAssistant(assistantId, threadId)
      agentStore.setStreamPhase('idle', threadId)
    }
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
   * 清理资源
   * 
   * 在以下情况调用：
   * - 正常完成（finally 块）
   * - 用户中止（abort 方法）
   * - 发生错误（finally 块）
   */
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
