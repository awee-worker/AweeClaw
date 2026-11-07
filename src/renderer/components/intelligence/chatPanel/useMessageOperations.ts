/**
 * 消息操作 Hook
 * 封装消息发送、编辑、重新生成、删除、恢复检查点等操作
 */
import { useCallback, useMemo, useRef } from 'react'
import { t, type Language } from '@renderer/i18n'
import { composerService } from '@intelligence/runtime/composerEngine'
import { getFileName } from '@shared/toolkit/pathHelper'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { useToast } from '@components/foundation/NotificationProvider'
import { clearPluginNotice } from '@renderer/plugins/pluginNoticeStore'
import { slashCommandService } from '@services/slashCommandAdapter'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useStore } from '@store'
import { enqueueLocalSteer } from '@intelligence/runtime/localSteer'
import { STEER_MAX_LENGTH } from '@shared/protocols/deviceTaskProtocol'
import {
  isUserMessage,
  getMessageText,
  type ChatMessage as ChatMessageType,
} from '@intelligence/providerTypes'
import type { useAttachmentManager } from './useAttachmentManager'

interface UseMessageOperationsParams {
  messages: ChatMessageType[]
  language: Language
  activeFilePath: string | null
  selectedCode: string | null
  workspacePath: string | null
  sendMessage: (content: string | any[]) => Promise<void>
  deleteMessagesAfter: (messageId: string) => void
  clearMessages: () => void
  deleteMessagesByIds: (ids: string[]) => void
  restoreToCheckpoint: (checkpointId: string) => Promise<any>
  getCheckpointForMessage: (messageId: string) => any
  acceptChange: (filePath: string) => void
  undoChange: (filePath: string) => Promise<boolean>
  acceptAllChanges: () => void
  undoAllChanges: () => Promise<any>
  addContextItem: (item: any) => void
  attachmentManager: ReturnType<typeof useAttachmentManager>
  setInput: (value: string | null | undefined) => void
  setChatMode?: (mode: string) => void
  scrollToBottom: (behavior?: 'smooth' | 'auto') => void
}

