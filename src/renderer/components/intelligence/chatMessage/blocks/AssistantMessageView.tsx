/**
 * 助手消息视图
 * 左对齐布局，支持流式输出、工具调用预览、交互卡片
 *
 * ── 订阅策略（性能关键）──
 *
 * 每条消息都挂 store 订阅时，流式期间每次 store 更新都会让全部可见消息各跑一遍
 * 选择器，成本随消息数线性放大。这里把订阅收窄到真正需要的两个位置：
 *   - 实时流式数据：只有当前正在流式的那条消息才订阅；
 *   - chip 数据：只有线程中最后一条助手消息才订阅。
 * 其余消息完全由 props 驱动、不订阅，`isActiveStreamMessage` / `isLastAssistantMessage`
 * 这两个「全线程唯一」的判断由 ChatPanel 统一计算后下发。
 */
import React, { useMemo } from 'react'
import { Check, FileCode, FilePlus, UserCog, X } from 'lucide-react'
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
import { MessageMetaGroupView } from './MessageMetaGroupView'
import { buildContinuationPrompt, CONTINUATION_DECLINE_MESSAGE } from '@intelligence/utils/continuationReply'

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
  /** 继续任务卡片专用：该消息之后已出现新的用户消息，卡片过期 */
  interactiveObsolete?: boolean
  /**
   * 该消息是否为当前正在流式的助手消息
   *
   * 由 ChatPanel 统一计算后传入：判断依据（线程 streamState.assistantId 与本消息 id
   * 是否一致）是全线程共享的，交给每条消息各自订阅只会让选择器执行次数乘以消息数。
   */
  isActiveStreamMessage?: boolean
  /** 该消息是否为线程中最后一条助手消息，同样由 ChatPanel 统一计算 */
  isLastAssistantMessage?: boolean
}

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

/* ------------------------------------------------------------------ */
/* 订阅作用域                                                          */
/* ------------------------------------------------------------------ */

type AgentState = ReturnType<typeof useAgentStore.getState>

/**
 * 计算「活跃消息」的实时流式数据。
 *
 * 只在活跃消息作用域内调用 —— 非活跃消息读到的是常量，不必付出选择器成本。
 */
function computeLiveStreamData(state: AgentState, message: ChatMessageType) {
  const threadId = state.currentThreadId
  const threadStreamState = threadId ? state.threads[threadId]?.streamState : undefined

  /**
   * 消息是否仍是当前执行中的助手消息。
   *
   * 只认归属：流式标记 + assistantId 匹配，不掺 phase。phase 会在迭代间隙、
   * 模型连接与重试时短暂离开活跃集合，若用它来门控实时数据来源，正处在预览阶段
   * （尚未写入 parts）的工具会因为读不到预览表而整体消失，phase 恢复后又出现，
   * 看起来就是工具卡片反复闪动。数据来源按归属取，状态表达才按 phase 取。
   */
  const isLiveAssistant =
    isAssistantMessage(message) &&
    Boolean(message.isStreaming) &&
    !!threadId &&
    threadStreamState?.assistantId === message.id

  /** 是否处于活跃流式阶段：只用于进度表达（如等待指示器），不用于数据订阅 */
  const isActiveAssistant =
    isLiveAssistant && ACTIVE_STREAM_PHASES.has(threadStreamState?.phase ?? 'idle')

  // 只有当前执行中的那条消息才需要从 store 取实时 parts，其余消息直接用自身 props。
  const liveMessage = isLiveAssistant
    ? state.threads[threadId!]?.messages.find(msg => msg.id === message.id && msg.role === 'assistant')
    : undefined

  return {
    isStreaming: isActiveAssistant,
    liveParts: liveMessage && isAssistantMessage(liveMessage) ? liveMessage.parts : undefined,
    liveInteractive: liveMessage && isAssistantMessage(liveMessage) ? liveMessage.interactive : undefined,
    previewMap: isLiveAssistant
      ? state.threads[threadId!]?.toolStreamingPreviews || EMPTY_PREVIEWS
      : EMPTY_PREVIEWS,
    waitPhase: isActiveAssistant ? threadStreamState?.waitPhase : undefined,
    streamStartTime: isActiveAssistant ? threadStreamState?.streamStartTime : undefined,
    retryAttempt: isActiveAssistant ? threadStreamState?.retryAttempt : undefined,
    retryDelay: isActiveAssistant ? threadStreamState?.retryDelay : undefined,
    streamDetail: isActiveAssistant ? threadStreamState?.streamDetail : undefined,
  }
}

