import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, type ComponentPropsWithoutRef } from 'react'
import { Virtuoso } from 'react-virtuoso'
import {
  AlertTriangle,
  Upload,
  ChevronDown,
  ShieldAlert,
  Check,
  X,
  MessageSquare,
  BrainCircuit,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useModeStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { BRAND } from '@shared/brand'
import { useAgentActions, useAgentCommands, useAgentViewState } from '@hooks/useAgent'
import { useChatScrollController, useAutoSpeak } from '@hooks'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { knowledgeExtractor } from '@intelligence/runtime/knowledgeService/extractor'
import {t, type Language} from '@renderer/i18n'
import { toFullPath, getFileName } from '@shared/toolkit/pathHelper'
import {
  ChatMessage as ChatMessageType,
  isUserMessage,
  isAssistantMessage,
  getMessageText,
  ContextItem,
  FileContext,
} from '@intelligence/providerTypes'

import { ChatInput, PendingAttachment } from '../conversation'
import MentionPopup from '@components/intelligence/MentionPopup'
import { MentionParser, MentionCandidate } from '@intelligence/utils/mentionDecoder'
import ChatMessageUI from './ChatMessage'
import ChangesReviewPanel from './ChangesReviewPanel'
import { keybindingService } from '@services/keybindingAdapter'
import { slashCommandService, SlashCommand } from '@services/slashCommandAdapter'
import SlashCommandPopup from './SlashCommandPopup'
import EmptyChatSuggestions from '../conversation/WelcomeSuggestions'
import { ChatMessagesSkeleton } from '../ui/ProgressIndicator'
import { ActionButton } from '../ui'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { useToast } from '@components/foundation/NotificationProvider'
import { composerService } from '@intelligence/runtime/composerEngine'
import { playNotificationSound } from '@utils/notificationSound'
import { getFriendlyToolName } from '@intelligence/display/toolFriendlyName'
import { compressImage } from '@intelligence/utils/imageCompressor'
import { needsVisualAnalysis } from '@intelligence/utils/imageIntentDetector'
import { TodoListPanel } from './TodoListPanel'
import { AgentWorkspace } from './AgentWorkspace'
import { channelConversationService } from '@intelligence/runtime/channelConversationService'
import {
  buildChatTimelineProjection,
  type ChatTimelineItem,
  type TimelineArchiveItem,
} from './chatTimelineProjection'

interface RenderableMessageItem {
  message: ChatMessageType
  hasCheckpoint: boolean
  renderKey: string
}

const HISTORY_REVEAL_BATCH_SIZE = 50
const HISTORY_VISIBLE_TAIL_COUNT = 100
const EMPTY_TODOS: import('@intelligence/providerTypes').TodoItem[] = []

function buildRenderableMessageItems(
  messages: ChatMessageType[],
  checkpointMessageIds: ReadonlySet<string>
): RenderableMessageItem[] {
  return messages.map(message => {
    const hasCheckpoint = isUserMessage(message) && checkpointMessageIds.has(message.id)

    return {
      message,
      hasCheckpoint,
      // Virtuoso caches rows by key. Include checkpoint state so a hydrated checkpoint
      // remounts the affected user row instead of reusing the pre-hydration render.
      renderKey: `${message.id}:${hasCheckpoint ? 'checkpoint' : 'plain'}`,
    }
  })
}

export default function ChatPanel() {
  const {
    llmConfig,
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
  } = useStore(useShallow(s => ({
    llmConfig: s.llmConfig,
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
  })))

  const isChatPrimary = activeScenarioId !== 'workspace-editor'

  // 从 AgentStore 获取 inputPrompt
  const inputPrompt = useAgentStore(state => state.inputPrompt)
  const setInputPrompt = useAgentStore(state => state.setInputPrompt)
  const todos = useAgentStore(state => {
    if (!state.currentThreadId) return EMPTY_TODOS
    return state.threads[state.currentThreadId]?.todos || EMPTY_TODOS
  })
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

  const toast = useToast()

  const {
    messages,
    isStreaming,
    isAwaitingApproval,
    pendingToolCall,
    pendingChanges,
    messageCheckpoints,
    contextItems,
    currentThreadId,
    messageListVersion,
    pendingApprovalToolCalls,
  } = useAgentViewState()

  const isChannelThread = useMemo(() => {
    if (!currentThreadId) return false
    return !!channelConversationService.getConversationKey(currentThreadId)
  }, [currentThreadId])

  const { sendMessage, abort, approveCurrentTool, rejectCurrentTool } = useAgentCommands()
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
  }, [activeWorkspaceSession])
  const [images, setImages] = useState<PendingAttachment[]>([])
  const imagesRef = useRef(images)
  imagesRef.current = images
  const checkpointMessageIds = useMemo(() => {
    return new Set(messageCheckpoints.map(checkpoint => checkpoint.messageId))
  }, [messageCheckpoints])

  // 组件卸载时释放所有未发送图片的 ObjectURL
  useEffect(() => {
    return () => {
      imagesRef.current.forEach(img => { if (img.previewUrl) URL.revokeObjectURL(img.previewUrl) })
    }
  }, [])

  // 流式请求完成后刷新云端配额
  const prevStreamingRef = useRef(isStreaming)
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const { isAuthenticated, cloudMode, fetchQuota } = useStore.getState()
      if (isAuthenticated && cloudMode === 'cloud') {
        fetchQuota().catch(() => {})
      }
    }
    prevStreamingRef.current = isStreaming
  }, [isStreaming])

  useAutoSpeak({ isStreaming, messages })

  // 缓存过滤后的消息列表，避免每次渲染都创建新数组
  const filteredMessages = useMemo(
    () => messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    [messages, messageListVersion]
  )

  // 骨架屏转场状态：避免大量消息的突现造成卡顿
  const [threadHistoryRevealCount, setThreadHistoryRevealCount] = useState<Record<string, number>>({})
  const currentThreadHistoryRevealCount = currentThreadId
    ? (threadHistoryRevealCount[currentThreadId] ?? 0)
    : 0
  const timelineProjection = useMemo(
    () => buildChatTimelineProjection(filteredMessages, {
      expandedHistoryCount: currentThreadHistoryRevealCount,
      visibleTailCount: HISTORY_VISIBLE_TAIL_COUNT,
      revealBatchSize: HISTORY_REVEAL_BATCH_SIZE,
    }),
    [currentThreadHistoryRevealCount, filteredMessages]
  )
  const visibleRenderableMessages = useMemo<RenderableMessageItem[]>(
    () => buildRenderableMessageItems(timelineProjection.visibleMessages, checkpointMessageIds),
    [checkpointMessageIds, timelineProjection.visibleMessages]
  )
  const timelineItems = useMemo<ChatTimelineItem<RenderableMessageItem>[]>(() => {
    const items: ChatTimelineItem<RenderableMessageItem>[] = []

    if (timelineProjection.hiddenCount > 0) {
      items.push({
        kind: 'archive',
        key: `archive:${timelineProjection.hiddenCount}`,
        hiddenCount: timelineProjection.hiddenCount,
        revealCount: timelineProjection.revealCount,
        remainingCount: Math.max(0, timelineProjection.hiddenCount - timelineProjection.revealCount),
      })
    }

    for (const item of visibleRenderableMessages) {
      items.push({
        kind: 'message',
        key: item.renderKey,
        item,
      })
    }

    return items
  }, [timelineProjection.hiddenCount, timelineProjection.revealCount, visibleRenderableMessages])
  const [isSwitchingThread, setIsSwitchingThread] = useState(false)
  const prevThreadIdRef = useRef(currentThreadId)
  const pendingRevealAnchorKeyRef = useRef<string | null>(null)
  const visibleRangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null)
  // Virtuoso 初始滚动位置：只在线程切换时重新指向底部，普通追加消息不重算
  // 避免每次消息列表变化都重新传入新的 initialTopMostItemIndex
  // 导致 Virtuoso 强制跳回该位置（即滚动条回顶的根因）
  const initialIndexRef = useRef(Math.max(0, timelineItems.length - 1))

  // Effect 1：只监听 currentThreadId 变化，控制骨架屏的显示/隐藏
  // 与 filteredMessages 解耦，防止懒加载消息在 350ms 内到达时
  // 触发 effect cleanup → clearTimeout → isSwitchingThread 永远不归 false
  useEffect(() => {
    const threadChanged = currentThreadId !== prevThreadIdRef.current
    prevThreadIdRef.current = currentThreadId

    if (!threadChanged) return

    // 线程切换时同步更新初始位置索引，指向新线程的底部
    initialIndexRef.current = Math.max(0, timelineItems.length - 1)

    // 线程切换：已加载线程只保留一帧过渡，未加载线程继续由 hydration 骨架接管
    setIsSwitchingThread(true)
    const timer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        setIsSwitchingThread(false)
      })
    }, 16)
    return () => window.clearTimeout(timer)
  }, [currentThreadId, timelineItems.length])

  // Unified Sidebar State
  const [showFileMention, setShowFileMention] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState({ x: 0, y: 0 })
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null)
  const suggestionRequestId = useRef(0) // 防止 getSuggestions 竞态
  const [isDragging, setIsDragging] = useState(false)
  // 斜杠命令状态
  const [showSlashCommand, setShowSlashCommand] = useState(false)
  const [slashCommandQuery, setSlashCommandQuery] = useState('')

  const [showReviewPanel, setShowReviewPanel] = useState(false)

  // 监听选项卡片选择事件
  useEffect(() => {
    const handleOptionSelect = (event: CustomEvent<{ content: string; messageId: string }>) => {
      const { content } = event.detail
      if (content) {
        sendMessage(content)
      }
    }

    const handleUpdateInteractive = (event: CustomEvent<{ messageId: string; selectedIds: string[] }>) => {
      const { messageId, selectedIds } = event.detail
      // 更新消息的 interactive.selectedIds
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

    window.addEventListener('chat-send-message', handleOptionSelect as EventListener)
    window.addEventListener('chat-update-interactive', handleUpdateInteractive as EventListener)
    return () => {
      window.removeEventListener('chat-send-message', handleOptionSelect as EventListener)
      window.removeEventListener('chat-update-interactive', handleUpdateInteractive as EventListener)
    }
  }, [sendMessage])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)

  // 用于防止工具卡片展开/收缩时误判滚动状态
  const isHydratingActiveThread = hasActiveThread && !activeThreadMessagesHydrated
  const {
    attachScrollerNode,
    followOutput,
    handleBottomStateChange,
    handleTotalListHeightChanged,
    handleVisibleRangeChanged,
    scrollToBottom,
    showScrollButton,
    virtuosoRef,
  } = useChatScrollController({
    isHydratingActiveThread,
    isStreaming,
    isSwitchingThread,
    messageCount: timelineItems.length,
    threadId: currentThreadId,
  })

  const revealArchivedMessages = useCallback(() => {
    if (!currentThreadId || timelineProjection.revealCount <= 0) {
      return
    }

    const anchorIndex = visibleRangeRef.current?.startIndex ?? 0
    const anchorItem = timelineItems[anchorIndex]
    if (anchorItem?.kind === 'message') {
      pendingRevealAnchorKeyRef.current = anchorItem.key
    } else {
      const firstVisibleMessage = timelineItems.find(item => item.kind === 'message')
      pendingRevealAnchorKeyRef.current = firstVisibleMessage?.key ?? null
    }

    setThreadHistoryRevealCount(state => ({
      ...state,
      [currentThreadId]: (state[currentThreadId] ?? 0) + timelineProjection.revealCount,
    }))
  }, [currentThreadId, timelineItems, timelineProjection.revealCount])

  useEffect(() => {
    const anchorKey = pendingRevealAnchorKeyRef.current
    if (!anchorKey) {
      return
    }

    const anchorIndex = timelineItems.findIndex(item => item.key === anchorKey)
    if (anchorIndex < 0) {
      return
    }

    pendingRevealAnchorKeyRef.current = null
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: anchorIndex,
        align: 'start',
        behavior: 'auto',
      })
    })
  }, [timelineItems, virtuosoRef])

  useEffect(() => {
    const unsub = EventBus.on('loop:end', (event) => {
      if (event.reason === 'error') {
        playNotificationSound('error')
      } else if (event.reason === 'max_iterations') {
        playNotificationSound('attention')
      }

      if (event.reason === 'complete' || event.reason === 'tool_requested_stop' || event.reason === 'waiting_for_user') {
        const convMessages = filteredMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: getMessageText(m.content) }))
        knowledgeExtractor.extractFromMessages(convMessages).catch(() => {})
      }
    })
    return unsub
  }, [filteredMessages])

  useEffect(() => {
    if (isAwaitingApproval) {
      playNotificationSound('approval')
    }
  }, [isAwaitingApproval])

  // 监听 AI 文件编写事件，自动打开文件实时预览
  useEffect(() => {
    const unsubWriting = EventBus.on('file:writing', async (event) => {
      if (!event.filePath || !workspacePath) return
      if (teamModeEnabled) return
      // event.filePath 已经是绝对路径（toolExecutors/streamProcessor 中已 resolve）
      const fullPath = event.filePath
      // 如果文件已经在打开列表中且是 active 的，不需要重复激活
      if (activeFilePath === fullPath) return
      // 读取文件当前内容并打开
      const content = await api.file.read(fullPath)
      if (content !== null) {
        openFile(fullPath, content)
        setActiveFile(fullPath)
      }
    })

    const unsubStreamContent = EventBus.on('file:stream_content', async (event) => {
      if (!event.filePath || !workspacePath) return
      if (teamModeEnabled) return
      // event.filePath 已经是绝对路径（streamProcessor 中已 resolve）
      const fullPath = event.filePath

      // 检查文件是否已打开
      const { openFiles } = useStore.getState()
      const isOpen = openFiles.some(f => f.path === fullPath)

      if (!isOpen) {
        // 首次打开文件进行预览
        openFile(fullPath, event.content)
        setActiveFile(fullPath)
      } else {
        // 实时更新已打开文件的内容（打字机效果）
        const store = useStore.getState()
        const file = openFiles.find(f => f.path === fullPath)
        if (file && !file.isDirty) {
          // 只有在用户未手动编辑时才自动更新
          store.updateFileContent(fullPath, event.content)
          if (activeFilePath !== fullPath) {
            setActiveFile(fullPath)
          }
        }
      }
    })

    const unsubWritten = EventBus.on('file:written', async (event) => {
      if (!event.filePath || !workspacePath) return
      if (teamModeEnabled) return
      // event.filePath 已经是绝对路径（toolExecutors 中已 resolve）
      const fullPath = event.filePath
      // 更新已打开文件的内容
      openFile(fullPath, event.content)
      setActiveFile(fullPath)
    })

    return () => {
      unsubWriting()
      unsubStreamContent()
      unsubWritten()
    }
  }, [workspacePath, openFile, setActiveFile, activeFilePath, teamModeEnabled])


  // 处理显示 diff
  const handleShowDiff = useCallback(async (filePath: string, oldContent: string, newContent: string) => {
    const fullPath = toFullPath(filePath, workspacePath)
    const currentContent = await api.file.read(fullPath)
    if (currentContent !== null) {
      openFile(fullPath, currentContent)
      setActiveFile(fullPath)
    }

    // 打开虚拟 Diff 标签页
    const diffUri = `diff://${fullPath}`
    openFile(diffUri, newContent, oldContent)
    setActiveFile(diffUri)
  }, [workspacePath, openFile, setActiveFile])

  // 图片处理
  const addImage = useCallback(async (file: File) => {
    const id = crypto.randomUUID()
    const isImage = file.type.startsWith('image/')
    const previewUrl = isImage ? URL.createObjectURL(file) : undefined

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setImages(prev => prev.map(img => (img.id === id ? { ...img, base64 } : img)))
    }
    reader.readAsDataURL(file)

    setImages(prev => [...prev, { id, file, previewUrl, isImage }])
  }, [])

  // 粘贴处理
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) addImage(file)
      }
    }
  }, [addImage])

  // 拖放处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    // 辅助函数：将文件路径转换为附件并添加
    const addImageFromPath = async (path: string) => {
      try {
        const base64 = await api.file.readBinary(path)
        if (base64) {
          const ext = path.split('.').pop()?.toLowerCase() || 'png'
          const imageMimeTypes: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            svg: 'image/svg+xml',
            bmp: 'image/bmp',
            ico: 'image/x-icon',
          }
          const isImage = ext in imageMimeTypes
          const mimeType = imageMimeTypes[ext] || 'application/octet-stream'
          const dataUrl = `data:${mimeType};base64,${base64}`
          const fileName = path.split(/[/\\]/).pop() || 'file'
          const id = crypto.randomUUID()
          setImages(prev => [...prev, {
            id,
            file: new File([], fileName, { type: mimeType }),
            previewUrl: isImage ? dataUrl : undefined,
            base64,
            isImage,
          }])
          return true
        }
      } catch (err) {
        logger.ui.error('Failed to load image:', err)
      }
      return false
    }

    // 获取拖放的文件
    const files = Array.from(e.dataTransfer.files)

    if (files.length > 0) {
      const imageFiles = files.filter(f => f.type.startsWith('image/'))
      const otherFiles = files.filter(f => !f.type.startsWith('image/'))

      if (imageFiles.length > 0) {
        imageFiles.forEach(addImage)
      }
      if (otherFiles.length > 0) {
        otherFiles.forEach(addImage)
      }
      if (imageFiles.length > 0 || otherFiles.length > 0) return

      for (const file of files) {
        const filePath = (file as any).path
        if (filePath) {
          await addImageFromPath(filePath)
          continue
        }
      }
      return
    }

    // 没有原生文件，尝试从自定义数据中获取路径
    const items = e.dataTransfer.items
    if (!items || items.length === 0) {
      return
    }

    // 尝试获取 aweeclaw 自定义路径
    let filePath: string | null = null

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'string') {
        if (item.type === BRAND.dragDrop.fileMimeType) {
          filePath = await new Promise<string>((resolve) => {
            item.getAsString((s) => resolve(s))
          })
          break
        } else if (item.type === 'text/uri-list' && !filePath) {
          const uriList = await new Promise<string>((resolve) => {
            item.getAsString((s) => resolve(s))
          })
          const match = uriList.match(/file:\/\/\/(.+)/)
          if (match) {
            filePath = decodeURIComponent(match[1])
          }
        }
      }
    }

    if (filePath) {
      await addImageFromPath(filePath)
    }
  }, [addImage, addContextItem, setImages])

  // 输入变化处理
  const handleInputChange = useCallback(async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart || 0
    setInput(value)

    // 计算弹窗位置
    const updatePopupPosition = () => {
      if (inputContainerRef.current) {
        const rect = inputContainerRef.current.getBoundingClientRect()
        setMentionPosition({ x: rect.left + 16, y: rect.top })
      }
    }

    const parseResult = MentionParser.parse(value, cursorPos)

    if (parseResult) {
      setMentionQuery(parseResult.query)
      setMentionRange(parseResult.range)
      updatePopupPosition()
      setShowFileMention(true)
      setShowSlashCommand(false)

      // Fetch suggestions（用递增 ID 防止竞态：只接受最新请求的结果）
      const requestId = ++suggestionRequestId.current
      setMentionLoading(true)
      try {
        const suggestions = await MentionParser.getSuggestions(parseResult.query, workspacePath)
        if (requestId === suggestionRequestId.current) {
          setMentionCandidates(suggestions)
        }
      } catch (err) {
        logger.agent.error('Error fetching suggestions:', err)
      } finally {
        if (requestId === suggestionRequestId.current) {
          setMentionLoading(false)
        }
      }
    } else if (value.startsWith('/') && !value.includes(' ') && value.length < 20) {
      // 斜杠命令：只在行首输入 / 且没有空格时触发
      setSlashCommandQuery(value)
      updatePopupPosition()
      setShowSlashCommand(true)
      setShowFileMention(false)
      setMentionQuery('')
    } else {
      setShowFileMention(false)
      setShowSlashCommand(false)
      setMentionQuery('')
      setSlashCommandQuery('')
    }
  }, [workspacePath])

  // 上下文选择
  const handleSelectMention = useCallback((candidate: MentionCandidate) => {
    if (!mentionRange) return
    const currentInput = input ?? ''

    const textBeforeMention = currentInput.slice(0, mentionRange.start)
    const textAfterMention = currentInput.slice(mentionRange.end)

    let replacement = ''
    let contextItem: ContextItem | null = null

    switch (candidate.type) {
      case 'codebase':
        replacement = '@codebase '
        contextItem = { type: 'Codebase' }
        break
      case 'git':
        replacement = '@git '
        contextItem = { type: 'Git' }
        break
      case 'terminal':
        replacement = '@terminal '
        contextItem = { type: 'Terminal' }
        break
      case 'symbols':
        replacement = '@symbols '
        contextItem = { type: 'Symbols' }
        break
      case 'skill':
        replacement = `@${candidate.data.skillId} `
        contextItem = {
          type: 'Skill',
          skillId: candidate.data.skillId,
          name: candidate.data.name
        }
        break
      case 'file':
      case 'folder':
        replacement = `@${candidate.description || candidate.label} `
        contextItem = {
          type: candidate.type === 'folder' ? 'Folder' : 'File',
          uri: candidate.data.path
        }
        break
      case 'web':
        replacement = '@web '
        contextItem = { type: 'Web' }
        break
    }

    const newInput = textBeforeMention + replacement + textAfterMention
    setInput(newInput)

    if (contextItem) {
      // Check if exists
      const exists = contextItems.some(item => {
        if (item.type !== contextItem!.type) return false
        if (item.type === 'File' && contextItem!.type === 'File') {
          return (item as FileContext).uri === (contextItem as FileContext).uri
        }
        return true
      })

      if (!exists) {
        addContextItem(contextItem)
      }
    }

    setShowFileMention(false)
    setMentionQuery('')
    textareaRef.current?.focus()
  }, [input, mentionRange, contextItems, addContextItem])

  // 提交
  const handleSubmit = useCallback(async () => {
    if ((!input.trim() && images.length === 0) || isStreaming) return

    // Handoff 现在由 WorkspaceStatusBar 自动处理，不再阻止发送
    // 如果正在过渡中，等待完成后会自动继续

    let userMessage: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string }; referenceOnly?: boolean; localPath?: string } | { type: 'file'; name: string; media_type: string; data: string }> = input.trim()

    if (images.length > 0) {
      const readyImages = images.filter(img => img.base64)
      if (readyImages.length !== images.length) return

      const imageParts = readyImages.filter(img => img.isImage)
      const fileParts = readyImages.filter(img => !img.isImage)

      const uploadDir = workspacePath ? `${workspacePath}/${BRAND.dirName}/uploads` : null

      if (uploadDir) {
        try {
          const dirCreated = await api.file.ensureDir(uploadDir)
          if (!dirCreated) {
            logger.agent.error('[ChatPanel] Failed to create upload directory:', uploadDir)
          }
        } catch (err) {
          logger.agent.error('[ChatPanel] Failed to create upload directory:', err)
        }
      }

      // 所有图片都保存到工作空间
      const savedImagePaths: string[] = []
      if (imageParts.length > 0 && uploadDir) {
        for (const img of imageParts) {
          const timestamp = Date.now()
          const safeName = img.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const filePath = `${uploadDir}/${timestamp}_${safeName}`
          try {
            const saved = await api.file.writeBinary(filePath, img.base64!)
            if (saved) {
              savedImagePaths.push(filePath)
            } else {
              logger.agent.error('[ChatPanel] Failed to save uploaded image:', filePath)
            }
          } catch (err) {
            logger.agent.error('[ChatPanel] Failed to save uploaded image:', err)
          }
        }
      }

      // 非图片文件保存到工作空间
      const savedFilePaths: string[] = []
      if (fileParts.length > 0 && uploadDir) {
        for (const fileImg of fileParts) {
          const timestamp = Date.now()
          const safeName = fileImg.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const filePath = `${uploadDir}/${timestamp}_${safeName}`
          try {
            const saved = await api.file.writeBinary(filePath, fileImg.base64!)
            if (saved) {
              addContextItem({ type: 'File', uri: filePath })
              savedFilePaths.push(filePath)
            } else {
              logger.agent.error('[ChatPanel] Failed to save uploaded file:', filePath)
            }
          } catch (err) {
            logger.agent.error('[ChatPanel] Failed to save uploaded file:', err)
          }
        }
      }

      // 智能判断是否需要视觉分析
      const userWantsAnalysis = needsVisualAnalysis(input.trim())

      // 构建消息内容
      const imageContentParts: Array<{
        type: 'image'
        source: { type: 'base64'; media_type: string; data: string }
        referenceOnly?: boolean
        localPath?: string
      }> = []

      for (let i = 0; i < imageParts.length; i++) {
        const img = imageParts[i]
        const localPath = savedImagePaths[i]
        const shouldAnalyze = img.analyzeMode || userWantsAnalysis

        if (shouldAnalyze) {
          try {
            const compressed = await compressImage(img.file, {
              maxDimension: 1024,
              quality: 0.8,
            })
            imageContentParts.push({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: compressed.mimeType,
                data: compressed.base64,
              },
              localPath,
            })
            logger.agent.info('[ChatPanel] Image compressed for analysis:', {
              name: img.file.name,
              originalSize: compressed.originalSize,
              compressedSize: compressed.compressedSize,
              ratio: `${Math.round((1 - compressed.compressedSize / compressed.originalSize) * 100)}%`,
            })
          } catch (err) {
            logger.agent.warn('[ChatPanel] Image compression failed, falling back to reference mode:', err)
            imageContentParts.push({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.file.type,
                data: img.base64!,
              },
              referenceOnly: true,
              localPath,
            })
          }
        } else {
          imageContentParts.push({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: img.file.type,
              data: img.base64!,
            },
            referenceOnly: true,
            localPath,
          })
        }
      }

      userMessage = [
        { type: 'text' as const, text: input.trim() },
        ...imageContentParts,
        ...fileParts.map(img => ({
          type: 'file' as const,
          name: img.file.name,
          media_type: img.file.type || 'application/octet-stream',
          data: img.base64!,
        })),
      ]
    }

    // 检查是否是斜杠命令
    if (input.startsWith('/')) {
      const result = slashCommandService.parse(input, {
        activeFilePath: activeFilePath || undefined,
        selectedCode: selectedCode || undefined,
        workspacePath: workspacePath || undefined,
      })
      if (result) {
        userMessage = result.prompt
        if (result.mode) {
          setChatMode(result.mode)
        }
      }
    }

    setInput('')
    setImages((prev) => { prev.forEach((img) => { if (img.previewUrl) URL.revokeObjectURL(img.previewUrl) }); return [] })
    // 发送消息后主动滚到底部，确保用户消息和即将出现的 AI 回复可见
    // 不依赖 followOutput 的时序，因为发送瞬间 isStreaming 还是 false
    scrollToBottom('smooth')
    await sendMessage(userMessage)
  }, [input, images, isStreaming, sendMessage, activeFilePath, selectedCode, workspacePath, setChatMode, scrollToBottom, addContextItem])

  // 编辑消息
  const handleEditMessage = useCallback(async (messageId: string, content: string) => {
    if (!content.trim()) return
    deleteMessagesAfter(messageId)
    await sendMessage(content.trim())
  }, [deleteMessagesAfter, sendMessage])

  // 重新生成（创建分支）
  const handleRegenerate = useCallback(async (messageId: string) => {
    const msgIndex = messages.findIndex((m: ChatMessageType) => m.id === messageId)
    if (msgIndex <= 0) return

    let userMsgIndex = msgIndex - 1
    while (userMsgIndex >= 0 && messages[userMsgIndex].role !== 'user') {
      userMsgIndex--
    }

    if (userMsgIndex < 0) return
    const userMsg = messages[userMsgIndex]
    if (!isUserMessage(userMsg)) return

    if (userMsgIndex > 0) {
      const prevMsg = messages[userMsgIndex - 1]
      deleteMessagesAfter(prevMsg.id)
    } else {
      clearMessages()
    }

    await sendMessage(userMsg.content)
  }, [messages, deleteMessagesAfter, clearMessages, sendMessage])

  const handleDeleteRound = useCallback((messageId: string) => {
    const msgIndex = messages.findIndex((m: ChatMessageType) => m.id === messageId)
    if (msgIndex === -1) return

    let roundStartIndex = msgIndex
    if (messages[msgIndex].role !== 'user') {
      roundStartIndex = msgIndex - 1
      while (roundStartIndex >= 0 && messages[roundStartIndex].role !== 'user') {
        roundStartIndex--
      }
      if (roundStartIndex < 0) return
    }

    let roundEndIndex = roundStartIndex + 1
    while (roundEndIndex < messages.length && messages[roundEndIndex].role !== 'user') {
      roundEndIndex++
    }
    roundEndIndex--

    const idsToSelect = new Set(
      messages.slice(roundStartIndex, roundEndIndex + 1).map(m => m.id)
    )

    setSelectedMessageIds(idsToSelect)
    setDeleteSelectionMode(true)
  }, [messages])

  const handleToggleSelectMessage = useCallback((messageId: string) => {
    setSelectedMessageIds(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }
      return next
    })
  }, [])

  const handleCancelDeleteSelection = useCallback(() => {
    setDeleteSelectionMode(false)
    setSelectedMessageIds(new Set())
  }, [])

  const handleConfirmDeleteSelection = useCallback(async () => {
    if (selectedMessageIds.size === 0) return

    const confirmed = await globalConfirm({
      title: t('ai.deleteconversation', language as Language),
      message: t('ai.deleteselectedmessages', language as Language, { size: selectedMessageIds.size }),
      confirmText: t('ai.delete', language as Language),
      variant: 'danger',
    })
    if (!confirmed) return

    deleteMessagesByIds(Array.from(selectedMessageIds))
    setDeleteSelectionMode(false)
    setSelectedMessageIds(new Set())
  }, [selectedMessageIds, deleteMessagesByIds, language])

  // 添加当前文件
  const handleAddCurrentFile = useCallback(() => {
    if (!activeFilePath) return
    const exists = contextItems.some((s: ContextItem) => s.type === 'File' && (s as FileContext).uri === activeFilePath)
    if (exists) return
    addContextItem({ type: 'File', uri: activeFilePath })
  }, [activeFilePath, contextItems, addContextItem])

  // 处理斜杠命令选择
  const handleSlashCommand = useCallback((cmd: SlashCommand) => {
    const result = slashCommandService.parse('/' + cmd.name, {
      activeFilePath: activeFilePath || undefined,
      selectedCode: selectedCode || undefined,
      workspacePath: workspacePath || undefined,
    })
    if (result) {
      setInput(result.prompt)
      if (result.mode) {
        setChatMode(result.mode as any)
      }
    }
    setShowSlashCommand(false)
    setSlashCommandQuery('')
    textareaRef.current?.focus()
  }, [activeFilePath, selectedCode, workspacePath, setChatMode])

  // 键盘处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 忽略 IME 组合状态中的按键（如中文输入法确认拼音）
    if (e.nativeEvent.isComposing) return

    if (showFileMention) {
      if (keybindingService.matches(e, 'list.cancel')) {
        e.preventDefault()
        setShowFileMention(false)
        setMentionQuery('')
      }
      if (['Enter', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
        e.preventDefault()
        return
      }
    }

    if (keybindingService.matches(e, 'chat.send')) {
      e.preventDefault()
      handleSubmit()
    }
  }, [showFileMention, handleSubmit])

  const hasApiKey = !!llmConfig.apiKey

  // 处理回退到检查点
  const handleRestore = useCallback(async (messageId: string) => {
    const checkpoint = getCheckpointForMessage(messageId)
    if (!checkpoint) {
      toast.error('No checkpoint found for this message')
      return
    }

    // 找到对应的用户消息内容
    const userMessage = messages.find(m => m.id === messageId)
    const userContent = userMessage && isUserMessage(userMessage)
      ? (typeof userMessage.content === 'string' ? userMessage.content : getMessageText(userMessage.content))
      : ''

    const confirmed = await globalConfirm({
      title: t('ai.restorecheckpoint', language as Language),
      message: t('confirmRestoreCheckpoint', language),
      confirmText: t('ai.restore', language as Language),
      variant: 'warning',
    })
    if (!confirmed) return

    const result = await restoreToCheckpoint(checkpoint.id)
    if (result.success) {
      toast.success(`Restored ${result.restoredFiles.length} file(s)`)

      // 恢复用户消息文本到输入框
      if (userContent) {
        setInput(userContent)
      }

      // 恢复图片到输入框
      if (result.images && result.images.length > 0) {
        const restoredImages: PendingAttachment[] = result.images.map(img => {
          const byteCharacters = atob(img.base64)
          const byteNumbers = new Array(byteCharacters.length)
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNumbers)
          const blob = new Blob([byteArray], { type: img.mimeType })
          const isImage = img.mimeType.startsWith('image/')
          const file = new File([blob], `restored-${img.id}.${img.mimeType.split('/')[1] || 'bin'}`, { type: img.mimeType })
          const previewUrl = isImage ? URL.createObjectURL(blob) : undefined

          return {
            id: img.id,
            file,
            previewUrl,
            base64: img.base64,
            isImage,
          }
        })
        setImages(restoredImages)
      }

      // 恢复上下文引用
      if (result.contextItems && result.contextItems.length > 0) {
        for (const item of result.contextItems) {
          addContextItem(item)
        }
      }
    } else if (result.errors.length > 0) {
      toast.error(`Restore failed: ${result.errors[0]}`)
    }
  }, [getCheckpointForMessage, restoreToCheckpoint, toast, language, messages, addContextItem])

  // AgentStatusBar 回调（提取为 useCallback 避免打破 memo）
  const handleAcceptFile = useCallback(async (filePath: string) => {
    acceptChange(filePath)
    await composerService.acceptChange(filePath)
    toast.success(`Accepted: ${getFileName(filePath)}`)
  }, [acceptChange, toast])

  const handleRejectFile = useCallback(async (filePath: string) => {
    const success = await undoChange(filePath)
    await composerService.rejectChange(filePath)
    if (success) {
      toast.success(`Reverted: ${getFileName(filePath)}`)
    } else {
      toast.error('Failed to revert')
    }
  }, [undoChange, toast])

  const handleUndoAll = useCallback(async () => {
    const result = await undoAllChanges()
    await composerService.rejectAll()
    if (result.success) {
      toast.success(`Reverted ${result.restoredFiles.length} files`)
    } else {
      toast.error(`Failed to revert some files: ${result.errors.join(', ')}`)
    }
  }, [undoAllChanges, toast])

  const handleKeepAll = useCallback(async () => {
    acceptAllChanges()
    await composerService.acceptAll()
    toast.success('All changes accepted')
  }, [acceptAllChanges, toast])

  // 渲染消息
  const renderArchiveItem = useCallback((item: TimelineArchiveItem) => {
    const label = t('ai.showmorehistory', language as Language)
    const hiddenLabel = t('ai.oldermessagesarchived', language as Language, { hiddenCount: item.hiddenCount })
    const revealLabel = t('ai.revealmore', language as Language, { revealCount: item.revealCount })
    const remainingLabel = item.remainingCount > 0
      ? (t('ai.remaining', language as Language, { remainingCount: item.remainingCount }))
      : undefined

    return (
      <div className="px-4 pb-3 pt-2">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border/60 bg-background/95 px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                {label}
              </div>
              <div className="mt-1 text-sm text-text-secondary">
                {hiddenLabel}
              </div>
              {remainingLabel && (
                <div className="mt-1 text-xs text-text-muted">
                  {remainingLabel}
                </div>
              )}
            </div>
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={revealArchivedMessages}
              className="shrink-0 rounded-xl border border-border/60 bg-surface/60 px-3 text-xs text-text-primary hover:bg-surface-hover"
            >
              {revealLabel}
            </ActionButton>
          </div>
        </div>
      </div>
    )
  }, [language, revealArchivedMessages])

  const renderTimelineItem = useCallback((item: ChatTimelineItem<RenderableMessageItem>) => {
    if (item.kind === 'archive') {
      return (
        <div className={isChatPrimary ? 'max-w-[800px] mx-auto w-full' : ''}>
          {renderArchiveItem(item)}
        </div>
      )
    }

    const msg = item.item.message
    if (!isUserMessage(msg) && !isAssistantMessage(msg)) return null

    return (
      <div className={isChatPrimary ? 'max-w-[800px] mx-auto w-full' : ''}>
        <ChatMessageUI
          key={msg.id}
          message={msg}
          onEdit={handleEditMessage}
          onRegenerate={handleRegenerate}
          onRestore={handleRestore}
          onApproveTool={approveCurrentTool}
          onRejectTool={rejectCurrentTool}
          onOpenDiff={handleShowDiff}
          pendingToolId={pendingToolCall?.id}
          hasCheckpoint={item.item.hasCheckpoint}
          isWorkspaceEditor={activeScenarioId === 'workspace-editor'}
          onDeleteRound={handleDeleteRound}
          selectionMode={deleteSelectionMode}
          isSelected={selectedMessageIds.has(msg.id)}
          onToggleSelect={handleToggleSelectMessage}
        />
      </div>
    )
  }, [approveCurrentTool, deleteSelectionMode, handleDeleteRound, handleEditMessage, handleRegenerate, handleRestore, handleShowDiff, handleToggleSelectMessage, isChatPrimary, pendingToolCall?.id, rejectCurrentTool, renderArchiveItem, selectedMessageIds])

  const handleTimelineRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    visibleRangeRef.current = range
    handleVisibleRangeChanged(range)
  }, [handleVisibleRangeChanged])

  const virtuosoComponents = useMemo(() => ({
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
    EmptyPlaceholder: () => <div />
  }), [attachScrollerNode])

  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-background-chat transition-colors ${isDragging ? 'bg-accent/5 ring-2 ring-inset ring-accent' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex flex-col h-full">

        {/* Drag Overlay */}
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-background/80 flex items-center justify-center pointer-events-none"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="flex flex-col items-center gap-4 p-8 rounded-3xl border border-accent/30 bg-surface/90 shadow-2xl shadow-accent/20"
              >
                <div className="p-5 rounded-full bg-accent/10 border border-accent/20 relative">
                  <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full animate-pulse" />
                  <Upload className="w-10 h-10 text-accent relative z-10" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-medium text-text-primary mb-1">{t('ai.dropfilestoaddcontext', language as Language)}</p>
                  <p className="text-sm text-text-muted">{t('ai.supportscodeandattachments', language as Language)}</p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages Area */}
        <div className="flex-1 min-h-0 relative z-0 flex flex-col">
          {/* Workspace / Chat Toggle - hidden in team mode (always show workspace) */}
          {activeWorkspaceSession && !teamModeEnabled && (
            <div className="flex items-center justify-center gap-1 px-4 pt-2 pb-1 border-b border-border/30 bg-surface/30">
              <button
                onClick={() => setWorkspaceViewVisible(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  !workspaceViewVisible ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                {t('ai.chat', language as Language)}
              </button>
              <button
                onClick={() => setWorkspaceViewVisible(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  workspaceViewVisible ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                }`}
              >
                <BrainCircuit className="w-3.5 h-3.5" />
                {t('ai.workspace', language as Language)}
                {activeWorkspaceSession.status === 'executing' && (
                  <span className="relative flex h-1.5 w-1.5 ml-0.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Agent Workspace View - in team mode always show workspace */}
          {((workspaceViewVisible && activeWorkspaceSession) || (teamModeEnabled && activeWorkspaceSession)) ? (
            <div className="flex-1 min-h-0">
              <AgentWorkspace />
            </div>
          ) : (
          <>
          {/* API Key Warning */}
          {!hasApiKey && (
            <div className={`m-4 p-4 border border-warning/20 bg-warning/5 rounded-xl flex gap-3 backdrop-blur-sm relative z-10 ${isChatPrimary ? 'max-w-[800px] mx-auto' : ''}`}>
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
              <div>
                <span className="font-medium text-sm text-warning block mb-1">{t('setupRequired', language)}</span>
                <p className="text-xs text-text-muted">{t('setupRequiredDesc', language)}</p>
              </div>
            </div>
          )}

          {/* Empty Welcome Screen */}
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-0 overflow-y-auto px-4">
              <EmptyChatSuggestions />
              <div className="w-full max-w-[640px] mt-6">
                <ChatInput
                  input={input}
                  setInput={setInput}
                  images={images}
                  setImages={setImages}
                  isStreaming={isStreaming}
                  hasApiKey={hasApiKey}
                  hasPendingToolCall={!!pendingToolCall}
                  chatMode={chatMode}
                  setChatMode={setChatMode}
                  onSubmit={handleSubmit}
                  onAbort={abort}
                  onInputChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  textareaRef={textareaRef}
                  inputContainerRef={inputContainerRef}
                  contextItems={contextItems}
                  onRemoveContextItem={(item) => {
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
          {/* Message List */}
          <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
            {/* 过渡用的骨架屏 */}
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

            <Virtuoso
              key={currentThreadId ?? 'no-thread'}
              ref={virtuosoRef}
              data={timelineItems}
              computeItemKey={(_, item) => item.key}
              atBottomStateChange={handleBottomStateChange}
              rangeChanged={handleTimelineRangeChanged}
              initialTopMostItemIndex={initialIndexRef.current}
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

            {/* Scroll to bottom button */}
            <AnimatePresence>
              {showScrollButton && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="absolute bottom-3 right-4 z-30"
                >
                  <button
                    onClick={() => scrollToBottom('smooth')}
                    className="w-8 h-8 rounded-full bg-surface/90 backdrop-blur-sm border border-border/50 shadow-lg shadow-black/15 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface transition-all"
                    title={t('ai.scrolltobottom', language as Language)}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          </>
          )}
          </>
          )}

          {/* File Mention Popup */}
          {
            showFileMention && (
              <MentionPopup
                position={mentionPosition}
                query={mentionQuery}
                candidates={mentionCandidates}
                loading={mentionLoading}
                onSelect={handleSelectMention}
                onClose={() => { setShowFileMention(false); setMentionQuery('') }}
              />
            )
          }

          {/* Slash Command Popup */}
          {
            showSlashCommand && (
              <SlashCommandPopup
                query={slashCommandQuery}
                position={mentionPosition}
                onSelect={handleSlashCommand}
                onClose={() => { setShowSlashCommand(false); setSlashCommandQuery('') }}
              />
            )
          }

          {/* Bottom TextField Area - Unified Tray */}
          {!deleteSelectionMode && messages.length > 0 && (
          <div className={`shrink-0 z-20 flex flex-col pt-2 ${isChatPrimary ? 'max-w-[840px] mx-auto w-full' : ''}`}>
            <div className="mx-4 mb-4 flex flex-col">
              {/* Tool Approval Banner */}
              <AnimatePresence>
                {isAwaitingApproval && pendingApprovalToolCalls && pendingApprovalToolCalls.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/8 backdrop-blur-sm">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/15 shrink-0">
                        <ShieldAlert className="w-4 h-4 text-amber-500 animate-pulse" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-text-primary">
                          {t('toolAwaitingApproval', language as any)}
                        </div>
                        <div className="text-[11px] text-text-muted mt-0.5 truncate">
                          {pendingApprovalToolCalls.map(tc => getFriendlyToolName(tc.name, language).label).join('、')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={rejectCurrentTool}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                        >
                          <X className="w-3.5 h-3.5" />
                          {t('toolReject', language as any)}
                        </button>
                        <button
                          onClick={approveCurrentTool}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-accent text-white hover:bg-accent-hover rounded-lg transition-all"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {t('toolApprove', language as any)}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Todo List */}
              {todos.length > 0 && !isChannelThread && (
                <div className="mb-3">
                  <TodoListPanel todos={todos} isStreaming={isStreaming} />
                </div>
              )}

              {/* TextField Component */}
              <ChatInput
                input={input}
                setInput={setInput}
                images={images}
                setImages={setImages}
                isStreaming={isStreaming}
                hasApiKey={hasApiKey}
                hasPendingToolCall={!!pendingToolCall}
                chatMode={chatMode}
                setChatMode={setChatMode}
                onSubmit={handleSubmit}
                onAbort={abort}
                onInputChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                textareaRef={textareaRef}
                inputContainerRef={inputContainerRef}
                contextItems={contextItems}
                onRemoveContextItem={(item) => {
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
        isOpen={showReviewPanel}
        onClose={() => setShowReviewPanel(false)}
        pendingChanges={pendingChanges}
        onAcceptFile={handleAcceptFile}
        onRejectFile={handleRejectFile}
        onAcceptAll={handleKeepAll}
        onRejectAll={handleUndoAll}
      />

      {deleteSelectionMode && (
        <div className="absolute bottom-0 left-0 right-0 z-50 flex justify-center pb-6 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl bg-surface/95 backdrop-blur-xl border border-border/60 shadow-2xl shadow-black/30">
            <span className="text-sm text-text-secondary">
              {t('ai.selected', language as Language, { size: selectedMessageIds.size })}
            </span>
            <button
              onClick={handleCancelDeleteSelection}
              className="px-4 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-all border border-border/50"
            >
              {t('ai.cancel', language as Language)}
            </button>
            <button
              onClick={handleConfirmDeleteSelection}
              disabled={selectedMessageIds.size === 0}
              className="px-4 py-1.5 rounded-lg text-sm text-white bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {t('ai.delete2', language as Language)}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
