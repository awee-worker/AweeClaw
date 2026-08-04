/**
 * MeetingToolbar - 会议纪要顶部工具栏
 *
 * 包含：
 * - 说话人选择器（当前发言者，下拉切换 + 重命名）
 * - 开始/暂停/恢复/重新开始 按钮（根据状态切换文案）
 * - 完成按钮（保存录音原文 txt）
 * - 整理按钮（AI 整理为结构化纪要 + docx）
 * - 重置按钮
 * - 实时音量指示器
 *
 * 按钮状态机：
 *   idle       → [开始记录]
 *   recording  → [暂停记录] [完成]
 *   paused     → [继续记录] [完成]
 *   finishing  → [整理会议纪要] [新会议]
 *   done       → [整理会议纪要] [新会议]
 *   organizing → 禁用
 */

import { memo, useState, useRef, useEffect } from 'react'
import {
  Mic,
  Pause,
  Play,
  Square,
  Sparkles,
  RotateCcw,
  ChevronDown,
  Check,
  Edit3,
} from 'lucide-react'
import type { MeetingState, Speaker } from '@shared/protocols/meetingNotes'

export interface MeetingToolbarProps {
  meetingState: MeetingState
  speaking: boolean
  volume: number
  currentSpeakerId: string
  speakers: Speaker[]
  segmentCount: number
  onSpeakerChange: (speakerId: string) => void
  onSpeakerRename: (speakerId: string, name: string) => void
  onStartPause: () => void
  onFinish: () => void
  onOrganize: () => void
  onReset: () => void
}