type LiveStreamData = ReturnType<typeof computeLiveStreamData>

const IDLE_STREAM_DATA: LiveStreamData = {
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

/** 计算「末条助手消息」chip 所依赖的数据 */
function computeChipData(state: AgentState) {
  const threadId = state.currentThreadId
  const thread = threadId ? state.threads[threadId] : undefined
  return {
    fileChangeHistory: state.fileChangeHistory || EMPTY_HISTORY,
    threadTodos: thread?.todos || EMPTY_TODOS,
    threadIsStreaming: threadStreamStateActive(state, threadId),
  }
}

type ChipData = ReturnType<typeof computeChipData>

const IDLE_CHIP_DATA: ChipData = {
  fileChangeHistory: EMPTY_HISTORY,
  threadTodos: EMPTY_TODOS,
  threadIsStreaming: false,
}

/** 实时流式数据作用域：只在活跃消息上挂载，避免每条消息各订阅一次 */
function LiveStreamScope({
  message,
  children,
}: {
  message: ChatMessageType
  children: (data: LiveStreamData) => React.ReactNode
}) {
  const data = useAgentStore(useShallow(state => computeLiveStreamData(state, message)))
  return <>{children(data)}</>
}

/** chip 数据作用域：只在末条助手消息上挂载 */
function ChipScope({
  children,
}: {
  children: (data: ChipData) => React.ReactNode
}) {
  const data = useAgentStore(useShallow(computeChipData))
  return <>{children(data)}</>
}

/** 仅在 active 时挂载实时流式作用域，否则直接给出空闲常量 */
function LiveGate({
  active,
  message,
  children,
}: {
  active: boolean
  message: ChatMessageType
  children: (data: LiveStreamData) => React.ReactNode
}) {
  if (!active) return <>{children(IDLE_STREAM_DATA)}</>
  return <LiveStreamScope message={message}>{children}</LiveStreamScope>
}

/** 仅在 last 时挂载 chip 作用域，否则直接给出空闲常量 */
function ChipGate({
  last,
  children,
}: {
  last: boolean
  children: (data: ChipData) => React.ReactNode
}) {
  if (!last) return <>{children(IDLE_CHIP_DATA)}</>
  return <ChipScope>{children}</ChipScope>
}

/* ------------------------------------------------------------------ */
/* 渲染主体                                                            */
/* ------------------------------------------------------------------ */

interface AssistantMessageBodyProps
  extends Omit<AssistantMessageViewProps, 'isActiveStreamMessage' | 'isLastAssistantMessage'> {
  isLastAssistantMessage: boolean
  live: LiveStreamData
  chips: ChipData
}

/**
 * 助手消息的纯渲染主体：不订阅任何「当前线程」状态，数据全部由作用域组件注入。
 * 因此非活跃、非末条消息的 props 一旦稳定，memo 即可完全短路。
 */
const AssistantMessageBody = React.memo(function AssistantMessageBody({
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
  interactiveObsolete,
  isLastAssistantMessage,
  live,
  chips,
}: AssistantMessageBodyProps) {
  const [copied, setCopied] = React.useState(false)
  const language = useStore(s => s.language)
  const updateMessage = useAgentStore(s => s.updateMessage)
  const messageIsStreaming = !!(message as any).isStreaming

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
  } = live
  const { fileChangeHistory, threadTodos, threadIsStreaming } = chips

  /** 从消息对象读取持久化的反馈状态（重载后保留） */
  const feedback: MessageFeedback | undefined = isAssistantMessage(message) ? message.feedback : undefined

  /** 当前消息关联的文件变更历史 */
  const messageFileChanges = useMemo(
    () => fileChangeHistory.filter(h => h.assistantMessageId === message.id),
    [fileChangeHistory, message.id],
  )

  /** 是否显示"文件变更"chip：最后一条助手消息 + 有关联的文件变更历史 + 非流式 */
  const showFileChangesChip = isLastAssistantMessage && messageFileChanges.length > 0 && !threadIsStreaming && !messageIsStreaming

  const assistantMessage = message as any
  const assistantParts: AssistantPart[] | undefined = isAssistantMessage(message) ? (liveParts ?? (message as any).parts) : undefined
  const assistantInteractive = isAssistantMessage(message) ? (liveInteractive ?? (message as any).interactive) : undefined

  /**
   * 是否显示"任务完成"chip：最后一条助手消息 + 该消息包含任务列表（todo_write 调用）
   * + 线程 todos 全部完成 + 非流式。
   * 通过 chip 让用户在 AI 回复底部直观看到本轮任务已全部完成。
   */
  const showTaskDoneChip = useMemo(() => {
    if (!isLastAssistantMessage || threadIsStreaming || messageIsStreaming) return false
    if (!assistantParts || assistantParts.length === 0) return false
    const hasTodoWrite = assistantParts.some(
      p => p.type === 'tool_call' && p.toolCall?.name === 'todo_write'
    )
    if (!hasTodoWrite) return false
    return threadTodos.length > 0 && threadTodos.every(t => t.status === 'completed')
  }, [isLastAssistantMessage, threadIsStreaming, messageIsStreaming, assistantParts, threadTodos])

  /** 计算流式工具调用预览 */
  const previewToolCalls = useMemo(() => {
    if (!isAssistantMessage(message)) return []

    // 判定「工具是否已正式落定」不能只看 props 上的 message.toolCalls：流式期间
    // props 可能滞后一拍，工具已写进 parts 却仍被当作未落定，于是同一次调用会同时
    // 渲染「正式卡片 + 流式预览卡」，预览卡恒为 pending，一直显示「正在读取 / 编辑中」，
    // 直到消息结束清空预览表才消失。这里把当前实时 parts 一并纳入已落定集合。
    const persistedIds = new Set<string>((assistantMessage.toolCalls || []).map((tc: any) => tc.id))
    for (const part of assistantParts || []) {
      if (part.type === 'tool_call') persistedIds.add((part as any).toolCall.id)
    }

    // 顺序必须恒定，故直接沿用 previewMap 的键序：它等于 tool_call_start 的到达顺序，
    // 也就是模型的调用声明顺序，并与工具正式写入 parts 的先后一致。
    //
    // 这里曾按 lastUpdateTime 排序，意图是「刚更新的调用排到最后」。但连续 / 并行调用时
    // 各工具的参数分片是交替到达的，每 150ms 的 flush 都会把刚刚更新的那个工具挪到队尾，
    // 于是组内首元素在 A、B、C 之间来回切换。而工具组以「首个工具 id」作为渲染 key，
    // 键一变整组 DOM 就被卸载重建、淡入动画重播 —— 观感正是「读取文件…」反复消失又出现，
    // 直到工具全部落定才稳定成组。键序在整个流式期间不变，预览转正式时也不会重排。
    const streamingPreviews = Object.entries(previewMap)
      .filter(([id, preview]) => preview?.isStreaming && !persistedIds.has(id))
      .map(([id, preview]) => ({
        id,
        name: preview.name || '...',
        arguments: preview.partialArgs || {},
        status: 'pending' as const,
      }))

    return streamingPreviews
  }, [assistantMessage, assistantParts, previewMap])

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

  /** 文件变更弹层内容（仅在需要时构造） */
  const fileChangesPopoverContent = useMemo(
    () => (showFileChangesChip ? <FileChangesPopoverContent changes={messageFileChanges} language={language as Language} /> : null),
    [showFileChangesChip, messageFileChanges, language],
  )

  return (
    <div className="w-full min-w-0 flex flex-col gap-2">
      {/* 手动引用的技能提示（关键词自动应用的技能不再在头部展示，避免噪音） */}
      {(() => {
        const items = (message as any).contextItems || []
        const manual = items.filter((i: any) => i.type === 'Skill' && !i.auto)
        if (manual.length === 0) return null
        return (
          <MessageMetaGroupView
            manualSkills={manual}
          />
        )
      })()}

      {/* 场景角色徽章：本轮回复使用了角色库中某个角色的方法 */}
      {(message as AssistantMessage).sceneRole && !messageIsStreaming && (
        <div className="flex items-center">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-muted bg-bg-hover border border-border rounded-full"
            title={language === 'zh'
              ? '本条回复应用了该角色的方法（可在设置-角色库中管理）'
              : 'This reply applied the method of this role (manage in Settings - Role Library)'}
          >
            <UserCog className="w-3 h-3" />
            {(message as AssistantMessage).sceneRole!.nameZh}
          </span>
        </div>
      )}

      <div className="w-full text-[15px] leading-relaxed text-text-primary/90 pl-1">
        <div className="prose-custom w-full max-w-none">
          {(assistantParts && assistantParts.length > 0) || previewToolCalls.length > 0 ? (
            <AssistantMessageContentView
              parts={assistantParts || []}
              previewToolCalls={previewToolCalls}
              pendingToolId={pendingToolId}
              pendingToolIds={pendingToolIds}
              onApproveTool={onApproveTool}
              onRejectTool={onRejectTool}
              onOpenDiff={onOpenDiff}
              fontSize={fontSize}
              isStreaming={messageIsStreaming}
              messageId={message.id}
            />
          ) : null}
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
        </div>

        {assistantInteractive && !messageIsStreaming && (
          <div className="mt-2 w-full">
            <InteractiveCard
              content={assistantInteractive}
              onSelect={(selectedIds, customText) => {
                const selectedLabels = assistantInteractive.options
                  .filter((opt: any) => selectedIds.includes(opt.id))
                  .map((opt: any) => opt.label)
                // 继续任务卡片：把未完成清单转成续做正文；普通选项卡片维持原语义
                const response = assistantInteractive.kind === 'continue_task'
                  ? (selectedIds.includes('skip')
                      ? CONTINUATION_DECLINE_MESSAGE
                      : buildContinuationPrompt(assistantInteractive.continuation?.remaining ?? []))
                  : (customText || selectedLabels.join(', '))
                window.dispatchEvent(new CustomEvent('chat-update-interactive', { detail: { messageId: message.id, selectedIds } }))
                window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: response, messageId: message.id } }))
              }}
              disabled={!!assistantInteractive.selectedIds?.length}
              obsolete={interactiveObsolete}
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
          showFileChangesChip={showFileChangesChip}
          fileChangesCount={messageFileChanges.length}
          fileChangesPopoverContent={fileChangesPopoverContent}
          showTaskDoneChip={showTaskDoneChip}
          feedback={feedback}
          onLike={handleLike}
          onDislikeSubmit={handleDislikeSubmit}
          onDislikeRegenerate={handleDislikeRegenerate}
          onCancelFeedback={handleCancelFeedback}
          timestamp={message.timestamp}
          timePosition="after"
        />
      )}
    </div>
  )
})
AssistantMessageBody.displayName = 'AssistantMessageBody'

function AssistantMessageViewBase({
  message,
  isActiveStreamMessage,
  isLastAssistantMessage,
  ...rest
}: AssistantMessageViewProps) {
  // 精确复刻原判定：既要是当前流式消息，消息本身也要仍标记为流式中
  const active = !!isActiveStreamMessage && !!(message as { isStreaming?: boolean }).isStreaming
  const last = !!isLastAssistantMessage

  return (
    <ChipGate last={last}>
      {chips => (
        <LiveGate active={active} message={message}>
          {live => (
            <AssistantMessageBody
              message={message}
              isLastAssistantMessage={last}
              live={live}
              chips={chips}
              {...rest}
            />
          )}
        </LiveGate>
      )}
    </ChipGate>
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
