/**
 * 项目创建对话框
 *
 * 创建新的场景项目，支持声明式和编程式。
 */
import { useState, useCallback } from 'react'
import type React from 'react'
import { projectService } from '../../services'
import type { ScenarioType } from '../../types'
import { useI18n } from '@renderer/i18n'

interface ProjectCreateDialogProps {
  onClose: () => void
  onCreated: () => void
}

const ProjectCreateDialog: React.FC<ProjectCreateDialogProps> = ({ onClose, onCreated }) => {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [type, setType] = useState<ScenarioType>('declarative')
  const [version, setVersion] = useState('1.0.0')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const handleNameChange = useCallback((value: string) => {
    setName(value)
    // 自动生成 scenarioId
    const id = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50)
    setScenarioId(id)
  }, [])

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      setError(t('builder.project.name') + ' ' + t('builder.common.error').toLowerCase())
      return
    }
    if (!scenarioId.trim() || !/^[a-z][a-z0-9-]*$/.test(scenarioId)) {
      setError('Scenario ID ' + t('builder.common.error').toLowerCase())
      return
    }

    setCreating(true)
    setError('')
    try {
      const result = await projectService.createProject({
        name: name.trim(),
        scenarioId: scenarioId.trim(),
        type,
        version: version.trim() || '1.0.0',
        description: description.trim(),
        author: author.trim(),
        localPath: localPath.trim() || undefined,
      })

      if (!result.success) {
        setError(result.error || t('builder.createFailed'))
      } else {
        onCreated()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }, [name, scenarioId, type, version, description, author, localPath, t, onCreated])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-inverted/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md mx-4 rounded-2xl border border-border/50 bg-background/95 backdrop-blur-xl p-6 shadow-2xl shadow-black/20"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">{t('builder.create.title')}</h2>

        <div className="space-y-3">
          {/* 名称 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('builder.create.namePlaceholder')}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* 场景 ID */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.scenarioId')}</label>
            <input
              type="text"
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              placeholder={t('builder.create.scenarioIdPlaceholder')}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono"
            />
          </div>

          {/* 类型 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.type')}</label>
            <div className="flex gap-2">
              {(['declarative', 'programmatic'] as const).map((t_) => (
                <button
                  key={t_}
                  onClick={() => setType(t_)}
                  className={`flex-1 rounded border px-3 py-2 text-sm transition-colors ${
                    type === t_
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {t(`builder.type.${t_}`)}
                </button>
              ))}
            </div>
          </div>

          {/* 版本 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.version')}</label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('builder.create.descriptionPlaceholder')}
              rows={2}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* 作者 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.project.author')}</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t('builder.create.authorPlaceholder')}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* 路径 */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t('builder.create.pathLabel')}</label>
            <input
              type="text"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder={t('builder.create.pathPlaceholder')}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono"
            />
          </div>

          {/* 错误 */}
          {error && <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
        </div>

        {/* 按钮 */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            {t('builder.create.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded bg-accent px-4 py-2 text-sm text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            {creating ? t('builder.creating') : t('builder.create.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProjectCreateDialog
