/**
 * 消息操作按钮组
 * 助手消息操作栏排版（从左到右）：
 *   任务完成（如有）  文件变更（如有）  语音播报  复制  赞  踩  重试  更多
 * 用户消息操作栏：编辑  复制  恢复检查点  更多
 *
 * 图标尺寸统一为 w-4 h-4（16px），内边距 p-1.5，确保点击区域舒适（~28px 触达目标）。
 * 赞/踩反馈通过 onLike / onDislikeSubmit / onDislikeRegenerate / onCancelFeedback 回调持久化到会话数据库。
 */
import React, { useEffect, useState } from 'react'
import { Copy, Check, Edit2, RotateCcw, ThumbsUp, ThumbsDown, RefreshCw, FileEdit, CheckCircle2 } from 'lucide-react'
import { HintOverlay } from '../../../ui/HintOverlay'
import VoiceOutputButton from '../../../conversation/VoiceOutputButton'
import { useVoiceOutput } from '../../../../composables/useVoiceOutput'
import { MessageActionMenu } from './MessageActionMenu'
import { MessagePopover } from './MessagePopover'
import { DislikeFeedbackPopover } from './DislikeFeedbackPopover'
import type { Language } from '@renderer/i18n'
import { t } from '@renderer/i18n'
import type { MessageFeedback } from '@intelligence/providerTypes'

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
  /** 是否显示"文件变更"chip（助手消息且有待确认文件变更） */
  showFileChangesChip?: boolean
  /** 待确认文件变更数量 */
  fileChangesCount?: number
  /** 文件变更弹层内容（提供则 chip 可点击展开） */
  fileChangesPopoverContent?: React.ReactNode
  /** 是否显示"任务完成"chip（助手消息且本轮任务列表全部完成） */
  showTaskDoneChip?: boolean
  /** 当前消息的持久化反馈状态（从消息对象读取） */
  feedback?: MessageFeedback
  /** 点击赞：未赞时提交赞，已赞时取消反馈。不传则不显示赞/踩按钮（如用户消息） */
  onLike?: () => void
  /** 提交踩反馈（含可选评论） */
  onDislikeSubmit?: (comment: string) => void
  /** 提交踩反馈并触发重新生成 */
  onDislikeRegenerate?: (comment: string) => void
  /** 取消反馈（清除赞/踩状态） */
  onCancelFeedback?: () => void
  /** 是否始终可见（不依赖 hover），用于最后一条助手消息 */
  alwaysVisible?: boolean
  /** 消息时间戳（ms），显示在操作按钮前/后 */
  timestamp?: number
  /** 时间显示位置：用户消息在图标按钮前面，AI 消息在后面 */
  timePosition?: 'before' | 'after'
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

