/**
 * TaskListView — 列表视图
 *
 * 紧凑展示所有任务，按优先级 → 截止时间排序。
 * 支持点击选中、双击编辑、快速完成切换。
 */
import { useCallback, useMemo } from 'react'
import {
  CheckCircle2, Circle, Clock, Trash2, AlertCircle, Zap, Loader2,
} from 'lucide-react'
import { useStore } from '@store'
import type { TaskItem } from './types'
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG, TASK_PRIORITY_ORDER } from './taskConstants'

interface TaskListViewProps {
  tasks: TaskItem[]
  selectedTaskId: string | null
  onSelect: (id: string) => void
  onToggleStatus: (task: TaskItem) => void
  onEdit: (task: TaskItem) => void
  onDelete: (id: string) => void
  /** 让 AI 执行任务（可选） */
  onRunTask?: (task: TaskItem) => void
  /** 正在执行的 taskId */
  runningTaskId?: string | null
}

export function TaskListView({
  tasks, selectedTaskId, onSelect, onToggleStatus, onEdit, onDelete, onRunTask, runningTaskId,
}: TaskListViewProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  // 按优先级 → 截止时间排序
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const pa = TASK_PRIORITY_ORDER.indexOf(a.priority)
      const pb = TASK_PRIORITY_ORDER.indexOf(b.priority)
      if (pa !== pb) return pb - pa
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return b.sortOrder - a.sortOrder
    })
  }, [tasks])

  const handleClick = useCallback((id: string) => onSelect(id), [onSelect])
  const handleDoubleClick = useCallback((task: TaskItem) => onEdit(task), [onEdit])

  return (
    <div className="h-full overflow-y-auto px-5 py-3">
      <div className="space-y-1 max-w-4xl mx-auto">
        {sortedTasks.map(task => {
          const statusConfig = TASK_STATUS_CONFIG[task.status]
          const priorityConfig = TASK_PRIORITY_CONFIG[task.priority]
          const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== 'DONE'
          const isDone = task.status === 'DONE'
          const isSelected = task.id === selectedTaskId
          const isRunning = runningTaskId === task.id
          const canRun = !isDone && onRunTask && !isRunning

          return (
            <div
              key={task.id}
              onClick={() => handleClick(task.id)}
              onDoubleClick={() => handleDoubleClick(task)}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                isSelected
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-transparent hover:bg-surface-hover/40 hover:border-border/20'
              } ${isDone ? 'opacity-55' : ''}`}
            >
              {/* 完成切换 */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleStatus(task) }}
                className="flex-shrink-0"
                title={isZh ? '切换完成状态' : 'Toggle complete'}
              >
                {isDone
                  ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                  : <Circle className="w-4 h-4 text-text-muted hover:text-accent transition-colors" />
                }
              </button>

              {/* 状态点 */}
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusConfig.dotColor}`} title={isZh ? statusConfig.labelZh : statusConfig.label} />

              {/* 标题 */}
              <span className={`text-[13px] flex-1 min-w-0 truncate ${isDone ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                {task.title}
              </span>

              {/* 优先级 */}
              <span className={`flex items-center gap-1 text-[12px] flex-shrink-0 ${priorityConfig.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${priorityConfig.dotColor}`} />
                {isZh ? priorityConfig.labelZh : priorityConfig.label}
              </span>

              {/* 截止时间 */}
              {task.dueAt && (
                <span className={`flex items-center gap-1 text-[12px] flex-shrink-0 ${isOverdue ? 'text-red-500' : 'text-text-muted'}`}>
                  <Clock className="w-3 h-3" />
                  {formatDate(task.dueAt, isZh)}
                  {isOverdue && <AlertCircle className="w-2.5 h-2.5" />}
                </span>
              )}

              {/* 标签 */}
              {task.tags.length > 0 && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {task.tags.slice(0, 2).map(tag => (
                    <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded bg-surface-hover/50 text-text-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* AI 执行 */}
              {onRunTask && !isDone && (
                <button
                  onClick={(e) => { e.stopPropagation(); if (canRun) onRunTask(task) }}
                  disabled={!canRun}
                  title={
                    isRunning
                      ? (isZh ? '执行中...' : 'Running...')
                      : task.threadId
                        ? (isZh ? '继续与 AI 对话' : 'Continue with AI')
                        : (isZh ? '让 AI 执行' : 'Run with AI')
                  }
                  className={`flex-shrink-0 p-1 rounded transition-all ${
                    isRunning
                      ? 'text-accent opacity-100'
                      : canRun
                        ? 'text-accent hover:bg-accent/15 opacity-0 group-hover:opacity-100'
                        : 'text-text-muted opacity-0 cursor-default'
                  }`}
                >
                  {isRunning
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Zap className="w-3.5 h-3.5" />
                  }
                </button>
              )}

              {/* 删除 */}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}
                className="flex-shrink-0 p-1 text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                title={isZh ? '删除' : 'Delete'}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatDate(iso: string, isZh: boolean): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return isZh ? '今天' : 'Today'
  if (diffDays === 1) return isZh ? '明天' : 'Tomorrow'
  if (diffDays === -1) return isZh ? '昨天' : 'Yesterday'
  if (diffDays < 0) return isZh ? `${-diffDays}天前` : `${-diffDays}d ago`
  if (diffDays < 7) return isZh ? `${diffDays}天后` : `${diffDays}d`

  return date.toLocaleDateString(isZh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
}
