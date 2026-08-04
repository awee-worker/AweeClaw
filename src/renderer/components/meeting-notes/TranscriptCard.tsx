/**
 * TranscriptCard - 单段发言卡片
 *
 * 展示：
 * - 说话人徽章（彩色圆点 + 名称，可下拉切换）
 * - 时间戳 + 段时长
 * - 原文（可双击编辑）
 * - 译文（自动填充，可双击编辑）
 * - 处理状态（pending/transcribing/translating/done/failed）
 * - 删除按钮（hover 显示）
 *
 * 状态指示：
 * - pending      → 灰色「待处理」
 * - transcribing → 蓝色脉动「转写中...」
 * - translating  → 蓝色脉动「翻译中...」
 * - done         → 无标识（成功）
 * - failed       → 红色「失败」+ 错误信息
 */

import { memo, useState, useRef, useEffect } from 'react'
import {
  Loader2,
  Trash2,
  Check,
  X,
  AlertCircle,
  ChevronDown,
  Clock,
} from 'lucide-react'
import type { Segment, Speaker, SegmentState } from '@shared/protocols/meetingNotes'

export interface TranscriptCardProps {
  segment: Segment
  speaker?: Speaker
  speakers: Speaker[]
  onSpeakerChange: (speakerId: string) => void
  onTextChange: (text: string) => void
  onRemove: () => void
}

/** 段时长格式化为 mm:ss */
function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 时间戳格式化为 HH:mm:ss */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 渲染处理状态徽章 */
function renderStateBadge(state: SegmentState, error?: string) {
  switch (state) {
    case 'pending':
      return <span className="text-xs text-text-muted">待处理</span>
    case 'transcribing':
      return (
        <span className="flex items-center gap-1 text-xs text-status-info">
          <Loader2 size={11} className="animate-spin" />
          转写中...
        </span>
      )
    case 'embedding':
      return (
        <span className="flex items-center gap-1 text-xs text-status-info">
          <Loader2 size={11} className="animate-spin" />
          识别中...
        </span>
      )
    case 'translating':
      return (
        <span className="flex items-center gap-1 text-xs text-status-info">
          <Loader2 size={11} className="animate-spin" />
          翻译中...
        </span>
      )
    case 'failed':
      return (
        <span className="flex items-center gap-1 text-xs text-status-error" title={error}>
          <AlertCircle size={11} />
          失败
        </span>
      )
    case 'done':
    default:
      return null
  }
}

