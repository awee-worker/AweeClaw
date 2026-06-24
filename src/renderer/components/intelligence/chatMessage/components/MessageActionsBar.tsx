/**
 * 消息操作按钮组
 * 提供复制、编辑、恢复检查点、语音输出、更多操作等按钮
 */
import React from 'react'
import { Copy, Check, Edit2, RotateCcw } from 'lucide-react'
import { HintOverlay } from '../../../ui/HintOverlay'
import VoiceOutputButton from '../../../conversation/VoiceOutputButton'
import { useVoiceOutput } from '../../../../composables/useVoiceOutput'
import { MessageActionMenu } from './MessageActionMenu'
import type { Language } from '@renderer/i18n'
import { t } from '@renderer/i18n'

interface MessageActionsBarProps {
  messageId: string
  copied: boolean
  onCopy: () => void
  onEdit?: () => void
  onRestore?: () => void
  onDeleteRound?: () => void
  textContent: string
  isWorkspaceEditor: boolean
  hasCheckpoint: boolean
  language: Language
  /** 操作菜单标签 key，用户消息用 'more'，助手消息用 'more2' */
  menuLabelKey: 'more' | 'more2'
  /** 是否显示语音输出按钮 */
  showVoiceOutput?: boolean
}

/** 语音输出按钮包装器 */
const VoiceOutputButtonForMessage = React.memo(function VoiceOutputButtonForMessage({
  text,
}: {
  text: string
}) {
  const voiceOutput = useVoiceOutput()
  if (!text || text.trim().length === 0) return null
  return (
    <VoiceOutputButton
      playbackState={voiceOutput.playbackState}
      onSpeak={voiceOutput.speak}
      onStop={voiceOutput.stop}
      onPause={voiceOutput.pause}
      onResume={voiceOutput.resume}
      text={text}
    />
  )
})
VoiceOutputButtonForMessage.displayName = 'VoiceOutputButtonForMessage'

function MessageActionsBarBase({
  messageId,
  copied,
  onCopy,
  onEdit,
  onRestore,
  onDeleteRound,
  textContent,
  isWorkspaceEditor,
  hasCheckpoint,
  language,
  menuLabelKey,
  showVoiceOutput,
}: MessageActionsBarProps) {
  const copyLabel = t('ai.copycontent', language)
  const editLabel = t('ai.editmessage', language)
  const restoreLabel = t('ai.restorecheckpoint', language)

  return (
    <div className="flex items-center gap-0.5 mt-1 mr-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
      {showVoiceOutput && <VoiceOutputButtonForMessage text={textContent} />}
      <HintOverlay content={copyLabel}>
        <button
          onClick={onCopy}
          className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </HintOverlay>
      {onEdit && (
        <HintOverlay content={editLabel}>
          <button
            onClick={onEdit}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
          >
            <Edit2 className="w-3 h-3" />
          </button>
        </HintOverlay>
      )}
      {isWorkspaceEditor && hasCheckpoint && onRestore && (
        <HintOverlay content={restoreLabel}>
          <button
            onClick={onRestore}
            className="p-1 rounded-md text-text-muted hover:text-amber-400 hover:bg-surface-hover transition-all"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </HintOverlay>
      )}
      {onDeleteRound && (
        <MessageActionMenu
          messageId={messageId}
          onDeleteRound={onDeleteRound}
          labelKey={menuLabelKey}
          language={language}
        />
      )}
    </div>
  )
}

export const MessageActionsBar = React.memo(MessageActionsBarBase)
MessageActionsBar.displayName = 'MessageActionsBar'
