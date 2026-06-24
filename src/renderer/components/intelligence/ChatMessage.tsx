/**
 * 聊天消息组件
 * 负责根据消息类型分发到用户消息视图或助手消息视图
 */
import React from 'react'
import { Check } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import {
  isUserMessage,
  isAssistantMessage,
  getMessageText,
  type ChatMessage as ChatMessageType,
} from '@intelligence/providerTypes'

import { UserMessageView } from './chatMessage/blocks/UserMessageView'
import { AssistantMessageView } from './chatMessage/blocks/AssistantMessageView'
import { MarkdownContentView } from './chatMessage/markdown/MarkdownContentView'

interface ChatMessageProps {
  message: ChatMessageType
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
  onRestore?: (messageId: string) => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  onSelectOption?: (messageId: string, selectedIds: string[]) => void
  pendingToolId?: string
  hasCheckpoint?: boolean
  isWorkspaceEditor?: boolean
  onDeleteRound?: (messageId: string) => void
  selectionMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (messageId: string) => void
}

function ChatMessageBase({
  message,
  onEdit,
  onRestore,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  pendingToolId,
  hasCheckpoint,
  isWorkspaceEditor,
  onDeleteRound,
  selectionMode,
  isSelected,
  onToggleSelect,
}: ChatMessageProps) {
  const { editorConfig } = useStore(useShallow(s => ({
    editorConfig: s.editorConfig,
  })))
  const fontSize = editorConfig.chatFontSize ?? editorConfig.fontSize

  if (!isUserMessage(message) && !isAssistantMessage(message)) {
    return null
  }

  const isUser = isUserMessage(message)
  const textContent = getMessageText((message as any).content)

  /** 选择模式下的渲染 */
  if (selectionMode) {
    return (
      <div className={`
        w-full group/msg transition-colors duration-300
        ${isUser ? 'py-1 bg-transparent' : 'py-2 bg-transparent'}
        ${selectionMode && isSelected ? 'bg-accent/5' : ''}
      `}>
        <div className="w-full px-4 flex items-start gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(message.id) }}
            className={`flex-shrink-0 mt-2 w-[18px] h-[18px] rounded flex items-center justify-center transition-all cursor-pointer ${
              isSelected
                ? 'bg-accent border-accent'
                : 'bg-transparent border-2 border-border/60 hover:border-accent/50'
            }`}
          >
            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </button>
          <div className={`flex-1 min-w-0 px-3.5 py-2.5 rounded-2xl border ${isUser ? 'bg-accent/8 border-accent/15' : 'bg-surface/80 border-border/40'}`}>
            {isUser ? (
              <div className="text-[14px] leading-relaxed text-text-primary/90">
                <MarkdownContentView content={textContent} fontSize={fontSize} preserveLineBreaks />
              </div>
            ) : (
              <div className="prose-custom w-full max-w-none text-[15px] leading-relaxed text-text-primary/90">
                <AssistantMessageView
                  message={message}
                  pendingToolId={pendingToolId}
                  onApproveTool={onApproveTool}
                  onRejectTool={onRejectTool}
                  onOpenDiff={onOpenDiff}
                  hasCheckpoint={hasCheckpoint}
                  isWorkspaceEditor={isWorkspaceEditor}
                  onDeleteRound={onDeleteRound}
                  textContent={textContent}
                  fontSize={fontSize}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  /** 常规模式渲染 */
  return (
    <div className={`
      w-full group/msg transition-colors duration-300
      ${isUser ? 'py-1 bg-transparent' : 'py-2 bg-transparent'}
    `}>
      <div className="w-full px-4 flex flex-col gap-1">
        {isUser ? (
          <UserMessageView
            message={message}
            textContent={textContent}
            onEdit={onEdit}
            onRestore={onRestore}
            onDeleteRound={onDeleteRound}
            hasCheckpoint={hasCheckpoint}
            isWorkspaceEditor={isWorkspaceEditor}
            fontSize={fontSize}
          />
        ) : (
          <AssistantMessageView
            message={message}
            pendingToolId={pendingToolId}
            onApproveTool={onApproveTool}
            onRejectTool={onRejectTool}
            onOpenDiff={onOpenDiff}
            hasCheckpoint={hasCheckpoint}
            isWorkspaceEditor={isWorkspaceEditor}
            onDeleteRound={onDeleteRound}
            textContent={textContent}
            fontSize={fontSize}
          />
        )}
      </div>
    </div>
  )
}

const ChatMessage = React.memo(ChatMessageBase)
ChatMessage.displayName = 'ChatMessage'

export default ChatMessage
