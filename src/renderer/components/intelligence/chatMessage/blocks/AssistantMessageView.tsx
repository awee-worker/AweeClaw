/**
 * 助手消息视图
 * 左对齐布局，支持流式输出、工具调用预览、交互卡片
 */
import React, { useMemo } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import {
  isAssistantMessage,
  isReasoningPart,
  type ChatMessage as ChatMessageType,
  type AssistantPart,
} from '@intelligence/providerTypes'
import type { ToolStreamingPreview } from '@protocols'
import type { Language } from '@renderer/i18n'

import { AssistantMessageContentView } from './AssistantMessageContentView'
import { StreamingPhaseIndicator } from './StreamingPhaseIndicator'
import { MessageActionsBar } from '../components/MessageActionsBar'
import { InteractiveCard } from '../../InteractiveCard'
import ToolCallGroup from '../../ToolCallGroup'

const EMPTY_PREVIEWS: Record<string, ToolStreamingPreview> = {}
const ACTIVE_STREAM_PHASES = new Set(['streaming', 'tool_running', 'tool_pending'])

interface AssistantMessageViewProps {
  message: ChatMessageType
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  hasCheckpoint?: boolean
  isWorkspaceEditor?: boolean
  onDeleteRound?: (messageId: string) => void
  textContent: string
  fontSize: number
}

function AssistantMessageViewBase({
  message,
  pendingToolId,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  isWorkspaceEditor,
  onDeleteRound,
  textContent,
  fontSize,
}: AssistantMessageViewProps) {
  const [copied, setCopied] = React.useState(false)
  const { language } = useStore(useShallow(s => ({ language: s.language })))

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

  const assistantMessage = message as any
  const assistantParts: AssistantPart[] | undefined = isAssistantMessage(message) ? (liveParts ?? (message as any).parts) : undefined
  const assistantInteractive = isAssistantMessage(message) ? (liveInteractive ?? (message as any).interactive) : undefined
  const messageIsStreaming = !!(message as any).isStreaming

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

  return (
    <div className="w-full min-w-0 flex flex-col gap-2">
      <div className="w-full text-[15px] leading-relaxed text-text-primary/90 pl-1">
        <div className="prose-custom w-full max-w-none">
          {assistantParts && assistantParts.length > 0 && (
            <AssistantMessageContentView
              parts={assistantParts}
              pendingToolId={pendingToolId}
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
          onRestore={undefined}
          onDeleteRound={onDeleteRound ? () => onDeleteRound(message.id) : undefined}
          textContent={textContent}
          isWorkspaceEditor={!!isWorkspaceEditor}
          hasCheckpoint={false}
          language={language as Language}
          menuLabelKey="more2"
          showVoiceOutput
        />
      )}
    </div>
  )
}

export const AssistantMessageView = React.memo(AssistantMessageViewBase)
AssistantMessageView.displayName = 'AssistantMessageView'
