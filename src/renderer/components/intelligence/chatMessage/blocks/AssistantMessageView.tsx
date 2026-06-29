/**
 * 助手消息视图
 * 左对齐布局，支持流式输出、工具调用预览、交互卡片
 */
import React, { useMemo } from 'react'
import { Check, Circle, Loader2, FileCode, FilePlus, X } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { composerService } from '@intelligence/runtime/composerEngine'
import { toast } from '@components/foundation/NotificationProvider'
import {
  isAssistantMessage,
  isReasoningPart,
  type ChatMessage as ChatMessageType,
  type AssistantMessage,
  type AssistantPart,
  type TodoItem,
  type FileChangeHistoryEntry,
  type MessageFeedback,
} from '@intelligence/providerTypes'
import type { ToolStreamingPreview } from '@protocols'
import type { Language } from '@renderer/i18n'
import { getFileName } from '@shared/toolkit/pathHelper'

import { AssistantMessageContentView } from './AssistantMessageContentView'
import { StreamingPhaseIndicator } from './StreamingPhaseIndicator'
import { MessageActionsBar } from '../components/MessageActionsBar'
import { InteractiveCard } from '../../InteractiveCard'
import ToolCallGroup from '../../ToolCallGroup'
import { MessageMetaGroupView } from './MessageMetaGroupView'

const EMPTY_PREVIEWS: Record<string, ToolStreamingPreview> = {}
const EMPTY_TODOS: TodoItem[] = []
const EMPTY_HISTORY: FileChangeHistoryEntry[] = []
const ACTIVE_STREAM_PHASES = new Set(['streaming', 'tool_running', 'tool_pending'])

interface AssistantMessageViewProps {
  message: ChatMessageType
  pendingToolId?: string
  pendingToolIds?: string[]
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  onRegenerate?: () => void
  hasCheckpoint?: boolean
  isWorkspaceEditor?: boolean
  onDeleteRound?: (messageId: string) => void
  textContent: string
  fontSize: number
}

/** 任务列表弹层内容（只读模式） */
const TaskListPopoverContent = React.memo(function TaskListPopoverContent({
  todos,
}: {
  todos: TodoItem[]
}) {
  return (
    <div className="py-1">
      {todos.map((todo, i) => {
        const isCompleted = todo.status === 'completed'
        const isActive = todo.status === 'in_progress'
        return (
          <div
            key={i}
            className={`flex items-center gap-2.5 py-1.5 px-3 ${
              isActive ? 'bg-accent/[0.06]' : ''
            }`}
          >
            {isCompleted ? (
              <div className="w-4 h-4 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                <Check className="w-2.5 h-2.5 text-green-400" strokeWidth={3} />
              </div>
            ) : isActive ? (
              <div className="w-4 h-4 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
                <Loader2 className="w-2.5 h-2.5 text-accent animate-spin" />
              </div>
            ) : (
              <Circle className="w-3 h-3 text-text-muted/40 flex-shrink-0" strokeWidth={1.5} />
            )}
            <span
              className={`text-[12px] flex-1 ${
                isCompleted ? 'text-text-muted/70 line-through' : 'text-text-primary'
              }`}
            >
              {isActive ? todo.activeForm : todo.content}
            </span>
          </div>
        )
      })}
    </div>
  )
})

