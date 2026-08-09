/**
 * TaskWorkspace — 任务工作台（宽屏模式）
 *
 * 布局结构：
 * ┌─────────────────────────────────────────────────┐
 * │  工具栏：视图切换 | 搜索 | 筛选 | 新建任务        │
 * ├──────────┬──────────────────────────────────────┤
 * │  看板/列表 │  任务详情抽屉（选中时展开）           │
 * │           │                                      │
 * └──────────┴──────────────────────────────────────┘
 *
 * 支持两种视图：
 * - kanban: 看板视图（按状态分列，支持拖拽移动）
 * - list:   列表视图（紧凑展示，按优先级/截止时间排序）
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Plus, Search, LayoutGrid, List as ListIcon, Loader2,
  CheckCircle2, Circle, AlertCircle, X,
} from 'lucide-react'
import { useStore } from '@store'
import { tasksApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import type { TaskItem, TaskStatus, TaskQuery, UpdateTaskInput, CreateTaskInput } from './types'
import { TASK_STATUS_CONFIG, KANBAN_COLUMNS } from './taskConstants'
import { TaskKanbanBoard } from './TaskKanbanBoard'
import { TaskListView } from './TaskListView'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { TaskFormDialog } from './TaskFormDialog'
import { useTaskExecution } from './useTaskExecution'
import { CopyTaskDialog } from './CopyTaskDialog'

type ViewMode = 'kanban' | 'list'

export function TaskWorkspace() {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [showFormDialog, setShowFormDialog] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [copyingTask, setCopyingTask] = useState<TaskItem | null>(null)

  // ─── AI 执行任务 ───────────────────────────────────────
  // 旧入口（任务面板）：执行后切换到聊天界面（保留原行为）
  const setActiveSidePanel = useStore(s => s.setActiveSidePanel)
  const setChatVisible = useStore(s => s.setChatVisible)
  const closeAllFullPages = useStore(s => s.closeAllFullPages)

  const { run: runTask, runningTaskId, error: runError, clearError: clearRunError } = useTaskExecution({
    onTaskUpdated: useCallback((taskId: string, patch: Partial<TaskItem>) => {
      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, ...patch } : t)))
    }, []),
    onThreadReady: useCallback(() => {
      // 保留原行为：切到主聊天界面
      closeAllFullPages()
      setActiveSidePanel(null)
      setChatVisible(true)
    }, [closeAllFullPages, setActiveSidePanel, setChatVisible]),
  })

  // ─── 数据加载 ───────────────────────────────────────

  const loadTasks = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    const query: TaskQuery = {
      q: searchQuery || undefined,
      status: filterStatus === 'all' ? undefined : filterStatus,
      limit: 500,
    }
    const [data, err] = await tasksApi.list(query).then(
      res => [res, null] as const,
      e => [null, getApiErrorMessage(e, isZh ? '加载失败' : 'Failed to load')] as const,
    )
    if (data) {
      setTasks(data.items)
      setError(null)
    } else {
      setError(err)
    }
    setLoading(false)
  }, [searchQuery, filterStatus, isZh])

  useEffect(() => {
    loadTasks(true)
  }, [loadTasks])

  // ─── 操作回调 ───────────────────────────────────────

  const handleCreate = useCallback(() => {
    setEditingTask(null)
    setShowFormDialog(true)
  }, [])

  const handleEdit = useCallback((task: TaskItem) => {
    setEditingTask(task)
    setShowFormDialog(true)
  }, [])

  const handleToggleStatus = useCallback(async (task: TaskItem) => {
    // 乐观更新：DONE ↔ TODO 切换
    const nextStatus: TaskStatus = task.status === 'DONE' ? 'TODO' : 'DONE'
    setTasks(prev => prev.map(t =>
      t.id === task.id ? { ...t, status: nextStatus } : t,
    ))
    try {
      await tasksApi.update(task.id, { status: nextStatus })
    } catch {
      // 回滚
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: task.status } : t,
      ))
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    if (selectedTaskId === id) setSelectedTaskId(null)
    try {
      await tasksApi.remove(id)
    } catch {
      // 重新加载以恢复数据
      loadTasks()
    }
  }, [selectedTaskId, loadTasks])

  const handleFormSubmit = useCallback(async (data: {
    title: string
    description?: string | null
    status?: TaskStatus
    priority?: TaskItem['priority']
    dueAt?: string | null
    estimatedMin?: number | null
    tags?: string[]
  }) => {
    if (editingTask) {
      // 编辑模式
      const updateData: UpdateTaskInput = {
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        dueAt: data.dueAt,
        estimatedMin: data.estimatedMin ?? undefined,
        tags: data.tags,
      }
      const [updated, err] = await tasksApi.update(editingTask.id, updateData).then(
        res => [res, null] as const,
        e => [null, getApiErrorMessage(e, isZh ? '更新失败' : 'Update failed')] as const,
      )
      if (updated) {
        setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
        setShowFormDialog(false)
      } else {
        setError(err)
      }
    } else {
      // 创建模式
      const createData: CreateTaskInput = {
        title: data.title,
        description: data.description || undefined,
        status: data.status,
        priority: data.priority,
        dueAt: data.dueAt || undefined,
        estimatedMin: data.estimatedMin ?? undefined,
        tags: data.tags,
      }
      const [created, err] = await tasksApi.create(createData).then(
        res => [res, null] as const,
        e => [null, getApiErrorMessage(e, isZh ? '创建失败' : 'Create failed')] as const,
      )
      if (created) {
        setTasks(prev => [created, ...prev])
        setShowFormDialog(false)
      } else {
        setError(err)
      }
    }
  }, [editingTask, isZh])

  // ─── 统计信息 ───────────────────────────────────────

  const stats = useMemo(() => {
    const active = tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELED').length
    const done = tasks.filter(t => t.status === 'DONE').length
    const overdue = tasks.filter(t =>
      t.dueAt && new Date(t.dueAt) < new Date() && t.status !== 'DONE',
    ).length
    return { total: tasks.length, active, done, overdue }
  }, [tasks])

  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId],
  )

  // ─── 渲染 ───────────────────────────────────────────

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* 主区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 工具栏 */}
        <div className="flex-shrink-0 h-14 px-5 flex items-center justify-between border-b border-border/40 bg-surface/30">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-semibold text-text-primary">
              {isZh ? '任务' : 'Tasks'}
            </h2>
            <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
              <span className="flex items-center gap-1">
                <Circle className="w-3 h-3 text-slate-400" />
                {stats.active} {isZh ? '进行中' : 'active'}
              </span>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                {stats.done} {isZh ? '已完成' : 'done'}
              </span>
              {stats.overdue > 0 && (
                <>
                  <span className="text-border">·</span>
                  <span className="flex items-center gap-1 text-red-500">
                    <AlertCircle className="w-3 h-3" />
                    {stats.overdue} {isZh ? '逾期' : 'overdue'}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 搜索 */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface/50 rounded-md border border-border/30 w-48">
              <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={isZh ? '搜索任务...' : 'Search tasks...'}
                className="flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted/60 min-w-0"
              />
            </div>

            {/* 视图切换 */}
            <div className="flex items-center bg-surface/50 rounded-md border border-border/30 p-0.5">
              <button
                onClick={() => setViewMode('kanban')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'kanban' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'}`}
                title={isZh ? '看板视图' : 'Kanban view'}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'}`}
                title={isZh ? '列表视图' : 'List view'}
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 新建任务 */}
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-md text-[12px] font-medium hover:bg-accent/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {isZh ? '新建任务' : 'New Task'}
            </button>
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="flex-shrink-0 px-5 py-2 flex items-center gap-1.5 border-b border-border/20">
          <button
            onClick={() => setFilterStatus('all')}
            className={`text-[12px] px-2.5 py-1 rounded-md transition-colors ${filterStatus === 'all' ? 'bg-accent/12 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover/50'}`}
          >
            {isZh ? '全部' : 'All'}
          </button>
          {KANBAN_COLUMNS.map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`text-[12px] px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${filterStatus === status ? 'bg-accent/12 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover/50'}`}
            >
              <span className={`w-2 h-2 rounded-full ${TASK_STATUS_CONFIG[status].dotColor}`} />
              {isZh ? TASK_STATUS_CONFIG[status].labelZh : TASK_STATUS_CONFIG[status].label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <AlertCircle className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-[13px]">{error}</p>
              <button onClick={() => loadTasks(true)} className="mt-3 text-[12px] text-accent hover:underline">
                {isZh ? '重试' : 'Retry'}
              </button>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <CheckCircle2 className="w-10 h-10 mb-3 opacity-25" />
              <p className="text-[13px]">{isZh ? '暂无任务' : 'No tasks yet'}</p>
              <button onClick={handleCreate} className="mt-3 flex items-center gap-1.5 text-[12px] text-accent hover:underline">
                <Plus className="w-3.5 h-3.5" />
                {isZh ? '创建第一个任务' : 'Create your first task'}
              </button>
            </div>
          ) : viewMode === 'kanban' ? (
            <TaskKanbanBoard
              tasks={tasks}
              onSelect={setSelectedTaskId}
              onToggleStatus={handleToggleStatus}
              onEdit={handleEdit}
              onRunTask={runTask}
              runningTaskId={runningTaskId}
              selectedTaskId={selectedTaskId}
            />
          ) : (
            <TaskListView
              tasks={tasks}
              onSelect={setSelectedTaskId}
              onToggleStatus={handleToggleStatus}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRunTask={runTask}
              runningTaskId={runningTaskId}
              selectedTaskId={selectedTaskId}
            />
          )}
        </div>
      </div>

      {/* 任务详情抽屉 */}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => {
            setSelectedTaskId(null)
            clearRunError()
          }}
          onEdit={() => handleEdit(selectedTask)}
          onDelete={() => handleDelete(selectedTask.id)}
          onToggleStatus={() => handleToggleStatus(selectedTask)}
          onRunTask={runTask}
          isRunning={runningTaskId === selectedTask.id}
          onCopy={(task: TaskItem) => setCopyingTask(task)}
        />
      )}

      {/* 执行错误提示（轻量 inline，不打断用户操作） */}
      {runError && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-[12px] shadow-lg z-50">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1">{runError}</span>
          <button onClick={clearRunError} className="p-0.5 hover:bg-red-500/10 rounded">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* 复制任务对话框 */}
      {copyingTask && (
        <CopyTaskDialog
          task={copyingTask}
          onCopied={() => loadTasks()}
          onClose={() => setCopyingTask(null)}
        />
      )}

      {/* 创建/编辑对话框 */}
      {showFormDialog && (
        <TaskFormDialog
          task={editingTask}
          onSubmit={handleFormSubmit}
          onClose={() => setShowFormDialog(false)}
        />
      )}
    </div>
  )
}
