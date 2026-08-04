/**
 * StatusBar - 底部状态栏
 *
 * 展示：
 * - 录音状态指示器（动态颜色 + 文字）
 * - 当前工作区路径（截断显示）
 * - 段数统计
 * - 会议时长
 * - 已保存文件路径（txt + docx）
 */

import { memo } from 'react'
import {
  Mic,
  Pause,
  Circle,
  Folder,
  FileText,
  FileType,
  Clock,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import type { MeetingState } from '@shared/protocols/meetingNotes'

export interface StatusBarProps {
  meetingState: MeetingState
  speaking: boolean
  vadRunning: boolean
  vadError: string | null
  workspacePath: string | null
  segmentCount: number
  startTime: number
  endTime: number
  savedTranscriptPath: string | null
  savedDocxPath: string | null
}

/** 格式化会议时长 */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 截断路径，保留末尾两层目录 */
function truncatePath(p: string): string {
  if (!p) return ''
  if (p.length <= 60) return p
  const parts = p.split(/[/\\]/)
  if (parts.length <= 3) return p
  return '.../' + parts.slice(-3).join('/')
}

function StatusBarImpl(props: StatusBarProps) {
  const {
    meetingState,
    speaking,
    vadError,
    workspacePath,
    segmentCount,
    startTime,
    endTime,
    savedTranscriptPath,
    savedDocxPath,
  } = props

  // ── 录音状态指示器 ──
  const renderStateIndicator = () => {
    if (vadError && meetingState === 'recording') {
      return (
        <span className="flex items-center gap-1.5 text-status-error">
          <AlertCircle size={13} className="animate-pulse" />
          <span className="text-xs">{vadError}</span>
        </span>
      )
    }

    switch (meetingState) {
      case 'idle':
        return (
          <span className="flex items-center gap-1.5 text-text-muted">
            <Circle size={10} className="fill-current" />
            <span className="text-xs">待开始</span>
          </span>
        )
      case 'recording':
        return (
          <span className={`flex items-center gap-1.5 ${speaking ? 'text-status-success' : 'text-text-secondary'}`}>
            <Mic size={13} className={speaking ? 'animate-pulse' : ''} />
            <span className="text-xs">{speaking ? '正在记录' : '监听中'}</span>
            {speaking && (
              <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-status-success" />
            )}
          </span>
        )
      case 'paused':
        return (
          <span className="flex items-center gap-1.5 text-status-warning">
            <Pause size={13} />
            <span className="text-xs">已暂停</span>
          </span>
        )
      case 'finishing':
        return (
          <span className="flex items-center gap-1.5 text-status-info">
            <FileText size={13} className="animate-spin" />
            <span className="text-xs">正在保存...</span>
          </span>
        )
      case 'organizing':
        return (
          <span className="flex items-center gap-1.5 text-accent">
            <span className="h-2 w-2 animate-spin rounded-full border border-accent border-t-transparent" />
            <span className="text-xs">整理中...</span>
          </span>
        )
      case 'done':
        return (
          <span className="flex items-center gap-1.5 text-status-success">
            <CheckCircle2 size={13} />
            <span className="text-xs">已完成</span>
          </span>
        )
      default:
        return null
    }
  }

  const now = Date.now()
  const duration = meetingState === 'recording' || meetingState === 'paused'
    ? now - startTime
    : (endTime > 0 ? endTime - startTime : 0)

  return (
    <div className="flex items-center gap-4 border-t border-border bg-background-secondary px-4 py-2 text-text-secondary">
      {/* 录音状态 */}
      {renderStateIndicator()}

      {/* 会议时长 */}
      {(meetingState === 'recording' || meetingState === 'paused' || duration > 0) && (
        <span className="flex items-center gap-1 text-xs">
          <Clock size={11} />
          {formatDuration(duration)}
        </span>
      )}

      {/* 段数 */}
      {segmentCount > 0 && (
        <span className="text-xs">{segmentCount} 段发言</span>
      )}

      <div className="flex-1" />

      {/* 已保存文件 */}
      {savedTranscriptPath && (
        <span
          className="flex max-w-[180px] items-center gap-1 text-xs text-status-success"
          title={savedTranscriptPath}
        >
          <FileText size={12} />
          <span className="truncate">{truncatePath(savedTranscriptPath)}</span>
        </span>
      )}

      {savedDocxPath && (
        <span
          className="flex max-w-[180px] items-center gap-1 text-xs text-accent"
          title={savedDocxPath}
        >
          <FileType size={12} />
          <span className="truncate">{truncatePath(savedDocxPath)}</span>
        </span>
      )}

      {/* 工作区路径 */}
      <span
        className="flex max-w-[240px] items-center gap-1 text-xs text-text-muted"
        title={workspacePath || '未打开工作区'}
      >
        <Folder size={12} />
        <span className="truncate">
          {workspacePath ? truncatePath(workspacePath) : '未打开工作区'}
        </span>
      </span>
    </div>
  )
}

export const StatusBar = memo(StatusBarImpl)
