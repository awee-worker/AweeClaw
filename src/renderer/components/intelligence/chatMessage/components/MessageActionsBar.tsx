/**
 * 消息操作按钮组
 * 助手消息操作栏排版（从左到右）：
 *   任务完成（如有）  文件变更（如有）  语音播报  复制  赞  踩  重试  更多
 * 用户消息操作栏：编辑  复制  恢复检查点  更多
 */
import React from 'react'
import { Copy, Check, Edit2, RotateCcw, ThumbsUp, ThumbsDown, RefreshCw, CheckCircle2, FileEdit } from 'lucide-react'
import { HintOverlay } from '../../../ui/HintOverlay'
import VoiceOutputButton from '../../../conversation/VoiceOutputButton'
import { useVoiceOutput } from '../../../../composables/useVoiceOutput'
import { MessageActionMenu } from './MessageActionMenu'
import { MessagePopover } from './MessagePopover'
import type { Language } from '@renderer/i18n'
import { t } from '@renderer/i18n'

export type MessageFeedback = 'like' | 'dislike' | null

interface MessageActionsBarProps {
  messageId: string
  copied: boolean
  onCopy: () => void
  onEdit?: () => void
  onRestore?: () => void
  onDeleteRound?: () => void
  onRegenerate?: () => void
  textContent: string
  isWorkspaceEditor: boolean
  hasCheckpoint: boolean
  language: Language
  /** 操作菜单标签 key，用户消息用 'more'，助手消息用 'more2' */
  menuLabelKey: 'more' | 'more2'
  /** 是否显示语音输出按钮 */
  showVoiceOutput?: boolean
  /** 是否显示"任务完成"chip（助手消息且任务已全部完成） */
  showTaskCompleteChip?: boolean
  /** 任务列表弹层内容（提供则 chip 可点击展开） */
  taskPopoverContent?: React.ReactNode
  /** 是否显示"文件变更"chip（助手消息且有待确认文件变更） */
  showFileChangesChip?: boolean
  /** 待确认文件变更数量 */
  fileChangesCount?: number
  /** 文件变更弹层内容（提供则 chip 可点击展开） */
  fileChangesPopoverContent?: React.ReactNode
  /** 当前消息的反馈状态 */
  feedback?: MessageFeedback
  /** 点击赞/踩回调 */
  onFeedback?: (feedback: 'like' | 'dislike') => void
  /** 是否始终可见（不依赖 hover），用于最后一条助手消息 */
  alwaysVisible?: boolean
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
  onRegenerate,
  textContent,
  isWorkspaceEditor,
  hasCheckpoint,
  language,
  menuLabelKey,
  showVoiceOutput,
  showTaskCompleteChip,
  taskPopoverContent,
  showFileChangesChip,
  fileChangesCount,
  fileChangesPopoverContent,
  feedback,
  onFeedback,
  alwaysVisible,
}: MessageActionsBarProps) {
  const copyLabel = t('ai.copycontent', language)
  const editLabel = t('ai.editmessage', language)
  const restoreLabel = t('ai.restorecheckpoint', language)
  const retryLabel = t('ai.retry', language)
  const likeLabel = t('ai.like', language)
  const dislikeLabel = t('ai.dislike', language)
  const taskCompleteLabel = t('ai.taskcomplete', language)
  const fileChangesLabel = t('ai.filechanges', language)

  const isLiked = feedback === 'like'
  const isDisliked = feedback === 'dislike'

  /** 任务完成 chip（带弹层） */
  const taskChip = showTaskCompleteChip && taskPopoverContent ? (
    <MessagePopover
      title={taskCompleteLabel}
      trigger={
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-green-400 bg-green-500/10 hover:bg-green-500/20 transition-all cursor-pointer">
          <CheckCircle2 className="w-3 h-3" />
          {taskCompleteLabel}
        </span>
      }
    >
      {taskPopoverContent}
    </MessagePopover>
  ) : null

  /** 文件变更 chip（带弹层） */
  const fileChip = showFileChangesChip && fileChangesPopoverContent ? (
    <MessagePopover
      title={fileChangesLabel}
      trigger={
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-all cursor-pointer">
          <FileEdit className="w-3 h-3" />
          {fileChangesLabel}
          {fileChangesCount ? ` (${fileChangesCount})` : ''}
        </span>
      }
    >
      {fileChangesPopoverContent}
    </MessagePopover>
  ) : null

  return (
    <div
      className={`flex items-center gap-1.5 mt-1.5 mr-1 transition-opacity duration-200 ${
        alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100'
      }`}
    >
      {/* 任务完成 chip（条件显示） */}
      {taskChip}

      {/* 文件变更 chip（条件显示） */}
      {fileChip}

      {showVoiceOutput && <VoiceOutputButtonForMessage text={textContent} />}
      <HintOverlay content={copyLabel}>
        <button
          onClick={onCopy}
          className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </HintOverlay>

      {/* 赞 */}
      {onFeedback && (
        <HintOverlay content={likeLabel}>
          <button
            onClick={() => onFeedback('like')}
            className={`p-1 rounded-md transition-all ${
              isLiked
                ? 'text-green-400 bg-green-500/10'
                : 'text-text-muted hover:text-green-400 hover:bg-surface-hover'
            }`}
          >
            <ThumbsUp className="w-3 h-3" />
          </button>
        </HintOverlay>
      )}

      {/* 踩 */}
      {onFeedback && (
        <HintOverlay content={dislikeLabel}>
          <button
            onClick={() => onFeedback('dislike')}
            className={`p-1 rounded-md transition-all ${
              isDisliked
                ? 'text-red-400 bg-red-500/10'
                : 'text-text-muted hover:text-red-400 hover:bg-surface-hover'
            }`}
          >
            <ThumbsDown className="w-3 h-3" />
          </button>
        </HintOverlay>
      )}

      {/* 重试 */}
      {onRegenerate && (
        <HintOverlay content={retryLabel}>
          <button
            onClick={onRegenerate}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </HintOverlay>
      )}

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