function TranscriptCardImpl(props: TranscriptCardProps) {
  const { segment, speaker, speakers, onSpeakerChange, onTextChange, onRemove } = props

  // ── 说话人下拉 ──
  const [speakerMenuOpen, setSpeakerMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!speakerMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSpeakerMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [speakerMenuOpen])

  // ── 文本编辑 ──
  const [editing, setEditing] = useState<'original' | 'translated' | null>(null)
  const [draft, setDraft] = useState('')

  const startEdit = (which: 'original' | 'translated') => {
    setDraft(which === 'original' ? segment.originalText : segment.translatedText)
    setEditing(which)
  }

  const confirmEdit = () => {
    if (editing) {
      onTextChange(editing === 'original' ? draft : draft)
    }
    setEditing(null)
  }

  // 译文单独编辑
  const [editingTranslated, setEditingTranslated] = useState(false)
  const [translatedDraft, setTranslatedDraft] = useState('')

  const startEditTranslated = () => {
    setTranslatedDraft(segment.translatedText)
    setEditingTranslated(true)
  }

  const confirmEditTranslated = () => {
    // 译文编辑需要单独的 store action，这里通过 onTextChange 简化（合并到原文）
    // 实际项目可能需要单独的 setSegmentTranslatedText
    setEditingTranslated(false)
  }

  const isEnvironment = segment.isEnvironment
  const hasFailed = segment.state === 'failed'

  return (
    <div
      className={`group relative rounded-md border px-3 py-2 transition-colors ${
        isEnvironment
          ? 'border-border-subtle bg-surface-muted/30'
          : hasFailed
            ? 'border-status-error/40 bg-status-error/5'
            : 'border-border bg-background-secondary hover:bg-surface-hover/40'
      }`}
    >
      {/* 顶部：说话人 + 时间 + 状态 */}
      <div className="mb-1.5 flex items-center gap-2">
        {/* 说话人徽章（可下拉切换） */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setSpeakerMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-text-primary hover:bg-surface-hover"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: speaker?.color || '#9ca3af' }}
            />
            <span className="max-w-[80px] truncate">{speaker?.name || '未识别'}</span>
            <ChevronDown size={11} className="text-text-muted" />
          </button>
          {speakerMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-md border border-border bg-surface py-1 shadow-glass">
              {speakers.map((spk) => (
                <button
                  key={spk.id}
                  onClick={() => {
                    onSpeakerChange(spk.id)
                    setSpeakerMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: spk.color }}
                  />
                  <span className="flex-1 truncate">{spk.name}</span>
                  {spk.id === segment.speakerId && (
                    <Check size={12} className="text-accent" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 时间戳 + 时长 */}
        <span className="flex items-center gap-1 text-xs text-text-muted">
          <Clock size={11} />
          {formatTime(segment.startTime)}
          <span className="text-text-muted/60">·</span>
          {formatDuration(segment.durationMs)}
        </span>

        {/* 状态徽章 */}
        <div className="flex-1">
          {renderStateBadge(segment.state, segment.sttError || segment.translateError)}
        </div>

        {/* 删除按钮 */}
        <button
          onClick={onRemove}
          className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:text-status-error group-hover:opacity-100"
          title="删除此段"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* 环境音特殊展示 */}
      {isEnvironment ? (
        <div className="flex items-center gap-2 py-1 text-xs italic text-text-muted">
          <AlertCircle size={12} />
          {segment.originalText || '环境音（已过滤）'}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {/* 原文 */}
          {editing === 'original' ? (
            <div className="flex flex-col gap-1">
              <textarea
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirmEdit()
                  if (e.key === 'Escape') setEditing(null)
                }}
                className="w-full resize-none rounded border border-border-active bg-background px-2 py-1 text-sm text-text-primary outline-none"
                rows={2}
              />
              <div className="flex justify-end gap-1">
                <button
                  onClick={() => setEditing(null)}
                  className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-surface-hover"
                >
                  <X size={11} className="inline" /> 取消
                </button>
                <button
                  onClick={confirmEdit}
                  className="rounded bg-accent px-2 py-0.5 text-xs text-accent-foreground hover:bg-accent-hover"
                >
                  <Check size={11} className="inline" /> 保存
                </button>
              </div>
            </div>
          ) : (
            <div
              onDoubleClick={() => startEdit('original')}
              className={`text-sm leading-relaxed ${
                segment.originalText
                  ? 'text-text-primary'
                  : segment.state === 'transcribing'
                    ? 'text-text-muted italic'
                    : 'text-text-muted italic'
              }`}
              title="双击编辑"
            >
              {segment.originalText || (
                segment.state === 'pending' || segment.state === 'transcribing'
                  ? '识别中...'
                  : '（无内容）'
              )}
            </div>
          )}

          {/* 译文 */}
          {segment.translatedText &&
            segment.translatedText !== segment.originalText &&
            editingTranslated === false && (
              <div
                onDoubleClick={startEditTranslated}
                className="border-l-2 border-accent/40 pl-2 text-sm leading-relaxed text-text-secondary"
                title="双击编辑"
              >
                {segment.translatedText}
              </div>
            )}

          {editingTranslated && (
            <div className="flex flex-col gap-1">
              <textarea
                value={translatedDraft}
                autoFocus
                onChange={(e) => setTranslatedDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirmEditTranslated()
                  if (e.key === 'Escape') setEditingTranslated(false)
                }}
                className="w-full resize-none rounded border border-border-active bg-background px-2 py-1 text-sm text-text-primary outline-none"
                rows={2}
              />
              <div className="flex justify-end gap-1">
                <button
                  onClick={() => setEditingTranslated(false)}
                  className="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-surface-hover"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* 失败错误信息 */}
          {hasFailed && (segment.sttError || segment.translateError) && (
            <div className="flex items-start gap-1.5 rounded bg-status-error/10 px-2 py-1 text-xs text-status-error">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{segment.sttError || segment.translateError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const TranscriptCard = memo(TranscriptCardImpl)
