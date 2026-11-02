/**
 * 任务中心 — 任务列表
 *
 * 宽屏下按「状态 / 标题 / 来源 / 耗时 / 时间 / 操作」分列排布，
 * 窄屏收成两行堆叠：第一行标题，第二行来源与时间。
 * 选中态交给调用方（selectedId），这里只负责渲染与回调。
 *
 * @module explorer/panels/ledger/LedgerTaskList
 */

import { Ban, Loader2, Play, RotateCcw } from 'lucide-react'
import type { LedgerTaskView } from '@renderer/types/electronBridge'
import {
  ORIGIN_META,
  STATUS_META,
  formatDuration,
  formatRelative,
  formatShortTime,
  taskDuration,
} from './ledgerMeta'

export type SortKey = 'recent' | 'oldest' | 'duration'

export interface LedgerTaskListProps {
  tasks: LedgerTaskView[]
  selectedId: string | null
  busyId: string | null
  isInflight: (taskId: string) => boolean
  isZh: boolean
  onSelect: (taskId: string) => void
  onStart: (task: LedgerTaskView) => void
  onApprove: (task: LedgerTaskView) => void
  onRetry: (task: LedgerTaskView) => void
  onCancel: (task: LedgerTaskView) => void
}

/** 行内操作：只在 hover / 键盘聚焦时出现，避免列表被按钮占满 */
const ACTION_CLASS =
  'p-1 rounded text-text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:cursor-not-allowed'

function TaskRow({
  task,
  selected,
  busy,
  isZh,
  onSelect,
  onStart,
  onApprove,
  onRetry,
  onCancel,
}: {
  task: LedgerTaskView
  selected: boolean
  busy: boolean
  isZh: boolean
  onSelect: () => void
  onStart: () => void
  onApprove: () => void
  onRetry: () => void
  onCancel: () => void
}) {
  const status = STATUS_META[task.status]
  const origin = ORIGIN_META[task.origin]
  const StatusIcon = status.icon
  const OriginIcon = origin.icon
  const duration = taskDuration(task)
  const canApprove = task.status === 'pending_approval'
  const canStart = task.status === 'queued'
  const canRetry = task.status === 'failed' || task.status === 'cancelled'
  const canCancel = task.status === 'queued' || task.status === 'running' || canApprove
  const hasActions = canApprove || canStart || canRetry || canCancel

  return (
    <li>
      <div
        className={`group relative flex items-start gap-3 px-4 py-2.5 border-b border-border/20 transition-colors ${
          selected ? 'bg-accent/[0.07]' : 'hover:bg-surface/40'
        }`}
      >
        {/* 选中指示条：整行点击之外再给一个稳定的视觉锚点 */}
        <span
          className={`absolute left-0 top-0 bottom-0 w-[2px] ${selected ? 'bg-accent' : 'bg-transparent'}`}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? 'true' : undefined}
          className="flex items-start gap-3 flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <StatusIcon
            className={`w-4 h-4 mt-0.5 shrink-0 ${status.text} ${
              task.status === 'running' ? 'animate-spin' : ''
            }`}
            aria-hidden="true"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`text-[13px] truncate ${
                  task.status === 'cancelled' ? 'text-text-muted line-through' : 'text-text-primary'
                }`}
              >
                {task.title}
              </span>
              {task.risk === 'high' && (
                <span className="shrink-0 px-1.5 py-0.5 rounded border border-red-400/30 bg-red-400/5 text-[10px] text-red-500">
                  {isZh ? '高风险' : 'High risk'}
                </span>
              )}
            </div>

            <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
              <span className={`inline-flex items-center gap-1 ${status.text}`}>
                {isZh ? status.labelZh : status.label}
              </span>
              <span className="opacity-30">·</span>
              <span className="inline-flex items-center gap-1">
                <OriginIcon className="w-3 h-3" aria-hidden="true" />
                {isZh ? origin.labelZh : origin.label}
              </span>
              {task.kind && (
                <>
                  <span className="opacity-30">·</span>
                  <span className="truncate max-w-[140px]" title={task.kind}>
                    {task.kind}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* 时间与耗时：宽屏右对齐成两列，窄屏收到第二行末尾 */}
          <div className="hidden md:flex flex-col items-end gap-0.5 shrink-0 tabular-nums">
            <span className="text-[11px] text-text-secondary" title={formatRelative(task.createdAt, isZh)}>
              {formatShortTime(task.createdAt)}
            </span>
            <span className="text-[11px] text-text-muted">
              {task.status === 'running'
                ? formatDuration(task.createdAt, null)
                : duration !== null
                  ? formatDuration(task.createdAt, task.finishedAt)
                  : '-'}
            </span>
          </div>
        </button>

        {hasActions && (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            {canApprove && (
              <button
                type="button"
                onClick={onApprove}
                disabled={busy}
                className={`${ACTION_CLASS} px-2 text-[11px] border border-amber-400/40 text-amber-500 hover:bg-amber-400/10`}
              >
                {isZh ? '放行' : 'Approve'}
              </button>
            )}
            {canStart && (
              <button
                type="button"
                onClick={onStart}
                disabled={busy}
                aria-label={isZh ? '开始执行' : 'Start'}
                title={isZh ? '开始执行' : 'Start'}
                className={`${ACTION_CLASS} hover:text-emerald-500 hover:bg-surface/60`}
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              </button>
            )}
            {canRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={busy}
                aria-label={isZh ? '重试' : 'Retry'}
                title={isZh ? '重试' : 'Retry'}
                className={`${ACTION_CLASS} hover:text-blue-500 hover:bg-surface/60`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                aria-label={isZh ? '取消' : 'Cancel'}
                title={isZh ? '取消' : 'Cancel'}
                className={`${ACTION_CLASS} hover:text-red-500 hover:bg-surface/60`}
              >
                <Ban className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export function LedgerTaskList({
  tasks,
  selectedId,
  busyId,
  isInflight,
  isZh,
  onSelect,
  onStart,
  onApprove,
  onRetry,
  onCancel,
}: LedgerTaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center">
        <div className="w-10 h-10 rounded-full bg-surface/60 border border-border/40 flex items-center justify-center">
          <Ban className="w-4 h-4 text-text-muted/60" aria-hidden="true" />
        </div>
        <p className="text-[13px] text-text-secondary">{isZh ? '当前筛选下没有任务' : 'No tasks under this filter'}</p>
        <p className="text-[11px] text-text-muted/70 leading-relaxed max-w-sm">
          {isZh
            ? '放宽左侧的状态或来源筛选，或清空搜索关键词再看一次。'
            : 'Relax the status or origin filter on the left, or clear the search keyword.'}
        </p>
      </div>
    )
  }

  return (
    <ul aria-label={isZh ? '任务列表' : 'Task list'}>
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          selected={selectedId === task.id}
          busy={busyId === task.id || isInflight(task.id)}
          isZh={isZh}
          onSelect={() => onSelect(task.id)}
          onStart={() => onStart(task)}
          onApprove={() => onApprove(task)}
          onRetry={() => onRetry(task)}
          onCancel={() => onCancel(task)}
        />
      ))}
    </ul>
  )
}

export default LedgerTaskList
