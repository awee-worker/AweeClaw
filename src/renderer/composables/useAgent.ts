/**
 * Agent 相关 Hook 集合
 *
 * 将 Agent 的视图状态、命令、动作和历史操作拆分为独立 Hook，
 * 渲染组件按需订阅，避免不必要的重渲染。
 */

import { api } from '../adapters/electronBridge'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useModeStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { getEffectiveLLMConfigAsync } from '@services/modelConfigHelper'
import {
  useAgentStore,
  selectMessageListState,
  selectStreamState,
  selectContextItems,
  selectIsStreaming,
  selectIsAwaitingApproval,
  selectPendingChanges,
  selectMessageCheckpoints,
} from '@intelligence/state/IntelligenceStore'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import {
  MessageContent,
  ChatThread,
  ToolCall,
  type LLMConfig,
} from '@intelligence/providerTypes'
import type { WorkMode } from '@/renderer/modes/workModeTypes'
import type { PlanStatus } from '@intelligence/planner/planTypes'

/* ------------------------------------------------------------------ */
/* 模式推理覆盖                                                       */
/* ------------------------------------------------------------------ */

/** 各模式默认推理强度 */
const MODE_DEFAULT_EFFORT: Record<WorkMode, LLMConfig['reasoningEffort']> = {
  chat: 'low',
  agent: 'high',
  plan: 'xhigh',
}

/** 各模式默认是否启用思考 */
const MODE_DEFAULT_THINKING: Record<WorkMode, boolean> = {
  chat: false,
  agent: true,
  plan: true,
}

/** 根据工作模式生成推理参数覆盖 */
function buildModeOverrides(
  mode: WorkMode,
  base: LLMConfig,
): Partial<LLMConfig> {
  if (!(mode in MODE_DEFAULT_EFFORT)) return {}
  return {
    reasoningEffort: base.reasoningEffort ?? MODE_DEFAULT_EFFORT[mode],
    enableThinking: base.enableThinking ?? MODE_DEFAULT_THINKING[mode],
  }
}

/* ------------------------------------------------------------------ */
/* 会话列表缓存                                                      */
/* ------------------------------------------------------------------ */

let cachedThreadsRef: Record<string, ChatThread> | null = null
let cachedSortedThreads: ChatThread[] = []
let cachedUserId: string | undefined = undefined

/** 获取当前用户可见的会话列表（按最近修改排序） */
export function useAllThreads(): ChatThread[] {
  const currentUserId = useStore((s) => s.cloudUser?.id)

  return useAgentStore((state) => {
    if (state.threads === cachedThreadsRef && currentUserId === cachedUserId) {
      return cachedSortedThreads
    }

    cachedThreadsRef = state.threads
    cachedUserId = currentUserId
    cachedSortedThreads = Object.values(state.threads)
      .filter((thread) => (currentUserId ? thread.userId === currentUserId : !thread.userId))
      .sort((a, b) => b.lastModified - a.lastModified)
    return cachedSortedThreads
  })
}

/* ------------------------------------------------------------------ */
/* 状态清理                                                           */
/* ------------------------------------------------------------------ */

/** 读取 Agent store 的动作 */
const getAgentActions = () => useAgentStore.getState()

/** 清空当前会话消息与工具调用日志 */
function clearAgentConversationState(): void {
  getAgentActions().clearMessages()
  useStore.getState().clearToolCallLogs()
}

/* ------------------------------------------------------------------ */
/* 命令 Hook                                                          */
/* ------------------------------------------------------------------ */

/** 发送消息所需的运行时参数 */
interface SendParams {
  llmConfig: LLMConfig
  workspacePath: string | null
  chatMode: WorkMode
  promptTemplateId: string
  aiInstructions: string
  openFiles: Array<{ path: string }>
  activeFilePath: string | null
  planPhase: 'planning' | 'executing'
}

export function useAgentCommands() {
  const llmConfig = useStore((state) => state.llmConfig)
  const workspacePath = useStore((state) => state.workspacePath)
  const promptTemplateId = useStore((state) => state.promptTemplateId)
  const openFiles = useStore((state) => state.openFiles)
  const activeFilePath = useStore((state) => state.activeFilePath)
  const chatMode = useModeStore((state) => state.currentMode)

  const [aiInstructions, setAiInstructions] = useState('')

  useEffect(() => {
    void api.settings.get('app-settings').then((settings: unknown) => {
      const typed = settings as { aiInstructions?: string } | undefined
      if (typed?.aiInstructions) setAiInstructions(typed.aiInstructions)
    })
  }, [])

  const planPhase = useAgentStore<'planning' | 'executing'>((state) => {
    const activePlan = state.plans.find((plan) => plan.id === state.activePlanId)
    const status = activePlan?.status
    const executingStatuses: PlanStatus[] = ['executing', 'pausing', 'stopping']
    return status && executingStatuses.includes(status) ? 'executing' : 'planning'
  })

  const streamState = useAgentStore(selectStreamState)

  // 使用 ref 保存最新参数，避免 sendMessage 依赖频繁变化
  const sendParamsRef = useRef<SendParams>({
    llmConfig,
    workspacePath,
    chatMode,
    promptTemplateId,
    aiInstructions,
    openFiles,
    activeFilePath,
    planPhase,
  })
  sendParamsRef.current = {
    llmConfig,
    workspacePath,
    chatMode,
    promptTemplateId,
    aiInstructions,
    openFiles,
    activeFilePath,
    planPhase,
  }

  const sendMessage = useCallback(async (content: MessageContent) => {
    const params = sendParamsRef.current
    const agentConfig = getAgentConfig()
    const effectiveConfig = await getEffectiveLLMConfigAsync(params.llmConfig)
    const overrides = buildModeOverrides(params.chatMode, effectiveConfig)

    const enhancedConfig: LLMConfig = {
      ...effectiveConfig,
      ...overrides,
      contextLimit: agentConfig.maxContextTokens,
    }

    await Agent.send(content, enhancedConfig, params.workspacePath, params.chatMode, {
      openFiles: params.openFiles.map((file) => file.path),
      activeFile: params.activeFilePath || undefined,
      customInstructions: params.aiInstructions,
      promptTemplateId: params.promptTemplateId,
      planPhase: params.chatMode === 'plan' ? params.planPhase : undefined,
    })
  }, [])

  const abort = useCallback((threadId?: string) => Agent.abort(threadId), [])

  const pendingApprovalRequestId = useMemo(() => {
    return streamState.phase === 'tool_pending' ? streamState.requestId : undefined
  }, [streamState.phase, streamState.requestId])

  const approveCurrentTool = useCallback(() => {
    Agent.approve(pendingApprovalRequestId)
  }, [pendingApprovalRequestId])

  const rejectCurrentTool = useCallback(() => {
    Agent.reject(pendingApprovalRequestId)
  }, [pendingApprovalRequestId])

  const approveAllTools = useCallback(() => Agent.approveAll(), [])
  const rejectAllTools = useCallback(() => Agent.rejectAll(), [])

  return {
    sendMessage,
    abort,
    approveCurrentTool,
    rejectCurrentTool,
    approveAllTools,
    rejectAllTools,
  }
}

/* ------------------------------------------------------------------ */
/* 动作 Hook                                                          */
/* ------------------------------------------------------------------ */

export function useAgentActions() {
  return useMemo(() => {
    const actions = getAgentActions()
    return {
      createThread: actions.createThread,
      renameThread: actions.renameThread,
      switchThread: actions.switchThread,
      ensureThreadLoaded: actions.ensureThreadLoaded,
      deleteThread: actions.deleteThread,
      deleteMessagesAfter: actions.deleteMessagesAfter,
      deleteMessagesByIds: actions.deleteMessagesByIds,
      acceptAllChanges: actions.acceptAllChanges,
      undoAllChanges: actions.undoAllChanges,
      acceptChange: actions.acceptChange,
      undoChange: actions.undoChange,
      restoreToCheckpoint: actions.restoreToCheckpoint,
      getCheckpointForMessage: actions.getCheckpointForMessage,
      addContextItem: actions.addContextItem,
      removeContextItem: actions.removeContextItem,
      clearContextItems: actions.clearContextItems,
      createBranch: actions.createBranch,
      switchBranch: actions.switchBranch,
      regenerateFromMessage: actions.regenerateFromMessage,
      clearMessages: clearAgentConversationState,
    }
  }, [])
}

export function useAgentHistoryActions() {
  return useMemo(
    () => ({
      clearMessages: clearAgentConversationState,
      clearCheckpoints: getAgentActions().clearMessageCheckpoints,
    }),
    [],
  )
}

export function useAgentChangeState() {
  const pendingChanges = useAgentStore(selectPendingChanges)

  return useMemo(
    () => ({
      pendingChanges,
      acceptChange: getAgentActions().acceptChange,
      undoChange: getAgentActions().undoChange,
    }),
    [pendingChanges],
  )
}

/* ------------------------------------------------------------------ */
/* 视图状态 Hook                                                      */
/* ------------------------------------------------------------------ */

/**
 * 空工具调用数组的共享引用。
 *
 * 没有待批准工具时必须复用它，而不是每次返回新的 `[]`：这个数组会经
 * `pendingApprovalToolCalls → pendingToolIds → ToolCallGroup` 一路透传，
 * 而 ToolCallGroup 是靠 props 浅比较挡重渲染的 —— 新数组引用会把整组
 * 工具卡片一路打穿。流式期间 streamState 每帧都在变，`[]` 也就每帧重建，
 * 于是文本推进时工具卡片跟着每秒重渲染几十次（实测 20~32 次/秒）。
 */
const EMPTY_TOOL_CALLS: ToolCall[] = []

export function useAgentViewState() {
  const {
    messages,
    messageListVersion,
    streamState,
    contextItems,
    isStreaming,
    isAwaitingApproval,
    pendingChanges,
    messageCheckpoints,
    currentThreadId,
  } = useAgentStore(
    useShallow((state) => ({
      messages: selectMessageListState(state).messages,
      messageListVersion: selectMessageListState(state).version,
      streamState: selectStreamState(state),
      contextItems: selectContextItems(state),
      isStreaming: selectIsStreaming(state),
      isAwaitingApproval: selectIsAwaitingApproval(state),
      pendingChanges: selectPendingChanges(state),
      messageCheckpoints: selectMessageCheckpoints(state),
      currentThreadId: state.currentThreadId,
    })),
  )

  const pendingToolCall = useMemo<ToolCall | undefined>(() => {
    if (streamState.phase === 'tool_pending' && streamState.currentToolCall) {
      return streamState.currentToolCall
    }
    return undefined
  }, [streamState])

  const pendingApprovalToolCalls = useMemo<ToolCall[]>(() => {
    if (streamState.phase === 'tool_pending' && streamState.pendingApprovalToolCalls) {
      return streamState.pendingApprovalToolCalls
    }
    return EMPTY_TOOL_CALLS
  }, [streamState])

  return {
    messages,
    messageListVersion,
    streamState,
    contextItems,
    isStreaming,
    isAwaitingApproval,
    pendingToolCall,
    pendingApprovalToolCalls,
    pendingChanges,
    messageCheckpoints,
    currentThreadId,
  }
}

/* ------------------------------------------------------------------ */
/* 聚合 Hook                                                          */
/* ------------------------------------------------------------------ */

export function useAgent() {
  const viewState = useAgentViewState()
  const commands = useAgentCommands()
  const actions = useAgentActions()
  const historyActions = useAgentHistoryActions()

  return {
    ...viewState,
    ...commands,
    ...actions,
    ...historyActions,
  }
}

/* ------------------------------------------------------------------ */
/* 定向线程消息发送（不切换 currentThreadId）                          */
/* ------------------------------------------------------------------ */

/**
 * useThreadMessenger — 向指定线程发送消息，不切换主聊天线程
 *
 * 与 useAgentCommands.sendMessage 的区别：
 * - sendMessage 绑定 currentThreadId（主聊天线程）
 * - sendToThread 通过 Agent.send 的 executionOptions.threadId 定向发送
 *   流式状态通过 forThread(threadId) 绑定目标线程，不污染主聊天
 *
 * 用途：项目任务执行、嵌入式对话等不希望切换主聊天界面的场景。
 */
export function useThreadMessenger() {
  const llmConfig = useStore((state) => state.llmConfig)
  const workspacePath = useStore((state) => state.workspacePath)
  const promptTemplateId = useStore((state) => state.promptTemplateId)
  const openFiles = useStore((state) => state.openFiles)
  const activeFilePath = useStore((state) => state.activeFilePath)
  const chatMode = useModeStore((state) => state.currentMode)

  const [aiInstructions, setAiInstructions] = useState('')

  useEffect(() => {
    void api.settings.get('app-settings').then((settings: unknown) => {
      const typed = settings as { aiInstructions?: string } | undefined
      if (typed?.aiInstructions) setAiInstructions(typed.aiInstructions)
    })
  }, [])

  const planPhase = useAgentStore<'planning' | 'executing'>((state) => {
    const activePlan = state.plans.find((plan) => plan.id === state.activePlanId)
    const status = activePlan?.status
    const executingStatuses: PlanStatus[] = ['executing', 'pausing', 'stopping']
    return status && executingStatuses.includes(status) ? 'executing' : 'planning'
  })

  const sendParamsRef = useRef({
    llmConfig,
    workspacePath,
    chatMode,
    promptTemplateId,
    aiInstructions,
    openFiles,
    activeFilePath,
    planPhase,
  })
  sendParamsRef.current = {
    llmConfig,
    workspacePath,
    chatMode,
    promptTemplateId,
    aiInstructions,
    openFiles,
    activeFilePath,
    planPhase,
  }

  /**
   * 向指定线程发送消息（不切换 currentThreadId）
   *
   * @param content 消息内容
   * @param threadId 目标线程 ID
   * @param options 发送选项
   *   - silent: 静默注入模式（不显示为用户消息气泡，但仍发送给 LLM）
   * @throws 若线程正在运行中（Agent.send 内部 runningTasks 拦截）
   */
  const sendToThread = useCallback(
    async (content: MessageContent, threadId: string, options?: { silent?: boolean }): Promise<void> => {
      const params = sendParamsRef.current
      const agentConfig = getAgentConfig()
      const effectiveConfig = await getEffectiveLLMConfigAsync(params.llmConfig)
      const overrides = buildModeOverrides(params.chatMode, effectiveConfig)

      const enhancedConfig: LLMConfig = {
        ...effectiveConfig,
        ...overrides,
        contextLimit: agentConfig.maxContextTokens,
      }

      await Agent.send(
        content,
        enhancedConfig,
        params.workspacePath,
        params.chatMode,
        {
          openFiles: params.openFiles.map((file) => file.path),
          activeFile: params.activeFilePath || undefined,
          customInstructions: params.aiInstructions,
          promptTemplateId: params.promptTemplateId,
          planPhase: params.chatMode === 'plan' ? params.planPhase : undefined,
        },
        { threadId, silent: options?.silent },
      )
    },
    [],
  )

  /** 中止指定线程的执行（不影响主聊天线程） */
  const abortThread = useCallback((threadId: string): void => {
    Agent.abort(threadId)
  }, [])

  /** 查询指定线程是否正在流式输出 */
  const isThreadStreaming = useCallback((threadId: string): boolean => {
    const state = useAgentStore.getState()
    const phase = state.threads[threadId]?.streamState?.phase
    return phase === 'streaming' || phase === 'tool_running' || phase === 'tool_pending'
  }, [])

  return { sendToThread, abortThread, isThreadStreaming }
}
