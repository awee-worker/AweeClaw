/**
 * ExecutionTaskList — 执行窗口左侧任务列表
 *
 * 显示当前项目的所有任务，按状态分组：
 * - 进行中（IN_PROGRESS）排在最前
 * - 待办（TODO）
 * - 已完成（DONE）
 *
 * 交互：
 * - 点击有 threadId 的任务 → 切换到该任务的执行线程（高亮 + 通知父组件）
 * - 点击无 threadId 的待办任务 → 通知父组件启动新会话
 * - 自动轮询刷新任务状态（执行中任务状态可能变化）
 */

import { useCallback, useEffect, useState, useRef } from 'react'
import {
  CheckCircle2, Circle, Loader2, AlertCircle, ListTodo, Play, RefreshCw, RotateCcw,
} from 'lucide-react'
import { tasksApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import type { TaskItem, TaskStatus } from '@renderer/components/explorer/panels/tasks/types'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 常量
// ============================================

/** 任务状态轮询间隔（ms） */
const POLL_INTERVAL = 3000

// ============================================
// 类型定义
// ============================================

interface ExecutionTaskListProps {
  projectId: string
  /** 当前激活的线程 ID（高亮对应任务） */
  threadId: string
  /** 任务点击回调（切换到该任务或启动新执行） */
  onTaskSelect?: (task: TaskItem) => void
  /** 重新执行任务回调（已完成/已取消任务显示此按钮） */
  onReExecuteTask?: (task: TaskItem) => void
}

/** 状态显示配置 */
const STATUS_CONFIG: Record<TaskStatus, { icon: typeof Circle; color: string; label: string }> = {
  IN_PROGRESS: { icon: Loader2, color: 'text-accent', label: '进行中' },
  TODO: { icon: Circle, color: 'text-text-muted', label: '待办' },
  BLOCKED: { icon: AlertCircle, color: 'text-amber-500', label: '阻塞' },
  DONE: { icon: CheckCircle2, color: 'text-green-500', label: '已完成' },
  CANCELED: { icon: Circle, color: 'text-text-muted/50', label: '已取消' },
}

// ============================================
// 主组件
// ============================================

export function ExecutionTaskList({ projectId, threadId, onTaskSelect, onReExecuteTask }: ExecutionTaskListProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refreshTokenRef = useRef(0)

  // 加载项目任务列表
  const loadTasks = useCallback(async () => {
    const token = ++refreshTokenRef.current
    setError(null)
    try {
      const result = await tasksApi.list({ projectId, limit: 200 })
      if (token !== refreshTokenRef.current) return
      setTasks(result.items)
    } catch (e) {
      if (token !== refreshTokenRef.current) return
      setError(getApiErrorMessage(e, '加载任务失败'))
      logger.agent.warn('[ExecutionTaskList] Load failed:', e)
    } finally {
      if (token === refreshTokenRef.current) {
        setLoading(false)
      }
    }
  }, [projectId])

  // 首次加载
  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  // 轮询刷新（执行中任务状态可能变化）
  useEffect(() => {
    const hasRunning = tasks.some(t => t.status === 'IN_PROGRESS')
    if (!hasRunning) return

    const timer = setInterval(() => {
      loadTasks()
    }, POLL_INTERVAL)

    return () => clearInterval(timer)
  }, [tasks, loadTasks])

  // 按状态排序：IN_PROGRESS > TODO > BLOCKED > DONE > CANCELED
  const sortedTasks = [...tasks].sort((a, b) => {
    const order: Record<TaskStatus, number> = { IN_PROGRESS: 0, TODO: 1, BLOCKED: 2, DONE: 3, CANCELED: 4 }
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.sortOrder - b.sortOrder
  })

  // 分组：活跃任务 + 已完成任务
  const activeTasks = sortedTasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELED')
  const doneTasks = sortedTasks.filter(t => t.status === 'DONE' || t.status === 'CANCELED')

  return (
    <div className="flex flex-col h-full bg-surface/20">
      {/* 头部 */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-3 h-9 border-b border-border/30">
        <ListTodo className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-[12px] font-medium text-text-primary">任务列表</span>
        <span className="text-[12px] text-text-muted ml-auto">{tasks.length}</span>
        {/* 刷新按钮 */}
        <button
          onClick={loadTasks}
          className="p-0.5 rounded hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-[12px] text-red-500 text-center">{error}</div>
        ) : sortedTasks.length === 0 ? (
          <div className="px-3 py-8 text-[12px] text-text-muted text-center">暂无任务</div>
        ) : (
          <>
            {/* 活跃任务 */}
            {activeTasks.map((task) => (
              <TaskListItem
                key={task.id}
                task={task}
                isActive={task.threadId === threadId}
                onClick={() => onTaskSelect?.(task)}
              />
            ))}

            {/* 已完成任务（折叠区） */}
            {doneTasks.length > 0 && (
              <>
                <div className="mt-2 mb-1 px-3 text-[12px] font-medium text-text-muted/60 uppercase tracking-wider">
                  已完成 ({doneTasks.length})
                </div>
                {doneTasks.map((task) => (
                  <TaskListItem
                    key={task.id}
                    task={task}
                    isActive={task.threadId === threadId}
                    onClick={() => onTaskSelect?.(task)}
                    onReExecute={onReExecuteTask ? () => onReExecuteTask(task) : undefined}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ============================================
// 子组件：任务列表项
// ============================================

interface TaskListItemProps {
  task: TaskItem
  isActive: boolean
  onClick: () => void
  /** 重新执行回调（已完成/已取消任务显示此按钮） */
  onReExecute?: () => void
}

function TaskListItem({ task, isActive, onClick, onReExecute }: TaskListItemProps) {
  const config = STATUS_CONFIG[task.status]
  const Icon = config.icon
  const isDone = task.status === 'DONE'
  const isCanceled = task.status === 'CANCELED'
  const canExecute = !isDone && !isCanceled && task.status !== 'IN_PROGRESS'
  const hasThread = !!task.threadId
  const canReExecute = (isDone || isCanceled) && !!onReExecute

  return (
    <div
      onClick={canExecute ? onClick : undefined}
      className={`group flex items-start gap-2 px-3 py-2 transition-colors border-l-2 ${
        isActive
          ? 'bg-accent/10 border-accent'
          : canExecute
            ? 'border-transparent hover:bg-surface-hover/30 cursor-pointer'
            : 'border-transparent cursor-default'
      }`}
      title={task.description || task.title}
    >
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${config.color} ${task.status === 'IN_PROGRESS' ? 'animate-spin' : ''}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-[12px] leading-snug truncate ${
          isDone ? 'text-text-muted line-through' : isCanceled ? 'text-text-muted/50' : 'text-text-primary'
        }`}>
          {task.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-[12px] text-text-muted">{config.label}</p>
          {/* 有线程标识：可查看 */}
          {hasThread && !isDone && (
            <span className="text-[12px] text-accent/60">· 已执行</span>
          )}
        </div>
      </div>
      {/* 执行/查看图标 */}
      {canExecute && (
        <div className={`flex-shrink-0 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {hasThread ? (
            <Play className="w-3 h-3 text-text-muted" />
          ) : (
            <Play className="w-3 h-3 text-accent" />
          )}
        </div>
      )}
      {/* 重新执行按钮（已完成/已取消任务） */}
      {canReExecute && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onReExecute!()
          }}
          title="重新执行"
          className="flex-shrink-0 p-0.5 rounded hover:bg-accent/10 text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
