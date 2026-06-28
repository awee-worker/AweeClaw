/**
 * 项目编辑对话框
 *
 * 修改项目元数据：name / description / version / author / tags / status。
 * type / scenarioId / localPath 创建后不可修改（影响构建产物路径与场景唯一标识）。
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import type React from 'react'
import { projectService } from '../../services'
import type { ScenarioProject, ProjectStatus } from '../../types'
import { useI18n } from '@renderer/i18n'

interface ProjectEditDialogProps {
  project: ScenarioProject
  onClose: () => void
  onSaved: (updated: ScenarioProject) => void
}

/** 所有可编辑状态（archived 仅允许从其他状态归档，不允许直接编辑为 archived 之外的过渡态） */
const EDITABLE_STATUSES: ProjectStatus[] = ['draft', 'developing', 'building', 'ready', 'published']

const ProjectEditDialog: React.FC<ProjectEditDialogProps> = ({ project, onClose, onSaved }) => {
  const { t } = useI18n()

  // 表单字段
  const [name, setName] = useState(project.name)
  const [version, setVersion] = useState(project.version)
  const [description, setDescription] = useState(project.description)
  const [author, setAuthor] = useState(project.author)
  const [tagsText, setTagsText] = useState(project.tags.join(', '))
  const [status, setStatus] = useState<ProjectStatus>(project.status)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /** 解析 tags 输入：按逗号分隔，去除空白与空项 */
  const parsedTags = useMemo(() => {
    return tagsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }, [tagsText])

  /** 检测是否有字段变更 */
  const hasChanges = useMemo(() => {
    if (name !== project.name) return true
    if (version !== project.version) return true
    if (description !== project.description) return true
    if (author !== project.author) return true
    if (status !== project.status) return true
    const beforeTags = project.tags.slice().sort().join(',')
    const afterTags = parsedTags.slice().sort().join(',')
    if (beforeTags !== afterTags) return true
    return false
  }, [name, version, description, author, status, parsedTags, project])

  /** 校验表单 */
  const validate = useCallback((): string | null => {
    const trimmedName = name.trim()
    if (!trimmedName) return t('builder.project.name') + ' ' + t('builder.common.error').toLowerCase()
    if (trimmedName.length > 100) return t('builder.project.name') + ' ≤ 100'

    const trimmedVersion = version.trim()
    if (!trimmedVersion) return t('builder.project.version') + ' ' + t('builder.common.error').toLowerCase()
    if (!/^\d+\.\d+\.\d+/.test(trimmedVersion)) return '1.0.0'

    return null
  }, [name, version, t])

  const handleSave = useCallback(async () => {
    const validateError = validate()
    if (validateError) {
      setError(validateError)
      return
    }
    if (!hasChanges) {
      setError(t('builder.edit.noChanges'))
      return
    }

    setSaving(true)
    setError('')
    try {
      await projectService.updateProject(project.id, {
        name: name.trim(),
        version: version.trim(),
        description: description.trim(),
        author: author.trim(),
        tags: parsedTags,
        status,
      })
      const updated = await projectService.getProject(project.id)
      if (!updated) {
        throw new Error('Project disappeared after update')
      }
      onSaved(updated)
    } catch (err) {
      setError((err as Error).message || t('builder.edit.failed'))
    } finally {
      setSaving(false)
    }
  }, [validate, hasChanges, project.id, name, version, description, author, parsedTags, status, onSaved, t])

  /** ESC 关闭 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saving, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-inverted/50 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-md mx-4 rounded-2xl border border-border/50 bg-background/95 backdrop-blur-xl p-6 shadow-2xl shadow-black/20 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold">{t('builder.edit.title')}</h2>
        <p className="mb-4 text-xs text-muted-foreground">{t('builder.edit.subtitle')}</p>

        <div className="space-y-3">
          {/* 名称 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('builder.edit.namePlaceholder')}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              disabled={saving}
            />
          </div>

          {/* 版本 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.version')}</label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder={t('builder.edit.versionPlaceholder')}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono"
              disabled={saving}
            />
          </div>

          {/* 作者 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.author')}</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t('builder.edit.authorPlaceholder')}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              disabled={saving}
            />
          </div>

          {/* 标签 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.tags')}</label>
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder={t('builder.edit.tagsPlaceholder')}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              disabled={saving}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">{t('builder.edit.tagsHint')}</p>
          </div>

          {/* 状态 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.status')}</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              disabled={saving}
            >
              {EDITABLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`builder.status.${s}`)}
                </option>
              ))}
              {project.status === 'archived' && (
                <option value="archived">{t('builder.status.archived')}</option>
              )}
            </select>
          </div>

          {/* 描述 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('builder.edit.descriptionPlaceholder')}
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              disabled={saving}
            />
          </div>

          {/* 不可修改字段（只读展示） */}
          <div className="rounded bg-muted/30 p-2 text-[10px] text-muted-foreground space-y-0.5">
            <div>
              <span className="opacity-60">{t('builder.project.scenarioId')}:</span>{' '}
              <span className="font-mono">{project.scenarioId}</span>
            </div>
            <div>
              <span className="opacity-60">{t('builder.project.type')}:</span>{' '}
              {t(`builder.type.${project.type}`)}
            </div>
            <div>
              <span className="opacity-60">{t('builder.project.path')}:</span>{' '}
              <span className="font-mono break-all">{project.localPath}</span>
            </div>
          </div>

          {/* 错误 */}
          {error && <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
        </div>

        {/* 按钮 */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {t('builder.common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="rounded bg-accent px-4 py-2 text-sm text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? t('builder.edit.saving') : t('builder.edit.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProjectEditDialog
