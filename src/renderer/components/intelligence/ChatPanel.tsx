/**
 * 聊天面板组件
 * 采用「组合式 Hook 架构」：
 *  - useAttachmentManager：附件生命周期
 *  - useMentionController：Mention 弹窗
 *  - useSlashCommandController：斜杠命令
 *  - useMessageOperations：消息操作
 *  - useFileEventBridge：文件事件桥接
 *  - useTimelineProjection：时间线投影
 *  - useChatKeyboard：键盘处理
 * 主组件仅负责组合各 Hook 和渲染子组件
 */
import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, type ComponentPropsWithoutRef } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { Virtuoso } from 'react-virtuoso'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useModeStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentActions, useAgentCommands, useAgentViewState } from '@hooks/useAgent'
import { useChatScrollController, useAutoSpeak } from '@hooks'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { knowledgeExtractor } from '@intelligence/runtime/knowledgeService/extractor'
import { type Language } from '@renderer/i18n'
import { toFullPath } from '@shared/toolkit/pathHelper'
import {
  isUserMessage,
  isAssistantMessage,
  getMessageText,
  type ContextItem,
  type FileContext,
} from '@intelligence/providerTypes'
import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

import MentionPopup from './MentionPopup'
import ChatMessageUI from './ChatMessage'
import ChangesReviewPanel from './ChangesReviewPanel'
import SlashCommandPopup from './SlashCommandPopup'
import EmptyChatSuggestions from '../conversation/WelcomeSuggestions'
import { ChatMessagesSkeleton } from '../ui/ProgressIndicator'
import { playNotificationSound } from '@utils/notificationSound'
import { AgentWorkspace } from './AgentWorkspace'
import type { ChatTimelineItem } from './chatTimelineProjection'

import { useAttachmentManager } from './chatPanel/useAttachmentManager'
import { useMentionController } from './chatPanel/useMentionController'
import { useSlashCommandController } from './chatPanel/useSlashCommandController'
import { useMessageOperations } from './chatPanel/useMessageOperations'
import { useFileEventBridge } from './chatPanel/useFileEventBridge'
import { useTimelineProjection, type RenderableMessageItem } from './chatPanel/useTimelineProjection'
import { useChatKeyboard } from './chatPanel/useChatKeyboard'
import { useHumanApprovalWatcher } from './chatPanel/useHumanApprovalWatcher'

import { DragOverlay } from './chatPanel/components/DragOverlay'
import { WorkspaceToggleBar } from './chatPanel/components/WorkspaceToggleBar'
import { ApiWarningBanner } from './chatPanel/components/ApiWarningBanner'
import { ScrollToBottomButton } from './chatPanel/components/ScrollToBottomButton'
import { DeleteSelectionBar } from './chatPanel/components/DeleteSelectionBar'
import { ArchiveTimelineItemView } from './chatPanel/components/ArchiveTimelineItemView'
import { ChatInputWrapper } from './chatPanel/components/ChatInputWrapper'
import { MessageIndexBar, type MessageIndexItem } from './chatPanel/components/MessageIndexBar'
import { PredictionBubble } from './chatPanel/components/PredictionBubble'
import PendingChangesBar from './PendingChangesBar'
import { HumanApprovalCard } from './HumanApprovalCard'
import { playPendingReviewSound } from '@renderer/utils/sound'
import { ProactiveSuggestionsContainer } from './proactive/ProactiveSuggestionsContainer'
import { useProactiveInvoker } from './proactive/useProactiveInvoker'
import { useAutomationCronExecutor } from './proactive/useAutomationCronExecutor'

export default function ChatPanel() {
  // ===== Store 状态订阅 =====
  const {
    llmConfig,
    cloudMode,
    isAuthenticated,
    workspacePath,
    openFile,
    setActiveFile,
    language,
    activeFilePath,
    selectedCode,
    activeScenarioId,
    workspaceViewVisible,
    setWorkspaceViewVisible,
    activeWorkspaceSession,
    teamModeEnabled,
    setTeamModeEnabled,
  } = useStore(
    useShallow(s => ({
      llmConfig: s.llmConfig,
      cloudMode: s.cloudMode,
      isAuthenticated: s.isAuthenticated,
      workspacePath: s.workspacePath,
      openFile: s.openFile,
      setActiveFile: s.setActiveFile,
      language: s.language,
      activeFilePath: s.activeFilePath,
      selectedCode: s.selectedCode,
      activeScenarioId: s.activeScenarioId,
      workspaceViewVisible: s.workspaceViewVisible,
      setWorkspaceViewVisible: s.setWorkspaceViewVisible,
      activeWorkspaceSession: s.activeWorkspaceSession,
      teamModeEnabled: s.teamModeEnabled,
      setTeamModeEnabled: s.setTeamModeEnabled,
    })),
  )

  const isChatPrimary = activeScenarioId !== 'dev-assistant'

  // ===== AgentStore 状态订阅 =====
  const inputPrompt = useAgentStore(state => state.inputPrompt)
  const setInputPrompt = useAgentStore(state => state.setInputPrompt)
  const hasActiveThread = useAgentStore(state => {
    if (!state.currentThreadId) return false
    return !!state.threads[state.currentThreadId]
  })
  const activeThreadMessagesHydrated = useAgentStore(state => {
    if (!state.currentThreadId) return true
    return state.threads[state.currentThreadId]?.messagesHydrated !== false
  })

  const chatMode = useModeStore(s => s.currentMode)
  const setChatMode = useModeStore(s => s.setMode)

  // ===== Agent 视图与命令 =====
  const {
    messages,
    isStreaming,
    isAwaitingApproval,
    pendingToolCall,
    pendingApprovalToolCalls,
    pendingChanges,
    messageCheckpoints,
    contextItems,
    currentThreadId,
    messageListVersion,
  } = useAgentViewState()

  /** 所有待批准工具 id 集合，用于批量批准面板 */
  const pendingToolIds = useMemo(
    () => pendingApprovalToolCalls.map((tc) => tc.id),
    [pendingApprovalToolCalls],
  )

  // AI 回复完成（isStreaming 从 true→false）统一处理：
  // 1. 有待接受文件变更时播放提示音
  // 2. 云端模式下刷新配额
  // prevStreamingRef 在此统一声明，下方"流式完成后刷新配额"复用
  const prevStreamingRef = useRef(isStreaming)
  const pendingReviewSoundPlayedRef = useRef(false)
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current
    prevStreamingRef.current = isStreaming

    if (wasStreaming && !isStreaming) {
      // 流式结束：有待确认变更则播放提示音
      if (pendingChanges.length > 0 && !pendingReviewSoundPlayedRef.current) {
        pendingReviewSoundPlayedRef.current = true
        playPendingReviewSound()
      }
      // 流式结束：云端模式刷新配额
      const { isAuthenticated, cloudMode, fetchQuota } = useStore.getState()
      if (isAuthenticated && cloudMode === 'cloud') {
        fetchQuota().catch(() => {})
      }
    }

    // 重新开始流式时重置提示音标记
    if (isStreaming) {
      pendingReviewSoundPlayedRef.current = false
    }
  }, [isStreaming, pendingChanges.length])

  const { sendMessage, abort, approveCurrentTool, rejectCurrentTool, approveAllTools, rejectAllTools } = useAgentCommands()

  // abort 显式传入 currentThreadId，确保执行窗口等多窗口场景下中止正确的线程
  // ⚠️ 优先使用闭包中的 currentThreadId（来自 useAgentViewState，响应式更新），
  //   若闭包值过期（如组件未及时重渲染），回退到 store 中的实时值。
  //   Agent.abort 内部还有全量中止兜底，即使 threadId 不匹配也能停止 AI。
  const handleAbort = useCallback(() => {
    // 实时读取 store 中的 currentThreadId，防止闭包值过期
    const freshThreadId = useAgentStore.getState().currentThreadId
    const effectiveThreadId = freshThreadId || currentThreadId
    logger.system.info(
      '[ChatPanel] handleAbort called, closureThreadId:', currentThreadId,
      'freshThreadId:', freshThreadId,
      'effectiveThreadId:', effectiveThreadId,
    )
    abort(effectiveThreadId ?? undefined)
  }, [abort, currentThreadId])
  const {
    clearMessages,
    deleteMessagesAfter,
    acceptAllChanges,
    undoAllChanges,
    acceptChange,
    undoChange,
    restoreToCheckpoint,
    getCheckpointForMessage,
    addContextItem,
    removeContextItem,
    deleteMessagesByIds,
  } = useAgentActions()

  // ===== 输入状态 =====
  const [inputState, setInputState] = useState('')
  const [deleteSelectionMode, setDeleteSelectionMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())
  const input = inputState
  const setInput = useCallback((value: string | null | undefined) => {
    setInputState(value ?? '')
  }, [])
  const inputPromptConsumedRef = useRef(false)

  useEffect(() => {
    if (inputPrompt && !inputPromptConsumedRef.current) {
      setInputState(inputPrompt)
      inputPromptConsumedRef.current = true
      setInputPrompt('')
    }
    if (!inputPrompt) {
      inputPromptConsumedRef.current = false
    }
  }, [inputPrompt, setInputPrompt])

  useEffect(() => {
    if (activeWorkspaceSession && !teamModeEnabled) {
      setTeamModeEnabled(true)
    }
  }, [activeWorkspaceSession, teamModeEnabled, setTeamModeEnabled])

  const checkpointMessageIds = useMemo(
    () => new Set(messageCheckpoints.map(checkpoint => checkpoint.messageId)),
    [messageCheckpoints],
  )

  // ===== 感知预测场景上下文（用于 PredictionBubble 触发预测） =====
  const perceptionSceneContext = useMemo(
    () => ({
      app: 'AweeClaw',
      activity: 'coding' as const,
      text: [activeFilePath, workspacePath].filter(Boolean).join(' '),
      openFiles: activeFilePath ? [activeFilePath] : [],
    }),
    [activeFilePath, workspacePath],
  )

  useAutoSpeak({ isStreaming, messages })

  // ===== 主动式助手 high/critical 级派发订阅（s10-06）=====
  // 订阅 'proactive:invoke-agent' 和 'proactive:execute-action' 频道
  // 收到 high/critical 级提案时自动调用 Agent.send 发起主动对话
  useProactiveInvoker()

  // ===== 自动化规则 Cron 执行订阅 =====
  // 监听 'cron:task-execute' 事件，用用户当前配置的模型在本地执行自动化 Agent 任务
  useAutomationCronExecutor()

  // ===== 过滤消息列表 =====
  const filteredMessages = useMemo(
    () => messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    [messages, messageListVersion],
  )

  // ref 桥接：保存最新的 filteredMessages，避免 EventBus 订阅因 filteredMessages
  // 引用变化而频繁注销/重注册（每次消息更新都会产生新的 filteredMessages 引用）
  const filteredMessagesRef = useRef(filteredMessages)
  filteredMessagesRef.current = filteredMessages

  // ===== DOM 引用 =====
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)

  // ===== 组合各功能 Hook =====
  const attachmentManager = useAttachmentManager({ workspacePath, addContextItem })

  const mentionController = useMentionController({
    workspacePath,
    input,
    setInput,
    contextItems,
    addContextItem,
    textareaRef,
    inputContainerRef,
  })

  const slashCommandController = useSlashCommandController({
    setInput,
    setChatMode: setChatMode as any,
    activeFilePath,
    selectedCode,
    workspacePath,
    textareaRef,
  })

  const messageOps = useMessageOperations({
    messages,
    language: language as Language,
    activeFilePath,
    selectedCode,
    workspacePath,
    sendMessage,
    deleteMessagesAfter,
    clearMessages,
    deleteMessagesByIds,
    restoreToCheckpoint,
    getCheckpointForMessage,
    acceptChange,
    undoChange,
    acceptAllChanges,
    undoAllChanges,
    addContextItem,
    attachmentManager,
    setInput,
    setChatMode: setChatMode as any,
    scrollToBottom: () => scrollToBottom('smooth'),
  })

  useFileEventBridge({
    workspacePath,
    activeFilePath,
    openFile,
    setActiveFile,
    teamModeEnabled,
  })

  // Graph Runtime 阶段四：HITL 人工审批监听
  const { awaitingApproval, resume: resumeHumanApproval, isResuming: isHumanApprovalResuming } =
    useHumanApprovalWatcher()

  const isHydratingActiveThread = hasActiveThread && !activeThreadMessagesHydrated

  // 先创建 virtuosoRef，解决 useChatScrollController 和 useTimelineProjection 的循环依赖
  // useTimelineProjection 需要 virtuosoRef 来设置初始滚动位置
  // useChatScrollController 需要 messageCount（来自 timelineItems）来正确执行 scrollToBottom
  const scrollVirtuosoRef = useRef<VirtuosoHandle>(null)

  const timelineProjection = useTimelineProjection({
    filteredMessages,
    checkpointMessageIds,
    currentThreadId,
    virtuosoRef: scrollVirtuosoRef,
  })

  const { isSwitchingThread, timelineItems } = timelineProjection

  // ===== 用户消息索引（左侧圆点导航）=====
  // timelineItems 的 ref，避免 handleTimelineRangeChanged 频繁重建（Virtuoso 性能优化）
  const timelineItemsRef = useRef(timelineItems)
  timelineItemsRef.current = timelineItems

  // 从 timelineItems 中提取所有用户消息及其在虚拟列表中的索引
  const userMessageIndexItems = useMemo<MessageIndexItem[]>(() => {
    const items: MessageIndexItem[] = []
    for (let i = 0; i < timelineItems.length; i++) {
      const tlItem = timelineItems[i]
      if (tlItem.kind !== 'message') continue
      const msg = tlItem.item.message
      if (!isUserMessage(msg)) continue
      items.push({
        id: msg.id,
        preview: getMessageText(msg.content),
        index: i,
      })
    }
    return items
  }, [timelineItems])

  // 当前可见区域内的首个用户消息 ID（用于圆点高亮）
  const [activeUserMessageId, setActiveUserMessageId] = useState<string | null>(null)
  const visibleRangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null)

  // 当 timelineItems 变化时（如新消息加入、线程切换），重新计算 active 用户消息
  useEffect(() => {
    const range = visibleRangeRef.current
    if (!range || timelineItems.length === 0) {
      setActiveUserMessageId(null)
      return
    }
    // 边界保护：Virtuoso 在首次挂载或空列表时可能报告无效 range（endIndex=-1 等）
    const start = Math.max(0, Math.min(range.startIndex, timelineItems.length - 1))
    const end = Math.max(start, Math.min(range.endIndex, timelineItems.length - 1))
    let foundId: string | null = null
    for (let i = start; i <= end; i++) {
      const tlItem = timelineItems[i]
      if (!tlItem) continue
      if (tlItem.kind === 'message' && isUserMessage(tlItem.item.message)) {
        foundId = tlItem.item.message.id
        break
      }
    }
    if (!foundId) {
      for (let i = start - 1; i >= 0; i--) {
        const tlItem = timelineItems[i]
        if (!tlItem) continue
        if (tlItem.kind === 'message' && isUserMessage(tlItem.item.message)) {
          foundId = tlItem.item.message.id
          break
        }
      }
    }
    setActiveUserMessageId(foundId)
  }, [timelineItems])

  // 点击圆点跳转到对应消息
  const handleJumpToMessage = useCallback((index: number) => {
    scrollVirtuosoRef.current?.scrollToIndex({
      index,
      align: 'start',
      behavior: 'smooth',
    })
  }, [scrollVirtuosoRef])

  const {
    attachScrollerNode,
    followOutput,
    handleBottomStateChange,
    handleTotalListHeightChanged,
    handleVisibleRangeChanged,
    scrollToBottom,
    showScrollButton,
  } = useChatScrollController({
    isHydratingActiveThread,
    isStreaming,
    isSwitchingThread,
    messageCount: timelineItems.length,
    threadId: currentThreadId,
    virtuosoRef: scrollVirtuosoRef,
  })

  const { handleKeyDown } = useChatKeyboard({
    showFileMention: mentionController.showFileMention,
    setShowFileMention: mentionController.closeMention,
    setMentionQuery: mentionController.closeMention,
    onSubmit: () => messageOps.handleSubmit(input, isStreaming),
  })

  // ===== UI3：快捷引导卡片点击发送 =====
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<string>).detail
      if (typeof prompt === 'string' && prompt.trim()) {
        setInput(prompt)
        // 异步发送，等 setInput 生效
        setTimeout(() => messageOps.handleSubmit(prompt, false), 0)
      }
    }
    window.addEventListener('aweeclaw:quick-prompt', handler as EventListener)
    return () => window.removeEventListener('aweeclaw:quick-prompt', handler as EventListener)
  }, [messageOps, setInput])

  // ===== AI 智能主动模式：自动发起对话 =====
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; mode: string }>).detail
      if (detail?.message && typeof detail.message === 'string') {
        const proactiveMessage = `[智能主动提醒] ${detail.message}`
        setTimeout(() => messageOps.handleSubmit(proactiveMessage, false), 0)
      }
    }
    window.addEventListener('aweeclaw:smart-proactive', handler as EventListener)
    return () => window.removeEventListener('aweeclaw:smart-proactive', handler as EventListener)
  }, [messageOps])

  // ===== 输入变化处理 =====
  const handleInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      const cursorPos = e.target.selectionStart || 0
      setInput(value)

      const mentioned = await mentionController.detectMention(value, cursorPos)
      if (!mentioned) {
        slashCommandController.detectSlashCommand(value)
        if (!value.startsWith('/')) {
          mentionController.closeMention()
        }
      } else {
        slashCommandController.closeSlashCommand()
      }
    },
    [setInput, mentionController, slashCommandController],
  )

  // ===== 定时任务监听 =====
  // 监听 Cron 任务触发，将 command 作为用户消息发送给 AI。
  // 跳过内部标记 command（以 '__' 开头包裹的指令，如 __proactive_learner_calibrate__）：
  // 这类 command 由对应模块在主进程内部自行处理（如 ProactiveLearner 的自适应校准），
  // 不应转发给 AI，否则 AI 会收到无意义的内部标记文本。
  useEffect(() => {
    const unsub = api.cron.onTaskExecute(async (event: { taskId: string; taskName: string; command: string }) => {
      // 内部标记 command 跳过（约定：'__' 前缀为模块内部指令，不发送给 Agent）
      if (event.command.startsWith('__')) return
      try {
        await sendMessage(event.command)
      } catch (err) {
        logger.agent.error('[ChatPanel] Failed to send cron command:', err)
      }
    })
    return unsub
  }, [sendMessage])

  // ===== 选项卡片事件监听 =====
  // ref 桥接：保存最新的 handleRegenerate，避免因 messages 引用变化导致事件监听频繁重注册
  // （SystemAlert 的"重试"按钮通过 chat-retry-message 事件触发，需读取最新实现）
  const handleRegenerateRef = useRef(messageOps.handleRegenerate)
  handleRegenerateRef.current = messageOps.handleRegenerate

  useEffect(() => {
    const handleOptionSelect = (event: CustomEvent<{ content: string; messageId: string }>) => {
      const { content } = event.detail
      if (content) {
        sendMessage(content)
      }
    }

    const handleUpdateInteractive = (event: CustomEvent<{ messageId: string; selectedIds: string[] }>) => {
      const { messageId, selectedIds } = event.detail
      const store = useAgentStore.getState()
      const thread = store.getCurrentThread()
      if (thread) {
        const msg = thread.messages.find(m => m.id === messageId)
        if (msg && msg.role === 'assistant' && (msg as any).interactive) {
          store.updateMessage(messageId, {
            interactive: {
              ...(msg as any).interactive,
              selectedIds,
            },
          } as any)
        }
      }
    }

    // SystemAlert「重试」按钮：重新生成该 assistant 消息（删除其后内容并重发用户消息）
    const handleRetryMessage = (event: CustomEvent<{ messageId: string }>) => {
      const { messageId } = event.detail
      if (messageId && typeof handleRegenerateRef.current === 'function') {
        handleRegenerateRef.current(messageId)
      }
    }

    // SystemAlert「前往设置」按钮：打开设置页面
    const handleOpenSettings = () => {
      useStore.getState().setShowSettingsPage(true)
    }

    // SystemAlert「切换模型」按钮：打开设置页面（模型配置位于设置页中）
    const handleSwitchModel = () => {
      useStore.getState().setShowSettingsPage(true)
    }

    // SystemAlert「升级套餐」按钮：打开用户中心（含套餐升级面板）
    const handleUpgradePlan = () => {
      useStore.getState().setShowUserProfilePage(true)
    }

    window.addEventListener('chat-send-message', handleOptionSelect as EventListener)
    window.addEventListener('chat-update-interactive', handleUpdateInteractive as EventListener)
    window.addEventListener('chat-retry-message', handleRetryMessage as EventListener)
    window.addEventListener('chat-open-settings', handleOpenSettings as EventListener)
    window.addEventListener('chat-switch-model', handleSwitchModel as EventListener)
    window.addEventListener('chat-upgrade-plan', handleUpgradePlan as EventListener)
    return () => {
      window.removeEventListener('chat-send-message', handleOptionSelect as EventListener)
      window.removeEventListener('chat-update-interactive', handleUpdateInteractive as EventListener)
      window.removeEventListener('chat-retry-message', handleRetryMessage as EventListener)
      window.removeEventListener('chat-open-settings', handleOpenSettings as EventListener)
      window.removeEventListener('chat-switch-model', handleSwitchModel as EventListener)
      window.removeEventListener('chat-upgrade-plan', handleUpgradePlan as EventListener)
    }
  }, [sendMessage])

  // ===== Agent 循环结束监听 =====
  // 使用 ref 桥接读取 filteredMessages，避免每次消息变化都重新注册 EventBus 订阅
  useEffect(() => {
    const unsub = EventBus.on('loop:end', event => {
      if (event.reason === 'error') {
        playNotificationSound('error')
      } else if (event.reason === 'max_iterations') {
        playNotificationSound('attention')
      }

      if (event.reason === 'complete' || event.reason === 'tool_requested_stop' || event.reason === 'waiting_for_user') {
        // 从 ref 读取最新的消息列表，避免闭包捕获过期的 filteredMessages
        const currentMessages = filteredMessagesRef.current
        const convMessages = currentMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: getMessageText(m.content) }))
        knowledgeExtractor.extractFromMessages(convMessages).catch(() => {})
      }
    })
    return unsub
  }, [])

  // ===== 审批提示音 =====
  useEffect(() => {
    if (isAwaitingApproval) {
      playNotificationSound('approval')
    }
  }, [isAwaitingApproval])

  // ===== Diff 显示处理 =====
  const handleShowDiff = useCallback(
    async (filePath: string, oldContent: string, newContent: string) => {
      const fullPath = toFullPath(filePath, workspacePath)
      const currentContent = await api.file.read(fullPath)
      if (currentContent !== null) {
        openFile(fullPath, currentContent)
        setActiveFile(fullPath)
      }
      const diffUri = `diff://${fullPath}`
      openFile(diffUri, newContent, oldContent)
      setActiveFile(diffUri)
    },
    [workspacePath, openFile, setActiveFile],
  )

  // ===== 添加当前文件到上下文 =====
  const handleAddCurrentFile = useCallback(() => {
    if (!activeFilePath) return
    const exists = contextItems.some((s: ContextItem) => s.type === 'File' && (s as FileContext).uri === activeFilePath)
    if (exists) return
    addContextItem({ type: 'File', uri: activeFilePath })
  }, [activeFilePath, contextItems, addContextItem])

  // ===== 渲染时间线条目 =====
  const renderTimelineItem = useCallback(
    (item: ChatTimelineItem<RenderableMessageItem>) => {
      if (item.kind === 'archive') {
        return (
          <ArchiveTimelineItemView
            item={item}
            onReveal={timelineProjection.revealArchivedMessages}
            language={language as Language}
            isChatPrimary={isChatPrimary}
          />
        )
      }

      const msg = item.item.message
      if (!isUserMessage(msg) && !isAssistantMessage(msg)) return null

      return (
        <div className={isChatPrimary ? 'max-w-[800px] mx-auto w-full' : ''}>
          <ChatMessageUI
            key={msg.id}
            message={msg}
            onEdit={messageOps.handleEditMessage}
            onRegenerate={messageOps.handleRegenerate}
            onRestore={messageOps.handleRestore}
            onApproveTool={pendingToolIds.length > 1 ? approveAllTools : approveCurrentTool}
            onRejectTool={pendingToolIds.length > 1 ? rejectAllTools : rejectCurrentTool}
            onOpenDiff={handleShowDiff}
            pendingToolId={pendingToolCall?.id}
            pendingToolIds={pendingToolIds}
            hasCheckpoint={item.item.hasCheckpoint}
            isWorkspaceEditor={activeScenarioId === 'dev-assistant'}
            onDeleteRound={(messageId: string) =>
              messageOps.handleDeleteRound(messageId, setSelectedMessageIds, setDeleteSelectionMode)
            }
            selectionMode={deleteSelectionMode}
            isSelected={selectedMessageIds.has(msg.id)}
            onToggleSelect={(messageId: string) => {
              setSelectedMessageIds(prev => {
                const next = new Set(prev)
                if (next.has(messageId)) {
                  next.delete(messageId)
                } else {
                  next.add(messageId)
                }
                return next
              })
            }}
          />
        </div>
      )
    },
    [
      approveCurrentTool,
      approveAllTools,
      deleteSelectionMode,
      handleShowDiff,
      isChatPrimary,
      language,
      messageOps,
      pendingToolCall?.id,
      pendingToolIds,
      rejectCurrentTool,
      rejectAllTools,
      selectedMessageIds,
      timelineProjection.revealArchivedMessages,
      activeScenarioId,
    ],
  )

  const handleTimelineRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      timelineProjection.handleTimelineRangeChanged(range)
      handleVisibleRangeChanged(range)
      // 更新可见范围引用，并立即计算 active 用户消息
      // （不能仅依赖 useEffect[timelineItems]，因为 range 变化时 timelineItems 引用可能未变）
      visibleRangeRef.current = range
      const tlItems = timelineItemsRef.current
      if (!tlItems || tlItems.length === 0) {
        setActiveUserMessageId(null)
        return
      }
      // 边界保护：Virtuoso 在首次挂载或空列表时可能报告无效 range（endIndex=-1 等）
      const start = Math.max(0, Math.min(range.startIndex, tlItems.length - 1))
      const end = Math.max(start, Math.min(range.endIndex, tlItems.length - 1))
      let foundId: string | null = null
      for (let i = start; i <= end; i++) {
        const tlItem = tlItems[i]
        if (!tlItem) continue
        if (tlItem.kind === 'message' && isUserMessage(tlItem.item.message)) {
          foundId = tlItem.item.message.id
          break
        }
      }
      if (!foundId) {
        for (let i = start - 1; i >= 0; i--) {
          const tlItem = tlItems[i]
          if (!tlItem) continue
          if (tlItem.kind === 'message' && isUserMessage(tlItem.item.message)) {
            foundId = tlItem.item.message.id
            break
          }
        }
      }
      setActiveUserMessageId(foundId)
    },
    [timelineProjection, handleVisibleRangeChanged],
  )

  // ===== Virtuoso 组件配置 =====
  const virtuosoComponents = useMemo(
    () => ({
      Scroller: forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>((props, ref) => (
        <div
          {...props}
          ref={node => {
            attachScrollerNode(node)
            if (typeof ref === 'function') {
              ref(node)
            } else if (ref) {
              ref.current = node
            }
          }}
        />
      )),
      Footer: () => <div className="h-28" />,
      EmptyPlaceholder: () => <div />,
    }),
    [attachScrollerNode],
  )

  // ===== 派生状态 =====
  const hasApiKey = cloudMode === 'cloud' && isAuthenticated ? true : !!llmConfig.apiKey
  const needsCloudLogin = cloudMode === 'cloud' && !isAuthenticated
  const showWorkspaceView =
    (workspaceViewVisible && activeWorkspaceSession) || (teamModeEnabled && activeWorkspaceSession)

  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-background-chat transition-colors ${
        attachmentManager.isDragging ? 'bg-accent/5 ring-2 ring-inset ring-accent' : ''
      }`}
      onDragOver={attachmentManager.handleDragOver}
      onDragLeave={attachmentManager.handleDragLeave}
      onDrop={attachmentManager.handleDrop}
    >
      <div className="flex flex-col h-full">
        <DragOverlay isDragging={attachmentManager.isDragging} language={language as Language} />

        {/* 消息区域 */}
        <div className="flex-1 min-h-0 relative z-0 flex flex-col">
          {/* 工作区/聊天切换栏 */}
          {activeWorkspaceSession && !teamModeEnabled && (
            <WorkspaceToggleBar
              workspaceViewVisible={workspaceViewVisible}
              setWorkspaceViewVisible={setWorkspaceViewVisible}
              isExecuting={activeWorkspaceSession.status === 'executing'}
              language={language as Language}
            />
          )}

          {/* 工作区视图 */}
          {showWorkspaceView ? (
            <div className="flex-1 min-h-0">
              <AgentWorkspace />
            </div>
          ) : (
            <>
              <ApiWarningBanner
                hasApiKey={hasApiKey}
                needsCloudLogin={needsCloudLogin}
                language={language as Language}
                isChatPrimary={isChatPrimary}
              />

              {/* 空状态欢迎屏 */}
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center min-h-0 overflow-y-auto px-4">
                  <EmptyChatSuggestions />
                  <div className="w-full max-w-[800px] mt-16">
                    <ChatInputWrapper
                      input={input}
                      setInput={setInput}
                      images={attachmentManager.images}
            setImages={attachmentManager.setImages}
            hasApiKey={hasApiKey}
            needsCloudLogin={needsCloudLogin}
            hasPendingToolCall={!!pendingToolCall}
            chatMode={chatMode}
            setChatMode={setChatMode}
            isStreaming={isStreaming}
            onSubmit={() => messageOps.handleSubmit(input, isStreaming)}
            onAbort={handleAbort}
                      onInputChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      onPaste={attachmentManager.handlePaste}
                      textareaRef={textareaRef}
                      inputContainerRef={inputContainerRef}
                      contextItems={contextItems}
                      onRemoveContextItem={item => {
                        const index = contextItems.indexOf(item)
                        if (index !== -1) {
                          removeContextItem(index)
                        }
                      }}
                      activeFilePath={activeFilePath}
                      onAddFile={handleAddCurrentFile}
                    />
                  </div>
                </div>
              ) : (
                <>
                  {/* 消息列表 */}
                  <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
                    {/* 过渡骨架屏 */}
                    <AnimatePresence>
                      {(isSwitchingThread || isHydratingActiveThread) && (
                        <motion.div
                          initial={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="absolute inset-0 z-30 bg-background-chat pointer-events-auto"
                        >
                          <ChatMessagesSkeleton />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* 用户消息索引栏（左侧浮动圆点导航） */}
                    {!isSwitchingThread && !isHydratingActiveThread && (
                      <MessageIndexBar
                        items={userMessageIndexItems}
                        activeMessageId={activeUserMessageId}
                        onJump={handleJumpToMessage}
                        language={language}
                      />
                    )}

                    {/* 主动建议卡片（medium 级，s10-06）*/}
                    {!isSwitchingThread && !isHydratingActiveThread && (
                      <ProactiveSuggestionsContainer language={language as Language} />
                    )}

                    <Virtuoso
                      key={currentThreadId ?? 'no-thread'}
                      ref={scrollVirtuosoRef}
                      data={timelineItems}
                      computeItemKey={(_, item) => item.key}
                      atBottomStateChange={handleBottomStateChange}
                      rangeChanged={handleTimelineRangeChanged}
                      initialTopMostItemIndex={timelineProjection.initialIndexRef.current}
                      followOutput={followOutput}
                      itemContent={(_, item) => renderTimelineItem(item)}
                      className="flex-1 custom-scrollbar w-full h-full"
                      style={{ minHeight: '100px', overflowX: 'hidden', overflowY: 'auto' }}
                      overscan={12}
                      atBottomThreshold={100}
                      totalListHeightChanged={handleTotalListHeightChanged}
                      skipAnimationFrameInResizeObserver
                      components={virtuosoComponents}
                    />

                    <ScrollToBottomButton
                      visible={showScrollButton}
                      onClick={() => scrollToBottom('smooth')}
                      language={language as Language}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* Mention 弹窗 */}
          {mentionController.showFileMention && (
            <MentionPopup
              position={mentionController.mentionPosition}
              query={mentionController.mentionQuery}
              candidates={mentionController.mentionCandidates}
              loading={mentionController.mentionLoading}
              onSelect={mentionController.handleSelectMention}
              onClose={mentionController.closeMention}
            />
          )}

          {/* 斜杠命令弹窗 */}
          {slashCommandController.showSlashCommand && (
            <SlashCommandPopup
              query={slashCommandController.slashCommandQuery}
              position={mentionController.mentionPosition}
              onSelect={slashCommandController.handleSlashCommand}
              onClose={slashCommandController.closeSlashCommand}
            />
          )}

          {/* 底部输入区 */}
          {!deleteSelectionMode && messages.length > 0 && (
            <div
              className={`shrink-0 z-20 flex flex-col pt-2 ${
                isChatPrimary ? 'max-w-[840px] mx-auto w-full' : ''
              }`}
            >
              <div className="mx-4 mb-4 flex flex-col">
                {awaitingApproval && (
                  <HumanApprovalCard
                    info={awaitingApproval}
                    onResume={resumeHumanApproval}
                    isResuming={isHumanApprovalResuming}
                  />
                )}
                <PredictionBubble
                  language={language}
                  sceneContext={perceptionSceneContext}
                />
                <PendingChangesBar pendingChanges={pendingChanges} />
                <ChatInputWrapper
                  input={input}
                  setInput={setInput}
                  images={attachmentManager.images}
                  setImages={attachmentManager.setImages}
                  hasApiKey={hasApiKey}
                  needsCloudLogin={needsCloudLogin}
                  hasPendingToolCall={!!pendingToolCall}
                  chatMode={chatMode}
                  setChatMode={setChatMode}
                  isStreaming={isStreaming}
                  onSubmit={() => messageOps.handleSubmit(input, isStreaming)}
                  onAbort={handleAbort}
                  onInputChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={attachmentManager.handlePaste}
                  textareaRef={textareaRef}
                  inputContainerRef={inputContainerRef}
                  contextItems={contextItems}
                  onRemoveContextItem={item => {
                    const index = contextItems.indexOf(item)
                    if (index !== -1) {
                      removeContextItem(index)
                    }
                  }}
                  activeFilePath={activeFilePath}
                  onAddFile={handleAddCurrentFile}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <ChangesReviewPanel
        isOpen={false}
        onClose={() => {}}
        pendingChanges={pendingChanges}
        onAcceptFile={messageOps.handleAcceptFile}
        onRejectFile={messageOps.handleRejectFile}
        onAcceptAll={messageOps.handleKeepAll}
        onRejectAll={messageOps.handleUndoAll}
      />

      {deleteSelectionMode && (
        <DeleteSelectionBar
          selectedCount={selectedMessageIds.size}
          onCancel={() => {
            setDeleteSelectionMode(false)
            setSelectedMessageIds(new Set())
          }}
          onConfirm={() =>
            messageOps.handleConfirmDeleteSelection(
              selectedMessageIds,
              setDeleteSelectionMode,
              setSelectedMessageIds,
            )
          }
          language={language as Language}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 场景感知聊天面板策略                                              */
/* ------------------------------------------------------------------ */

import type { ScenarioDomain } from '@configuration/defaultProfile'

/** 场景聊天面板策略 */
export interface ScenarioChatPanelPolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 是否显示变更审查面板 */
  showChangesReviewPanel: boolean
  /** 是否显示云配额信息 */
  showCloudQuota: boolean
  /** 是否启用场景感知建议 */
  enableScenarioSuggestions: boolean
  /** 是否显示合规横幅 */
  showComplianceBanner: boolean
  /** 最大消息长度 */
  maxMessageLength: number
  /** 是否允许文件上传 */
  allowFileUpload: boolean
  /** 允许的文件类型 */
  allowedFileTypes: string[]
  /** 是否启用审计日志 */
  enableAudit: boolean
  /** 是否允许消息编辑 */
  allowMessageEdit: boolean
  /** 是否允许消息删除 */
  allowMessageDelete: boolean
}

/** 场景聊天面板策略预设 */
const SCENARIO_CHAT_PANEL_POLICIES: Record<ScenarioDomain, ScenarioChatPanelPolicy> = {
  /** 法律场景：显示变更审查 + 合规横幅 + 限制文件类型 */
  legal: {
    domain: 'legal',
    showChangesReviewPanel: true,
    showCloudQuota: false,
    enableScenarioSuggestions: true,
    showComplianceBanner: true,
    maxMessageLength: 10000,
    allowFileUpload: true,
    allowedFileTypes: ['.pdf', '.docx', '.txt', '.md', '.doc'],
    enableAudit: true,
    allowMessageEdit: false,
    allowMessageDelete: false,
  },

  /** 医疗场景：显示合规横幅 + 严格限制文件类型 */
  medical: {
    domain: 'medical',
    showChangesReviewPanel: true,
    showCloudQuota: false,
    enableScenarioSuggestions: true,
    showComplianceBanner: true,
    maxMessageLength: 8000,
    allowFileUpload: true,
    allowedFileTypes: ['.pdf', '.docx', '.txt', '.md'],
    enableAudit: true,
    allowMessageEdit: false,
    allowMessageDelete: false,
  },

  /** 教育场景：显示场景建议 + 允许所有文件 */
  education: {
    domain: 'education',
    showChangesReviewPanel: false,
    showCloudQuota: true,
    enableScenarioSuggestions: true,
    showComplianceBanner: false,
    maxMessageLength: 12000,
    allowFileUpload: true,
    allowedFileTypes: [],
    enableAudit: false,
    allowMessageEdit: true,
    allowMessageDelete: true,
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    showChangesReviewPanel: true,
    showCloudQuota: true,
    enableScenarioSuggestions: false,
    showComplianceBanner: false,
    maxMessageLength: 10000,
    allowFileUpload: true,
    allowedFileTypes: [],
    enableAudit: false,
    allowMessageEdit: true,
    allowMessageDelete: true,
  },
}

/**
 * 获取场景聊天面板策略
 */
export function getScenarioChatPanelPolicy(
  domain: ScenarioDomain,
): ScenarioChatPanelPolicy {
  return SCENARIO_CHAT_PANEL_POLICIES[domain]
}

/**
 * 检查文件类型是否允许
 */
export function isFileTypeAllowed(
  fileName: string,
  domain: ScenarioDomain,
): boolean {
  const policy = SCENARIO_CHAT_PANEL_POLICIES[domain]
  if (!policy.allowFileUpload) return false
  if (policy.allowedFileTypes.length === 0) return true

  const extension = '.' + (fileName.split('.').pop() || '').toLowerCase()
  return policy.allowedFileTypes.includes(extension)
}

/**
 * 检查消息长度是否允许
 */
export function isMessageLengthAllowed(
  length: number,
  domain: ScenarioDomain,
): boolean {
  const policy = SCENARIO_CHAT_PANEL_POLICIES[domain]
  return length <= policy.maxMessageLength
}
