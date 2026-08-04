/**
 * TranscriptList - 发言段转写列表
 *
 * 职责：
 * - 按时间顺序展示所有发言段
 * - 自动滚动到最新段（用户上滚查看历史时不打断）
 * - 空状态展示引导文案
 *
 * 子组件：
 * - TranscriptCard：单段卡片（说话人徽章 + 原文 + 译文 + 状态）
 */

import { memo, useEffect, useRef, useState } from 'react'
import { TranscriptCard } from './TranscriptCard'
import type { Segment, Speaker } from '@shared/protocols/meetingNotes'

export interface TranscriptListProps {
  segments: Segment[]
  speakers: Speaker[]
  onSegmentSpeakerChange: (segmentId: string, speakerId: string) => void
  onSegmentTextEdit: (segmentId: string, text: string) => void
  onSegmentRemove: (segmentId: string) => void
}

function TranscriptListImpl(props: TranscriptListProps) {
  const { segments, speakers, onSegmentSpeakerChange, onSegmentTextEdit, onSegmentRemove } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // 检测用户是否手动上滚
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    // 距离底部 < 60px 视为在底部，启用自动滚动
    setAutoScroll(distanceFromBottom < 60)
  }

  // 段数变化时滚动到底部（仅当 autoScroll 为 true）
  const lastSegmentId = segments[segments.length - 1]?.id
  useEffect(() => {
    if (!autoScroll || !lastSegmentId) return
    const el = scrollRef.current
    if (!el) return
    // 用 requestAnimationFrame 等待 DOM 更新完成
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [lastSegmentId, autoScroll])

  // 段内容更新时也滚动（如 STT 文本流式填充）
  const lastSegmentContent = segments[segments.length - 1]?.originalText
  useEffect(() => {
    if (!autoScroll) return
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [lastSegmentContent, autoScroll])

  if (segments.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-8 text-center">
        <div className="max-w-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface">
            <Mic className="h-7 w-7 text-text-muted" />
          </div>
          <h3 className="mb-2 text-base font-medium text-text-primary">会议纪要</h3>
          <p className="text-sm text-text-secondary">
            点击「开始记录」启动会议录音，AI 会自动识别说话人、转写并翻译为中文。
          </p>
          <p className="mt-3 text-xs text-text-muted">
            可在工具栏选择当前说话人，AI 会按段切分并标注说话人。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full w-full overflow-y-auto bg-background px-4 py-3"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2 pb-4">
        {segments.map((segment) => {
          const speaker = speakers.find((s) => s.id === segment.speakerId)
          return (
            <TranscriptCard
              key={segment.id}
              segment={segment}
              speaker={speaker}
              speakers={speakers}
              onSpeakerChange={(speakerId) => onSegmentSpeakerChange(segment.id, speakerId)}
              onTextChange={(text) => onSegmentTextEdit(segment.id, text)}
              onRemove={() => onSegmentRemove(segment.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

// 单独引入图标避免循环引用
import { Mic } from 'lucide-react'

export const TranscriptList = memo(TranscriptListImpl)
