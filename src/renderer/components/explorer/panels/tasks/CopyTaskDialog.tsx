/**
 * CopyTaskDialog — 复制任务到其他项目
 *
 * 展示用户所有可选项目（排除当前任务所属项目），
 * 选择目标项目后复制任务（状态重置为 TODO）。
 */
import { useState, useEffect, useCallback } from 'react'
import { Copy, Loader2, AlertCircle, Check, FolderKanban } from 'lucide-react'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { useStore } from '@store'
import { projectsApi, tasksApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import type { TaskItem, ProjectItem } from './types'

interface CopyTaskDialogProps {
  task: TaskItem
  onCopied: () => void
  onClose: () => void
}

export function CopyTaskDialog({ task, onCopied, onClose }: CopyTaskDialogProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const data = await projectsApi.list()
      // 排除当前任务所属的项目（复制到同一项目无意义）
      const filtered = data.filter(p => p.id !== task.projectId)
      setProjects(filtered)
      setError(null)
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '加载项目失败' : 'Failed to load projects'))
    }
    setLoading(false)
  }, [task.projectId, isZh])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const handleSubmit = async () => {
    if (!selectedId) return
    setSubmitting(true)
    setError(null)
    try {
      await tasksApi.copyTo(task.id, selectedId)
      onCopied()
      onClose()
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '复制失败' : 'Copy failed'))
    }
    setSubmitting(false)
  }

  return (
    <OverlayDialog
      isOpen
      onClose={onClose}
      title={isZh ? '复制任务到项目' : 'Copy Task to Project'}
      size="md"
    >
      <div className="space-y-4">
        {/* 源任务信息 */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-surface/30 border border-border/20">
          <Copy className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[12px] text-text-muted">{isZh ? '源任务' : 'Source task'}</div>
            <div className="text-[13px] font-medium text-text-primary truncate">{task.title}</div>
          </div>
        </div>

        <p className="text-[12px] text-text-muted leading-relaxed">
          {isZh
            ? '复制将创建一个新任务，保留标题、描述、优先级和标签，状态重置为待办。两个任务独立管理，互不影响。'
            : 'A new task will be created with the same title, description, priority and tags. Status resets to To Do. Both tasks are managed independently.'}
        </p>

        {/* 项目列表 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '选择目标项目' : 'Select target project'}
          </label>
          <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-text-muted">
                <FolderKanban className="w-6 h-6 mb-2 opacity-30" />
                <p className="text-[12px]">
                  {isZh ? '没有可用的目标项目' : 'No available projects'}
                </p>
                <p className="text-[11px] text-text-muted/60 mt-0.5">
                  {isZh ? '当前任务已是独立任务或没有其他项目' : 'This task is already standalone or no other projects exist'}
                </p>
              </div>
            ) : (
              projects.map(project => {
                const isSelected = project.id === selectedId
                return (
                  <div
                    key={project.id}
                    onClick={() => setSelectedId(project.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-border/20 hover:bg-surface-hover/40 hover:border-border/40'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-accent border-accent text-white'
                        : 'border-border/40'
                    }`}>
                      {isSelected && <Check className="w-3 h-3" />}
                    </div>
                    <span className="text-lg flex-shrink-0">{project.icon || '📁'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text-primary truncate">{project.name}</div>
                      {project.description && (
                        <div className="text-[12px] text-text-muted truncate">{project.description}</div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
            <span className="text-[12px] text-red-500">{error}</span>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium text-text-secondary rounded-lg hover:bg-surface-hover/50 transition-colors"
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedId || submitting}
            className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg transition-colors ${
              selectedId && !submitting
                ? 'bg-accent text-white hover:bg-accent/90'
                : 'bg-surface-hover/30 text-text-muted cursor-not-allowed'
            }`}
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {submitting
              ? (isZh ? '复制中...' : 'Copying...')
              : (isZh ? '复制任务' : 'Copy Task')}
          </button>
        </div>
      </div>
    </OverlayDialog>
  )
}
