/**
 * ProjectTasksTab — 项目任务 Tab
 *
 * 展示项目下所有任务，支持三种添加任务方式：
 * 1. 直接添加（内联创建任务表单）
 * 2. 从已有任务选择（关联独立任务到项目）
 * 3. AI 自动生成（AI 拆解项目需求生成任务清单）
 *
 * 点击任务可切换到任务面板查看详情。
 */
import { useState, useMemo, useCallback } from 'react'
import {
  CheckCircle2, Circle, Clock, AlertCircle,
  Plus, Sparkles, Link2, X, Edit2, Play,
} from 'lucide-react'
import { useStore } from '@store'
import { tasksApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import type { TaskItem, TaskStatus, TaskPriority, CreateTaskInput } from '../tasks/types'
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG, KANBAN_COLUMNS } from '../tasks/taskConstants'
import { TaskFormDialog } from '../tasks/TaskFormDialog'
import { optimizeTaskDescription } from './taskQualityAi'
import type { TaskQualityMeta } from './taskQuality'
import { AddTaskToProjectDialog } from './AddTaskToProjectDialog'
import { AiGenerateTasksDialog } from './AiGenerateTasksDialog'

interface ProjectTasksTabProps {
  projectId: string
  projectName: string
  projectDescription?: string | null
  projectGoal?: string | null
  projectTags?: string[]
  tasks: TaskItem[]
  loading: boolean
  isZh: boolean
  onTasksChange: () => void
  /** 执行任务：切换到执行 Tab 并启动该任务的执行 */
  onExecuteTask?: (task: TaskItem) => void
}

type DialogType = 'create' | 'link' | 'ai' | null

