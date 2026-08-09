/**
 * TaskFormDialog — 任务创建/编辑对话框
 *
 * 表单字段：标题、描述、状态、优先级、截止时间、预估耗时、标签
 * - 创建模式：task = null
 * - 编辑模式：task = 已有任务
 *
 * 校验规则：标题必填且非空
 */
import { useState, useCallback, useEffect } from 'react'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { useStore } from '@store'
import type { TaskItem, TaskStatus, TaskPriority } from './types'
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG, TASK_PRIORITY_ORDER } from './taskConstants'
import { TaskQualityFields } from '../projects/TaskQualityFields'
import { extractQualityMeta, mergeQualityMeta, type TaskQualityMeta } from '../projects/taskQuality'

interface TaskFormDialogProps {
  task: TaskItem | null
  onSubmit: (data: {
    title: string
    description?: string | null
    status?: TaskStatus
    priority?: TaskPriority
    dueAt?: string | null
    estimatedMin?: number | null
    tags?: string[]
    metadata?: Record<string, unknown>
  }) => void
  onClose: () => void
  /** AI 优化任务描述回调（可选，不传则不显示 AI 优化按钮） */
  onAiOptimize?: (taskInfo: { title: string; description: string }) => Promise<TaskQualityMeta | null>
}

export function TaskFormDialog({ task, onSubmit, onClose, onAiOptimize }: TaskFormDialogProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'
  const isEdit = !!task

  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'TODO')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'MEDIUM')
  const [dueAt, setDueAt] = useState(task?.dueAt ? toLocalDatetime(task.dueAt) : '')
  const [estimatedMin, setEstimatedMin] = useState<string>(task?.estimatedMin?.toString() ?? '')
  const [tagsInput, setTagsInput] = useState(task?.tags?.join(', ') ?? '')
  const [error, setError] = useState<string | null>(null)
  // 质量元数据（从 task.metadata 提取）
  const [qualityMeta, setQualityMeta] = useState<TaskQualityMeta>(() => extractQualityMeta(task?.metadata))
  const [aiOptimizing, setAiOptimizing] = useState(false)

  // 重置表单（当 task 变化时）
  useEffect(() => {
    setTitle(task?.title ?? '')
    setDescription(task?.description ?? '')
    setStatus(task?.status ?? 'TODO')
    setPriority(task?.priority ?? 'MEDIUM')
    setDueAt(task?.dueAt ? toLocalDatetime(task.dueAt) : '')
    setEstimatedMin(task?.estimatedMin?.toString() ?? '')
    setTagsInput(task?.tags?.join(', ') ?? '')
    setQualityMeta(extractQualityMeta(task?.metadata))
    setError(null)
  }, [task])

  /** AI 优化任务描述 */
  const handleAiOptimize = useCallback(async () => {
    if (!onAiOptimize) return
    const trimmedTitle = title.trim()
    const trimmedDesc = description.trim()
    if (!trimmedTitle && !trimmedDesc) {
      setError(isZh ? '请先输入任务标题或描述' : 'Please enter title or description first')
      return
    }
    setAiOptimizing(true)
    try {
      const result = await onAiOptimize({ title: trimmedTitle, description: trimmedDesc })
      if (result) {
        setQualityMeta(prev => ({ ...prev, ...result }))
      }
    } catch {
      // AI 优化失败不阻断流程
    } finally {
      setAiOptimizing(false)
    }
  }, [onAiOptimize, title, description, isZh])

  const handleSubmit = useCallback(() => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError(isZh ? '请输入任务标题' : 'Please enter a task title')
      return
    }

    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)

    // 质量元数据合并到 metadata（保留已有字段如 result）
    const metadata = mergeQualityMeta(task?.metadata, qualityMeta)

    const data: Parameters<typeof onSubmit>[0] = {
      title: trimmedTitle,
      description: description.trim() || null,
      status,
      priority,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      estimatedMin: estimatedMin ? parseInt(estimatedMin, 10) : null,
      tags,
      metadata,
    }

    onSubmit(data)
  }, [title, description, status, priority, dueAt, estimatedMin, tagsInput, isZh, onSubmit, task, qualityMeta])

  return (
    <OverlayDialog
      isOpen
      onClose={onClose}
      title={isEdit ? (isZh ? '编辑任务' : 'Edit Task') : (isZh ? '新建任务' : 'New Task')}
      size="lg"
    >
      <div className="space-y-4">
        {/* 标题 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '标题' : 'Title'} <span className="text-red-500">*</span>
          </label>
          <input
            autoFocus
            value={title}
            onChange={e => { setTitle(e.target.value); setError(null) }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder={isZh ? '输入任务标题...' : 'Enter task title...'}
            className={`w-full px-3 py-2 bg-surface/50 rounded-lg border text-[13px] text-text-primary outline-none transition-colors ${
              error ? 'border-red-500/50' : 'border-border/40 focus:border-accent/50'
            }`}
          />
          {error && <p className="text-[12px] text-red-500 mt-1">{error}</p>}
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '描述' : 'Description'}
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={isZh ? '任务详细描述...' : 'Task description...'}
            rows={3}
            className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none"
          />
        </div>

        {/* 状态 + 优先级 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '状态' : 'Status'}
            </label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as TaskStatus)}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
            >
              {(Object.keys(TASK_STATUS_CONFIG) as TaskStatus[]).map(s => (
                <option key={s} value={s}>
                  {isZh ? TASK_STATUS_CONFIG[s].labelZh : TASK_STATUS_CONFIG[s].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '优先级' : 'Priority'}
            </label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as TaskPriority)}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
            >
              {TASK_PRIORITY_ORDER.map(p => (
                <option key={p} value={p}>
                  {isZh ? TASK_PRIORITY_CONFIG[p].labelZh : TASK_PRIORITY_CONFIG[p].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 截止时间 + 预估耗时 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '截止时间' : 'Due Date'}
            </label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={e => setDueAt(e.target.value)}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '预估耗时（分钟）' : 'Estimated (min)'}
            </label>
            <input
              type="number"
              min={0}
              value={estimatedMin}
              onChange={e => setEstimatedMin(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
            />
          </div>
        </div>

        {/* 标签 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '标签（逗号分隔）' : 'Tags (comma-separated)'}
          </label>
          <input
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            placeholder={isZh ? '例如：前端, 紧急' : 'e.g. frontend, urgent'}
            className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
          />
        </div>

        {/* 质量要求（预期产出 / 验收标准 / 约束） */}
        <TaskQualityFields
          value={qualityMeta}
          isZh={isZh}
          onChange={setQualityMeta}
          onAiOptimize={onAiOptimize ? handleAiOptimize : undefined}
          aiOptimizing={aiOptimizing}
        />

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium text-text-secondary rounded-lg hover:bg-surface-hover/50 transition-colors"
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-[13px] font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
          >
            {isEdit ? (isZh ? '保存' : 'Save') : (isZh ? '创建' : 'Create')}
          </button>
        </div>
      </div>
    </OverlayDialog>
  )
}

// ─── 工具函数 ───────────────────────────────────────────

/** ISO 时间转 <input type="datetime-local"> 所需格式 */
function toLocalDatetime(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
