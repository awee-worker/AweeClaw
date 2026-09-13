/**
 * SubAgent 任务面板
 * 
 * 展示后台任务列表，支持进度查看、取消操作
 */

import { useState, useEffect } from 'react'
import { Play, Square, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { getSubAgentEngine, type BackgroundTask } from '@renderer/intelligence/engine/SubAgentEngine'

interface SubAgentPanelProps {
  className?: string
}

export default function SubAgentPanel({ className = '' }: SubAgentPanelProps) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const engine = getSubAgentEngine()

  // 加载任务列表
  useEffect(() => {
    loadTasks()
    
    const interval = setInterval(loadTasks, 2000)
    return () => clearInterval(interval)
  }, [])

  const loadTasks = async () => {
    const allTasks = await engine.getAllTasks()
    setTasks(allTasks)
  }

  // 启动任务
  const startTask = async (taskId: string) => {
    try {
      await engine.startTask(taskId)
      loadTasks()
    } catch (err) {
      console.error('Failed to start task:', err)
    }
  }

  // 取消任务
  const cancelTask = async (taskId: string) => {
    await engine.cancelTask(taskId)
    loadTasks()
  }

  // 删除任务
  const deleteTask = async (taskId: string) => {
    await engine['taskStore'].delete(taskId)
    loadTasks()
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
