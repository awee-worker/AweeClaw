/**
 * TaskExecutionView — 任务内嵌执行视图
 *
 * 在项目「执行」Tab 中渲染对话流，不切换到主聊天界面。
 * 支持两种模式：
 * 1. 单任务模式（task 模式）：渲染指定任务的对话流
 * 2. 批量模式（batch 模式）：渲染批量执行的对话流，头部显示"批量执行"标识
 *
 * 职责：
 * - 订阅指定 threadId 的消息列表与流式状态（不依赖 currentThreadId）
 * - 使用 LightweightMessageView 渲染消息（脱离 ChatPanel Virtuoso/批准流/composer 上下文）
 * - 提供输入区继续对话（sendToThread 定向发送，不污染主聊天线程）
 * - 提供工具批准条（基于该线程 streamState.pendingApprovalToolCalls）
 * - 自动滚动到底部（用户向上滚动时不打断，滚回底部后恢复跟随）
 *
 * 布局：
 * ┌────────────────────────────────────────────┐
 * │  标题 + 状态徽标 + 关闭按钮                   │
 * ├────────────────────────────────────────────┤
 * │  消息流（LightweightMessageView 列表）       │
 * ├────────────────────────────────────────────┤
 * │  工具批准条（streamState.phase=tool_pending）│
 * ├────────────────────────────────────────────┤
 * │  输入框 + 发送/停止按钮                      │
 * └────────────────────────────────────────────┘
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, X, AlertCircle, CheckCircle2, Layers, FileCheck2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { Agent } from '@intelligence/engine'
import { useThreadMessenger } from '@hooks/useAgent'
import { isAssistantMessage } from '@intelligence/types/conversationModel'
import { tasksApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import { logger } from '@shared/toolkit/LogEngine'
import type { TaskItem } from '../../tasks/types'
import { TASK_STATUS_CONFIG } from '../../tasks/taskConstants'
import { TaskExecutionMessages } from './TaskExecutionMessages'
import { TaskExecutionInput } from './TaskExecutionInput'
import { TaskResultCard } from './TaskResultCard'
import {
  parseExecutionResult,
  extractExecutionResult,
  mergeExecutionResult,
  type TaskExecutionResult,
} from '../taskQuality'
import { buildResultRegenerationPrompt } from '../projectExecutionContext'
import type { FileItem } from '@shared/protocols'

interface TaskExecutionViewProps {
  /** 关联的任务（单任务模式必填，批量模式为 null） */
  task: TaskItem | null
  /** 关联的对话线程 ID（任务执行上下文） */
  threadId: string
  /** 是否中文 */
  isZh: boolean
  /** 关闭回调（清除当前执行视图） */
  onClose: () => void
  /** 任务状态变更通知（AI 完成后回写状态） */
  onTaskUpdated?: (taskId: string, patch: Partial<TaskItem>) => void
  /** 流式结束回调（AI 执行完成，用于清除批量执行队列状态等） */
  onStreamFinished?: () => void
  /** 中止执行回调（更新会话状态为 aborted + 中止 AI 线程） */
  onAbort?: () => void
  /** 重新执行任务（结果卡片中点击「重新执行」时触发） */
  onRerun?: () => void
  /** 预览产出文件（结果卡片中点击文件路径时触发） */
  onPreviewFile?: (file: FileItem) => void

  // ─── 批量模式专用 ──────────────────────────────
  /** 批量模式标识（非 null 时为批量执行模式） */
  batchMode?: boolean
  /** 批量执行的任务总数 */
  batchTotalCount?: number
  /** 批量执行的自定义标题 */
  batchTitle?: string
}

