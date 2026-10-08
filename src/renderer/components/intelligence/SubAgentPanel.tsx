/**
 * SubAgent 任务面板
 * 
 * 展示后台任务列表，支持进度查看、取消操作
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { getSubAgentEngine, type BackgroundTask } from '@renderer/intelligence/engine/SubAgentEngine'

interface SubAgentPanelProps {
  className?: string
}

/** 有任务在跑时的轮询间隔（ms）：进度要跟得上 */
const ACTIVE_POLL_MS = 2000
/** 空闲时的兜底轮询间隔（ms）：只为捕捉外部写入，降到最低频次 */
const IDLE_POLL_MS = 15000

/**
 * 任务快照是否等价。
 *
 * 只比较面板真正渲染出来的字段：id / 状态 / 进度 / 结果 / 错误。
 * getAllTasks 每次都重新查库并重建对象，引用比较会恒为“不同”，这里按字段判等。
 */
function isSameTaskSnapshot(a: BackgroundTask[], b: BackgroundTask[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id ||
      x.status !== y.status ||
      x.progress !== y.progress ||
      x.result !== y.result ||
      x.error !== y.error
    ) {
      return false
    }
  }
  return true
}

export default function SubAgentPanel({ className = '' }: SubAgentPanelProps) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const engine = getSubAgentEngine()

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)
  /** 当前调度函数；手动操作后用它把轮询节拍立刻重算一次 */
  const scheduleRef = useRef<() => void>(() => {})

  const loadTasks = useCallback(async () => {
    const allTasks = await engine.getAllTasks()
    // 每次都会重查任务库并构造新数组；内容未变时保持原引用，
    // 否则面板会因数组引用变化周期性重渲染（列表、进度条全部重算）。
    setTasks(prev => (isSameTaskSnapshot(prev, allTasks) ? prev : allTasks))
  }, [engine])

  /**
   * 立刻重排下一拍。
   *
   * 手动启动 / 取消 / 删除后调用：一个空闲期排下的旧节拍最长要等满 IDLE_POLL_MS
   * 才会切回快节拍，用户点了「启动」却十几秒看不到进度动起来。
   */
  const kick = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    scheduleRef.current()
  }, [])

  // 自适应轮询：有任务在跑时按 ACTIVE_POLL_MS 刷新进度，无任务时降到
  // IDLE_POLL_MS 兜底。用自调度 setTimeout 而非固定 setInterval：间隔要随
  // 「是否有运行中任务」变化，且能在上一拍读库返回后再排下一拍，避免慢查询堆叠。
  useEffect(() => {
    stoppedRef.current = false
    void loadTasks()

    const schedule = () => {
      if (stoppedRef.current) return
      const delay = engine.getRunningCount() > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS
      timerRef.current = setTimeout(async () => {
        timerRef.current = null
        await loadTasks()
        schedule()
      }, delay)
    }
    scheduleRef.current = schedule
    schedule()

    return () => {
      stoppedRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [engine, loadTasks])

  // 启动任务
  const startTask = async (taskId: string) => {
    try {
      await engine.startTask(taskId)
      await loadTasks()
      kick()
    } catch (err) {
      console.error('Failed to start task:', err)
    }
  }

  // 取消任务
  const cancelTask = async (taskId: string) => {
    await engine.cancelTask(taskId)
    await loadTasks()
    kick()
  }

  // 删除任务
  const deleteTask = async (taskId: string) => {
    await engine['taskStore'].delete(taskId)
    await loadTasks()
    kick()
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-purple-500" />
          <span className="text-sm font-medium">后台任务</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            运行中: {engine.getRunningCount()}
          </span>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            暂无后台任务<br />
            任务会在发送耗时请求时自动创建
          </div>
        ) : (
          tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onStart={() => startTask(task.id)}
              onCancel={() => cancelTask(task.id)}
              onDelete={() => deleteTask(task.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// 任务卡片
function TaskCard({
  task,
  onStart,
  onCancel,
  onDelete,
}: {
  task: BackgroundTask
  onStart: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  return (
    <div className={`p-3 rounded-lg border transition-colors ${
      task.status === 'running'
        ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
        : task.status === 'failed'
        ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
        : 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
    }`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          {getStatusIcon(task.status)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {task.id.slice(0, 8)}...
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {getStatusLabel(task.status)}
            </span>
          </div>
          <p className="text-sm font-medium mt-1 truncate">
            {task.prompt}
          </p>
          {task.status === 'running' && (
            <div className="mt-2">
              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 inline-block">
                {task.progress}%
              </span>
            </div>
          )}
          {task.error && (
            <p className="text-xs text-red-500 mt-1 truncate">
              错误: {task.error}
            </p>
          )}
          {task.result && task.status === 'completed' && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1 line-clamp-2">
              {task.result}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {task.status === 'pending' && (
            <button
              onClick={onStart}
              className="p-1 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
              title="启动"
            >
              <Play className="w-3 h-3 text-green-500" />
            </button>
          )}
          {task.status === 'running' && (
            <button
              onClick={onCancel}
              className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
              title="取消"
            >
              <Square className="w-3 h-3 text-red-500" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
            title="删除"
          >
            <Trash2 className="w-3 h-3 text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  )
}

function getStatusIcon(status: BackgroundTask['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />
    case 'cancelled':
      return <XCircle className="w-4 h-4 text-gray-400" />
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
    default:
      return <Square className="w-4 h-4 text-gray-400" />
  }
}

function getStatusLabel(status: BackgroundTask['status']): string {
  switch (status) {
    case 'completed': return '已完成'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    case 'running': return '运行中'
    default: return '等待中'
  }
}