export function ProjectTasksTab({
  projectId, projectName, projectDescription, projectGoal, projectTags,
  tasks, loading, isZh, onTasksChange, onExecuteTask,
}: ProjectTasksTabProps) {
  const setActiveSidePanel = useStore(s => s.setActiveSidePanel)
  const llmConfig = useStore(s => s.llmConfig)

  /** AI 优化任务描述（传入 TaskFormDialog） */
  const handleAiOptimize = useCallback(async (taskInfo: { title: string; description: string }): Promise<TaskQualityMeta | null> => {
    return optimizeTaskDescription(llmConfig, taskInfo, isZh)
  }, [llmConfig, isZh])
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all')
  const [dialog, setDialog] = useState<DialogType>(null)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)

  const filteredTasks = useMemo(() => {
    if (filterStatus === 'all') return tasks
    return tasks.filter(t => t.status === filterStatus)
  }, [tasks, filterStatus])

  // 从项目中移除任务（不删除任务本身，仅解除关联）
  const handleRemoveFromProject = async (taskId: string) => {
    setRemovingId(taskId)
    setError(null)
    try {
      // 传 null 将 projectId 置空，任务变为独立任务
      await tasksApi.update(taskId, { projectId: null })
      onTasksChange()
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '移除失败' : 'Failed to remove'))
    }
    setRemovingId(null)
  }

  // 编辑任务（AI 生成或手动创建的任务均可编辑）
  const handleEditTask = async (data: {
    title: string
    description?: string | null
    status?: TaskStatus
    priority?: TaskPriority
    dueAt?: string | null
    estimatedMin?: number | null
    tags?: string[]
    metadata?: Record<string, unknown>
  }) => {
    if (!editingTask) return
    try {
      await tasksApi.update(editingTask.id, {
        ...data,
        // UpdateTaskInput 不接受 null，空值传 undefined
        estimatedMin: data.estimatedMin ?? undefined,
        dueAt: data.dueAt ?? undefined,
        description: data.description ?? undefined,
      })
      onTasksChange()
      setEditingTask(null)
      setError(null)
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '更新失败' : 'Update failed'))
    }
  }

  // 直接创建任务（关联到当前项目）
  const handleCreateTask = async (data: {
    title: string
    description?: string | null
    status?: TaskStatus
    priority?: string
    dueAt?: string | null
    estimatedMin?: number | null
    tags?: string[]
    metadata?: Record<string, unknown>
  }) => {
    const input: CreateTaskInput = {
      title: data.title,
      description: data.description ?? undefined,
      projectId,
      status: data.status,
      priority: data.priority as CreateTaskInput['priority'],
      dueAt: data.dueAt ?? undefined,
      estimatedMin: data.estimatedMin ?? undefined,
      tags: data.tags,
      metadata: data.metadata,
    }
    try {
      await tasksApi.create(input)
      onTasksChange()
      setDialog(null)
      setError(null)
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '创建失败' : 'Create failed'))
    }
  }

  return (
    <div className="p-5 max-w-3xl">
      {/* 操作按钮组 */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setDialog('create')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-md text-[12px] font-medium hover:bg-accent/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {isZh ? '添加任务' : 'Add Task'}
        </button>
        <button
          onClick={() => setDialog('link')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface/50 text-text-primary rounded-md text-[12px] font-medium border border-border/40 hover:bg-surface-hover/50 transition-colors"
        >
          <Link2 className="w-3.5 h-3.5" />
          {isZh ? '从已有任务选择' : 'Link Existing'}
        </button>
        <button
          onClick={() => setDialog('ai')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent rounded-md text-[12px] font-medium border border-accent/30 hover:bg-accent/20 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {isZh ? 'AI 生成任务' : 'AI Generate'}
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          <span className="text-[12px] text-red-500 flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-[12px] text-red-500/70 hover:text-red-500">
            ✕
          </button>
        </div>
      )}

      {/* 筛选 */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4">
          <button
            onClick={() => setFilterStatus('all')}
            className={`text-[12px] px-2.5 py-1 rounded-md transition-colors ${filterStatus === 'all' ? 'bg-accent/12 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover/50'}`}
          >
            {isZh ? '全部' : 'All'} ({tasks.length})
          </button>
          {KANBAN_COLUMNS.map(status => {
            const count = tasks.filter(t => t.status === status).length
            if (count === 0) return null
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`text-[12px] px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${filterStatus === status ? 'bg-accent/12 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover/50'}`}
              >
                <span className={`w-2 h-2 rounded-full ${TASK_STATUS_CONFIG[status].dotColor}`} />
                {isZh ? TASK_STATUS_CONFIG[status].labelZh : TASK_STATUS_CONFIG[status].label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* 任务列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
          <Circle className="w-8 h-8 mb-2 opacity-25" />
          <p className="text-[13px]">{isZh ? '此项目暂无任务' : 'No tasks in this project'}</p>
          <p className="text-[12px] mt-1 text-text-muted/60">
            {isZh ? '点击上方按钮添加任务，或让 AI 自动生成' : 'Add tasks above, or let AI generate them'}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filteredTasks.map(task => {
            const statusConfig = TASK_STATUS_CONFIG[task.status]
            const priorityConfig = TASK_PRIORITY_CONFIG[task.priority]
            const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== 'DONE'
            const isDone = task.status === 'DONE'
            const isAiGenerated = task.source === 'AI_GENERATED'
            return (
              <div
                key={task.id}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:bg-surface-hover/40 hover:border-border/20 transition-all cursor-pointer"
                onClick={() => setActiveSidePanel('tasks')}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusConfig.dotColor}`} />
                <span className={`text-[13px] flex-1 min-w-0 truncate ${isDone ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                  {task.title}
                </span>
                {isAiGenerated && (
                  <span title={isZh ? 'AI 生成' : 'AI generated'}>
                    <Sparkles className="w-3 h-3 text-accent/60 flex-shrink-0" />
                  </span>
                )}
                <span className={`flex items-center gap-1 text-[12px] ${priorityConfig.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${priorityConfig.dotColor}`} />
                  {isZh ? priorityConfig.labelZh : priorityConfig.label}
                </span>
                {task.dueAt && (
                  <span className={`flex items-center gap-1 text-[12px] ${isOverdue ? 'text-red-500' : 'text-text-muted'}`}>
                    <Clock className="w-3 h-3" />
                    {new Date(task.dueAt).toLocaleDateString(isZh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                    {isOverdue && <AlertCircle className="w-2.5 h-2.5" />}
                  </span>
                )}
                {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
                {/* 执行按钮：切换到执行 Tab 并启动该任务，阻止冒泡避免触发任务跳转 */}
                {onExecuteTask && !isDone && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onExecuteTask(task)
                    }}
                    title={isZh ? '执行任务' : 'Execute task'}
                    className="p-1 rounded hover:bg-accent/10 text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                )}
                {/* 编辑按钮：点击弹出编辑表单，阻止冒泡避免触发任务跳转 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingTask(task)
                  }}
                  title={isZh ? '编辑任务' : 'Edit task'}
                  className="p-1 rounded hover:bg-accent/10 text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                {/* 移除按钮：从项目中移除（不删除任务），点击时阻止冒泡避免触发任务跳转 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveFromProject(task.id)
                  }}
                  disabled={removingId === task.id}
                  title={isZh ? '从项目移除' : 'Remove from project'}
                  className="p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                >
                  {removingId === task.id
                    ? <div className="w-3 h-3 border border-text-muted/40 border-t-text-muted rounded-full animate-spin" />
                    : <X className="w-3.5 h-3.5" />
                  }
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 对话框 */}
      {dialog === 'create' && (
        <TaskFormDialog
          task={null}
          onSubmit={handleCreateTask}
          onClose={() => setDialog(null)}
          onAiOptimize={handleAiOptimize}
        />
      )}
      {dialog === 'link' && (
        <AddTaskToProjectDialog
          projectId={projectId}
          onAdded={onTasksChange}
          onClose={() => setDialog(null)}
        />
      )}
      {/* 编辑任务对话框（复用 TaskFormDialog 编辑模式） */}
      {editingTask && (
        <TaskFormDialog
          task={editingTask}
          onSubmit={handleEditTask}
          onClose={() => setEditingTask(null)}
          onAiOptimize={handleAiOptimize}
        />
      )}
      {dialog === 'ai' && (
        <AiGenerateTasksDialog
          projectId={projectId}
          projectName={projectName}
          projectDescription={projectDescription}
          projectGoal={projectGoal}
          projectTags={projectTags}
          onGenerated={() => onTasksChange()}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
