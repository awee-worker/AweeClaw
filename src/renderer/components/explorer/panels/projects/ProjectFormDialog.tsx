/**
 * ProjectFormDialog — 项目创建/编辑对话框
 *
 * 表单字段：名称、描述、图标、颜色、状态、目标、标签、截止时间、附件
 * - 创建模式：project = null，可选择附件文件，创建后自动上传
 * - 编辑模式：project = 已有项目，附件在项目详情的附件 Tab 中管理
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { Paperclip, X, Plus, FolderOpen, Folder } from 'lucide-react'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { useStore } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import type { ProjectItem, ProjectStatus } from '../tasks/types'
import { PROJECT_STATUS_CONFIG, PROJECT_COLORS, PROJECT_ICONS } from '../tasks/taskConstants'

interface ProjectFormDialogProps {
  project: ProjectItem | null
  onSubmit: (data: {
    name: string
    description?: string
    icon?: string
    color?: string
    status?: ProjectStatus
    goal?: string
    tags?: string[]
    dueAt?: string | null
    workspacePaths?: string[]
    attachments?: File[]
  }) => void
  onClose: () => void
}

/** 允许上传的文件类型 */
const ACCEPT_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.jpg,.jpeg,.png,.gif,.webp,.svg,.zip,.rar,.7z'

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ProjectFormDialog({ project, onSubmit, onClose }: ProjectFormDialogProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'
  const isEdit = !!project

  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [icon, setIcon] = useState(project?.icon ?? '📁')
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0])
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'PLANNING')
  const [goal, setGoal] = useState(project?.goal ?? '')
  const [tagsInput, setTagsInput] = useState(project?.tags?.join(', ') ?? '')
  const [dueAt, setDueAt] = useState(project?.dueAt ? toLocalDate(project.dueAt) : '')
  const [attachments, setAttachments] = useState<File[]>([])
  // 项目目录路径（workspacePaths[0]），不选默认工作区根目录
  const [directoryPath, setDirectoryPath] = useState<string>(
    project?.workspacePaths?.[0] ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(project?.name ?? '')
    setDescription(project?.description ?? '')
    setIcon(project?.icon ?? '📁')
    setColor(project?.color ?? PROJECT_COLORS[0])
    setStatus(project?.status ?? 'PLANNING')
    setGoal(project?.goal ?? '')
    setTagsInput(project?.tags?.join(', ') ?? '')
    setDueAt(project?.dueAt ? toLocalDate(project.dueAt) : '')
    setAttachments([])
    setDirectoryPath(project?.workspacePaths?.[0] ?? '')
    setError(null)
  }, [project])

  const handleSubmit = useCallback(() => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(isZh ? '请输入项目名称' : 'Please enter a project name')
      return
    }

    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean)

    onSubmit({
      name: trimmedName,
      description: description.trim() || undefined,
      icon,
      color,
      status,
      goal: goal.trim() || undefined,
      tags,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      workspacePaths: directoryPath.trim() ? [directoryPath.trim()] : [],
      // 创建模式才传附件，编辑模式附件在附件 Tab 管理
      attachments: isEdit ? undefined : attachments,
    })
  }, [name, description, icon, color, status, goal, tagsInput, dueAt, directoryPath, isZh, onSubmit, attachments, isEdit])

  return (
    <OverlayDialog
      isOpen
      onClose={onClose}
      title={isEdit ? (isZh ? '编辑项目' : 'Edit Project') : (isZh ? '新建项目' : 'New Project')}
      size="lg"
    >
      <div className="space-y-4">
        {/* 名称 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '项目名称' : 'Project Name'} <span className="text-red-500">*</span>
          </label>
          <input
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); setError(null) }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder={isZh ? '输入项目名称...' : 'Enter project name...'}
            className={`w-full px-3 py-2 bg-surface/50 rounded-lg border text-[13px] text-text-primary outline-none transition-colors ${error ? 'border-red-500/50' : 'border-border/40 focus:border-accent/50'}`}
          />
          {error && <p className="text-[12px] text-red-500 mt-1">{error}</p>}
        </div>

        {/* 图标选择 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '图标' : 'Icon'}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_ICONS.map(emoji => (
              <button
                key={emoji}
                onClick={() => setIcon(emoji)}
                className={`w-8 h-8 flex items-center justify-center rounded-lg border text-lg transition-all ${icon === emoji ? 'border-accent bg-accent/10' : 'border-border/30 hover:bg-surface-hover/50'}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* 颜色选择 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '主题色' : 'Color'}
          </label>
          <div className="flex flex-wrap gap-2">
            {PROJECT_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-text-primary scale-110' : 'border-transparent hover:scale-105'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '描述' : 'Description'}
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={isZh ? '项目描述...' : 'Project description...'}
            rows={2}
            className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none"
          />
        </div>

        {/* 项目目录 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '项目目录' : 'Project Directory'}
          </label>
          <p className="text-[12px] text-text-muted mb-2">
            {isZh
              ? '选择工作区中的文件夹作为项目目录，不选则默认工作区根目录。可在「文件」Tab 中查看目录内容。'
              : 'Select a folder in the workspace as the project directory. Defaults to workspace root if not selected. View contents in the Files tab.'}
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-surface/50 rounded-lg border border-border/40 text-[13px] text-text-primary min-w-0">
              <Folder className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
              <span className={`truncate ${directoryPath ? 'text-text-primary' : 'text-text-muted'}`}>
                {directoryPath || (isZh ? '默认工作区根目录' : 'Workspace root (default)')}
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                const folder = await api.file.selectFolder()
                if (folder) setDirectoryPath(folder)
              }}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border/40 text-[12px] font-medium text-text-secondary hover:border-accent/40 hover:text-accent transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {isZh ? '选择' : 'Browse'}
            </button>
            {directoryPath && (
              <button
                type="button"
                onClick={() => setDirectoryPath('')}
                className="flex-shrink-0 p-2 rounded-lg text-text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                title={isZh ? '清除' : 'Clear'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 目标 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '项目目标' : 'Goal'}
          </label>
          <textarea
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder={isZh ? '这个项目要达成什么目标？' : 'What is the goal of this project?'}
            rows={2}
            className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none"
          />
        </div>

        {/* 状态 + 截止时间 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '状态' : 'Status'}
            </label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as ProjectStatus)}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
            >
              {(Object.keys(PROJECT_STATUS_CONFIG) as ProjectStatus[]).map(s => (
                <option key={s} value={s}>
                  {isZh ? PROJECT_STATUS_CONFIG[s].labelZh : PROJECT_STATUS_CONFIG[s].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '截止时间' : 'Due Date'}
            </label>
            <input
              type="date"
              value={dueAt}
              onChange={e => setDueAt(e.target.value)}
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
            placeholder={isZh ? '例如：重要, 前端' : 'e.g. important, frontend'}
            className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none"
          />
        </div>

        {/* 附件（仅创建模式显示，编辑模式在附件 Tab 管理） */}
        {!isEdit && (
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {isZh ? '项目附件（可选）' : 'Attachments (optional)'}
            </label>
            <p className="text-[12px] text-text-muted mb-2">
              {isZh
                ? '上传需求文档，AI 生成任务时会自动读取附件内容。支持 PDF、Word、Excel、PPT、文本等。'
                : 'Upload requirement docs. AI will read attachments when generating tasks. Supports PDF, Word, Excel, PPT, text, etc.'}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_TYPES}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  setAttachments(prev => [...prev, ...Array.from(e.target.files!)])
                }
                e.target.value = ''
              }}
            />
            {attachments.length === 0 ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-border/40 text-[12px] text-text-muted hover:border-accent/40 hover:text-accent hover:bg-accent/5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {isZh ? '添加附件文件' : 'Add attachment files'}
              </button>
            ) : (
              <div className="space-y-1.5">
                {attachments.map((file, idx) => (
                  <div
                    key={`${file.name}-${idx}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/40 border border-border/30"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-text-primary truncate">{file.name}</div>
                      <div className="text-[11px] text-text-muted">{formatFileSize(file.size)}</div>
                    </div>
                    <button
                      onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                      className="p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border/40 text-[12px] text-text-muted hover:border-accent/40 hover:text-accent hover:bg-accent/5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {isZh ? '继续添加' : 'Add more'}
                </button>
              </div>
            )}
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

/** ISO 时间转 <input type="date"> 所需格式 */
function toLocalDate(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