export function useMessageOperations({
  messages,
  language,
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
  setChatMode,
  scrollToBottom,
}: UseMessageOperationsParams) {
  const toast = useToast()

  /**
   * 最新消息列表的引用桥。
   *
   * 下面几个回调原先把 messages 写进依赖数组：流式期间消息数组每个分片都在变，
   * 于是这些回调跟着重建，一路打穿上层 ChatMessage / AssistantMessageView 的
   * memo，让整条可见消息树陪着每个文本分片重渲染。改为调用时读 ref，回调引用
   * 得以稳定，而读到的始终是最新列表（比闭包快照更准）。
   */
  const messagesRef = useRef<ChatMessageType[]>(messages)
  messagesRef.current = messages

  /**
   * toast 的 ref 桥
   *
   * Provider 每次渲染都会新建 context value（字面量对象），toast 因此不是稳定引用。
   * 把它放进 handleSubmit 的依赖数组，会让这个回调随每次渲染重建，一路打穿上层的
   * memo —— 与 messages 当初踩的是同一个坑。
   */
  const toastRef = useRef(toast)
  toastRef.current = toast

  /** 提交消息 */
  const handleSubmit = useCallback(
    async (input: string, isStreaming: boolean) => {
      const text = input.trim()
      const hasAttachments = attachmentManager.images.length > 0

      /**
       * 运行中提交 = 插话（不是新一轮）
       *
       * 这里不能直接把消息发出去：执行锁会以「Thread already running」挡下它，
       * 用户看到的是点了没反应。改为排进本地队列，由循环在下一个工具批次边界
       * 取走并注入；收尾接缝还有第二次机会，所以「刚说完模型就打算结束」也不会丢。
       *
       * 附件与斜杠命令不在此展开：它们改变的是新一轮请求的形态（要重新组装内容、
       * 可能要切模式），不是一句补充说明。运行中提交只认纯文本。
       */
      if (isStreaming) {
        if (!text) return
        const threadId = useAgentStore.getState().currentThreadId
        if (!threadId) return

        /**
         * 团队协作（多 Agent）运行中不吃插话
         *
         * 那条路径由编排器把子任务派给各自 Agent，不经过主循环的工具批次边界，
         * 队列里有内容也没有任何取走点 —— 入队只会让用户以为话已经送到了。
         * 这里直接说明边界，比事后让人对着一段毫无反应的输出猜测要好。
         */
        const teamSession = useStore.getState().activeWorkspaceSession
        const teamRunning = teamSession?.threadId === threadId && (
          teamSession.status === 'planning'
          || teamSession.status === 'plan_review'
          || teamSession.status === 'discussing'
          || teamSession.status === 'executing'
        )
        if (teamRunning) {
          toastRef.current.warning(t('chat.steer.teamUnsupported', language))
          return
        }

        const result = enqueueLocalSteer(threadId, text)
        if (!result.accepted) {
          if (result.reason === 'too_long') {
            toastRef.current.warning(t('chat.steer.tooLong', language, { max: STEER_MAX_LENGTH }))
          } else if (result.reason === 'full') {
            toastRef.current.warning(t('chat.steer.full', language))
          }
          // duplicate / empty：连点或空内容，静默即可，弹提示只会干扰
          return
        }

        // 不在这里写会话气泡、也不弹「已排上」的提示：插话真正该出现的位置是
        // 「被采纳的那一刻」。早一步作为用户消息落到列表末尾，就会排在 AI 后续输出
        // 上方，读起来像 AI 先说完、才看到补充。等待期的状态交给输入区上方的待生效条，
        // 生效时执行层会把内容就地嵌进助手消息（user_steer part）。
        setInput('')
        attachmentManager.clearImages()
        scrollToBottom('smooth')
        return
      }

      if ((!text && !hasAttachments)) return

      let userMessage: string | any[] = input.trim()

      if (attachmentManager.images.length > 0) {
        userMessage = await attachmentManager.buildMessageContent(input)
      }

      // 斜杠命令解析
      if (input.startsWith('/')) {
        const result = slashCommandService.parse(input, {
          activeFilePath: activeFilePath || undefined,
          selectedCode: selectedCode || undefined,
          workspacePath: workspacePath || undefined,
        })
        if (result) {
          userMessage = result.prompt
          // 模式选择器已移除：所有写入统一归一到专家档（expert），避免写回 chat/agent
          if (result.mode) {
            setChatMode?.('expert')
          }
        }
      }

      setInput('')
      attachmentManager.clearImages()
      scrollToBottom('smooth')
      // 发送会清空线程上下文，插件侧的选择状态随之失效：必须在这一刻就收掉提示。
      // 放到 await sendMessage 之后是不行的 —— sendMessage 要等整轮会话跑完才 resolve，
      // 期间输入框上方会一直挂着上一次的二级项结果，直到会话结束才消失。
      clearPluginNotice()
      await sendMessage(userMessage)
    },
    [
      attachmentManager,
      activeFilePath,
      selectedCode,
      workspacePath,
      setInput,
      setChatMode,
      scrollToBottom,
      sendMessage,
    ],
  )

  /** 编辑消息 */
  const handleEditMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!content.trim()) return
      deleteMessagesAfter(messageId)
      await sendMessage(content.trim())
    },
    [deleteMessagesAfter, sendMessage],
  )

  /** 重新生成 */
  const handleRegenerate = useCallback(
    async (messageId: string) => {
      const messages = messagesRef.current
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
    },
    [deleteMessagesAfter, clearMessages, sendMessage],
  )

  /** 删除一轮对话 */
  const handleDeleteRound = useCallback(
    (messageId: string, setSelectedMessageIds: (ids: Set<string>) => void, setDeleteSelectionMode: (mode: boolean) => void) => {
      const messages = messagesRef.current
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

      const idsToSelect = new Set(messages.slice(roundStartIndex, roundEndIndex + 1).map(m => m.id))
      setSelectedMessageIds(idsToSelect)
      setDeleteSelectionMode(true)
    },
    [],
  )

  /** 确认删除选中消息 */
  const handleConfirmDeleteSelection = useCallback(
    async (selectedMessageIds: Set<string>, setDeleteSelectionMode: (mode: boolean) => void, setSelectedMessageIds: (ids: Set<string>) => void) => {
      if (selectedMessageIds.size === 0) return

      const confirmed = await globalConfirm({
        title: t('ai.deleteconversation', language),
        message: t('ai.deleteselectedmessages', language, { size: selectedMessageIds.size }),
        confirmText: t('ai.delete', language),
        variant: 'danger',
      })
      if (!confirmed) return

      deleteMessagesByIds(Array.from(selectedMessageIds))
      setDeleteSelectionMode(false)
      setSelectedMessageIds(new Set())
    },
    [language, deleteMessagesByIds],
  )

  /** 恢复到检查点 */
  const handleRestore = useCallback(
    async (messageId: string) => {
      const checkpoint = getCheckpointForMessage(messageId)
      if (!checkpoint) {
        toast.error('No checkpoint found for this message')
        return
      }

      const userMessage = messagesRef.current.find(m => m.id === messageId)
      const userContent =
        userMessage && isUserMessage(userMessage)
          ? typeof userMessage.content === 'string'
            ? userMessage.content
            : getMessageText(userMessage.content)
          : ''

      const confirmed = await globalConfirm({
        title: t('ai.restorecheckpoint', language),
        message: t('confirmRestoreCheckpoint', language),
        confirmText: t('ai.restore', language),
        variant: 'warning',
      })
      if (!confirmed) return

      const result = await restoreToCheckpoint(checkpoint.id)
      if (result.success) {
        toast.success(`Restored ${result.restoredFiles.length} file(s)`)

        if (userContent) {
          setInput(userContent)
        }

        if (result.images && result.images.length > 0) {
          attachmentManager.restoreFromImages(result.images)
        }

        if (result.contextItems && result.contextItems.length > 0) {
          for (const item of result.contextItems) {
            addContextItem(item)
          }
        }
      } else if (result.errors.length > 0) {
        toast.error(`Restore failed: ${result.errors[0]}`)
      }
    },
    [getCheckpointForMessage, restoreToCheckpoint, toast, language, addContextItem, setInput, attachmentManager],
  )

  /** 接受单个文件变更 */
  const handleAcceptFile = useCallback(
    async (filePath: string) => {
      acceptChange(filePath)
      await composerService.acceptChange(filePath)
      toast.success(`Accepted: ${getFileName(filePath)}`)
    },
    [acceptChange, toast],
  )

  /** 拒绝单个文件变更 */
  const handleRejectFile = useCallback(
    async (filePath: string) => {
      const success = await undoChange(filePath)
      await composerService.rejectChange(filePath)
      if (success) {
        toast.success(`Reverted: ${getFileName(filePath)}`)
      } else {
        toast.error('Failed to revert')
      }
    },
    [undoChange, toast],
  )

  /** 撤销所有变更 */
  const handleUndoAll = useCallback(async () => {
    const result = await undoAllChanges()
    await composerService.rejectAll()
    if (result.success) {
      toast.success(`Reverted ${result.restoredFiles.length} files`)
    } else {
      toast.error(`Failed to revert some files: ${result.errors.join(', ')}`)
    }
  }, [undoAllChanges, toast])

  /** 接受所有变更 */
  const handleKeepAll = useCallback(async () => {
    acceptAllChanges()
    await composerService.acceptAll()
    toast.success('All changes accepted')
  }, [acceptAllChanges, toast])

  /**
   * 返回值整体 memo 化：调用方把它当依赖使用（renderTimelineItem 等），
   * 对象引用每轮更换会让这些 useCallback 一并失效。
   */
  return useMemo(
    () => ({
      handleSubmit,
      handleEditMessage,
      handleRegenerate,
      handleDeleteRound,
      handleConfirmDeleteSelection,
      handleRestore,
      handleAcceptFile,
      handleRejectFile,
      handleUndoAll,
      handleKeepAll,
    }),
    [
      handleSubmit,
      handleEditMessage,
      handleRegenerate,
      handleDeleteRound,
      handleConfirmDeleteSelection,
      handleRestore,
      handleAcceptFile,
      handleRejectFile,
      handleUndoAll,
      handleKeepAll,
    ],
  )
}
