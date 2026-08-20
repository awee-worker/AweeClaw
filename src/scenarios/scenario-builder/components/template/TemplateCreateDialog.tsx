/**
 * 从模板创建项目对话框
 *
 * 用户点击模板卡片的"使用此模板"后弹出：
 * - 基础信息：项目名称 / 场景 ID / 版本 / 作者 / 描述（自动从模板变量填充默认值）
 * - 模板变量：根据 template.variables 动态生成的表单
 * - 项目路径：默认 workspace/scenarios/{scenarioId}
 *
 * 提交时调用 templateService.prepareScaffoldParams 准备骨架参数，
 * 再调用 projectService.createProjectFromTemplate 创建项目。
 *
 * 设计要点：
 * - 表单字段按"基础信息 / 模板变量"分组，提升可读性
 * - 项目名称自动生成 scenarioId（kebab-case）
 * - 必填变量带 * 标识，未填写时禁用提交按钮
 * - 创建中显示步骤进度（scaffold / config / extraFiles / overrideFiles / database）
 */
import { useState, useCallback, useMemo, useEffect } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { getLucideIcon } from '@components/foundation/IconMap'
import { X, Check, AlertCircle, Loader2 } from 'lucide-react'
import type { ScenarioTemplate, TemplateVariable } from '../../templates/types'
import { templateService } from '../../services'
import { projectService } from '../../services'
import type { CreateProjectResult } from '../../types'

interface TemplateCreateDialogProps {
  template: ScenarioTemplate
  onClose: () => void
  onCreated: (result: CreateProjectResult) => void
}

/** 步骤状态图标 */
function StepIcon({ status }: { status: 'success' | 'failed' | 'running' | 'pending' }) {
  if (status === 'success') return <Check className="h-3.5 w-3.5 text-emerald-500" />
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
  return <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
}

