/**
 * 场景配置编辑器（ScenarioConfigEditor）
 *
 * 可视化编辑 scenario.json，支持两种模式互转：
 * - 表单模式：按字段分组（基础 / 权限 / 依赖 / 身份 / 能力 / 数据库）的可视化表单
 * - JSON 模式：直接编辑 JSON 文本，带格式化与语法校验
 *
 * 数据流：
 *   选中项目 → scenarioBuilderReadFile 读取 scenario.json
 *   → 表单/JSON 双向同步
 *   → scenarioBuilderWriteFile 写回项目目录
 *
 * 设计要点：
 * - 单列布局适配侧边栏（minWidth 170，maxWidth 600）
 * - 字段分组折叠，避免长表单一屏装不下
 * - 字体均 ≥ 12px，代码区使用 Menlo/Monaco 等宽字体
 * - 切换模式如有未保存改动则提示确认，避免数据丢失
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import { IconPicker, MultiSelectPicker } from './Pickers'
import {
  SCENARIO_CATEGORY_OPTIONS,
  SCENARIO_PERMISSION_OPTIONS,
  BUILTIN_TOOL_OPTIONS,
} from '../../config/scenarioOptionCatalog'
import {
  Save,
  Check,
  AlertTriangle,
  RefreshCw,
  Braces,
  FormInput,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  FileJson,
  FolderOpen,
} from 'lucide-react'

// ==========================================
// 类型定义
// ==========================================

/** scenario.json 的运行时形态（部分字段可选） */
interface ScenarioConfig {
  id?: string
  version?: string
  name?: string
  nameZh?: string
  description?: string
  descriptionZh?: string
  author?: string
  icon?: string
  category?: string
  type?: 'declarative' | 'programmatic'
  tags?: string[]
  permissions?: string[]
  dependencies?: Array<{ scenarioId: string; version: string }>
  identity?: {
    systemPrompt?: string
    securityRules?: string
    conventions?: string
    workflow?: string
  }
  capabilities?: {
    builtinTools?: string[]
  }
  database?: {
    installScript?: string
    uninstallScript?: string
    installScriptFiles?: string[]
    uninstallScriptFiles?: string[]
  }
  [key: string]: unknown
}

type EditorMode = 'form' | 'json'

// ==========================================
// 工具函数
// ==========================================

/** 安全解析 JSON，失败返回 null */
function safeParseJson(text: string): { value: ScenarioConfig | null; error?: string } {
  try {
    const v = JSON.parse(text)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      return { value: null, error: 'Root must be an object' }
    }
    return { value: v as ScenarioConfig }
  } catch (err) {
    return { value: null, error: (err as Error).message }
  }
}

/** 将数组以逗号分隔字符串形式呈现（用于表单输入） */
function arrayToCsv(arr?: string[]): string {
  return Array.isArray(arr) ? arr.join(', ') : ''
}

/** 将逗号分隔字符串解析为数组（自动 trim、去空、去重） */
function csvToArray(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** 空配置（首次创建时使用） */
function emptyConfig(): ScenarioConfig {
  return {
    id: '',
    version: '1.0.0',
    name: '',
    nameZh: '',
    description: '',
    descriptionZh: '',
    author: '',
    icon: 'Package',
    category: 'general',
    type: 'declarative',
    tags: [],
    permissions: [],
    dependencies: [],
    identity: { systemPrompt: '', securityRules: '', conventions: '', workflow: '' },
    capabilities: { builtinTools: [] },
    database: { installScript: '', uninstallScript: '' },
  }
}

// ==========================================
// Section 折叠组件
// ==========================================

interface SectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

const Section: React.FC<SectionProps> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="text-[12px] font-medium text-foreground">{title}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  )
}

// ==========================================
// 字段输入组件
// ==========================================

interface FieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

const Field: React.FC<FieldProps> = ({ label, hint, children }) => (
  <div className="mb-3">
    <label className="mb-1 block text-[12px] font-medium text-foreground/80">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[12px] text-muted-foreground/70">{hint}</p>}
  </div>
)

