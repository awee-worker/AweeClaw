/**
 * SpeakerBadge - 说话人徽章
 *
 * 可复用的小型彩色徽章，展示说话人标识。
 * 用于：
 * - TranscriptCard 顶部说话人标识
 * - OrganizePanel 参会人列表
 * - StatusBar 当前说话人
 */

import { memo } from 'react'
import type { Speaker } from '@shared/protocols/meetingNotes'

export interface SpeakerBadgeProps {
  speaker: Speaker | undefined
  /** 紧凑模式（不显示名称，仅彩色圆点） */
  compact?: boolean
  /** 自定义文字（覆盖 speaker.name） */
  label?: string
}

function SpeakerBadgeImpl({ speaker, compact, label }: SpeakerBadgeProps) {
  const color = speaker?.color || '#9ca3af'
  const text = label ?? speaker?.name ?? '未识别'

  if (compact) {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
        title={text}
      />
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-text-primary"
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="max-w-[100px] truncate">{text}</span>
    </span>
  )
}

export const SpeakerBadge = memo(SpeakerBadgeImpl)