export function TaskExecutionView({
  task, threadId, isZh, onClose, onTaskUpdated, onStreamFinished, onAbort, onRerun, onPreviewFile,
  batchMode, batchTotalCount, batchTitle,
}: TaskExecutionViewProps) {
  const { sendToThread, abortThread } = useThreadMessenger()

  // ─── 订阅指定线程的消息列表与流式状态 ───────────────────
  const { messages, streamState, messagesHydrated, threadExists } = useAgentStore(useShallow(state => {
    const thread = state.threads[threadId]
    return {
      messages: thread?.messages ?? EMPTY_MESSAGES,
      streamState: thread?.streamState ?? DEFAULT_STREAM_STATE,
      messagesHydrated: thread?.messagesHydrated ?? false,
      threadExists: !!thread,
    }
  }))

  // threadMessageVersions 用于触发消息列表重渲染（消息内容变更时版本号递增）
  const messageVersion = useAgentStore(s => s.threadMessageVersions[threadId] ?? 0)

  // 从响应式 streamState 派生 isStreaming（避免非响应式的 getState 调用导致 UI 不更新）
  const isStreaming = streamState.phase === 'streaming'
    || streamState.phase === 'tool_running'
    || streamState.phase === 'tool_pending'
  const pendingApprovals = streamState.pendingApprovalToolCalls ?? EMPTY_APPROVALS

  // ─── 工具批准派生（与主聊天 ChatPanel 一致：单个 approve / 多个 approveAll） ───
  // pendingToolIds：所有待批准工具 id；pendingToolId：单个时取第一个
  const pendingToolIds = useMemo(() => pendingApprovals.map(tc => tc.id), [pendingApprovals])
  const pendingToolId = pendingToolIds.length === 1 ? pendingToolIds[0] : undefined

  // ─── 流式阶段状态（派生自当前线程 streamState，供消息列表渲染思考中/处理中） ───
  // 仅携带状态字段，mode/hasReasoningBlock 由消费方（LightweightMessageView）自行决定
  const streamPhase = useMemo(() => ({
    waitPhase: streamState.waitPhase,
    streamStartTime: streamState.streamStartTime,
    streamDetail: streamState.streamDetail,
    retryAttempt: streamState.retryAttempt,
    retryDelay: streamState.retryDelay,
  }), [
    streamState.waitPhase,
    streamState.streamStartTime,
    streamState.streamDetail,
    streamState.retryAttempt,
    streamState.retryDelay,
  ])

  // ─── 输入与发送 ───────────────────────────────────────
  const [input, setInput] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setSendError(null)
    setInput('')
    try {
      await sendToThread(text, threadId)
    } catch (e) {
      setSendError(getApiErrorMessage(e, isZh ? '发送失败' : 'Failed to send'))
      // 发送失败时恢复输入内容，便于用户重试
      setInput(text)
    }
  }, [input, isStreaming, sendToThread, threadId, isZh])

  const handleAbort = useCallback(() => {
    // 优先使用 onAbort（会更新会话状态为 aborted，批量循环检测后立即退出）
    if (onAbort) {
      onAbort()
    } else {
      // 回退：直接中止线程（无会话上下文时）
      abortThread(threadId)
    }
  }, [onAbort, abortThread, threadId])

  // ─── 工具批准/拒绝（与主聊天 ChatPanel 一致：单个 approve/reject，多个 approveAll/rejectAll） ───
  // 内联渲染于工具卡片（ToolCallGroup），不再使用底部独立批准条
  const handleApproveTool = useCallback(() => {
    if (pendingToolIds.length > 1) {
      Agent.approveAll()
    } else {
      Agent.approve(streamState.requestId)
    }
  }, [pendingToolIds.length, streamState.requestId])

  const handleRejectTool = useCallback(() => {
    if (pendingToolIds.length > 1) {
      Agent.rejectAll()
    } else {
      Agent.reject(streamState.requestId)
    }
  }, [pendingToolIds.length, streamState.requestId])

  // ─── 流式完成检测：AI 执行完成后解析结构化结果 ─────────
  const prevStreamingRef = useRef(isStreaming)
  const [justFinished, setJustFinished] = useState(false)
  const executionStartRef = useRef<number | null>(null)
  const [parsedResult, setParsedResult] = useState<TaskExecutionResult | null>(() =>
    task ? extractExecutionResult(task.metadata) : null,
  )
  const [showResultCard, setShowResultCard] = useState(false)
  // 执行完成但未解析出结构化结果时，提供"生成结果摘要"重试入口（仅单任务模式）
  const [resultParseFailed, setResultParseFailed] = useState(false)

  // 记录执行开始时间（首次进入 streaming 时）
  useEffect(() => {
    if (isStreaming && executionStartRef.current === null) {
      executionStartRef.current = Date.now()
    }
    // 进入流式时清除"解析失败"提示（新一轮执行 / 重生成 / 用户追问都应清除）
    if (isStreaming) {
      setResultParseFailed(false)
    }
  }, [isStreaming])

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      // 流式刚结束
      setJustFinished(true)
      // 通知父组件流式结束（用于清除批量执行队列状态等）
      onStreamFinished?.()

      // 3 秒后自动隐藏"刚完成"提示
      const timer = setTimeout(() => setJustFinished(false), 3000)
      prevStreamingRef.current = isStreaming

      // ── 解析结构化执行结果（仅单任务模式） ──
      // 从最后一条 assistant 消息中提取结构化结果块
      if (task && !batchMode) {
        const lastAssistant = [...messages].reverse().find(isAssistantMessage)
        const result =
          lastAssistant && typeof lastAssistant.content === 'string'
            ? parseExecutionResult(lastAssistant.content)
            : null
        if (result) {
          // 解析成功：记录耗时、切换结果卡片、异步回写后端
          if (executionStartRef.current) {
            result.durationSec = Math.round((Date.now() - executionStartRef.current) / 1000)
          }
          setParsedResult(result)
          // 自动切换到结果卡片视图
          setShowResultCard(true)
          setResultParseFailed(false)
          // 异步存入后端 task.metadata.result（合并写入，保留已有 quality 等字段）
          const mergedMetadata = mergeExecutionResult(task.metadata, result)
          tasksApi
            .update(task.id, { metadata: mergedMetadata })
            .then(() => {
              onTaskUpdated?.(task.id, { metadata: mergedMetadata })
            })
            .catch((e) => {
              logger.agent.warn('[TaskExecutionView] Failed to save execution result:', e)
            })
        } else if (!extractExecutionResult(task.metadata)) {
          // 解析失败且任务无已保存结果：提供"生成结果摘要"重试入口
          // （已有结果时不打扰，避免用户普通追问也弹提示）
          setResultParseFailed(true)
        }
      }

      return () => clearTimeout(timer)
    }
    prevStreamingRef.current = isStreaming
  }, [isStreaming, onStreamFinished, task, batchMode, messages, onTaskUpdated])

  // ─── 标记任务完成（仅单任务模式） ─────────────────────
  const [markingDone, setMarkingDone] = useState(false)
  const handleMarkDone = useCallback(async () => {
    if (!task) return
    setMarkingDone(true)
    try {
      onTaskUpdated?.(task.id, { status: 'DONE' })
      setJustFinished(false)
    } finally {
      setMarkingDone(false)
    }
  }, [onTaskUpdated, task])

  // ── 重新执行 ──
  const handleRerun = useCallback(() => {
    setShowResultCard(false)
    setParsedResult(null)
    setResultParseFailed(false)
    executionStartRef.current = Date.now()
    onRerun?.()
  }, [onRerun])

  // ── 生成结果摘要（AI 未输出结构化结果块时的重试） ──
  // 发送跟进消息，要求 AI 基于已完成的工作补充输出结果块；
  // 回复到达后由上方解析逻辑自动捕获并切换到结果卡片。
  const handleRegenerateResult = useCallback(async () => {
    if (!task || isStreaming) return
    try {
      const message = buildResultRegenerationPrompt(task, isZh)
      await sendToThread(message, threadId)
    } catch (e) {
      setSendError(getApiErrorMessage(e, isZh ? '发送失败' : 'Failed to send'))
    }
  }, [task, isStreaming, isZh, sendToThread, threadId])

  // ─── 渲染 ───────────────────────────────────────────

  if (!threadExists) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted">
        <AlertCircle className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-[13px]">{isZh ? '对话线程不存在或已被删除' : 'Thread not found or deleted'}</p>
        <button onClick={onClose} className="mt-3 text-[12px] text-accent hover:underline">
          {isZh ? '返回' : 'Go back'}
        </button>
      </div>
    )
  }

  // 头部标题与状态
  const headerTitle = batchMode
    ? (batchTitle ?? (isZh ? '批量执行' : 'Batch Execution'))
    : (task?.title ?? '')
  const headerStatusColor = batchMode
    ? 'text-accent'
    : (task ? TASK_STATUS_CONFIG[task.status].color : '')
  const headerStatusLabel = batchMode
    ? (isZh ? `${batchTotalCount ?? 0} 个任务` : `${batchTotalCount ?? 0} tasks`)
    : (task ? (isZh ? TASK_STATUS_CONFIG[task.status].labelZh : TASK_STATUS_CONFIG[task.status].label) : '')
  const headerDotColor = batchMode
    ? 'bg-accent'
    : (task ? TASK_STATUS_CONFIG[task.status].dotColor : 'bg-slate-400')
  const taskIsDone = task?.status === 'DONE'

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* 头部：标题 + 状态 + 关闭 */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 h-12 border-b border-border/30 bg-surface/20">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {batchMode ? (
            <Layers className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          ) : (
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${headerDotColor}`} />
          )}
          <span className="text-[13px] font-medium text-text-primary truncate" title={headerTitle}>
            {headerTitle}
          </span>
          <span className={`text-[12px] flex-shrink-0 ${headerStatusColor}`}>
            {headerStatusLabel}
          </span>
          {isStreaming && (
            <span className="flex items-center gap-1 text-[12px] text-accent flex-shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              {isZh ? '执行中' : 'Running'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* 查看执行结果：已有解析结果且当前展示对话流时，可切回结果卡片 */}
          {parsedResult && !showResultCard && !isStreaming && !batchMode && (
            <button
              onClick={() => setShowResultCard(true)}
              className="p-1.5 rounded hover:bg-surface-hover/50 text-text-muted hover:text-accent transition-colors"
              title={isZh ? '查看执行结果' : 'View execution result'}
            >
              <FileCheck2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors"
            title={isZh ? '关闭执行视图' : 'Close execution view'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/*
        主体视图切换：
        - 单任务执行完成且解析出结构化结果时 → 展示 TaskResultCard（结果卡片）
        - 其他情况（执行中 / 批量模式 / 解析失败 / 用户切回对话）→ 展示对话流
        结果卡片内置「查看对话 / 重新执行 / 标记完成」操作，避免与下方输入区重复。
      */}
      {showResultCard && parsedResult && !isStreaming && !batchMode ? (
        <TaskResultCard
          result={parsedResult}
          isZh={isZh}
          onViewConversation={() => setShowResultCard(false)}
          onRerun={handleRerun}
          onMarkDone={handleMarkDone}
          onPreviewFile={onPreviewFile}
        />
      ) : (
        <>
          {/* 消息流 */}
          <TaskExecutionMessages
            messages={messages}
            messageVersion={messageVersion}
            isStreaming={isStreaming}
            isZh={isZh}
            isLoading={!messagesHydrated}
            streamPhase={streamPhase}
            pendingToolId={pendingToolId}
            pendingToolIds={pendingToolIds}
            onApproveTool={handleApproveTool}
            onRejectTool={handleRejectTool}
          />

          {/* 刚完成提示条 */}
          {justFinished && !isStreaming && (
            <div className="flex-shrink-0 px-4 py-2 border-t border-border/30 bg-green-500/5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12px] text-green-600">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {batchMode
                    ? (isZh ? '批量执行已完成' : 'Batch execution finished')
                    : (isZh ? '任务执行已完成' : 'Task execution finished')}
                </span>
              </div>
              {/* 仅单任务模式且未完成时显示"标记完成"按钮 */}
              {!batchMode && task && !taskIsDone && (
                <button
                  onClick={handleMarkDone}
                  disabled={markingDone}
                  className="text-[12px] px-2 py-0.5 rounded bg-green-500/15 text-green-600 hover:bg-green-500/25 transition-colors disabled:opacity-50"
                >
                  {markingDone
                    ? (isZh ? '标记中...' : 'Marking...')
                    : (isZh ? '标记为已完成' : 'Mark as done')}
                </button>
              )}
            </div>
          )}

          {/* 工具批准：已改为内联渲染于工具卡片（ToolCallGroup），与主聊天窗口一致，无需独立批准条 */}

          {/* 发送错误提示 */}
          {sendError && (
            <div className="flex-shrink-0 mx-4 mb-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
              <span className="text-[12px] text-red-500 flex-1">{sendError}</span>
              <button onClick={() => setSendError(null)} className="text-[12px] text-red-500/70 hover:text-red-500">
                ✕
              </button>
            </div>
          )}

          {/* 结果解析失败提示：AI 未输出结构化结果块时，提供"生成结果摘要"重试入口 */}
          {resultParseFailed && !isStreaming && !batchMode && task && !parsedResult && (
            <div className="flex-shrink-0 mx-4 mb-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-[12px] text-amber-600 flex-1">
                {isZh
                  ? '未能解析结构化结果，可让 AI 补充生成结果摘要'
                  : 'Could not parse structured result. Ask AI to generate a summary.'}
              </span>
              <button
                onClick={handleRegenerateResult}
                disabled={isStreaming}
                className="text-[12px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
              >
                {isZh ? '生成结果摘要' : 'Generate Summary'}
              </button>
              <button
                onClick={() => setResultParseFailed(false)}
                className="text-[12px] text-amber-500/70 hover:text-amber-500"
                title={isZh ? '关闭' : 'Dismiss'}
              >
                ✕
              </button>
            </div>
          )}

          {/* 输入区 */}
          <TaskExecutionInput
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            onAbort={handleAbort}
            isStreaming={isStreaming}
            isZh={isZh}
          />
        </>
      )}
    </div>
  )
}

// ─── 常量 ───────────────────────────────────────────────

const EMPTY_MESSAGES: import('@intelligence/providerTypes').ChatMessage[] = []
const DEFAULT_STREAM_STATE: import('@intelligence/types/dialogThreadModel').StreamState = { phase: 'idle' }
const EMPTY_APPROVALS: import('@intelligence/types/dialogThreadModel').PendingToolApproval[] = []
