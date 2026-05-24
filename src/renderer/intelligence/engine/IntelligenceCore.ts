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
import type { RunLoopFn } from './AgentRuntime'

import { buildAgentSystemPrompt } from '../prompt-engine/PromptComposer'
import { taskComplexityDetector } from '../capabilities/planning/TaskComplexityDetector'
import { multiAgentOrchestrator, agentRegistry, DEFAULT_AGENT_PROFILES, loadCustomAgentProfiles } from './MultiAgentOrchestrator'
import { useStore } from '@renderer/state'

export class AgentClass {
  /** 运行中的任务（按线程追踪） */
  private runningTasks: Map<string, {
    abortController: AbortController
    assistantId: string
    requestId?: string
    planTaskId?: string
  }> = new Map()

  /** 多 Agent 协作是否已初始化 */
  private multiAgentInitialized = false

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
      // 检测任务复杂度，决定是否启用多 Agent 协作
      const complexityResult = taskComplexityDetector.analyze(userQueryText)

      // 读取用户多 Agent 配置
      const globalStore = useStore.getState()
      const multiAgentConfig = globalStore.agentConfig.multiAgent ?? { enabled: true, threshold: 50, requireConsensus: true, maxAgents: 5 }

      if (
        multiAgentConfig.enabled &&
        complexityResult.total >= multiAgentConfig.threshold &&
        chatMode === 'agent'
      ) {
        logger.agent.info(
          `[Agent] Complex task detected (score: ${complexityResult.total} >= threshold: ${multiAgentConfig.threshold}), ` +
          `features: [${complexityResult.features.join(', ')}]`
        )

        // 初始化多 Agent 环境（只执行一次）
        if (!this.multiAgentInitialized) {
          DEFAULT_AGENT_PROFILES.forEach(p => agentRegistry.register(p))
          // 加载用户自定义角色
          loadCustomAgentProfiles(globalStore.agentConfig.customAgentProfiles)
          this.multiAgentInitialized = true
          logger.agent.info('[Agent] Multi-agent environment initialized')
        }

        // 执行多 Agent 协作
        await this.executeMultiAgent(
          userQueryText,
          config,
          workspacePath,
          threadId,
          assistantId,
          requestId,
          complexityResult,
          multiAgentConfig
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
    requestId: string,
    complexityResult: import('../capabilities/planning/TaskComplexityDetector').ComplexityScore,
    multiAgentConfig: { enabled: boolean; threshold: number; requireConsensus: boolean; maxAgents: number }
  ): Promise<void> {
    const store = useAgentStore.getState()

    // 更新状态：显示多 Agent 协作中
    store.setStreamPhase('streaming', threadId)
    store.setStreamState({ streamDetail: 'reasoning' }, threadId)

    // 添加系统提示，告知用户正在使用多 Agent 协作
    store.appendToAssistant(assistantId, `🤖 **多 Agent 协作模式**\n\n`, threadId)
    store.appendToAssistant(
      assistantId,
      `检测到复杂任务（复杂度: ${complexityResult.total}/100），已启用多 Agent 协作。\n` +
      `涉及领域: ${complexityResult.features.join('、')}\n\n`,
      threadId
    )

    try {
        // 定义 Agent 执行器：调用 LLM 完成子任务
        const agentExecutor = async (agentId: string, subTask: string): Promise<string> => {
          const agent = agentRegistry.get(agentId)
          if (!agent) {
            throw new Error(`Agent ${agentId} not found`)
          }

          logger.agent.info(`[MultiAgent] Executing sub-task with ${agent.name}: ${subTask.slice(0, 50)}...`)

          // 构建带角色 systemPrompt 的 LLM 请求
          const messages = [
            { role: 'system' as const, content: agent.systemPrompt },
            { role: 'user' as const, content: subTask },
          ]

          // 使用流式接口但等待完整结果
          const subRequestId = crypto.randomUUID()
          let fullContent = ''
          let done = false
          let error: Error | null = null

          return new Promise<string>((resolve, reject) => {
            api.llm.onStream(subRequestId, (data) => {
              if (data.type === 'text' && data.content) {
                fullContent += data.content
              }
            })

            api.llm.onError(subRequestId, (err) => {
              error = new Error(err.message)
              done = true
            })

            api.llm.onDone(subRequestId, () => {
              done = true
            })

            api.llm.send({
              config,
              messages,
              requestId: subRequestId,
            }).catch(reject)

            // 轮询等待完成
            const checkInterval = setInterval(() => {
              if (done) {
                clearInterval(checkInterval)
                if (error) {
                  reject(error)
                } else {
                  resolve(fullContent || '无响应')
                }
              }
            }, 100)

            // 超时处理（60秒）
            setTimeout(() => {
              clearInterval(checkInterval)
              if (!done) {
                reject(new Error('Sub-task timeout'))
              }
            }, 60000)
          })
        }

      // 执行多 Agent 协作
      const result = await multiAgentOrchestrator.collaborate(
        task,
        {
          mode: 'chat',
          workspacePath,
          requireConsensus: multiAgentConfig.requireConsensus && complexityResult.total > 50,
          maxAgents: multiAgentConfig.maxAgents,
        },
        agentExecutor
      )

      // 汇总结果输出到 UI
      if (result.success) {
        store.appendToAssistant(assistantId, `✅ **协作完成**（耗时 ${result.duration}ms）\n\n`, threadId)

        // 显示各子任务结果
        for (const subTask of result.subTasks) {
          const status = subTask.status === 'completed' ? '✅' : '❌'
          store.appendToAssistant(
            assistantId,
            `${status} **${subTask.title}**\n${subTask.result || ''}\n\n`,
            threadId
          )
        }

        // 显示共识结果
        if (result.consensusReached !== undefined) {
          store.appendToAssistant(
            assistantId,
            `📊 **共识投票**: ${result.consensusReached ? '✅ 已通过' : '⚠️ 未通过'}\n\n`,
            threadId
          )
        }

        // 最终汇总
        if (result.finalAnswer) {
          store.appendToAssistant(assistantId, `---\n\n📋 **最终汇总**:\n${result.finalAnswer}`, threadId)
        }
      } else {
        store.appendToAssistant(
          assistantId,
          `⚠️ **协作未完成**，部分子任务失败。\n\n${result.finalAnswer || ''}`,
          threadId
        )
      }

      // 完成助手消息
      store.finalizeAssistant(assistantId, threadId)
      store.setStreamPhase('idle', threadId)

      logger.agent.info(
        `[MultiAgent] Collaboration completed: success=${result.success}, ` +
        `subTasks=${result.subTasks.length}, duration=${result.duration}ms`
      )
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.agent.error('[MultiAgent] Collaboration failed:', errorMsg)
      store.appendToAssistant(assistantId, `\n\n❌ **多 Agent 协作出错**: ${errorMsg}`, threadId)
      store.finalizeAssistant(assistantId, threadId)
      store.setStreamPhase('idle', threadId)
      throw error
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
