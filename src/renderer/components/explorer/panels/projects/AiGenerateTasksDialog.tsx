/**
 * AiGenerateTasksDialog — AI 自动生成任务对话框
 *
 * 流程：
 * 1. 用户输入补充说明 + 任务数量上限
 * 2. 前端通过 callLLM 调用 LLM（自动适配云端/自定义模式）
 * 3. 解析 AI 返回的 JSON 任务列表
 * 4. 预览展示，用户可移除不需要的任务
 * 5. 确认后调用后端批量创建任务接口
 *
 * 设计要点：
 * - LLM 调用完全在前端完成，使用用户当前选择的模型（store.llmConfig）
 * - callLLM 通过 Electron IPC 调用主进程 AIProviderService，自动处理云端/自定义两种模式
 * - 后端只负责批量创建任务，不依赖 LlmProxyService
 */
import { useState, useCallback, useMemo, useEffect } from 'react'
import { Sparkles, Loader2, AlertCircle, Check, Plus, X, Paperclip, Pencil, Save } from 'lucide-react'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { useStore } from '@store'
import { projectsApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import { localAttachmentsService } from '@renderer/adapters/localAttachmentsService'
import type { LocalAttachmentItem } from '@renderer/adapters/electronBridge'
import { callLLM } from '@renderer/composables/meeting-notes/callLLM'
import type { LLMMessage } from '@shared/protocols/modelProtocol'
import type { TaskItem, TaskPriority } from '../tasks/types'
import { TASK_PRIORITY_CONFIG, TASK_PRIORITY_ORDER } from '../tasks/taskConstants'

interface AiGenerateTasksDialogProps {
  projectId: string
  projectName: string
  projectDescription?: string | null
  projectGoal?: string | null
  projectTags?: string[]
  onGenerated: (tasks: TaskItem[]) => void
  onClose: () => void
}

type Phase = 'input' | 'generating' | 'preview'

/** AI 返回的单条任务建议 */
interface AiTaskSuggestion {
  title: string
  description?: string
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  estimatedMin?: number
}

/** 预览阶段使用的任务结构（带临时 id） */
interface PreviewTask extends AiTaskSuggestion {
  tempId: string
}

/** 优先级规范化映射 */
const PRIORITY_MAP: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'> = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
}