const TemplateCreateDialog: React.FC<TemplateCreateDialogProps> = ({
  template,
  onClose,
  onCreated,
}) => {
  const { t, language } = useI18n()
  const isZh = language === 'zh'
  const IconComponent = getLucideIcon(template.icon)

  // 基础信息
  const [name, setName] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [author, setAuthor] = useState('developer')
  const [description, setDescription] = useState('')
  const [localPath, setLocalPath] = useState('')

  // 模板变量值（key → value）
  const [variableValues, setVariableValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const v of template.variables ?? []) {
      if (v.defaultValue) initial[v.key] = v.defaultValue
    }
    return initial
  })

  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<Array<{ id: string; status: 'success' | 'failed' | 'running' | 'pending'; message: string }>>([])

  // 从模板变量初始化基础信息的默认值
  useEffect(() => {
    const nameVar = template.variables?.find((v) => v.key === 'name')
    if (nameVar?.defaultValue && !name) {
      setName(nameVar.defaultValue)
    }
    const descVar = template.variables?.find((v) => v.key === 'description')
    if (descVar?.defaultValue && !description) {
      setDescription(descVar.defaultValue)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template])

  // 名称变化时自动生成 scenarioId
  const handleNameChange = useCallback((value: string) => {
    setName(value)
    const id = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50)
    setScenarioId(id)
  }, [])

  const handleVariableChange = useCallback((key: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  // 必填变量校验
  const missingRequired = useMemo(() => {
    const missing: string[] = []
    for (const v of template.variables ?? []) {
      if (v.required) {
        const val = variableValues[v.key] ?? ''
        if (!val.trim()) {
          missing.push(isZh ? v.label : v.labelEn)
        }
      }
    }
    return missing
  }, [template.variables, variableValues, isZh])

  const canSubmit = name.trim() && scenarioId.trim() && /^[a-z][a-z0-9-]*$/.test(scenarioId) && missingRequired.length === 0 && !creating

  const handleCreate = useCallback(async () => {
    if (!canSubmit) return

    setCreating(true)
    setError(null)
    setSteps([{ id: 'start', status: 'running', message: '正在准备模板参数...' }])

    try {
      // 1. 通过 templateService 准备骨架参数（含变量解析）
      const workspacePath = (projectService as unknown as { context: { workspacePath: string } }).context?.workspacePath
      const finalLocalPath = localPath.trim() || (workspacePath ? `${workspacePath}/scenarios/${scenarioId}` : '')

      const prepareResult = templateService.prepareScaffoldParams({
        templateId: template.id,
        name: name.trim(),
        scenarioId: scenarioId.trim(),
        version: version.trim() || '1.0.0',
        author: author.trim() || 'developer',
        description: description.trim(),
        localPath: finalLocalPath,
        variableValues,
      })

      if (!prepareResult.success || !prepareResult.params) {
        setSteps(prepareResult.steps.map((s) => ({
          id: s.id,
          status: 'failed' as const,
          message: s.message,
        })))
        setError(prepareResult.error || '参数准备失败')
        setCreating(false)
        return
      }

      setSteps([
        { id: 'prepare', status: 'success', message: '模板参数已准备' },
        { id: 'scaffold', status: 'running', message: '正在创建项目骨架...' },
      ])

      // 2. 调用 projectService.createProjectFromTemplate
      // templateSteps 字段需要 'success' | 'failed' 状态（与 CreateProjectResult.steps 兼容）
      const templateStepsForProject = prepareResult.steps.map((s) => ({
        id: s.id,
        status: s.status as 'success' | 'failed',
        message: s.message,
      }))

      const result = await projectService.createProjectFromTemplate({
        name: name.trim(),
        scenarioId: scenarioId.trim(),
        type: template.type,
        version: version.trim() || '1.0.0',
        description: description.trim(),
        author: author.trim() || 'developer',
        localPath: finalLocalPath || undefined,
        configOverride: prepareResult.params.configOverride,
        extraFiles: prepareResult.params.extraFiles,
        overrideFiles: prepareResult.params.overrideFiles,
        templateSteps: templateStepsForProject,
      })

      // 映射 steps 到本地状态（CreateProjectResult.steps 的 status 包含 pending/running/success/failed）
      const mappedSteps: Array<{ id: string; status: 'success' | 'failed' | 'running' | 'pending'; message: string }> =
        result.steps.map((s) => ({
          id: s.id,
          status: s.status as 'success' | 'failed' | 'running' | 'pending',
          message: s.message,
        }))
      setSteps(mappedSteps)

      if (!result.success) {
        setError(result.error || '创建失败')
      } else {
        onCreated(result)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }, [canSubmit, template, name, scenarioId, version, author, description, localPath, variableValues, onCreated])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-inverted/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border/50 bg-background shadow-2xl shadow-black/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <IconComponent className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">
                {t('builder.template.createFromTemplate')}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isZh ? template.nameZh : template.name}
                <span className="mx-1 text-muted-foreground/40">·</span>
                <span className="font-mono">{template.id}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label={t('builder.common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* 基础信息 */}
          <section className="mb-4">
            <h3 className="mb-3 text-sm font-medium">
              {t('builder.template.basicInfo')}
            </h3>
            <div className="space-y-3">
              {/* 名称 */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {t('builder.project.name')} <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder={t('builder.create.namePlaceholder')}
                  disabled={creating}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
                />
              </div>

              {/* 场景 ID */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {t('builder.project.scenarioId')} <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={scenarioId}
                  onChange={(e) => setScenarioId(e.target.value)}
                  placeholder={t('builder.create.scenarioIdPlaceholder')}
                  disabled={creating}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50"
                />
                {scenarioId && !/^[a-z][a-z0-9-]*$/.test(scenarioId) && (
                  <p className="mt-1 text-xs text-destructive">
                    {t('builder.create.scenarioIdInvalid')}
                  </p>
                )}
              </div>

              {/* 版本 + 作者 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t('builder.project.version')}
                  </label>
                  <input
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                    disabled={creating}
                    className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t('builder.project.author')}
                  </label>
                  <input
                    type="text"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder={t('builder.create.authorPlaceholder')}
                    disabled={creating}
                    className="w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
                  />
                </div>
              </div>

              {/* 描述 */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {t('builder.project.description')}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('builder.create.descriptionPlaceholder')}
                  rows={2}
                  disabled={creating}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
                />
              </div>

              {/* 路径 */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {t('builder.create.pathLabel')}
                </label>
                <input
                  type="text"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder={t('builder.create.pathPlaceholder')}
                  disabled={creating}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50"
                />
              </div>
            </div>
          </section>

          {/* 模板变量 */}
          {template.variables && template.variables.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-3 text-sm font-medium">
                {t('builder.template.variables')}
                <span className="ml-2 text-xs text-muted-foreground">
                  {t('builder.template.variablesHint')}
                </span>
              </h3>
              <div className="space-y-3">
                {template.variables.map((v: TemplateVariable) => (
                  <div key={v.key}>
                    <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <span>{isZh ? v.label : v.labelEn}</span>
                      {v.required && <span className="text-destructive">*</span>}
                      <span className="font-mono text-muted-foreground/60">{`{{${v.key}}}`}</span>
                    </label>
                    <input
                      type="text"
                      value={variableValues[v.key] ?? ''}
                      onChange={(e) => handleVariableChange(v.key, e.target.value)}
                      placeholder={v.placeholder}
                      disabled={creating}
                      className="w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 步骤进度 */}
          {steps.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                {t('builder.template.createSteps')}
              </h3>
              <ul className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
                {steps.map((s, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-xs">
                    <StepIcon status={s.status} />
                    <span className="font-mono text-muted-foreground">{s.id}</span>
                    <span className="text-foreground/80">{s.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 错误 */}
          {error && (
            <div className="mb-4 rounded bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* 必填提示 */}
          {missingRequired.length > 0 && !creating && (
            <div className="mb-4 rounded bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
              {t('builder.template.missingRequired')}: {missingRequired.join(', ')}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {t('builder.common.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            {creating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('builder.creating')}
              </>
            ) : (
              t('builder.create.confirm')
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TemplateCreateDialog