function MeetingToolbarImpl(props: MeetingToolbarProps) {
  const {
    meetingState,
    speaking,
    volume,
    currentSpeakerId,
    speakers,
    onSpeakerChange,
    onSpeakerRename,
    onStartPause,
    onFinish,
    onOrganize,
    onReset,
  } = props

  // ── 说话人下拉与重命名 ──
  const [speakerMenuOpen, setSpeakerMenuOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!speakerMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSpeakerMenuOpen(false)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [speakerMenuOpen])

  const currentSpeaker = speakers.find((s) => s.id === currentSpeakerId) || speakers[0]

  const startRename = (speaker: Speaker) => {
    setRenamingId(speaker.id)
    setRenameValue(speaker.name)
  }

  const confirmRename = () => {
    if (renamingId && renameValue.trim()) {
      onSpeakerRename(renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }

  // ── 主按钮（开始/暂停/继续/重新开始） ──
  const renderMainButton = () => {
    switch (meetingState) {
      case 'idle':
        return (
          <button
            onClick={onStartPause}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            <Mic size={16} />
            开始记录
          </button>
        )
      case 'recording':
        return (
          <button
            onClick={onStartPause}
            className="flex items-center gap-2 rounded-md bg-status-warning px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            <Pause size={16} />
            暂停记录
          </button>
        )
      case 'paused':
        return (
          <button
            onClick={onStartPause}
            className="flex items-center gap-2 rounded-md bg-status-success px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            <Play size={16} />
            继续记录
          </button>
        )
      case 'finishing':
      case 'done':
      case 'organizing':
        return (
          <button
            onClick={onStartPause}
            className="flex items-center gap-2 rounded-md bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
          >
            <RotateCcw size={16} />
            新会议
          </button>
        )
      default:
        return null
    }
  }

  // ── 录音中显示完成按钮 ──
  const showFinishButton = meetingState === 'recording' || meetingState === 'paused'

  // ── 录音完成后显示整理按钮 ──
  const showOrganizeButton =
    meetingState === 'finishing' ||
    meetingState === 'done' ||
    meetingState === 'organizing'

  const isOrganizing = meetingState === 'organizing'

  return (
    <div className="flex items-center gap-3 border-b border-border bg-background-secondary px-4 py-3">
      {/* 说话人选择器 + 切换提示 */}
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setSpeakerMenuOpen((v) => !v)}
          disabled={meetingState === 'organizing'}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            meetingState === 'recording' || meetingState === 'paused'
              ? 'border-accent/50 bg-accent/10 text-text-primary hover:bg-accent/15'
              : 'border-border bg-surface text-text-primary hover:bg-surface-hover'
          }`}
          title="点击切换当前发言人"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: currentSpeaker?.color || '#6b7280' }}
          />
          <span className="max-w-[100px] truncate">{currentSpeaker?.name || '选择说话人'}</span>
          <ChevronDown size={14} className="text-text-muted" />
        </button>

        {/* 录音中提示：当前发言人 */}
        {(meetingState === 'recording' || meetingState === 'paused') && (
          <span className="ml-1 text-xs text-text-muted">当前发言人</span>
        )}

        {speakerMenuOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-surface py-1 shadow-glass">
            {/* 提示文字 */}
            <div className="border-b border-border-subtle px-3 py-1.5 text-xs text-text-muted">
              选择当前发言人（说话前切换）
            </div>
            {speakers.map((speaker) => (
              <div
                key={speaker.id}
                className="group flex items-center hover:bg-surface-hover"
              >
                {renamingId === speaker.id ? (
                  <div className="flex flex-1 items-center gap-1 px-3 py-2">
                    <input
                      type="text"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      className="flex-1 rounded border border-border-active bg-background px-2 py-1 text-xs text-text-primary outline-none"
                    />
                    <button
                      onClick={confirmRename}
                      className="rounded p-1 text-status-success hover:bg-surface-active"
                    >
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        onSpeakerChange(speaker.id)
                        setSpeakerMenuOpen(false)
                      }}
                      className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-sm text-text-primary"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: speaker.color }}
                      />
                      <span className="flex-1 truncate">{speaker.name}</span>
                      {speaker.id === currentSpeakerId && (
                        <Check size={14} className="text-accent" />
                      )}
                      {speaker.segmentCount !== undefined && speaker.segmentCount > 0 && (
                        <span className="text-xs text-text-muted">{speaker.segmentCount}</span>
                      )}
                    </button>
                    <button
                      onClick={() => startRename(speaker)}
                      className="px-2 py-2 text-text-muted opacity-0 transition-opacity hover:text-text-primary group-hover:opacity-100"
                      title="重命名"
                    >
                      <Edit3 size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 实时音量指示器 */}
      {(meetingState === 'recording' || meetingState === 'paused') && (
        <div className="flex items-center gap-2">
          <div className="flex h-4 items-end gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-1 rounded-full transition-all"
                style={{
                  height: `${Math.max(2, Math.min(16, volume * 100 * (i + 1) / 5))}px`,
                  backgroundColor: speaking
                    ? '#10b981'
                    : '#6b7280',
                  opacity: volume * 5 > i ? 1 : 0.3,
                }}
              />
            ))}
          </div>
          <span className="text-xs text-text-muted">
            {speaking ? '说话中' : '监听中'}
          </span>
        </div>
      )}

      <div className="flex-1" />

      {/* 主按钮 */}
      {renderMainButton()}

      {/* 完成按钮 */}
      {showFinishButton && (
        <button
          onClick={onFinish}
          className="flex items-center gap-2 rounded-md bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
        >
          <Square size={14} />
          完成
        </button>
      )}

      {/* 整理按钮 */}
      {showOrganizeButton && (
        <button
          onClick={onOrganize}
          disabled={isOrganizing}
          className="flex items-center gap-2 rounded-md bg-accent-subtle px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles size={14} />
          {isOrganizing ? '整理中...' : '整理会议纪要'}
        </button>
      )}

      {/* 重置按钮（仅 idle 状态显示） */}
      {meetingState === 'idle' && (
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 rounded-md px-3 py-2 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          title="清空当前会议"
        >
          <RotateCcw size={13} />
          重置
        </button>
      )}

      {/* 段计数 */}
      {meetingState !== 'idle' && (
        <span className="ml-1 text-xs text-text-muted">
          {props.segmentCount} 段
        </span>
      )}
    </div>
  )
}

export const MeetingToolbar = memo(MeetingToolbarImpl)