export function AiGenerateTasksDialog({
  projectId,
  projectName,
  projectDescription,
  projectGoal,
  projectTags = [],
  onGenerated,
  onClose,
}: AiGenerateTasksDialogProps) {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const isZh = language === 'zh'

  // 从 store 读取用户当前选择的模型
  const currentProvider = llmConfig?.provider || ''
  const currentModel = llmConfig?.model || ''
  const hasModel = !!(currentProvider && currentModel)

  const [phase, setPhase] = useState<Phase>('input')
  const [hint, setHint] = useState('')
  const [maxTasks, setMaxTasks] = useState(10)
  const [previewTasks, setPreviewTasks] = useState<PreviewTask[]>([])
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<LocalAttachmentItem[]>([])
  /** 当前正在编辑的任务 tempId（null 表示无编辑态） */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** 编辑表单（受控） */
  const [editForm, setEditForm] = useState<{
    title: string
    description: string
    priority: TaskPriority
    estimatedMin: string
  }>({ title: '', description: '', priority: 'MEDIUM', estimatedMin: '' })

  /** 加载项目附件（本地优先，用于 AI 读取文本内容） */
  useEffect(() => {
    localAttachmentsService.list(projectId)
      .then(setAttachments)
      .catch(() => { /* 附件加载失败不阻断 AI 生成 */ })
  }, [projectId])

  /** 构建 LLM 消息列表（注入附件文本内容供 AI 参考） */
  const buildMessages = useCallback((): LLMMessage[] => {
    const projectInfo: string[] = [`项目名称：${projectName}`]
    if (projectDescription) {
      projectInfo.push(`项目描述：${projectDescription}`)
    }
    if (projectGoal) {
      projectInfo.push(`项目目标：${projectGoal}`)
    }
    if (projectTags.length > 0) {
      projectInfo.push(`标签：${projectTags.join('、')}`)
    }
    if (hint.trim()) {
      projectInfo.push(`补充说明：${hint.trim()}`)
    }

    // 注入附件文本内容（截断到 30KB，避免 prompt 过长）
    const attachmentsWithText = attachments.filter(a => a.hasText && a.textContent)
    if (attachmentsWithText.length > 0) {
      const MAX_ATTACHMENT_TEXT = 30 * 1024
      let totalLen = 0
      const attachmentSections: string[] = []
      for (const att of attachmentsWithText) {
        const remaining = MAX_ATTACHMENT_TEXT - totalLen
        if (remaining <= 0) break
        const text = att.textContent!.slice(0, remaining)
        totalLen += text.length
        const truncNote = att.textTruncated || text.length < att.textContent!.length
          ? '（内容较长，已截断）'
          : ''
        attachmentSections.push(`【附件：${att.fileName}】${truncNote}\n${text}`)
      }
      if (attachmentSections.length > 0) {
        projectInfo.push(`\n以下为项目附件内容，请结合附件信息拆解任务：\n${attachmentSections.join('\n\n')}`)
      }
    }

    const systemPrompt = `你是一位资深项目经理。根据用户提供的项目信息，拆解出 ${maxTasks} 个以内的具体可执行任务。
每个任务必须包含：
- title: 任务标题（简洁明确，不超过 100 字）
- description: 任务描述（详细说明要做什么，可选）
- priority: 优先级（LOW / MEDIUM / HIGH / URGENT）
- estimatedMin: 预估耗时（分钟，整数）

请严格按照以下 JSON 数组格式返回，不要包含任何其他文字：
[
  {"title": "任务标题", "description": "任务描述", "priority": "MEDIUM", "estimatedMin": 60}
]`

    const userPrompt = `请为以下项目拆解任务，最多 ${maxTasks} 个：

${projectInfo.join('\n')}

返回 JSON 数组：`

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
  }, [projectName, projectDescription, projectGoal, projectTags, hint, maxTasks, attachments])

  /** 解析 AI 返回的 JSON */
  const parseAiResponse = useCallback((content: string): AiTaskSuggestion[] => {
    let jsonStr = content.trim()

    // 去除 markdown 代码块标记
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim()
    }

    // 尝试找到第一个 [ 和最后一个 ]
    const startIdx = jsonStr.indexOf('[')
    const endIdx = jsonStr.lastIndexOf(']')
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      jsonStr = jsonStr.substring(startIdx, endIdx + 1)
    }

    try {
      const parsed = JSON.parse(jsonStr)
      if (!Array.isArray(parsed)) return []

      return parsed
        .filter((item: unknown) => {
          if (typeof item !== 'object' || item === null) return false
          const title = (item as Record<string, unknown>).title
          return typeof title === 'string' && title.trim().length > 0
        })
        .map((item: Record<string, unknown>) => ({
          title: String(item.title).trim(),
          description:
            typeof item.description === 'string' ? item.description.trim() : undefined,
          priority: PRIORITY_MAP[String(item.priority || '').toUpperCase()] || undefined,
          estimatedMin:
            typeof item.estimatedMin === 'number'
              ? item.estimatedMin
              : typeof item.estimatedMin === 'string'
                ? parseInt(item.estimatedMin, 10) || undefined
                : undefined,
        }))
    } catch {
      return []
    }
  }, [])

  /** 调用 LLM 生成任务 */
  const handleGenerate = useCallback(async () => {
    if (!hasModel) {
      setError(isZh
        ? '请先在聊天界面选择 AI 模型，或在设置中配置模型后再使用此功能'
        : 'Please select an AI model in chat or configure it in Settings first')
      return
    }

    setPhase('generating')
    setError(null)

    try {
      // 1. 通过 callLLM 调用 LLM（自动适配云端/自定义模式）
      const messages = buildMessages()
      const result = await callLLM(llmConfig, messages, {
        timeoutMs: 120000, // AI 生成任务可能耗时较长，给 2 分钟
      })

      // 2. 解析 JSON 响应
      const suggestions = parseAiResponse(result.content)
      if (suggestions.length === 0) {
        throw new Error(isZh
          ? 'AI 未返回有效的任务建议，请补充更多项目信息后重试'
          : 'AI did not return valid task suggestions. Please add more details and try again.')
      }

      // 3. 展示预览（添加临时 id）
      const preview = suggestions.slice(0, maxTasks).map((s, idx) => ({
        ...s,
        tempId: `preview-${idx}-${Date.now()}`,
      }))
      setPreviewTasks(preview)
      setRemovedIds(new Set())
      setPhase('preview')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(isZh ? `AI 生成失败：${msg}` : `AI generation failed: ${msg}`)
      setPhase('input')
    }
  }, [hasModel, isZh, llmConfig, buildMessages, parseAiResponse, maxTasks])

  /** 确认创建：调用后端批量创建任务 */
  const handleConfirm = useCallback(async () => {
    const kept = previewTasks.filter(t => !removedIds.has(t.tempId))
    if (kept.length === 0) {
      onClose()
      return
    }

    setPhase('generating') // 复用 loading 状态
    setError(null)

    try {
      const tasksToCreate = kept.map(t => ({
        title: t.title,
        description: t.description,
        priority: t.priority,
        estimatedMin: t.estimatedMin,
      }))
      const created = await projectsApi.generateTasks(projectId, tasksToCreate, hint.trim() || undefined)
      onGenerated(created)
      onClose()
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '创建任务失败' : 'Failed to create tasks'))
      setPhase('preview')
    }
  }, [previewTasks, removedIds, projectId, hint, onGenerated, onClose, isZh])

  const toggleRemove = (tempId: string) => {
    setRemovedIds(prev => {
      const next = new Set(prev)
      if (next.has(tempId)) {
        next.delete(tempId)
      } else {
        next.add(tempId)
      }
      return next
    })
    // 移除时退出编辑态（避免编辑已标记删除的任务）
    if (editingId === tempId) setEditingId(null)
  }

  /** 进入编辑模式：用任务当前值初始化表单 */
  const startEdit = useCallback((task: PreviewTask) => {
    setEditingId(task.tempId)
    setEditForm({
      title: task.title,
      description: task.description || '',
      priority: task.priority || 'MEDIUM',
      estimatedMin: task.estimatedMin != null ? String(task.estimatedMin) : '',
    })
  }, [editingId])

  /** 取消编辑 */
  const cancelEdit = useCallback(() => {
    setEditingId(null)
  }, [])

  /** 保存编辑：写回 previewTasks（标题为空时保留原值，不覆盖） */
  const saveEdit = useCallback((tempId: string) => {
    setPreviewTasks(prev => prev.map(t => {
      if (t.tempId !== tempId) return t
      const trimmedTitle = editForm.title.trim()
      const trimmedDesc = editForm.description.trim()
      const parsedMin = editForm.estimatedMin.trim()
      return {
        ...t,
        title: trimmedTitle || t.title,
        description: trimmedDesc || undefined,
        priority: PRIORITY_MAP[editForm.priority] || t.priority,
        estimatedMin: parsedMin ? (parseInt(parsedMin, 10) || undefined) : undefined,
      }
    }))
    setEditingId(null)
  }, [editForm])

  const keptCount = useMemo(
    () => previewTasks.filter(t => !removedIds.has(t.tempId)).length,
    [previewTasks, removedIds],
  )

  return (
    <OverlayDialog
      isOpen
      onClose={onClose}
      title={isZh ? 'AI 自动生成任务' : 'AI Generate Tasks'}
      size="lg"
    >
      {/* ─── 输入阶段 ─── */}
      {phase === 'input' && (
        <div className="space-y-4">
          {/* 项目信息 */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/30 border border-border/20">
            <Sparkles className="w-4 h-4 text-accent flex-shrink-0" />
            <span className="text-[13px] text-text-primary">
              {isZh ? `项目：${projectName}` : `Project: ${projectName}`}
            </span>
          </div>

          {/* 当前使用的模型 */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
            <div className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
            <span className="text-[12px] text-text-secondary">
              {isZh ? '使用模型：' : 'Using model: '}
            </span>
            <span className="text-[12px] font-medium text-text-primary">
              {hasModel ? `${currentProvider} / ${currentModel}` : (isZh ? '未选择' : 'Not selected')}
            </span>
          </div>

          {/* 未配置模型提示 */}
          {!hasModel && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <span className="text-[12px] text-amber-600 dark:text-amber-400">
                {isZh
                  ? '请先在聊天界面选择 AI 模型，或在设置中配置模型后再使用此功能'
                  : 'Please select an AI model in chat or configure it in Settings first'}
              </span>
            </div>
          )}

          <p className="text-[12px] text-text-muted leading-relaxed">
            {isZh
              ? 'AI 将根据项目名称、描述和目标自动拆解出可执行的任务清单。你可以在下方添加补充说明，帮助 AI 更精准地生成。'
              : 'AI will analyze your project name, description, and goal to generate actionable tasks. Add hints below for more precise results.'}
          </p>

          {/* 附件提示：展示已读取的附件数量 */}
          {attachments.filter(a => a.hasText).length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
              <Paperclip className="w-3.5 h-3.5 text-accent flex-shrink-0" />
              <span className="text-[12px] text-accent">
                {isZh
                  ? `已读取 ${attachments.filter(a => a.hasText).length} 个附件内容，将作为拆解任务的参考`
                  : `Read ${attachments.filter(a => a.hasText).length} attachment(s), will be used as reference for task generation`}
              </span>
            </div>
          )}

          {/* 补充说明 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '补充说明（可选）' : 'Additional Hints (optional)'}
            </label>
            <textarea
              autoFocus
              value={hint}
              onChange={e => setHint(e.target.value)}
              placeholder={isZh ? '例如：重点关注前端开发，包含用户认证和数据看板...' : 'e.g. Focus on frontend, include auth and dashboard...'}
              rows={3}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none"
            />
          </div>

          {/* 任务数量 */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '任务数量上限' : 'Max Tasks'}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={3}
                max={20}
                value={maxTasks}
                onChange={e => setMaxTasks(parseInt(e.target.value, 10))}
                className="flex-1 accent-accent"
              />
              <span className="text-[13px] font-medium text-text-primary w-8 text-right">{maxTasks}</span>
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-[12px] text-red-500">{error}</span>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[13px] font-medium text-text-secondary rounded-lg hover:bg-surface-hover/50 transition-colors"
            >
              {isZh ? '取消' : 'Cancel'}
            </button>
            <button
              onClick={handleGenerate}
              disabled={!hasModel}
              className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg transition-colors ${
                hasModel
                  ? 'bg-accent text-white hover:bg-accent/90'
                  : 'bg-surface-hover/30 text-text-muted cursor-not-allowed'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isZh ? '开始生成' : 'Generate'}
            </button>
          </div>
        </div>
      )}

      {/* ─── 生成中 ─── */}
      {phase === 'generating' && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="relative">
            <Loader2 className="w-10 h-10 text-accent animate-spin" />
            <Sparkles className="w-4 h-4 text-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <p className="mt-4 text-[14px] font-medium text-text-primary">
            {isZh ? 'AI 正在拆解项目需求...' : 'AI is analyzing your project...'}
          </p>
          <p className="mt-1 text-[12px] text-text-muted">
            {isZh ? '这可能需要几秒钟' : 'This may take a few seconds'}
          </p>
        </div>
      )}

      {/* ─── 预览阶段 ─── */}
      {phase === 'preview' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-text-primary">
              {isZh
                ? `AI 生成了 ${previewTasks.length} 个任务`
                : `AI generated ${previewTasks.length} tasks`}
            </p>
            <span className="text-[12px] text-text-muted">
              {isZh ? '可编辑或移除任务' : 'Edit or remove tasks'}
            </span>
          </div>

          {/* 任务预览列表 */}
          <div className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-1.5">
            {previewTasks.map((task, idx) => {
              const isRemoved = removedIds.has(task.tempId)
              const isEditing = editingId === task.tempId
              const priorityConfig = task.priority
                ? TASK_PRIORITY_CONFIG[task.priority as keyof typeof TASK_PRIORITY_CONFIG]
                : null
              return (
                <div
                  key={task.tempId}
                  className={`group flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                    isEditing
                      ? 'border-accent/50 bg-accent/5'
                      : isRemoved
                        ? 'border-border/10 bg-surface/10 opacity-40'
                        : 'border-border/20 hover:bg-surface-hover/40 hover:border-border/40'
                  }`}
                >
                  <span className="text-[12px] text-text-muted w-5 flex-shrink-0 mt-0.5">{idx + 1}.</span>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      /* ─── 编辑表单 ─── */
                      <div className="space-y-2">
                        <input
                          autoFocus
                          value={editForm.title}
                          onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                          placeholder={isZh ? '任务标题' : 'Task title'}
                          className="w-full px-2.5 py-1.5 bg-surface/60 rounded-md border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
                        />
                        <textarea
                          value={editForm.description}
                          onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                          placeholder={isZh ? '任务描述（可选）' : 'Description (optional)'}
                          rows={2}
                          className="w-full px-2.5 py-1.5 bg-surface/60 rounded-md border border-border/40 focus:border-accent/50 text-[12px] text-text-primary outline-none transition-colors resize-none"
                        />
                        <div className="flex items-center gap-2">
                          {/* 优先级 */}
                          <select
                            value={editForm.priority}
                            onChange={e => setEditForm(f => ({ ...f, priority: e.target.value as TaskPriority }))}
                            className="px-2 py-1.5 bg-surface/60 rounded-md border border-border/40 focus:border-accent/50 text-[12px] text-text-primary outline-none transition-colors"
                          >
                            {TASK_PRIORITY_ORDER.map(p => (
                              <option key={p} value={p}>
                                {isZh ? TASK_PRIORITY_CONFIG[p].labelZh : TASK_PRIORITY_CONFIG[p].label}
                              </option>
                            ))}
                          </select>
                          {/* 预估耗时 */}
                          <input
                            type="number"
                            min={0}
                            value={editForm.estimatedMin}
                            onChange={e => setEditForm(f => ({ ...f, estimatedMin: e.target.value }))}
                            placeholder={isZh ? '分钟' : 'min'}
                            className="w-24 px-2 py-1.5 bg-surface/60 rounded-md border border-border/40 focus:border-accent/50 text-[12px] text-text-primary outline-none transition-colors"
                          />
                          <span className="text-[12px] text-text-muted">{isZh ? '分钟' : 'min'}</span>
                        </div>
                        {/* 保存 / 取消 */}
                        <div className="flex items-center gap-2 pt-0.5">
                          <button
                            onClick={() => saveEdit(task.tempId)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-accent text-white rounded-md text-[12px] font-medium hover:bg-accent/90 transition-colors"
                          >
                            <Save className="w-3 h-3" />
                            {isZh ? '保存' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-2.5 py-1 text-text-secondary rounded-md text-[12px] font-medium hover:bg-surface-hover/50 transition-colors"
                          >
                            {isZh ? '取消' : 'Cancel'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ─── 展示态 ─── */
                      <>
                        <div className={`text-[13px] font-medium ${isRemoved ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                          {task.title}
                        </div>
                        {task.description && !isRemoved && (
                          <div className="text-[12px] text-text-muted mt-0.5 line-clamp-2">{task.description}</div>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          {priorityConfig && (
                            <span className={`flex items-center gap-1 text-[12px] ${priorityConfig.color}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${priorityConfig.dotColor}`} />
                              {isZh ? priorityConfig.labelZh : priorityConfig.label}
                            </span>
                          )}
                          {task.estimatedMin != null && task.estimatedMin > 0 && (
                            <span className="text-[12px] text-text-muted">
                              {isZh ? `${task.estimatedMin} 分钟` : `${task.estimatedMin} min`}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {/* 操作按钮：编辑态隐藏；移除态显示恢复按钮；正常态显示编辑+删除 */}
                  {!isEditing && (
                    isRemoved ? (
                      <button
                        onClick={() => toggleRemove(task.tempId)}
                        title={isZh ? '恢复任务' : 'Restore task'}
                        className="p-1 rounded hover:bg-surface-hover/60 text-text-muted hover:text-text-primary transition-colors flex-shrink-0 mt-0.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* 编辑按钮（在删除按钮前面） */}
                        <button
                          onClick={() => startEdit(task)}
                          title={isZh ? '编辑任务' : 'Edit task'}
                          className="p-1 rounded hover:bg-accent/10 text-text-muted hover:text-accent transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {/* 删除按钮 */}
                        <button
                          onClick={() => toggleRemove(task.tempId)}
                          title={isZh ? '移除任务' : 'Remove task'}
                          className="p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-[12px] text-red-500">{error}</span>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center justify-between pt-3 border-t border-border/20">
            <span className="text-[12px] text-text-muted">
              {isZh
                ? `保留 ${keptCount} / ${previewTasks.length} 个`
                : `${keptCount} / ${previewTasks.length} kept`}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setPhase('input'); setRemovedIds(new Set()) }}
                className="px-4 py-2 text-[13px] font-medium text-text-secondary rounded-lg hover:bg-surface-hover/50 transition-colors"
              >
                {isZh ? '重新生成' : 'Regenerate'}
              </button>
              <button
                onClick={handleConfirm}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {isZh ? '确认创建' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </OverlayDialog>
  )
}
