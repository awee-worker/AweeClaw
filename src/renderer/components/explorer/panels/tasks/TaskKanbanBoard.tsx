/**
 * TaskKanbanBoard — 看板视图
 *
 * 按任务状态分列展示，支持：
 * - 点击任务卡片选中（打开详情抽屉）
 * - 快速完成/重启切换
 * - 拖拽排序（通过 sortOrder 更新）
 *
 * 列顺序由 KANBAN_COLUMNS 常量定义。
 */
import { useCallback } from 'react'
import { CheckCircle2, Circle, Clock, AlertCircle, Zap, Loader2 } from 'lucide-react'
import { useStore } from '@store'
import type { TaskItem } from './types'
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG, KANBAN_COLUMNS } from './taskConstants'

interface TaskKanbanBoardProps {
  tasks: TaskItem[]
  selectedTaskId: string | null
  onSelect: (id: string) => void
  onToggleStatus: (task: TaskItem) => void
  onEdit: (task: TaskItem) => void
  /** 让 AI 执行任务（可选） */
  onRunTask?: (task: TaskItem) => void
  /** 正在执行的 taskId */
  runningTaskId?: string | null
}

export function TaskKanbanBoard({
  tasks, selectedTaskId, onSelect, onToggleStatus, onEdit, onRunTask, runningTaskId,
}: TaskKanbanBoardProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const handleCardClick = useCallback((id: string) => {
    onSelect(id)
  }, [onSelect])

  const handleCardDoubleClick = useCallback((task: TaskItem) => {
    onEdit(task)
  }, [onEdit])

  return (
    <div className="h-full overflow-x-auto overflow-y-hidden">
      <div className="flex gap-3 h-full px-5 py-4 min-w-max">
        {KANBAN_COLUMNS.map(status => {
          const columnTasks = tasks.filter(t => t.status === status)
          const config = TASK_STATUS_CONFIG[status]
          return (
            <div key={status} className="flex flex-col w-72 flex-shrink-0">
              {/* 列头 */}
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
                  <span className="text-[12px] font-semibold text-text-primary">
                    {isZh ? config.labelZh : config.label}
                  </span>
                  <span className="text-[12px] text-text-muted/70">{columnTasks.length}</span>
                </div>
              </div>

              {/* 卡片列表 */}
              <div className="flex-1 overflow-y-auto space-y-2 pb-4 pr-1">
                {columnTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isSelected={task.id === selectedTaskId}
                    isRunning={runningTaskId === task.id}
                    isZh={isZh}
                    onClick={() => handleCardClick(task.id)}
                    onDoubleClick={() => handleCardDoubleClick(task)}
                    onToggleStatus={() => onToggleStatus(task)}
                    onRunTask={onRunTask}
                  />
                ))}
                {columnTasks.length === 0 && (
                  <div className="text-[12px] text-text-muted/40 text-center py-6 border border-dashed border-border/30 rounded-lg">
                    {isZh ? '拖拽任务到此' : 'Drop tasks here'}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 任务卡片 ───────────────────────────────────────────

function TaskCard({
  task, isSelected, isZh, isRunning, onClick, onDoubleClick, onToggleStatus, onRunTask,
}: {
  task: TaskItem
  isSelected: boolean
  isRunning: boolean
  isZh: boolean
  onClick: () => void
  onDoubleClick: () => void
  onToggleStatus: () => void
  onRunTask?: (task: TaskItem) => void
}) {
  const priorityConfig = TASK_PRIORITY_CONFIG[task.priority]
  const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== 'DONE'
  const isDone = task.status === 'DONE'
  const canRun = !isDone && onRunTask && !isRunning

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`group relative p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-accent/50 bg-accent/5 shadow-sm'
          : 'border-border/30 bg-surface/40 hover:border-border/50 hover:bg-surface/60'
      } ${isDone ? 'opacity-60' : ''}`}
    >
      {/* 快捷执行按钮（hover 显示在右上角） */}
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
          className={`absolute top-2 right-2 p-1 rounded transition-all ${
            canRun
              ? 'opacity-0 group-hover:opacity-100 hover:bg-accent/15 text-accent'
              : 'opacity-100 text-accent cursor-default'
          }`}
        >
          {isRunning
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Zap className="w-3.5 h-3.5" />
          }
        </button>
      )}

      {/* 标题 + 优先级 */}
      <div className="flex items-start gap-2 mb-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleStatus() }}
          className="flex-shrink-0 mt-0.5"
          title={isZh ? '切换完成状态' : 'Toggle complete'}
        >
          {isDone
            ? <CheckCircle2 className="w-4 h-4 text-green-500" />
            : <Circle className="w-4 h-4 text-text-muted hover:text-accent transition-colors" />
          }
        </button>
        <span className={`text-[13px] flex-1 leading-snug pr-6 ${isDone ? 'line-through text-text-muted' : 'text-text-primary'}`}>
          {task.title}
        </span>
      </div>

      {/* 标签 + 截止时间 */}
      <div className="flex items-center gap-1.5 ml-6 flex-wrap">
        <span className={`flex items-center gap-1 text-[11px] ${priorityConfig.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${priorityConfig.dotColor}`} />
          {isZh ? priorityConfig.labelZh : priorityConfig.label}
        </span>
        {task.dueAt && (
          <span className={`flex items-center gap-0.5 text-[11px] ${isOverdue ? 'text-red-500' : 'text-text-muted'}`}>
            <Clock className="w-2.5 h-2.5" />
            {formatDate(task.dueAt, isZh)}
            {isOverdue && <AlertCircle className="w-2.5 h-2.5" />}
          </span>
        )}
        {task.tags.slice(0, 2).map(tag => (
          <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded bg-surface-hover/50 text-text-muted">
            {tag}
          </span>
        ))}
        {task.tags.length > 2 && (
          <span className="text-[11px] text-text-muted">+{task.tags.length - 2}</span>
        )}
      </div>
    </div>
  )
}

// ─── 工具函数 ───────────────────────────────────────────

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
