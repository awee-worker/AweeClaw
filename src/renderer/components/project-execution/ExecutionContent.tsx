/**
 * ExecutionContent — 执行窗口右侧内容区
 *
 * 复用 TaskExecutionMessages / TaskExecutionInput / TaskResultCard，
 * 从 IntelligenceStore 订阅指定 threadId 的消息流和流式状态。
 *
 * 与 TaskExecutionView 的区别：
 * - 不含标题栏 / 关闭按钮（由 ExecutionWindowTitleBar 统一控制）
 * - 不含批量执行模式（执行窗口每个 Tab 是独立的单任务/单项目）
 * - 结果卡片在底部可折叠显示
 *
 * 布局：
 * ┌──────────────────────────────────────┐
 * │  消息流（TaskExecutionMessages）       │
 * │  ...                                 │
 * ├──────────────────────────────────────┤
 * │  结果预览（TaskResultCard，可折叠）     │
 * ├──────────────────────────────────────┤
 * │  输入框（TaskExecutionInput）          │
 * └──────────────────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, ChevronUp, FileCheck2 } from 'lucide-react'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { Agent } from '@intelligence/engine'
import { useThreadMessenger } from '@hooks/useAgent'
import { isAssistantMessage } from '@intelligence/types/conversationModel'
import { tasksApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import { logger } from '@shared/toolkit/LogEngine'
import type { TaskItem } from '@renderer/components/explorer/panels/tasks/types'
import { TaskExecutionMessages } from '@renderer/components/explorer/panels/projects/taskExecution/TaskExecutionMessages'
import { TaskExecutionInput } from '@renderer/components/explorer/panels/projects/taskExecution/TaskExecutionInput'
import { TaskResultCard } from '@renderer/components/explorer/panels/projects/taskExecution/TaskResultCard'
import {
  parseExecutionResult,
  mergeExecutionResult,
  type TaskExecutionResult,
} from '@renderer/components/explorer/panels/projects/taskQuality'

// ============================================
// 常量
// ============================================

const EMPTY_MESSAGES: import('@intelligence/providerTypes').ChatMessage[] = []
const DEFAULT_STREAM_STATE: import('@intelligence/types/dialogThreadModel').StreamState = { phase: 'idle' }
const EMPTY_APPROVALS: import('@intelligence/types/dialogThreadModel').PendingToolApproval[] = []

// ============================================
// 组件
// ============================================

interface ExecutionContentProps {
  threadId: string
  projectId: string
  sessionId: string
}

export function ExecutionContent({ threadId, projectId }: ExecutionContentProps) {
  const isZh = true // 执行窗口默认中文（可后续从 settings 读取）
  const { sendToThread, abortThread } = useThreadMessenger()

  // ─── 订阅指定线程的消息列表与流式状态 ───────────────────
  const { messages, streamState, messagesHydrated } = useAgentStore(useShallow(state => {
    const thread = state.threads[threadId]
    return {
      messages: thread?.messages ?? EMPTY_MESSAGES,
      streamState: thread?.streamState ?? DEFAULT_STREAM_STATE,
      messagesHydrated: thread?.messagesHydrated ?? false,
    }
  }))

  const messageVersion = useAgentStore(s => s.threadMessageVersions[threadId] ?? 0)

  // 从 streamState 派生流式状态
  const isStreaming = streamState.phase === 'streaming'
    || streamState.phase === 'tool_running'
    || streamState.phase === 'tool_pending'
  const pendingApprovals = streamState.pendingApprovalToolCalls ?? EMPTY_APPROVALS

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
      setSendError(getApiErrorMessage(e, '发送失败'))
      setInput(text)
    }
  }, [input, isStreaming, sendToThread, threadId])

  const handleAbort = useCallback(() => {
    abortThread(threadId)
  }, [abortThread, threadId])

  // ─── 工具批准/拒绝 ─────────────────────────────────────
  const handleApprove = useCallback(() => {
    const requestId = streamState.requestId
    if (pendingApprovals.length > 1) {
      Agent.approveAll()
    } else {
      Agent.approve(requestId)
    }
  }, [streamState.requestId, pendingApprovals.length])

  const handleReject = useCallback(() => {
    const requestId = streamState.requestId
    if (pendingApprovals.length > 1) {
      Agent.rejectAll()
    } else {
      Agent.reject(requestId)
    }
  }, [streamState.requestId, pendingApprovals.length])

  const pendingToolIds = useMemo(
    () => pendingApprovals.map(a => a.id),
    [pendingApprovals],
  )

  // ─── 结果解析 ─────────────────────────────────────────
  const [parsedResult, setParsedResult] = useState<TaskExecutionResult | null>(null)
  const [showResultCard, setShowResultCard] = useState(false)
  const [resultCollapsed, setResultCollapsed] = useState(false)
  const prevStreamingRef = useRef(isStreaming)
  const executionStartRef = useRef<number | null>(null)

  // 记录执行开始时间
  useEffect(() => {
    if (isStreaming && executionStartRef.current === null) {
      executionStartRef.current = Date.now()
    }
  }, [isStreaming])

  // 流式完成后解析结果
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      // 从最后一条 assistant 消息中提取结构化结果
      const lastAssistant = [...messages].reverse().find(isAssistantMessage)
      if (lastAssistant && typeof lastAssistant.content === 'string') {
        const result = parseExecutionResult(lastAssistant.content)
        if (result) {
          if (executionStartRef.current) {
            result.durationSec = Math.round((Date.now() - executionStartRef.current) / 1000)
          }
          setParsedResult(result)
          setShowResultCard(true)

          // 异步存入后端
          // 通过 tasksApi 查找关联任务并更新 metadata
          tasksApi
            .list({ projectId, limit: 200 })
            .then((res) => {
              const task = res.items.find((t: TaskItem) => t.threadId === threadId)
              if (task) {
                const mergedMetadata = mergeExecutionResult(task.metadata, result)
                return tasksApi.update(task.id, { metadata: mergedMetadata })
              }
              return null
            })
            .catch((e) => {
              logger.agent.warn('[ExecutionContent] Failed to save execution result:', e)
            })
        }
      }
    }
    prevStreamingRef.current = isStreaming
  }, [isStreaming, messages, projectId, threadId])

  // ─── 渲染 ────────────────────────────────────────────

  // streamPhase 派生（用于思考中/处理中指示器）
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

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 消息流 */}
      <TaskExecutionMessages
        messages={messages}
        messageVersion={messageVersion}
        isStreaming={isStreaming}
        isZh={isZh}
        isLoading={!messagesHydrated}
        streamPhase={streamPhase}
        pendingToolId={pendingApprovals[0]?.id}
        pendingToolIds={pendingToolIds}
        onApproveTool={handleApprove}
        onRejectTool={handleReject}
      />

      {/* 结果预览（可折叠） */}
      {showResultCard && parsedResult && (
        <div className="flex-shrink-0 border-t border-border/30 bg-surface/10">
          {/* 折叠/展开按钮 */}
          <button
            onClick={() => setResultCollapsed(!resultCollapsed)}
            className="w-full flex items-center gap-2 px-4 h-9 hover:bg-surface-hover/30 transition-colors"
          >
            <FileCheck2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
            <span className="text-[12px] font-medium text-text-primary flex-1 text-left">
              {isZh ? '执行结果' : 'Execution Result'}
            </span>
            {resultCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
            )}
          </button>
          {/* 结果卡片内容 */}
          {!resultCollapsed && (
            <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
              <TaskResultCard
                result={parsedResult}
                isZh={isZh}
                onViewConversation={() => setShowResultCard(false)}
                onRerun={() => {
                  setShowResultCard(false)
                  setParsedResult(null)
                  executionStartRef.current = Date.now()
                }}
                onMarkDone={() => {
                  // 标记任务完成（通过 tasksApi 查找关联任务）
                  tasksApi
                    .list({ projectId, limit: 200 })
                    .then((res) => {
                      const task = res.items.find((t: TaskItem) => t.threadId === threadId)
                      if (task) {
                        return tasksApi.update(task.id, { status: 'DONE' })
                      }
                      return null
                    })
                    .catch((e) => logger.agent.warn('[ExecutionContent] Mark done failed:', e))
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* 发送错误提示 */}
      {sendError && (
        <div className="flex-shrink-0 mx-4 mb-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2">
          <span className="text-[12px] text-red-500 flex-1">{sendError}</span>
          <button onClick={() => setSendError(null)} className="text-[12px] text-red-500/70 hover:text-red-500">
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
    </div>
  )
}