/** 文件变更弹层内容（基于历史记录，支持单个接受/拒绝，接受/拒绝后显示状态） */
const FileChangesPopoverContent = React.memo(function FileChangesPopoverContent({
  changes,
  language,
}: {
  changes: FileChangeHistoryEntry[]
  language: Language
}) {
  const acceptChange = useAgentStore(s => s.acceptChange)
  const undoChange = useAgentStore(s => s.undoChange)
  const isZh = language === 'zh'

  const handleAccept = async (filePath: string) => {
    acceptChange(filePath)
    await composerService.acceptChange(filePath)
    toast.success(isZh ? `已接受：${getFileName(filePath)}` : `Accepted: ${getFileName(filePath)}`)
  }

  const handleReject = async (filePath: string) => {
    const success = await undoChange(filePath)
    await composerService.rejectChange(filePath)
    if (success) {
      toast.success(isZh ? `已撤销：${getFileName(filePath)}` : `Reverted: ${getFileName(filePath)}`)
    } else {
      toast.error(isZh ? `撤销失败：${getFileName(filePath)}` : `Failed to revert: ${getFileName(filePath)}`)
    }
  }

  return (
    <div className="py-1">
      {changes.map(change => {
        const isCreate = change.changeType === 'create'
        const fileName = getFileName(change.filePath)
        const isPending = change.status === 'pending'
        const isAccepted = change.status === 'accepted'
        const isRejected = change.status === 'rejected'

        return (
          <div
            key={change.id}
            className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-accent/5 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isCreate ? (
                <FilePlus className="w-3.5 h-3.5 text-status-success shrink-0" />
              ) : (
                <FileCode className="w-3.5 h-3.5 text-accent shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-text-primary truncate">
                    {fileName}
                  </span>
                  <span className="text-[10px] text-status-success">+{change.linesAdded || 0}</span>
                  <span className="text-[10px] text-status-error">-{change.linesRemoved || 0}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isPending && (
                <>
                  <button
                    onClick={() => handleReject(change.filePath)}
                    className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-status-error hover:bg-status-error/10 rounded transition-colors"
                  >
                    {isZh ? '拒绝' : 'Reject'}
                  </button>
                  <button
                    onClick={() => handleAccept(change.filePath)}
                    className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-status-success hover:bg-status-success/10 rounded transition-colors"
                  >
                    {isZh ? '接受' : 'Accept'}
                  </button>
                </>
              )}
              {isAccepted && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-status-success bg-status-success/10 rounded">
                  <Check className="w-2.5 h-2.5" />
                  {isZh ? '已接受' : 'Accepted'}
                </span>
              )}
              {isRejected && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-status-error bg-status-error/10 rounded">
                  <X className="w-2.5 h-2.5" />
                  {isZh ? '已拒绝' : 'Rejected'}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})

function AssistantMessageViewBase({
  message,
  pendingToolId,
  pendingToolIds,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  onRegenerate,
  isWorkspaceEditor,
  onDeleteRound,
  textContent,
  fontSize,
}: AssistantMessageViewProps) {
  const [copied, setCopied] = React.useState(false)
  const { language } = useStore(useShallow(s => ({ language: s.language })))
  const updateMessage = useAgentStore(s => s.updateMessage)
  const messageIsStreaming = !!(message as any).isStreaming

  /** 从消息对象读取持久化的反馈状态（重载后保留） */
  const feedback: MessageFeedback | undefined = isAssistantMessage(message) ? message.feedback : undefined

  /** 从全局状态订阅流式状态 */
  const {
    isStreaming,
    liveParts,
    liveInteractive,
    previewMap,
    waitPhase,
    streamStartTime,
    retryAttempt,
    retryDelay,
    streamDetail,
  } = useAgentStore(useShallow(state => {
    if (!isAssistantMessage(message)) {
      return {
        isStreaming: false,
        liveParts: undefined,
        liveInteractive: undefined,
        previewMap: EMPTY_PREVIEWS,
        waitPhase: undefined,
        streamStartTime: undefined,
        retryAttempt: undefined,
        retryDelay: undefined,
        streamDetail: undefined,
      }
    }

    const threadId = state.currentThreadId
    const threadStreamState = threadId ? state.threads[threadId]?.streamState : undefined
    const liveMessage = threadId
      ? state.threads[threadId]?.messages.find(msg => msg.id === message.id && msg.role === 'assistant')
      : undefined
    const isActiveAssistant =
      Boolean(message.isStreaming) &&
      !!threadId &&
      threadStreamState?.assistantId === message.id &&
      ACTIVE_STREAM_PHASES.has(threadStreamState?.phase ?? 'idle')

    return {
      isStreaming: isActiveAssistant,
      liveParts: liveMessage && isAssistantMessage(liveMessage) ? liveMessage.parts : undefined,
      liveInteractive: liveMessage && isAssistantMessage(liveMessage) ? liveMessage.interactive : undefined,
      previewMap: isActiveAssistant
        ? state.threads[threadId!]?.toolStreamingPreviews || EMPTY_PREVIEWS
        : EMPTY_PREVIEWS,
      waitPhase: isActiveAssistant ? threadStreamState?.waitPhase : undefined,
      streamStartTime: isActiveAssistant ? threadStreamState?.streamStartTime : undefined,
      retryAttempt: isActiveAssistant ? threadStreamState?.retryAttempt : undefined,
      retryDelay: isActiveAssistant ? threadStreamState?.retryDelay : undefined,
      streamDetail: isActiveAssistant ? threadStreamState?.streamDetail : undefined,
    }
  }))

  /** 订阅当前线程的 todos、fileChangeHistory，用于决定是否显示 chip */
  const { todos, fileChangeHistory, isLastAssistantMessage, threadIsStreaming } = useAgentStore(useShallow(state => {
    const threadId = state.currentThreadId
    const thread = threadId ? state.threads[threadId] : undefined
    const threadTodos = thread?.todos || EMPTY_TODOS
    const history = state.fileChangeHistory || EMPTY_HISTORY

    // 判断当前消息是否为线程中最后一条助手消息
    let lastAssistant = false
    if (thread) {
      for (let i = thread.messages.length - 1; i >= 0; i--) {
        if (thread.messages[i].role === 'assistant') {
          lastAssistant = thread.messages[i].id === message.id
          break
        }
      }
    }

    const streaming = threadStreamStateActive(state, threadId)

    return {
      todos: threadTodos,
      fileChangeHistory: history,
      isLastAssistantMessage: lastAssistant,
      threadIsStreaming: streaming,
    }
  }))

  /** 所有任务是否已完成 */
  const allTodosCompleted = useMemo(
    () => todos.length > 0 && todos.every(t => t.status === 'completed'),
    [todos],
  )

  /** 当前消息关联的文件变更历史 */
  const messageFileChanges = useMemo(
    () => fileChangeHistory.filter(h => h.assistantMessageId === message.id),
    [fileChangeHistory, message.id],
  )

  /** 是否显示"任务完成"chip：最后一条助手消息 + 任务全部完成 + 非流式 */
  const showTaskCompleteChip = isLastAssistantMessage && allTodosCompleted && !threadIsStreaming && !messageIsStreaming

  /** 是否显示"文件变更"chip：最后一条助手消息 + 有关联的文件变更历史 + 非流式 */
  const showFileChangesChip = isLastAssistantMessage && messageFileChanges.length > 0 && !threadIsStreaming && !messageIsStreaming

  const assistantMessage = message as any
  const assistantParts: AssistantPart[] | undefined = isAssistantMessage(message) ? (liveParts ?? (message as any).parts) : undefined
  const assistantInteractive = isAssistantMessage(message) ? (liveInteractive ?? (message as any).interactive) : undefined

  /** 计算流式工具调用预览 */
  const previewToolCalls = useMemo(() => {
    if (!isAssistantMessage(message)) return []

    const persistedIds = new Set((assistantMessage.toolCalls || []).map((tc: any) => tc.id))
    const streamingPreviews = Object.entries(previewMap)
      .filter(([id, preview]) => preview?.isStreaming && !persistedIds.has(id))
      .sort(([, left], [, right]) => (left.lastUpdateTime || 0) - (right.lastUpdateTime || 0))
      .map(([id, preview]) => ({
        id,
        name: preview.name || '...',
        arguments: preview.partialArgs || {},
        status: 'pending' as const,
      }))

    return streamingPreviews
  }, [assistantMessage, previewMap])

  const handleCopy = React.useCallback(() => {
    navigator.clipboard.writeText(textContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [textContent])

  /** 提交赞反馈：持久化到消息对象，自动同步到会话数据库 */
  const handleLike = React.useCallback(() => {
    const likeFeedback: MessageFeedback = { rating: 'like', timestamp: Date.now() }
    updateMessage(message.id, { feedback: likeFeedback } as Partial<AssistantMessage>)
    toast.success(language === 'zh' ? '感谢你的反馈' : 'Thanks for your feedback')
  }, [message.id, updateMessage, language])

  /** 提交踩反馈（含可选评论）：持久化到消息对象 */
  const handleDislikeSubmit = React.useCallback((comment: string) => {
    const dislikeFeedback: MessageFeedback = {
      rating: 'dislike',
      timestamp: Date.now(),
      ...(comment ? { comment } : {}),
    }
    updateMessage(message.id, { feedback: dislikeFeedback } as Partial<AssistantMessage>)
    toast.success(language === 'zh' ? '反馈已提交，感谢你的建议' : 'Feedback submitted, thanks for the suggestion')
  }, [message.id, updateMessage, language])

  /** 提交踩反馈并触发重新生成 */
  const handleDislikeRegenerate = React.useCallback((comment: string) => {
    const dislikeFeedback: MessageFeedback = {
      rating: 'dislike',
      timestamp: Date.now(),
      ...(comment ? { comment } : {}),
    }
    updateMessage(message.id, { feedback: dislikeFeedback } as Partial<AssistantMessage>)
    toast.success(language === 'zh' ? '反馈已提交，正在重新生成…' : 'Feedback submitted, regenerating…')
    onRegenerate?.()
  }, [message.id, updateMessage, language, onRegenerate])

  /** 取消反馈：清除消息上的反馈状态 */
  const handleCancelFeedback = React.useCallback(() => {
    updateMessage(message.id, { feedback: undefined } as Partial<AssistantMessage>)
    toast.info(language === 'zh' ? '已取消反馈' : 'Feedback removed')
  }, [message.id, updateMessage, language])

  /** 任务列表弹层内容（仅在需要时构造） */
  const taskPopoverContent = useMemo(
    () => (showTaskCompleteChip ? <TaskListPopoverContent todos={todos} /> : null),
    [showTaskCompleteChip, todos],
  )

  /** 文件变更弹层内容（仅在需要时构造） */
  const fileChangesPopoverContent = useMemo(
    () => (showFileChangesChip ? <FileChangesPopoverContent changes={messageFileChanges} language={language as Language} /> : null),
    [showFileChangesChip, messageFileChanges, language],
  )

  return (
    <div className="w-full min-w-0 flex flex-col gap-2">
      {/* 自动应用 / 手动引用的技能提示 */}
      {(() => {
        const items = (message as any).contextItems || []
        const skillItems = items.filter((i: any) => i.type === 'Skill')
        if (skillItems.length === 0) return null
        const auto = skillItems.filter((i: any) => i.auto)
        const manual = skillItems.filter((i: any) => !i.auto)
        return (
          <MessageMetaGroupView
            autoSkills={auto.length > 0 ? auto : undefined}
            manualSkills={manual.length > 0 ? manual : undefined}
          />
        )
      })()}
      <div className="w-full text-[15px] leading-relaxed text-text-primary/90 pl-1">
        <div className="prose-custom w-full max-w-none">
          {assistantParts && assistantParts.length > 0 && (
            <AssistantMessageContentView
              parts={assistantParts}
              pendingToolId={pendingToolId}
              pendingToolIds={pendingToolIds}
              onApproveTool={onApproveTool}
              onRejectTool={onRejectTool}
              onOpenDiff={onOpenDiff}
              fontSize={fontSize}
              isStreaming={messageIsStreaming}
              messageId={message.id}
            />
          )}
          {isStreaming && assistantParts && assistantParts.length > 0 && (
            <StreamingPhaseIndicator
              mode="inline"
              streamDetail={streamDetail}
              retryAttempt={retryAttempt}
              retryDelay={retryDelay}
              hasReasoningBlock={assistantParts.some(isReasoningPart)}
            />
          )}
          {isStreaming && (!assistantParts || assistantParts.length === 0) && previewToolCalls.length === 0 && (
            <StreamingPhaseIndicator
              mode="waiting"
              waitPhase={waitPhase}
              streamStartTime={streamStartTime}
              streamDetail={streamDetail}
              retryAttempt={retryAttempt}
              retryDelay={retryDelay}
            />
          )}
          {previewToolCalls.length > 0 && (
            <ToolCallGroup
              toolCalls={previewToolCalls}
              pendingToolId={pendingToolId}
              pendingToolIds={pendingToolIds}
              onApproveTool={onApproveTool}
              onRejectTool={onRejectTool}
              onOpenDiff={onOpenDiff}
              messageId={message.id}
            />
          )}
        </div>

        {assistantInteractive && !messageIsStreaming && (
          <div className="mt-2 w-full">
            <InteractiveCard
              content={assistantInteractive}
              onSelect={(selectedIds, customText) => {
                const selectedLabels = assistantInteractive.options
                  .filter((opt: any) => selectedIds.includes(opt.id))
                  .map((opt: any) => opt.label)
                const response = customText || selectedLabels.join(', ')
                window.dispatchEvent(new CustomEvent('chat-update-interactive', { detail: { messageId: message.id, selectedIds } }))
                window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: response, messageId: message.id } }))
              }}
              disabled={!!assistantInteractive.selectedIds?.length}
            />
          </div>
        )}
      </div>

      {!messageIsStreaming && (
        <MessageActionsBar
          messageId={message.id}
          copied={copied}
          onCopy={handleCopy}
          onRegenerate={onRegenerate}
          onDeleteRound={onDeleteRound ? () => onDeleteRound(message.id) : undefined}
          textContent={textContent}
          isWorkspaceEditor={!!isWorkspaceEditor}
          hasCheckpoint={false}
          language={language as Language}
          menuLabelKey="more2"
          showVoiceOutput
          alwaysVisible={isLastAssistantMessage}
          showTaskCompleteChip={showTaskCompleteChip}
          taskPopoverContent={taskPopoverContent}
          showFileChangesChip={showFileChangesChip}
          fileChangesCount={messageFileChanges.length}
          fileChangesPopoverContent={fileChangesPopoverContent}
          feedback={feedback}
          onLike={handleLike}
          onDislikeSubmit={handleDislikeSubmit}
          onDislikeRegenerate={handleDislikeRegenerate}
          onCancelFeedback={handleCancelFeedback}
        />
      )}
    </div>
  )
}

/** 判断线程是否处于流式状态 */
function threadStreamStateActive(
  state: ReturnType<typeof useAgentStore.getState>,
  threadId: string | null,
): boolean {
  if (!threadId) return false
  const phase = state.threads[threadId]?.streamState?.phase
  return ACTIVE_STREAM_PHASES.has(phase ?? 'idle')
}

export const AssistantMessageView = React.memo(AssistantMessageViewBase)
AssistantMessageView.displayName = 'AssistantMessageView'
