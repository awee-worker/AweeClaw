/**
 * ExecutionDockBar — 执行会话切换条
 *
 * 类似浏览器 tab，展示当前项目的所有执行会话，可点击切换查看。
 *
 * 布局：
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ [● 任务1] [○ 批量(2/5)] [✓ 任务3] [✗ 任务4]              [清除] │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 状态图标：
 * - ● 运行中（accent 色 + 旋转动画）
 * - ○ 排队中（灰色）
 * - ✓ 已完成（绿色，5秒后自动淡出）
 * - ✗ 失败（红色）
 * - ■ 已中止（灰色）
 *
 * 无活跃会话时隐藏（返回 null）。
 */
import { memo, useEffect, useState, useCallback } from 'react'
import {
  Loader2, Clock, CheckCircle2, AlertCircle, X, Layers, Square,
} from 'lucide-react'
import { useStore } from '@store'
import type { ExecutionSession } from '@renderer/state/slices/executionSessionSlice'

interface ExecutionDockBarProps {
  /** 该项目的所有会话 */
  sessions: ExecutionSession[]
  /** 当前聚焦的会话 ID */
  activeSessionId: string | null
  /** 是否中文 */
  isZh: boolean
  /** 选择会话 */
  onSelect: (id: string) => void
  /** 中止会话 */
  onAbort: (id: string) => void
}

function ExecutionDockBarBase({
  sessions, activeSessionId, isZh, onSelect, onAbort,
}: ExecutionDockBarProps) {
  const clearFinishedSessions = useStore((s) => s.clearFinishedSessions)

  const handleClear = useCallback(() => {
    clearFinishedSessions()
  }, [clearFinishedSessions])

  // 过滤：仅显示活跃 + 最近完成的会话
  const visibleSessions = sessions.filter(s => {
    // 活跃会话总是显示
    if (s.status === 'running' || s.status === 'queued') return true
    // 完成的会话显示 30 秒后隐藏
    if (s.status === 'completed' || s.status === 'failed' || s.status === 'aborted') {
      if (!s.finishedAt) return true
      return Date.now() - s.finishedAt < 30000
    }
    return false
  })

  // 无可见会话时隐藏
  if (visibleSessions.length === 0) return null

  return (
    <div className="flex-shrink-0 border-t border-border/30 bg-surface/20 px-2 py-1.5 flex items-center gap-1 overflow-x-auto">
      {visibleSessions.map(session => (
        <DockBarItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          isZh={isZh}
          onSelect={() => onSelect(session.id)}
          onAbort={() => onAbort(session.id)}
        />
      ))}

      {/* 右侧：清除已完成的会话 */}
      {sessions.some(s => ['completed', 'failed', 'aborted'].includes(s.status)) && (
        <button
          onClick={handleClear}
          className="ml-auto flex-shrink-0 px-2 py-1 text-[12px] text-text-muted hover:text-text-primary transition-colors"
          title={isZh ? '清除已完成的会话' : 'Clear finished sessions'}
        >
          {isZh ? '清除' : 'Clear'}
        </button>
      )}
    </div>
  )
}

// ─── 单个会话标签 ───────────────────────────────────────

interface DockBarItemProps {
  session: ExecutionSession
  isActive: boolean
  isZh: boolean
  onSelect: () => void
  onAbort: () => void
}

function DockBarItem({ session, isActive, isZh, onSelect, onAbort }: DockBarItemProps) {
  // 已完成会话自动淡出
  const [fading, setFading] = useState(false)
  useEffect(() => {
    if (session.status === 'completed' || session.status === 'failed' || session.status === 'aborted') {
      if (session.finishedAt) {
        const elapsed = Date.now() - session.finishedAt
        const remaining = Math.max(0, 30000 - elapsed)
        if (remaining > 0) {
          const timer = setTimeout(() => setFading(true), remaining - 1000)
          return () => clearTimeout(timer)
        } else {
          setFading(true)
        }
      }
    }
  }, [session.status, session.finishedAt])

  const isRunning = session.status === 'running'
  const isQueued = session.status === 'queued'
  const isCompleted = session.status === 'completed'
  const isFailed = session.status === 'failed'
  const isAborted = session.status === 'aborted'

  // 会话标题
  const title = session.kind === 'batch'
    ? (isZh
        ? `批量执行${session.batchTotal ? ` (${session.batchCompleted ?? 0}/${session.batchTotal})` : ''}`
        : `Batch${session.batchTotal ? ` (${session.batchCompleted ?? 0}/${session.batchTotal})` : ''}`)
    : (isZh ? `任务` : 'Task')

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer transition-all flex-shrink-0 ${
        isActive
          ? 'bg-accent/15 border border-accent/30'
          : 'bg-surface/40 border border-transparent hover:bg-surface-hover/50'
      } ${fading ? 'opacity-40' : ''}`}
    >
      {/* 状态图标 */}
      {isRunning ? (
        <Loader2 className="w-3 h-3 text-accent animate-spin flex-shrink-0" />
      ) : isQueued ? (
        <Clock className="w-3 h-3 text-text-muted flex-shrink-0" />
      ) : isCompleted ? (
        <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
      ) : isFailed ? (
        <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
      ) : isAborted ? (
        <Square className="w-3 h-3 text-text-muted flex-shrink-0" />
      ) : (
        <Layers className="w-3 h-3 text-text-muted flex-shrink-0" />
      )}

      {/* 标题 */}
      <span className={`text-[12px] whitespace-nowrap ${
        isActive ? 'text-accent font-medium' : 'text-text-secondary'
      }`}>
        {title}
      </span>

      {/* 中止按钮（仅运行中/排队中显示） */}
      {(isRunning || isQueued) && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAbort()
          }}
          className="ml-0.5 p-0.5 rounded hover:bg-red-500/20 transition-colors"
          title={isZh ? '中止' : 'Abort'}
        >
          <X className="w-2.5 h-2.5 text-text-muted hover:text-red-500" />
        </button>
      )}
    </div>
  )
}

export const ExecutionDockBar = memo(ExecutionDockBarBase)
ExecutionDockBar.displayName = 'ExecutionDockBar'
