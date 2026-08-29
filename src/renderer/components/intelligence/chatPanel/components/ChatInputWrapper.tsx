/**
 * 聊天输入区包装组件
 * 封装 ChatInput 的属性构建和上下文项管理
 */
import { memo } from 'react'
import { ChatInput, type PendingAttachment } from '../../../conversation'
import type { ContextItem } from '@intelligence/providerTypes'
import type { WorkMode } from '@/renderer/modes/workModeTypes'

interface ChatInputWrapperProps {
  input: string
  setInput: (value: string | null | undefined) => void
  images: PendingAttachment[]
  setImages: React.Dispatch<React.SetStateAction<PendingAttachment[]>>
  isStreaming: boolean
  hasApiKey: boolean
  needsCloudLogin: boolean
  hasPendingToolCall: boolean
  chatMode: WorkMode
  setChatMode: (mode: WorkMode) => void
  onSubmit: () => void
  onAbort: () => void
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
  textareaRef: React.RefObject<HTMLTextAreaElement>
  inputContainerRef: React.RefObject<HTMLDivElement>
  contextItems: ContextItem[]
  onRemoveContextItem: (item: ContextItem) => void
  activeFilePath: string | null
  onAddFile: () => void
  language?: string
  onOpenSettings?: () => void
  /** 编辑指定智能体 */
  onEditAgent?: (agentId: string) => void
}

function ChatInputWrapperBase({
  input,
  setInput,
  images,
  setImages,
  isStreaming,
  hasApiKey,
  needsCloudLogin,
  hasPendingToolCall,
  chatMode,
  setChatMode,
  onSubmit,
  onAbort,
  onInputChange,
  onKeyDown,
  onPaste,
  textareaRef,
  inputContainerRef,
  contextItems,
  onRemoveContextItem,
  activeFilePath,
  onAddFile,
  language,
  onOpenSettings,
  onEditAgent,
}: ChatInputWrapperProps) {
  return (
    <ChatInput
      input={input}
      setInput={setInput}
      images={images}
      setImages={setImages}
      isStreaming={isStreaming}
      hasApiKey={hasApiKey}
      needsCloudLogin={needsCloudLogin}
      hasPendingToolCall={hasPendingToolCall}
      chatMode={chatMode}
      setChatMode={setChatMode}
      onSubmit={onSubmit}
      onAbort={onAbort}
      onInputChange={onInputChange}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      textareaRef={textareaRef}
      inputContainerRef={inputContainerRef}
      contextItems={contextItems}
      onRemoveContextItem={onRemoveContextItem}
      activeFilePath={activeFilePath}
      onAddFile={onAddFile}
      language={language}
      onOpenSettings={onOpenSettings}
      onEditAgent={onEditAgent}
    />
  )
}

export const ChatInputWrapper = memo(ChatInputWrapperBase)