/** 相对时间格式化：<1分钟=刚刚；<1小时=N分钟前；<1天=N小时前；<7天=N天前；否则 M-D HH:mm（跨年含年份） */
export function formatMessageTimestamp(ts: number, lang: Language): string {
  const diff = Date.now() - ts
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000
  if (diff < minute) return t('ai.justnow', lang)
  if (diff < hour) return t('ai.minutesago', lang, { n: Math.floor(diff / minute) })
  if (diff < day) return t('ai.hoursago', lang, { n: Math.floor(diff / hour) })
  if (diff < day * 7) return t('ai.daysago', lang, { n: Math.floor(diff / day) })
  const d = new Date(ts)
  const pad = (x: number) => String(x).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getFullYear() === new Date().getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md} ${hm}`
}

/** 完整时间（用于 hover tooltip）：YYYY-MM-DD HH:mm:ss */
export function formatMessageTimestampFull(ts: number): string {
  const d = new Date(ts)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 每分钟刷新一次相对时间，保证 hover 时显示的最新值 */
function useRelativeTimeTick(enabled: boolean) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setTick(x => x + 1), 60_000)
    return () => window.clearInterval(id)
  }, [enabled])
}

/** 消息时间戳显示（带完整时间 tooltip） */
const MessageTimestamp = React.memo(function MessageTimestamp({
  timestamp,
  language,
}: {
  timestamp: number
  language: Language
}) {
  useRelativeTimeTick(true)
  return (
    <HintOverlay content={formatMessageTimestampFull(timestamp)}>
      <span className="px-0.5 text-[11px] leading-none text-text-muted/70 tabular-nums select-none cursor-default">
        {formatMessageTimestamp(timestamp, language)}
      </span>
    </HintOverlay>
  )
})

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
  showFileChangesChip,
  fileChangesCount,
  fileChangesPopoverContent,
  showTaskDoneChip,
  feedback,
  onLike,
  onDislikeSubmit,
  onDislikeRegenerate,
  onCancelFeedback,
  alwaysVisible,
  timestamp,
  timePosition,
}: MessageActionsBarProps) {
  const copyLabel = t('ai.copycontent', language)
  const editLabel = t('ai.editmessage', language)
  const restoreLabel = t('ai.restorecheckpoint', language)
  const retryLabel = t('ai.retry', language)
  const likeLabel = t('ai.like', language)
  const fileChangesLabel = t('ai.filechanges', language)
  const taskDoneLabel = t('ai.taskcomplete', language)

  const isLiked = feedback?.rating === 'like'
  const isDisliked = feedback?.rating === 'dislike'

  /** 赞按钮点击：已赞则取消，未赞则提交赞 */
  const handleLikeClick = () => {
    if (isLiked) {
      onCancelFeedback?.()
    } else {
      onLike?.()
    }
  }

  /** 文件变更 chip（带弹层） */
  const fileChip = showFileChangesChip && fileChangesPopoverContent ? (
    <MessagePopover
      title={fileChangesLabel}
      trigger={
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-all cursor-pointer">
          <FileEdit className="w-3.5 h-3.5" />
          {fileChangesLabel}
          {fileChangesCount ? ` (${fileChangesCount})` : ''}
        </span>
      }
    >
      {fileChangesPopoverContent}
    </MessagePopover>
  ) : null

  /** 任务完成 chip（纯展示，表明本轮任务已全部完成） */
  const taskDoneChip = showTaskDoneChip ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-status-success bg-status-success/10">
      <CheckCircle2 className="w-3.5 h-3.5" />
      {taskDoneLabel}
    </span>
  ) : null

  /** 消息时间戳（用户消息在按钮前、助手消息在按钮后） */
  const timeEl = timestamp ? (
    <MessageTimestamp timestamp={timestamp} language={language} />
  ) : null

  return (
    <div
      className={`flex items-center gap-1.5 mt-1.5 mr-1 transition-opacity duration-200 ${
        alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100'
      }`}
    >
      {timePosition === 'before' && timeEl}

      {/* 文件变更 chip（条件显示） */}
      {fileChip}

      {showVoiceOutput && <VoiceOutputButtonForMessage text={textContent} />}
      <HintOverlay content={copyLabel}>
        <button
          onClick={onCopy}
          className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </HintOverlay>

      {/* 赞：立即提交，再次点击取消（仅助手消息显示） */}
      {onLike && (
        <HintOverlay content={likeLabel}>
          <button
            onClick={handleLikeClick}
            className={`p-1.5 rounded-md transition-all ${
              isLiked
                ? 'text-green-400 bg-green-500/10'
                : 'text-text-muted hover:text-green-400 hover:bg-surface-hover'
            }`}
          >
            <ThumbsUp className="w-4 h-4" />
          </button>
        </HintOverlay>
      )}

      {/* 踩：点击弹出反馈弹层（收集评论 + 重新生成入口），仅助手消息显示 */}
      {onLike && (
        <DislikeFeedbackPopover
          language={language}
          initialComment={isDisliked ? (feedback?.comment ?? '') : ''}
          onSubmit={(comment) => onDislikeSubmit?.(comment)}
          onCancel={() => onCancelFeedback?.()}
          onRegenerate={(comment) => onDislikeRegenerate?.(comment)}
          trigger={
            <span
              className={`p-1.5 rounded-md transition-all cursor-pointer ${
                isDisliked
                  ? 'text-red-400 bg-red-500/10'
                  : 'text-text-muted hover:text-red-400 hover:bg-surface-hover'
              }`}
            >
              <ThumbsDown className="w-4 h-4" />
            </span>
          }
        />
      )}

      {/* 重试 */}
      {onRegenerate && (
        <HintOverlay content={retryLabel}>
          <button
            onClick={onRegenerate}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </HintOverlay>
      )}

      {onEdit && (
        <HintOverlay content={editLabel}>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        </HintOverlay>
      )}
      {isWorkspaceEditor && hasCheckpoint && onRestore && (
        <HintOverlay content={restoreLabel}>
          <button
            onClick={onRestore}
            className="p-1.5 rounded-md text-text-muted hover:text-amber-400 hover:bg-surface-hover transition-all"
          >
            <RotateCcw className="w-4 h-4" />
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
      {timePosition !== 'before' && timeEl}
    </div>
  )
}

export const MessageActionsBar = React.memo(MessageActionsBarBase)
MessageActionsBar.displayName = 'MessageActionsBar'