/** 文本输入框（统一样式） */
const TextInput: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
> = ({ className = '', invalid, ...props }) => (
  <input
    {...props}
    className={`w-full rounded border bg-background px-2 py-1.5 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-accent/30 ${
      invalid ? 'border-destructive/60 focus:border-destructive' : 'border-border focus:border-accent/50'
    } ${className}`}
  />
)

/** 文本域（统一样式） */
const TextArea: React.FC<
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
> = ({ className = '', invalid, ...props }) => (
  <textarea
    {...props}
    className={`w-full resize-y rounded border bg-background px-2 py-1.5 font-mono text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-accent/30 ${
      invalid ? 'border-destructive/60 focus:border-destructive' : 'border-border focus:border-accent/50'
    } ${className}`}
  />
)

// ==========================================
// 主组件
// ==========================================

const ScenarioConfigEditor: React.FC = () => {
  const { t } = useI18n()
  const { project } = useSelectedProject()

  // 编辑模式
  const [mode, setMode] = useState<EditorMode>('form')

  // 配置数据（表单模式使用对象，JSON 模式使用字符串）
  const [config, setConfig] = useState<ScenarioConfig>(emptyConfig())
  const [jsonText, setJsonText] = useState<string>('')

  // 加载 / 保存 / 校验状态
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [jsonError, setJsonError] = useState<string>('')
  // 改动标记（区分原始加载内容与当前内容）
  const [dirty, setDirty] = useState(false)
  // 原始加载内容（用于 dirty 判定）
  const originalJsonRef = useRef<string>('')

  // ==========================================
  // 加载配置
  // ==========================================

  const loadConfig = useCallback(async () => {
    if (!project) {
      setConfig(emptyConfig())
      setJsonText('')
      originalJsonRef.current = ''
      setDirty(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const electronAPI = (window as any).electronAPI
      if (!electronAPI?.scenarioBuilderReadFile) {
        throw new Error('IPC scenarioBuilderReadFile not available')
      }
      const result = await electronAPI.scenarioBuilderReadFile({
        projectPath: project.localPath,
        relativePath: 'scenario.json',
      })
      if (!result?.success) {
        throw new Error(result?.error || 'Read failed')
      }
      const text: string = result.content ?? ''
      const parsed = safeParseJson(text)
      if (!parsed.value) {
        // 文件内容不是合法 JSON，初始化为空配置，但保留原文便于用户修复
        setConfig(emptyConfig())
        setJsonText(text)
        originalJsonRef.current = text
        setJsonError(parsed.error || 'Invalid JSON')
        setDirty(false)
        return
      }
      setConfig(parsed.value)
      const formatted = JSON.stringify(parsed.value, null, 2)
      setJsonText(formatted)
      originalJsonRef.current = formatted
      setJsonError('')
      setDirty(false)
    } catch (err) {
      setError((err as Error).message || t('builder.editor.loadFailed'))
      setConfig(emptyConfig())
      setJsonText('')
      originalJsonRef.current = ''
    } finally {
      setLoading(false)
    }
  }, [project, t])

  // 项目变化时自动加载
  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  // 清除成功提示（3 秒后）
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [success])

  // ==========================================
  // 模式切换
  // ==========================================

  const handleModeChange = useCallback(
    (nextMode: EditorMode) => {
      if (nextMode === mode) return
      // 切换前如有改动，提示确认
      if (dirty && !window.confirm(t('builder.editor.confirmDiscard'))) {
        return
      }
      if (nextMode === 'json') {
        // 表单 → JSON：将当前 config 序列化
        setJsonText(JSON.stringify(config, null, 2))
        setJsonError('')
      } else {
        // JSON → 表单：尝试解析当前 jsonText
        const parsed = safeParseJson(jsonText)
        if (!parsed.value) {
          setJsonError(parsed.error || 'Invalid JSON')
          return
        }
        setConfig(parsed.value)
        setJsonError('')
      }
      setMode(nextMode)
      setDirty(false)
      originalJsonRef.current = nextMode === 'json' ? jsonText : JSON.stringify(config, null, 2)
    },
    [mode, dirty, config, jsonText, t],
  )

  // ==========================================
  // 表单字段更新
  // ==========================================

  const updateField = useCallback(<K extends keyof ScenarioConfig>(key: K, value: ScenarioConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }, [])

  const updateIdentity = useCallback((key: keyof NonNullable<ScenarioConfig['identity']>, value: string) => {
    setConfig((prev) => ({
      ...prev,
      identity: { ...(prev.identity ?? {}), [key]: value },
    }))
    setDirty(true)
  }, [])

  const updateCapabilities = useCallback(
    (key: keyof NonNullable<ScenarioConfig['capabilities']>, value: string[]) => {
      setConfig((prev) => ({
        ...prev,
        capabilities: { ...(prev.capabilities ?? {}), [key]: value },
      }))
      setDirty(true)
    },
    [],
  )

  const updateDatabase = useCallback(
    (key: keyof NonNullable<ScenarioConfig['database']>, value: string | string[]) => {
      setConfig((prev) => ({
        ...prev,
        database: { ...(prev.database ?? {}), [key]: value },
      }))
      setDirty(true)
    },
    [],
  )

  // 依赖项操作
  const addDependency = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      dependencies: [...(prev.dependencies ?? []), { scenarioId: '', version: '>=1.0.0' }],
    }))
    setDirty(true)
  }, [])

  const updateDependency = useCallback((idx: number, key: 'scenarioId' | 'version', value: string) => {
    setConfig((prev) => {
      const deps = [...(prev.dependencies ?? [])]
      deps[idx] = { ...deps[idx], [key]: value }
      return { ...prev, dependencies: deps }
    })
    setDirty(true)
  }, [])

  const removeDependency = useCallback((idx: number) => {
    setConfig((prev) => {
      const deps = [...(prev.dependencies ?? [])]
      deps.splice(idx, 1)
      return { ...prev, dependencies: deps }
    })
    setDirty(true)
  }, [])

  // ==========================================
  // JSON 模式更新
  // ==========================================

  const handleJsonChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonText(e.target.value)
    setDirty(true)
    // 实时校验语法
    if (!e.target.value.trim()) {
      setJsonError('')
      return
    }
    const parsed = safeParseJson(e.target.value)
    setJsonError(parsed.error ?? '')
  }, [])

  /** 格式化 JSON */
  const handleFormat = useCallback(() => {
    const parsed = safeParseJson(jsonText)
    if (!parsed.value) {
      setJsonError(parsed.error || 'Invalid JSON')
      return
    }
    const formatted = JSON.stringify(parsed.value, null, 2)
    setJsonText(formatted)
    setJsonError('')
    setDirty(formatted !== originalJsonRef.current)
  }, [jsonText])

  // ==========================================
  // 保存配置
  // ==========================================

  const handleSave = useCallback(async () => {
    if (!project) return
    // 收集最终要保存的内容
    let textToSave: string
    if (mode === 'form') {
      textToSave = JSON.stringify(config, null, 2)
    } else {
      // JSON 模式：先校验语法
      const parsed = safeParseJson(jsonText)
      if (!parsed.value) {
        setJsonError(parsed.error || 'Invalid JSON')
        setError(t('builder.editor.jsonInvalid') + (parsed.error || ''))
        return
      }
      textToSave = JSON.stringify(parsed.value, null, 2)
    }

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const electronAPI = (window as any).electronAPI
      if (!electronAPI?.scenarioBuilderWriteFile) {
        throw new Error('IPC scenarioBuilderWriteFile not available')
      }
      const result = await electronAPI.scenarioBuilderWriteFile({
        projectPath: project.localPath,
        relativePath: 'scenario.json',
        content: textToSave,
        createDirs: false,
      })
      if (!result?.success) {
        throw new Error(result?.error || 'Write failed')
      }
      originalJsonRef.current = textToSave
      setDirty(false)
      setSuccess(t('builder.editor.saved'))
    } catch (err) {
      setError((err as Error).message || t('builder.editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [project, mode, config, jsonText, t])

  // ==========================================
  // 校验
  // ==========================================

  const handleValidate = useCallback(async () => {
    if (!project) return
    setError('')
    setSuccess('')
    try {
      const electronAPI = (window as any).electronAPI
      if (!electronAPI?.scenarioBuilderValidate) {
        throw new Error('IPC scenarioBuilderValidate not available')
      }
      const result = await electronAPI.scenarioBuilderValidate({
        projectPath: project.localPath,
      })
      if (result?.success && result.valid) {
        setSuccess(t('builder.editor.validateSuccess'))
      } else {
        setError(result?.error || t('builder.editor.validateFailed'))
      }
    } catch (err) {
      setError((err as Error).message || t('builder.editor.validateFailed'))
    }
  }, [project, t])

  // ==========================================
  // 渲染辅助
  // ==========================================

  const canSave = useMemo(() => {
    if (!project || saving) return false
    if (mode === 'json' && jsonError) return false
    return dirty
  }, [project, saving, mode, jsonError, dirty])

  // ==========================================
  // 渲染
  // ==========================================

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">{t('builder.editor.noProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ========== 顶部工具栏 ========== */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <FileJson className="h-3.5 w-3.5 shrink-0 text-accent" />
            <h2 className="truncate text-[13px] font-medium">{t('builder.editor.title')}</h2>
          </div>
          {/* 模式切换 Tab */}
          <div className="flex shrink-0 items-center rounded border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => handleModeChange('form')}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[12px] transition-colors ${
                mode === 'form'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FormInput className="h-3 w-3" />
              {t('builder.editor.modeForm')}
            </button>
            <button
              onClick={() => handleModeChange('json')}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[12px] transition-colors ${
                mode === 'json'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Braces className="h-3 w-3" />
              {t('builder.editor.modeJson')}
            </button>
          </div>
        </div>

        {/* 操作按钮行 */}
        <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[12px] text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:hover:bg-accent"
            title={t('builder.editor.action.save')}
          >
            <Save className="h-3 w-3" />
            {saving ? t('builder.editor.saving') : t('builder.editor.action.save')}
          </button>
          <button
            onClick={handleValidate}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted"
            title={t('builder.editor.action.validate')}
          >
            <Check className="h-3 w-3" />
            {t('builder.editor.action.validate')}
          </button>
          <button
            onClick={loadConfig}
            disabled={loading}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted disabled:opacity-40"
            title={t('builder.editor.action.reload')}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('builder.editor.action.reload')}
          </button>
          {mode === 'json' && (
            <button
              onClick={handleFormat}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted"
              title={t('builder.editor.action.format')}
            >
              <Braces className="h-3 w-3" />
              {t('builder.editor.action.format')}
            </button>
          )}
          {dirty && (
            <span className="ml-auto flex items-center gap-1 text-[12px] text-yellow-600">
              <AlertTriangle className="h-3 w-3" />
              {t('builder.editor.formChanged')}
            </span>
          )}
        </div>
      </div>

      {/* ========== 状态提示 ========== */}
      {(error || success || jsonError) && (
        <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
          {error && (
            <div className="flex items-center gap-1.5 text-[12px] text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}
          {success && !error && (
            <div className="flex items-center gap-1.5 text-[12px] text-emerald-600">
              <Check className="h-3 w-3 shrink-0" />
              <span className="truncate">{success}</span>
            </div>
          )}
          {jsonError && mode === 'json' && (
            <div className="flex items-center gap-1.5 text-[12px] text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {t('builder.editor.jsonInvalid')}
                {jsonError}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ========== 主区域 ========== */}
      <div className="flex-1 overflow-y-auto">
        {/* ---------- 表单模式 ---------- */}
        {mode === 'form' && (
          <div>
            {/* 基础信息 */}
            <Section title={t('builder.editor.section.basic')}>
              <Field label={t('builder.editor.field.id')}>
                <TextInput
                  value={config.id ?? ''}
                  onChange={(e) => updateField('id', e.target.value)}
                  placeholder="my-scenario"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('builder.editor.field.version')}>
                  <TextInput
                    value={config.version ?? ''}
                    onChange={(e) => updateField('version', e.target.value)}
                    placeholder="1.0.0"
                  />
                </Field>
                <Field label={t('builder.editor.field.type')}>
                  <select
                    value={config.type ?? 'declarative'}
                    onChange={(e) => updateField('type', e.target.value as 'declarative' | 'programmatic')}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
                  >
                    <option value="declarative">declarative</option>
                    <option value="programmatic">programmatic</option>
                  </select>
                </Field>
              </div>
              <Field label={t('builder.editor.field.name')}>
                <TextInput
                  value={config.name ?? ''}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="My Scenario"
                />
              </Field>
              <Field label={t('builder.editor.field.nameZh')}>
                <TextInput
                  value={config.nameZh ?? ''}
                  onChange={(e) => updateField('nameZh', e.target.value)}
                  placeholder="我的场景"
                />
              </Field>
              <Field label={t('builder.editor.field.description')}>
                <TextArea
                  rows={2}
                  value={config.description ?? ''}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="Description in English"
                />
              </Field>
              <Field label={t('builder.editor.field.descriptionZh')}>
                <TextArea
                  rows={2}
                  value={config.descriptionZh ?? ''}
                  onChange={(e) => updateField('descriptionZh', e.target.value)}
                  placeholder="中文描述"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('builder.editor.field.author')}>
                  <TextInput
                    value={config.author ?? ''}
                    onChange={(e) => updateField('author', e.target.value)}
                    placeholder="developer"
                  />
                </Field>
                <Field label={t('builder.editor.field.icon')} hint={t('builder.editor.field.iconHint')}>
                  <IconPicker
                    value={config.icon ?? ''}
                    onChange={(v) => updateField('icon', v)}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('builder.editor.field.category')} hint={t('builder.editor.field.categoryHint')}>
                  <select
                    value={config.category ?? 'custom'}
                    onChange={(e) => updateField('category', e.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
                  >
                    {SCENARIO_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.labelKey)} ({opt.value})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('builder.editor.field.tags')} hint={t('builder.editor.field.tagsHint')}>
                  <TextInput
                    value={arrayToCsv(config.tags)}
                    onChange={(e) => updateField('tags', csvToArray(e.target.value))}
                    placeholder="demo, dev"
                  />
                </Field>
              </div>
            </Section>

            {/* 权限 */}
            <Section title={t('builder.editor.section.permissions')} defaultOpen={false}>
              <Field
                label={t('builder.editor.field.permissions')}
                hint={t('builder.editor.field.permissionsHint')}
              >
                <MultiSelectPicker
                  options={SCENARIO_PERMISSION_OPTIONS}
                  value={config.permissions ?? []}
                  onChange={(v) => updateField('permissions', v)}
                  placeholder={t('builder.editor.field.permissionsPlaceholder')}
                />
              </Field>
            </Section>

            {/* 依赖 */}
            <Section title={t('builder.editor.section.dependencies')} defaultOpen={false}>
              <div className="space-y-2">
                {(config.dependencies ?? []).map((dep, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <TextInput
                      value={dep.scenarioId}
                      onChange={(e) => updateDependency(idx, 'scenarioId', e.target.value)}
                      placeholder={t('builder.editor.field.dependencyId')}
                      className="flex-1"
                    />
                    <TextInput
                      value={dep.version}
                      onChange={(e) => updateDependency(idx, 'version', e.target.value)}
                      placeholder=">=1.0.0"
                      className="w-24"
                    />
                    <button
                      onClick={() => removeDependency(idx)}
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      title={t('builder.editor.field.removeDependency')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addDependency}
                  className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:border-accent/50 hover:text-accent"
                >
                  <Plus className="h-3 w-3" />
                  {t('builder.editor.field.addDependency')}
                </button>
              </div>
            </Section>

            {/* 身份与提示词 */}
            <Section title={t('builder.editor.section.identity')} defaultOpen={false}>
              <Field label={t('builder.editor.field.systemPrompt')}>
                <TextArea
                  rows={4}
                  value={config.identity?.systemPrompt ?? ''}
                  onChange={(e) => updateIdentity('systemPrompt', e.target.value)}
                  placeholder="你是一个专业的助手..."
                />
              </Field>
              <Field label={t('builder.editor.field.securityRules')}>
                <TextArea
                  rows={3}
                  value={config.identity?.securityRules ?? ''}
                  onChange={(e) => updateIdentity('securityRules', e.target.value)}
                  placeholder="不要执行危险操作..."
                />
              </Field>
              <Field label={t('builder.editor.field.conventions')}>
                <TextArea
                  rows={3}
                  value={config.identity?.conventions ?? ''}
                  onChange={(e) => updateIdentity('conventions', e.target.value)}
                  placeholder="使用专业语言..."
                />
              </Field>
              <Field label={t('builder.editor.field.workflow')}>
                <TextArea
                  rows={3}
                  value={config.identity?.workflow ?? ''}
                  onChange={(e) => updateIdentity('workflow', e.target.value)}
                  placeholder="1. 分析需求\n2. 执行任务"
                />
              </Field>
            </Section>

            {/* 能力配置 */}
            <Section title={t('builder.editor.section.capabilities')} defaultOpen={false}>
              <Field
                label={t('builder.editor.field.builtinTools')}
                hint={t('builder.editor.field.builtinToolsHint')}
              >
                <MultiSelectPicker
                  options={BUILTIN_TOOL_OPTIONS}
                  value={config.capabilities?.builtinTools ?? []}
                  onChange={(v) => updateCapabilities('builtinTools', v)}
                  placeholder={t('builder.editor.field.builtinToolsPlaceholder')}
                />
              </Field>
            </Section>

            {/* 数据库脚本 */}
            <Section title={t('builder.editor.section.database')} defaultOpen={false}>
              <Field label={t('builder.editor.field.installScript')}>
                <TextArea
                  rows={3}
                  value={config.database?.installScript ?? ''}
                  onChange={(e) => updateDatabase('installScript', e.target.value)}
                  placeholder="CREATE TABLE IF NOT EXISTS items (...);"
                />
              </Field>
              <Field label={t('builder.editor.field.uninstallScript')}>
                <TextArea
                  rows={3}
                  value={config.database?.uninstallScript ?? ''}
                  onChange={(e) => updateDatabase('uninstallScript', e.target.value)}
                  placeholder="DROP TABLE IF EXISTS items;"
                />
              </Field>
              <Field label={t('builder.editor.field.installScriptFiles')}>
                <TextInput
                  value={arrayToCsv(config.database?.installScriptFiles)}
                  onChange={(e) => updateDatabase('installScriptFiles', csvToArray(e.target.value))}
                  placeholder="db/install.sql"
                />
              </Field>
              <Field label={t('builder.editor.field.uninstallScriptFiles')}>
                <TextInput
                  value={arrayToCsv(config.database?.uninstallScriptFiles)}
                  onChange={(e) => updateDatabase('uninstallScriptFiles', csvToArray(e.target.value))}
                  placeholder="db/uninstall.sql"
                />
              </Field>
            </Section>
          </div>
        )}

        {/* ---------- JSON 模式 ---------- */}
        {mode === 'json' && (
          <textarea
            value={jsonText}
            onChange={handleJsonChange}
            spellCheck={false}
            className="h-full min-h-[400px] w-full resize-none border-0 bg-background p-3 font-mono text-[12px] leading-relaxed text-foreground outline-none"
            placeholder="{}"
          />
        )}
      </div>
    </div>
  )
}

export default ScenarioConfigEditor
