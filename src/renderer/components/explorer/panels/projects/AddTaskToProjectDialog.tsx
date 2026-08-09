/**
 * AddTaskToProjectDialog — 从已有任务选择关联到项目
 *
 * 展示当前不属于任何项目的独立任务（projectId === null），
 * 用户可多选后批量关联到当前项目。
 *
 * 设计说明：
 * - 任务与项目为 1:N 关系（一个任务只属于一个项目）
 * - 跨项目复用任务请使用「复制任务」功能（CopyTaskDialog）
 * - 这里仅展示未关联项目的独立任务，避免一个任务出现在多个项目中造成状态混乱
 */
import { useState, useEffect, useCallback } from 'react'
import { Search, Loader2, Check, AlertCircle } from 'lucide-react'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { useStore } from '@store'
import { tasksApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import type { TaskItem } from '../tasks/types'
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from '../tasks/taskConstants'

interface AddTaskToProjectDialogProps {
  projectId: string
  onAdded: () => void
  onClose: () => void
}

export function AddTaskToProjectDialog({
  projectId, onAdded, onClose,
}: AddTaskToProjectDialogProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const [unassignedTasks, setUnassignedTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 加载未关联项目的任务
  const loadUnassigned = useCallback(async () => {
    setLoading(true)
    try {
      const result = await tasksApi.list({ projectId: 'null', limit: 200 })
      // 过滤掉已删除的
      setUnassignedTasks(result.items)
      setError(null)
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '加载失败' : 'Failed to load'))
    }
    setLoading(false)
  }, [isZh])

  useEffect(() => {
    loadUnassigned()
  }, [loadUnassigned])

  // 搜索过滤
  const filteredTasks = searchQuery
    ? unassignedTasks.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : unassignedTasks

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return
    setSubmitting(true)
    setError(null)
    try {
      await tasksApi.batchUpdate(Array.from(selectedIds), { projectId })
      onAdded()
      onClose()
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '关联失败' : 'Failed to link tasks'))
    }
    setSubmitting(false)
  }

  return (
    <OverlayDialog
      isOpen
      onClose={onClose}
      title={isZh ? '从已有任务选择' : 'Link Existing Tasks'}
      size="lg"
    >
      <div className="space-y-3">
        {/* 搜索栏 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            autoFocus
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={isZh ? '搜索任务...' : 'Search tasks...'}
            className="w-full pl-9 pr-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
          />
        </div>

        {/* 说明 */}
        <p className="text-[12px] text-text-muted">
          {isZh
            ? `仅显示未关联项目的独立任务，选中后将关联到当前项目`
            : `Showing tasks not linked to any project. Selected tasks will be linked to this project.`}
        </p>

        {/* 任务列表 */}
        <div className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted">
              <p className="text-[13px]">
                {isZh ? '没有可关联的独立任务' : 'No unassigned tasks available'}
              </p>
            </div>
          ) : (
            filteredTasks.map(task => {
              const isSelected = selectedIds.has(task.id)
              const statusConfig = TASK_STATUS_CONFIG[task.status]
              const priorityConfig = TASK_PRIORITY_CONFIG[task.priority]
              const isDone = task.status === 'DONE'
              return (
                <div
                  key={task.id}
                  onClick={() => toggleSelect(task.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-border/20 hover:bg-surface-hover/40 hover:border-border/40'
                  }`}
                >
                  {/* 选中框 */}
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-accent border-accent text-white'
                      : 'border-border/40'
                  }`}>
                    {isSelected && <Check className="w-3 h-3" />}
                  </div>

                  {/* 状态点 */}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusConfig.dotColor}`} />

                  {/* 标题 */}
                  <span className={`text-[13px] flex-1 min-w-0 truncate ${isDone ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                    {task.title}
                  </span>

                  {/* 优先级 */}
                  <span className={`flex items-center gap-1 text-[12px] flex-shrink-0 ${priorityConfig.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${priorityConfig.dotColor}`} />
                    {isZh ? priorityConfig.labelZh : priorityConfig.label}
                  </span>
                </div>
              )
            })
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
            <span className="text-[12px] text-red-500">{error}</span>
          </div>
        )}

        {/* 底部操作 */}
        <div className="flex items-center justify-between pt-2 border-t border-border/20">
          <span className="text-[12px] text-text-muted">
            {isZh ? `已选 ${selectedIds.size} 个` : `${selectedIds.size} selected`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[13px] font-medium text-text-secondary rounded-lg hover:bg-surface-hover/50 transition-colors"
            >
              {isZh ? '取消' : 'Cancel'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={selectedIds.size === 0 || submitting}
              className={`px-4 py-2 text-[13px] font-medium rounded-lg transition-colors ${
                selectedIds.size > 0 && !submitting
                  ? 'bg-accent text-white hover:bg-accent/90'
                  : 'bg-surface-hover/30 text-text-muted cursor-not-allowed'
              }`}
            >
              {submitting
                ? (isZh ? '关联中...' : 'Linking...')
                : (isZh ? '关联到项目' : 'Link to Project')}
            </button>
          </div>
        </div>
      </div>
    </OverlayDialog>
  )
}
