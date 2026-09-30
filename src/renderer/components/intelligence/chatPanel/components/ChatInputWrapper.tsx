/**
 * 聊天输入区包装组件
 * 封装 ChatInput 的属性构建和上下文项管理
 */
import { memo } from 'react'
import { ChatInput, type PendingAttachment } from '../../../conversation'
import type { ContextItem } from '@intelligence/providerTypes'
import type { VoiceDialogState } from '@hooks/voice/useVoiceDialog'

interface ChatInputWrapperProps {
  input: string
  setInput: (value: string | null | undefined) => void
  images: PendingAttachment[]
  setImages: React.Dispatch<React.SetStateAction<PendingAttachment[]>>
  isStreaming: boolean
  hasApiKey: boolean
  needsCloudLogin: boolean
  hasPendingToolCall: boolean
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
  /** 语音对话运行时状态：输入框据此在麦克风按钮上就地呈现，不再另起浮层 */
  voiceDialogState?: VoiceDialogState | null
  voiceDialogStream?: MediaStream | null
  voiceDialogNotice?: string | null
  voiceDialogPendingSend?: boolean
  voiceDialogAwaitingConfirm?: boolean
  onVoiceDialogEnd?: () => void
  onVoiceDialogInterrupt?: () => void
  /** 语音对话是否播报 AI 回复（长按麦克风后的面板可切换） */
  voiceSpeakEnabled?: boolean
  /** 切换语音播报偏好（持久化由上层负责） */
  onVoiceSpeakEnabledChange?: (enabled: boolean) => void
  /** 是否跳过「要不要播报」面板：长按直接沿用上次选择进入对话 */
  voiceSkipPrompt?: boolean
  /** 记住「下次不再询问」（持久化由上层负责） */
  onVoiceSkipPromptChange?: (skip: boolean) => void
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
  voiceDialogState,
  voiceDialogStream,
  voiceDialogNotice,
  voiceDialogPendingSend,
  voiceDialogAwaitingConfirm,
  onVoiceDialogEnd,
  onVoiceDialogInterrupt,
  voiceSpeakEnabled,
  onVoiceSpeakEnabledChange,
  voiceSkipPrompt,
  onVoiceSkipPromptChange,
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
      voiceDialogState={voiceDialogState}
      voiceDialogStream={voiceDialogStream}
      voiceDialogNotice={voiceDialogNotice}
      voiceDialogPendingSend={voiceDialogPendingSend}
      voiceDialogAwaitingConfirm={voiceDialogAwaitingConfirm}
      onVoiceDialogEnd={onVoiceDialogEnd}
      onVoiceDialogInterrupt={onVoiceDialogInterrupt}
      voiceSpeakEnabled={voiceSpeakEnabled}
      onVoiceSpeakEnabledChange={onVoiceSpeakEnabledChange}
      voiceSkipPrompt={voiceSkipPrompt}
      onVoiceSkipPromptChange={onVoiceSkipPromptChange}
    />
  )
}

export const ChatInputWrapper = memo(ChatInputWrapperBase)
