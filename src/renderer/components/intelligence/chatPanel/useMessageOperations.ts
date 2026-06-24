/**
 * 消息操作 Hook
 * 封装消息发送、编辑、重新生成、删除、恢复检查点等操作
 */
import { useCallback } from 'react'
import { t, type Language } from '@renderer/i18n'
import { composerService } from '@intelligence/runtime/composerEngine'
import { getFileName } from '@shared/toolkit/pathHelper'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { useToast } from '@components/foundation/NotificationProvider'
import { slashCommandService } from '@services/slashCommandAdapter'
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
  setChatMode: (mode: string) => void
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

  /** 提交消息 */
  const handleSubmit = useCallback(
    async (input: string, isStreaming: boolean) => {
      if ((!input.trim() && attachmentManager.images.length === 0) || isStreaming) return

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
          if (result.mode) {
            setChatMode(result.mode)
          }
        }
      }

      setInput('')
      attachmentManager.clearImages()
      scrollToBottom('smooth')
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
    [messages, deleteMessagesAfter, clearMessages, sendMessage],
  )

  /** 删除一轮对话 */
  const handleDeleteRound = useCallback(
    (messageId: string, setSelectedMessageIds: (ids: Set<string>) => void, setDeleteSelectionMode: (mode: boolean) => void) => {
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
    [messages],
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

      const userMessage = messages.find(m => m.id === messageId)
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
    [getCheckpointForMessage, restoreToCheckpoint, toast, language, messages, addContextItem, setInput, attachmentManager],
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

  return {
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
  }
}
