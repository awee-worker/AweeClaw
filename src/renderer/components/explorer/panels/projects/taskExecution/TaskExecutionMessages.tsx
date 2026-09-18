/**
 * TaskExecutionMessages — 任务执行消息列表
 *
 * 渲染指定线程的消息流，使用 LightweightMessageView 轻量渲染，
 * 但保持与主聊天窗口一致的「思考中 / 处理中 / 工具执行 / 批准」展示：
 * - 透传 streamPhase → LightweightMessageView 内的 StreamingPhaseIndicator
 * - 透传 pendingToolId / pendingToolIds / onApproveTool / onRejectTool →
 *   AssistantMessageContentView → ToolCallGroup 内联批准按钮
 *
 * 自动滚动策略：
 * - 新消息到达时自动滚动到底部
 * - 用户向上滚动查看历史时不打断（通过 isAtBottom 标记判断）
 * - 滚回底部后恢复自动跟随
 * - 提供"回到底部"浮动按钮（非底部时显示）
 *
 * 与 ChatPanel 的 Virtuoso 虚拟列表的区别：
 * - 任务对话通常消息量较小，使用普通 div + scrollTop 即可
 * - 脱离 Virtuoso 的 range/followOutput 复杂状态机
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, Loader2, MessageSquare } from 'lucide-react'
import { LightweightMessageView } from '@components/intelligence/chatMessage/LightweightMessageView'
import { StreamingPhaseIndicator } from '@components/intelligence/chatMessage/blocks/StreamingPhaseIndicator'
import type { ChatMessage } from '@intelligence/providerTypes'
import { isAssistantMessage } from '@intelligence/providerTypes'
import type { StreamingPhaseProps } from '@components/intelligence/chatMessage/types'

interface TaskExecutionMessagesProps {
  messages: ChatMessage[]
  /** 消息列表版本号（内容变更时递增，用于触发重渲染） */
  messageVersion: number
  isStreaming: boolean
  isZh: boolean
  isLoading: boolean
  /** 流式阶段状态（从指定线程 streamState 派生，不含 mode/hasReasoningBlock），传入后渲染思考中/处理中指示器 */
  streamPhase?: Omit<StreamingPhaseProps, 'mode' | 'hasReasoningBlock'>
  // ─── 工具批准（与主聊天一致，内联渲染于工具卡片） ───────────────
  /** 当前待批准工具 id（单个） */
  pendingToolId?: string
  /** 所有待批准工具 id 列表（多个时进入批量批准模式） */
  pendingToolIds?: string[]
  /** 批准工具（单个用 approve / 多个用 approveAll，由父组件决定） */
  onApproveTool?: () => void
  /** 拒绝工具（单个用 reject / 多个用 rejectAll，由父组件决定） */
  onRejectTool?: () => void
  /** 打开 diff 预览（可选，未接入时工具卡片不显示 diff 按钮） */
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
}

/** 距底部阈值（px），小于此值视为"在底部" */
const BOTTOM_THRESHOLD = 80

export function TaskExecutionMessages({
  messages, messageVersion, isStreaming, isZh, isLoading,
  streamPhase, pendingToolId, pendingToolIds, onApproveTool, onRejectTool, onOpenDiff,
}: TaskExecutionMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  /** 滚动到底部 */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  /** 检测是否在底部（用于决定是否自动跟随） */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setIsAtBottom(distanceFromBottom < BOTTOM_THRESHOLD)
  }, [])

  /**
   * 消息列表或流式状态变化时自动滚动：
   * - 仅在用户已处于底部时跟随（避免打断用户查看历史）
   * - 流式过程中持续跟随（messageVersion 递增触发）
   */
  useEffect(() => {
    if (isAtBottom) {
      // 流式时用 auto 避免频繁 smooth 动画卡顿
      scrollToBottom(isStreaming ? 'auto' : 'smooth')
    }
  }, [messages.length, messageVersion, isStreaming, isAtBottom, scrollToBottom])

  /** 点击"回到底部"按钮 */
  const handleScrollToBottom = useCallback(() => {
    scrollToBottom('smooth')
    setIsAtBottom(true)
  }, [scrollToBottom])

  // ─── 渲染 ───────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-accent animate-spin" />
      </div>
    )
  }

  // 过滤出可渲染的消息（user/assistant），tool_result/checkpoint 由助手消息内嵌展示
  const visibleMessages = messages.filter(
    m => m.role === 'user' || m.role === 'assistant',
  )

  if (visibleMessages.length === 0) {
    // 流式中且无消息：用 waiting 指示器替代空态（与主聊天一致）
    if (isStreaming && streamPhase) {
      return (
        <div className="flex-1 overflow-y-auto">
          <div className="py-3">
            <div className="px-4">
              <StreamingPhaseIndicator mode="waiting" {...streamPhase} />
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
        <MessageSquare className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-[13px]">{isZh ? '还没有对话消息' : 'No messages yet'}</p>
        <p className="text-[12px] mt-1 text-text-muted/60">
          {isZh ? '在下方输入消息开始与 AI 对话' : 'Type a message below to start chatting with AI'}
        </p>
      </div>
    )
  }

  // 是否存在正在流式输出的助手消息（决定是否需要 waiting 占位）
  const hasStreamingAssistant = visibleMessages.some(
    m => isAssistantMessage(m) && m.isStreaming,
  )

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto"
      >
        <div className="py-3">
          {visibleMessages.map(msg => (
            <LightweightMessageView
              key={msg.id}
              message={msg}
              isZh={isZh}
              fontSize={13}
              messageId={msg.id}
              isStreaming={isAssistantMessage(msg) ? msg.isStreaming : undefined}
              streamPhase={streamPhase}
              pendingToolId={pendingToolId}
              pendingToolIds={pendingToolIds}
              onApproveTool={onApproveTool}
              onRejectTool={onRejectTool}
              onOpenDiff={onOpenDiff}
            />
          ))}
          {/*
            流式占位：AI 正在响应但尚未产出助手消息（连接中 / 构建上下文 / 等待模型）。
            用 StreamingPhaseIndicator waiting 模式替代旧的「思考中...」圆点，
            与主聊天窗口的状态展示完全一致。
          */}
          {isStreaming && !hasStreamingAssistant && streamPhase && (
            <div className="px-4">
              <StreamingPhaseIndicator mode="waiting" {...streamPhase} />
            </div>
          )}
          {/* 兜底：流式中但未传入 streamPhase（不应发生），保留基础占位避免无反馈。
              此时没有任何 streamDetail，属于等待模型响应而非模型思考中。 */}
          {isStreaming && !hasStreamingAssistant && !streamPhase && (
            <div className="flex items-center gap-1.5 px-4 py-2 text-text-muted text-[12px]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {isZh ? '等待模型响应...' : 'Waiting for model response...'}
            </div>
          )}
        </div>
      </div>

      {/* 回到底部按钮 */}
      {!isAtBottom && (
        <button
          onClick={handleScrollToBottom}
          className="absolute bottom-3 right-3 p-2 rounded-full bg-surface/90 border border-border/40 shadow-md text-text-muted hover:text-accent hover:border-accent/40 transition-all"
          title={isZh ? '回到底部' : 'Scroll to bottom'}
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
