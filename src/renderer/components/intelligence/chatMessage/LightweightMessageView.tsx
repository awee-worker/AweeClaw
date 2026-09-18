/**
 * LightweightMessageView — 轻量单条消息渲染
 *
 * 用于项目任务执行等嵌入式场景，脱离主 ChatPanel 的 Virtuoso/composer 上下文，
 * 但保持与主聊天窗口一致的「思考中 / 处理中 / 工具执行 / 批准」展示。
 *
 * 渲染策略：
 * - role === 'user' + hidden → 跳过（静默注入的任务上下文不显示为用户气泡）
 * - role === 'user' → 右对齐气泡 + MarkdownContentView
 * - role === 'assistant' → 左对齐 + AssistantMessageContentView（复用 Part 分组渲染）
 * - role === 'tool'/'checkpoint'/'interrupted_tool' → 折叠/跳过（轻量视图不展示）
 *
 * 助手消息渲染规则（与主 AssistantMessageView 保持一致，避免重复显示）：
 * - 优先通过 parts 渲染（TextPart / ToolCallPart / TodoList 等）
 * - 仅当 parts 为空时，回退到 content 字段渲染（兼容旧消息/无 parts 的场景）
 * - 不同时渲染 content 和 parts，避免文本重复
 *
 * 流式状态展示（与主聊天一致）：
 * - 流式中且已有 parts → StreamingPhaseIndicator inline 模式（处理中…/思考中…）
 * - 流式中且无任何产出 → StreamingPhaseIndicator waiting 模式（连接中/思考中…）
 * - hasReasoningBlock 由本组件从 message.parts 自行计算（reasoning 块已展示思考内容时不再重复）
 *
 * 批准流（与主聊天一致）：
 * - 通过 restCtx 透传 pendingToolId / pendingToolIds / onApproveTool / onRejectTool，
 *   由 AssistantMessageContentView → ToolCallGroup 在工具卡片内联渲染批准按钮。
 *
 * 复用组件：
 * - MarkdownContentView：用户消息文本渲染 / parts 为空时回退渲染
 * - AssistantMessageContentView：助手消息 Part 分组（工具调用组/todo列表/文本块）
 * - StreamingPhaseIndicator：流式阶段指示器（思考中/处理中）
 *
 * 不依赖：
 * - ChatPanel 的 Virtuoso 虚拟列表
 * - 消息索引栏 / 主动建议 / composer
 */
import { memo } from 'react'
import { MarkdownContentView } from './markdown/MarkdownContentView'
import { AssistantMessageContentView } from './blocks/AssistantMessageContentView'
import { StreamingPhaseIndicator } from './blocks/StreamingPhaseIndicator'
import {
  isUserMessage,
  isAssistantMessage,
  isReasoningPart,
  getMessageText,
  type ChatMessage,
} from '@intelligence/providerTypes'
import type { PartRenderContext, StreamingPhaseProps } from './types'

interface LightweightMessageViewProps extends PartRenderContext {
  message: ChatMessage
  isZh: boolean
  /**
   * 流式阶段状态（仅对正在流式输出的助手消息生效）
   *
   * 由父组件从指定线程的 streamState 派生并传入（streamDetail / waitPhase /
   * streamStartTime / retryAttempt / retryDelay）。mode 与 hasReasoningBlock 由
   * 本组件根据消息自身状态决定，无需传入。
   *
   * 未传入时不渲染流式指示器（兼容不需要流式状态的场景）。
   */
  streamPhase?: Omit<StreamingPhaseProps, 'mode' | 'hasReasoningBlock'>
}

/** 默认字体大小（与 ChatPanel 默认值一致） */
const DEFAULT_FONT_SIZE = 14

function LightweightMessageViewBase({
  message,
  isZh,
  fontSize = DEFAULT_FONT_SIZE,
  messageId,
  streamPhase,
  ...restCtx
}: LightweightMessageViewProps) {
  // 用户消息
  if (isUserMessage(message)) {
    // 静默注入的消息（hidden=true）不渲染为用户气泡
    if (message.hidden) return null

    const text = getMessageText(message.content)
    if (!text.trim()) return null
    return (
      <div className="flex justify-end px-4 py-1.5">
        <div className="max-w-[85%] px-3 py-2 rounded-lg rounded-tr-sm bg-accent/15 text-text-primary text-[13px]">
          <MarkdownContentView content={text} fontSize={fontSize} />
        </div>
      </div>
    )
  }

  // 助手消息：左对齐
  if (isAssistantMessage(message)) {
    const hasParts = message.parts && message.parts.length > 0
    // content 字段：仅当 parts 为空时作为回退渲染（避免与 parts 中的 TextPart 重复）
    const fallbackText = !hasParts ? (typeof message.content === 'string' ? message.content : '') : ''
    const messageIsStreaming = !!message.isStreaming

    // 流式阶段指示器的 hasReasoningBlock：从当前 parts 自行计算
    // reasoning 块本身已展示思考内容时，inline 指示器不再重复显示「思考中」
    const hasReasoningBlock = !!(hasParts && message.parts.some(isReasoningPart))

    return (
      <div className="flex justify-start px-4 py-1.5">
        <div className="max-w-[90%] min-w-0">
          {/* parts 渲染：TextPart / ToolCallPart 等（主渲染路径） */}
          {/* hideTodoList=true：项目执行场景左侧已有任务列表，不重复渲染 AI 的 todo */}
          {hasParts && (
            <AssistantMessageContentView
              parts={message.parts}
              fontSize={fontSize}
              messageId={message.id}
              isStreaming={messageIsStreaming}
              hideTodoList
              {...restCtx}
            />
          )}
          {/* 回退：parts 为空时用 content 渲染（兼容旧消息/DB 加载的无 parts 消息） */}
          {!hasParts && fallbackText.trim() && (
            <div className="text-[13px] text-text-primary leading-relaxed">
              <MarkdownContentView
                content={fallbackText}
                fontSize={fontSize}
                isStreaming={messageIsStreaming}
              />
            </div>
          )}
          {/* 流式阶段指示器：与主聊天窗口一致（思考中 / 处理中 / 连接中） */}
          {messageIsStreaming && streamPhase && (
            <StreamingPhaseIndicator
              mode={hasParts || fallbackText.trim() ? 'inline' : 'waiting'}
              waitPhase={streamPhase.waitPhase}
              streamStartTime={streamPhase.streamStartTime}
              streamDetail={streamPhase.streamDetail}
              retryAttempt={streamPhase.retryAttempt}
              retryDelay={streamPhase.retryDelay}
              hasReasoningBlock={hasReasoningBlock}
            />
          )}
          {/* 兜底：流式中但未传入 streamPhase 时，显示基础等待占位（避免完全无反馈）。
              此刻尚无任何 streamDetail，属于等待模型响应，不能写成「思考中」。 */}
          {messageIsStreaming && !streamPhase && !hasParts && !fallbackText.trim() && (
            <div className="flex items-center gap-1 text-text-muted text-[12px] py-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {isZh ? '等待模型响应...' : 'Waiting for model response...'}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 其他类型（tool_result/checkpoint/interrupted_tool）轻量视图不展示
  return null
}

export const LightweightMessageView = memo(LightweightMessageViewBase)
