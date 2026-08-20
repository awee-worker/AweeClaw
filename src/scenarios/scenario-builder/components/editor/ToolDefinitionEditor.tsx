/**
 * 工具定义编辑器（ToolDefinitionEditor）
 *
 * 可视化编辑场景项目的工具定义（ToolDefinition[]），支持：
 * - 表单模式：工具列表 + 工具基础信息 + 参数表树形编辑
 * - JSON 模式：直接编辑 JSON 文本，带格式化与语法校验
 * - 生成 TS 代码：把 tools.json 编译成 src/tools/index.ts
 * - 反向解析：从 src/tools/index.ts 加载已有工具定义（best-effort）
 *
 * 数据流：
 *   选中项目 → scenarioBuilderReadFile 读取 src/tools/tools.json
 *   → 表单/JSON 双向同步
 *   → scenarioBuilderWriteFile 写回 src/tools/tools.json
 *   → （可选）generateToolsTsCode 生成 src/tools/index.ts
 *
 * 设计要点：
 * - 字体 ≥ 12px，代码区使用 Menlo/Monaco 等宽字体
 * - 工具列表 + 工具详情左右两栏布局
 * - 切换模式/工具如有未保存改动则提示确认
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import type { ToolDefinition, ToolApprovalType } from '@shared/protocols/modelProtocol'
import { generateToolsTsCode, parseToolsFromTsCode } from './toolCodeGenerator'
import ToolParamEditor, { type ToolParameters } from './ToolParamEditor'
import {
  Save,
  Check,
  AlertTriangle,
  RefreshCw,
  Braces,
  FormInput,
  ChevronRight,
  Plus,
  Trash2,
  Wrench,
  FileJson,
  FolderOpen,
  Code2,
  ArrowRight,
} from 'lucide-react'

// ==========================================
// 类型定义
// ==========================================

type EditorMode = 'form' | 'json'

/** 空工具定义（添加新工具时使用） */
function emptyTool(): ToolDefinition {
  return {
    name: 'new_tool',
    description: '',
    approvalType: 'none',
    parameters: {
      type: 'object',
      properties: {},
    },
  }
}

/** 安全解析 JSON */
function safeParseJson(text: string): { value: ToolDefinition[] | null; error?: string } {
  try {
    const v = JSON.parse(text)
    if (!Array.isArray(v)) {
      return { value: null, error: 'Root must be an array' }
    }
    return { value: v as ToolDefinition[] }
  } catch (err) {
    return { value: null, error: (err as Error).message }
  }
}

/** 校验工具名是否合法（小写字母+数字+下划线，动词在前） */
function isValidToolName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name)
}

// ==========================================
// 字段输入组件（与 ScenarioConfigEditor 一致的样式）
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

const TOOLS_JSON_PATH = 'src/tools/tools.json'
const TOOLS_TS_PATH = 'src/tools/index.ts'

const ToolDefinitionEditor: React.FC = () => {
  const { t } = useI18n()
  const { project } = useSelectedProject()

  // 编辑模式
  const [mode, setMode] = useState<EditorMode>('form')

  // 工具列表（表单模式使用数组，JSON 模式使用字符串）
  const [tools, setTools] = useState<ToolDefinition[]>([])
  const [jsonText, setJsonText] = useState<string>('')

  // 当前选中的工具 index
  const [selectedIndex, setSelectedIndex] = useState<number>(0)

  // 加载 / 保存 / 校验状态
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [jsonError, setJsonError] = useState<string>('')
  // 改动标记
  const [dirty, setDirty] = useState(false)
  // 原始加载内容（用于 dirty 判定）
  const originalJsonRef = useRef<string>('')

  // ==========================================
  // 加载工具定义
  // ==========================================

  const loadTools = useCallback(async () => {
    if (!project) {
      setTools([])
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

      // 1. 优先读取 src/tools/tools.json
      const jsonResult = await electronAPI.scenarioBuilderReadFile({
        projectPath: project.localPath,
        relativePath: TOOLS_JSON_PATH,
      })

      if (jsonResult?.success && jsonResult.content) {
        // tools.json 存在且非空
        const parsed = safeParseJson(jsonResult.content)
        if (parsed.value) {
          setTools(parsed.value)
          const formatted = JSON.stringify(parsed.value, null, 2)
          setJsonText(formatted)
          originalJsonRef.current = formatted
          setJsonError('')
          setDirty(false)
          return
        }
        // JSON 解析失败：保留原文，让用户修复
        setTools([])
        setJsonText(jsonResult.content)
        originalJsonRef.current = jsonResult.content
        setJsonError(parsed.error || 'Invalid JSON')
        setDirty(false)
        return
      }

      // 2. tools.json 不存在，尝试从 src/tools/index.ts 反向解析
      const tsResult = await electronAPI.scenarioBuilderReadFile({
        projectPath: project.localPath,
        relativePath: TOOLS_TS_PATH,
      })

      if (tsResult?.success && tsResult.content) {
        const parsedTools = parseToolsFromTsCode(tsResult.content)
        if (parsedTools.length > 0) {
          setTools(parsedTools)
          const formatted = JSON.stringify(parsedTools, null, 2)
          setJsonText(formatted)
          originalJsonRef.current = formatted
          setJsonError('')
          setDirty(false)
          return
        }
      }

      // 3. 都不存在：初始化空数组
      setTools([])
      const empty = '[]'
      setJsonText(empty)
      originalJsonRef.current = empty
      setJsonError('')
      setDirty(false)
    } catch (err) {
      setError((err as Error).message || t('builder.tools.loadFailed'))
      setTools([])
      setJsonText('[]')
      originalJsonRef.current = '[]'
    } finally {
      setLoading(false)
    }
  }, [project, t])

  // 项目变化时自动加载
  useEffect(() => {
    void loadTools()
  }, [loadTools])

  // 清除成功提示
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
      if (dirty && !window.confirm(t('builder.tools.confirmDiscard'))) {
        return
      }
      if (nextMode === 'json') {
        // 表单 → JSON：序列化当前 tools
        const formatted = JSON.stringify(tools, null, 2)
        setJsonText(formatted)
        setJsonError('')
      } else {
        // JSON → 表单：解析当前 jsonText
        const parsed = safeParseJson(jsonText)
        if (!parsed.value) {
          setJsonError(parsed.error || 'Invalid JSON')
          return
        }
        setTools(parsed.value)
        setJsonError('')
      }
      setMode(nextMode)
      setDirty(false)
      originalJsonRef.current =
        nextMode === 'json' ? jsonText : JSON.stringify(tools, null, 2)
    },
    [mode, dirty, tools, jsonText, t],
  )

  // ==========================================
  // 工具操作（表单模式）
  // ==========================================

  /** 添加新工具 */
  const handleAddTool = useCallback(() => {
    // 生成唯一工具名
    let i = 1
    let name = `new_tool_${i}`
    while (tools.some((t) => t.name === name)) {
      i++
      name = `new_tool_${i}`
    }
    const newTool: ToolDefinition = { ...emptyTool(), name }
    const next = [...tools, newTool]
    setTools(next)
    setDirty(true)
    setSelectedIndex(next.length - 1)
  }, [tools])

  /** 删除工具 */
  const handleRemoveTool = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= tools.length) return
      if (!window.confirm(t('builder.tools.confirmRemove'))) return
      const next = tools.filter((_, i) => i !== idx)
      setTools(next)
      setDirty(true)
      // 调整选中 index
      if (selectedIndex >= next.length) {
        setSelectedIndex(Math.max(0, next.length - 1))
      }
    },
    [tools, selectedIndex, t],
  )

  /** 复制工具 */
  const handleDuplicateTool = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= tools.length) return
      const source = tools[idx]
      // 生成唯一工具名
      let i = 1
      let name = `${source.name}_copy_${i}`
      while (tools.some((t) => t.name === name)) {
        i++
        name = `${source.name}_copy_${i}`
      }
      const duplicated: ToolDefinition = {
        ...JSON.parse(JSON.stringify(source)),
        name,
        description: `${source.description} (copy)`,
      }
      const next = [...tools.slice(0, idx + 1), duplicated, ...tools.slice(idx + 1)]
      setTools(next)
      setDirty(true)
      setSelectedIndex(idx + 1)
    },
    [tools],
  )

  /** 更新工具字段 */
  const updateTool = useCallback(
    (idx: number, patch: Partial<ToolDefinition>) => {
      setTools((prev) => {
        const next = [...prev]
        next[idx] = { ...next[idx], ...patch }
        return next
      })
      setDirty(true)
    },
    [],
  )

  /** 更新工具参数表 */
  const updateParameters = useCallback(
    (idx: number, parameters: ToolParameters) => {
      updateTool(idx, { parameters })
    },
    [updateTool],
  )

  // ==========================================
  // JSON 模式更新
  // ==========================================

  const handleJsonChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonText(e.target.value)
    setDirty(true)
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
  // 保存
  // ==========================================

  const handleSave = useCallback(async () => {
    if (!project) return
    let textToSave: string
    if (mode === 'form') {
      // 表单模式：先校验所有工具
      const invalidTools = tools.filter((t) => !isValidToolName(t.name))
      if (invalidTools.length > 0) {
        setError(
          t('builder.tools.invalidName') + invalidTools.map((t) => t.name).join(', '),
        )
        return
      }
      textToSave = JSON.stringify(tools, null, 2)
    } else {
      // JSON 模式：先校验语法
      const parsed = safeParseJson(jsonText)
      if (!parsed.value) {
        setJsonError(parsed.error || 'Invalid JSON')
        setError(t('builder.tools.jsonInvalid') + (parsed.error || ''))
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
        relativePath: TOOLS_JSON_PATH,
        content: textToSave,
        createDirs: true,
      })
      if (!result?.success) {
        throw new Error(result?.error || 'Write failed')
      }
      originalJsonRef.current = textToSave
      setDirty(false)
      setSuccess(t('builder.tools.saved'))
    } catch (err) {
      setError((err as Error).message || t('builder.tools.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [project, mode, tools, jsonText, t])

  // ==========================================
  // 生成 TS 代码
  // ==========================================

  const handleGenerateTs = useCallback(async () => {
    if (!project) return
    // 优先使用当前编辑内容
    let currentTools: ToolDefinition[] = []
    if (mode === 'form') {
      const invalidTools = tools.filter((t) => !isValidToolName(t.name))
      if (invalidTools.length > 0) {
        setError(
          t('builder.tools.invalidName') + invalidTools.map((t) => t.name).join(', '),
        )
        return
      }
      currentTools = tools
    } else {
      const parsed = safeParseJson(jsonText)
      if (!parsed.value) {
        setJsonError(parsed.error || 'Invalid JSON')
        setError(t('builder.tools.jsonInvalid') + (parsed.error || ''))
        return
      }
      currentTools = parsed.value
    }

    setGenerating(true)
    setError('')
    setSuccess('')
    try {
      const code = generateToolsTsCode(currentTools)
      const electronAPI = (window as any).electronAPI
      if (!electronAPI?.scenarioBuilderWriteFile) {
        throw new Error('IPC scenarioBuilderWriteFile not available')
      }
      const result = await electronAPI.scenarioBuilderWriteFile({
        projectPath: project.localPath,
        relativePath: TOOLS_TS_PATH,
        content: code,
        createDirs: true,
      })
      if (!result?.success) {
        throw new Error(result?.error || 'Write failed')
      }
      setSuccess(t('builder.tools.tsGenerated'))
    } catch (err) {
      setError((err as Error).message || t('builder.tools.tsGenerateFailed'))
    } finally {
      setGenerating(false)
    }
  }, [project, mode, tools, jsonText, t])

  // ==========================================
  // 渲染辅助
  // ==========================================

  const canSave = useMemo(() => {
    if (!project || saving) return false
    if (mode === 'json' && jsonError) return false
    return dirty
  }, [project, saving, mode, jsonError, dirty])

  const currentTool = mode === 'form' && selectedIndex >= 0 && selectedIndex < tools.length
    ? tools[selectedIndex]
    : null

  // ==========================================
  // 渲染
  // ==========================================

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">{t('builder.tools.noProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ========== 顶部工具栏 ========== */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5 shrink-0 text-accent" />
            <h2 className="truncate text-[13px] font-medium">{t('builder.tools.title')}</h2>
            {tools.length > 0 && (
              <span className="ml-1 shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {tools.length}
              </span>
            )}
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
              {t('builder.tools.modeForm')}
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
              {t('builder.tools.modeJson')}
            </button>
          </div>
        </div>

        {/* 操作按钮行 */}
        <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[12px] text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:hover:bg-accent"
            title={t('builder.tools.action.save')}
          >
            <Save className="h-3 w-3" />
            {saving ? t('builder.tools.saving') : t('builder.tools.action.save')}
          </button>
          <button
            onClick={handleGenerateTs}
            disabled={generating || tools.length === 0}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted disabled:opacity-40"
            title={t('builder.tools.action.generateTs')}
          >
            <Code2 className="h-3 w-3" />
            {generating ? t('builder.tools.generating') : t('builder.tools.action.generateTs')}
          </button>
          <button
            onClick={loadTools}
            disabled={loading}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted disabled:opacity-40"
            title={t('builder.tools.action.reload')}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('builder.tools.action.reload')}
          </button>
          {mode === 'json' && (
            <button
              onClick={handleFormat}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted"
              title={t('builder.tools.action.format')}
            >
              <Braces className="h-3 w-3" />
              {t('builder.tools.action.format')}
            </button>
          )}
          {dirty && (
            <span className="ml-auto flex items-center gap-1 text-[12px] text-yellow-600">
              <AlertTriangle className="h-3 w-3" />
              {t('builder.tools.formChanged')}
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
          {jsonError && mode === 'json' && !error && (
            <div className="flex items-center gap-1.5 text-[12px] text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {t('builder.tools.jsonInvalid')}
                {jsonError}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ========== 主区域 ========== */}
      <div className="flex-1 overflow-hidden">
        {/* ---------- 表单模式 ---------- */}
        {mode === 'form' && (
          <div className="flex h-full">
            {/* 左栏：工具列表 */}
            <div className="flex w-56 shrink-0 flex-col border-r border-border">
              <div className="shrink-0 border-b border-border/60 px-2 py-1.5">
                <button
                  onClick={handleAddTool}
                  className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-border px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:border-accent/50 hover:text-accent"
                >
                  <Plus className="h-3 w-3" />
                  {t('builder.tools.addTool')}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {tools.length === 0 ? (
                  <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">
                    {t('builder.tools.empty')}
                  </p>
                ) : (
                  <ul>
                    {tools.map((tool, idx) => {
                      const active = idx === selectedIndex
                      return (
                        <li key={`${tool.name}-${idx}`}>
                          <button
                            onClick={() => setSelectedIndex(idx)}
                            className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-muted/50 ${
                              active ? 'bg-accent/5 border-l-2 border-accent' : 'border-l-2 border-transparent'
                            }`}
                          >
                            <Wrench
                              className={`h-3 w-3 shrink-0 ${active ? 'text-accent' : 'text-muted-foreground'}`}
                            />
                            <span
                              className={`min-w-0 flex-1 truncate font-mono text-[12px] ${
                                active ? 'text-accent' : 'text-foreground'
                              }`}
                            >
                              {tool.name}
                            </span>
                            <span className="shrink-0 rounded bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground">
                              {(tool.parameters.properties ? Object.keys(tool.parameters.properties) : []).length}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* 右栏：工具详情编辑 */}
            <div className="flex-1 overflow-y-auto">
              {currentTool ? (
                <div className="p-3">
                  {/* 工具详情头部 */}
                  <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-[13px] font-medium text-foreground">
                        {currentTool.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleDuplicateTool(selectedIndex)}
                        className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title={t('builder.tools.duplicate')}
                      >
                        {t('builder.tools.duplicate')}
                      </button>
                      <button
                        onClick={() => handleRemoveTool(selectedIndex)}
                        className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title={t('builder.tools.remove')}
                      >
                        <Trash2 className="h-3 w-3" />
                        {t('builder.tools.remove')}
                      </button>
                    </div>
                  </div>

                  {/* 基础信息 */}
                  <Field label={t('builder.tools.field.name')} hint={t('builder.tools.field.nameHint')}>
                    <TextInput
                      value={currentTool.name}
                      onChange={(e) => updateTool(selectedIndex, { name: e.target.value })}
                      invalid={!isValidToolName(currentTool.name)}
                      placeholder="my_tool"
                      className="font-mono"
                    />
                  </Field>

                  <Field label={t('builder.tools.field.description')} hint={t('builder.tools.field.descriptionHint')}>
                    <TextArea
                      rows={2}
                      value={currentTool.description}
                      onChange={(e) => updateTool(selectedIndex, { description: e.target.value })}
                      placeholder="Describe what this tool does (AI-readable)"
                    />
                  </Field>

                  <Field label={t('builder.tools.field.approvalType')} hint={t('builder.tools.field.approvalHint')}>
                    <select
                      value={currentTool.approvalType ?? 'none'}
                      onChange={(e) =>
                        updateTool(selectedIndex, { approvalType: e.target.value as ToolApprovalType })
                      }
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
                    >
                      <option value="none">{t('builder.tools.approval.none')}</option>
                      <option value="terminal">{t('builder.tools.approval.terminal')}</option>
                      <option value="dangerous">{t('builder.tools.approval.dangerous')}</option>
                      <option value="interaction">{t('builder.tools.approval.interaction')}</option>
                    </select>
                  </Field>

                  {/* 参数表 */}
                  <div className="mb-3 border-t border-border/60 pt-3">
                    <ToolParamEditor
                      parameters={currentTool.parameters as ToolParameters}
                      onChange={(next) => updateParameters(selectedIndex, next)}
                    />
                  </div>

                  {/* 工具 JSON 预览（只读） */}
                  <details className="mb-3 rounded border border-border/60 bg-muted/20">
                    <summary className="cursor-pointer px-3 py-1.5 text-[12px] font-medium text-muted-foreground">
                      {t('builder.tools.jsonPreview')}
                    </summary>
                    <pre className="overflow-x-auto px-3 pb-2 font-mono text-[11px] leading-relaxed text-foreground/80">
                      {JSON.stringify(currentTool, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                  <Wrench className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-[12px] text-muted-foreground">{t('builder.tools.emptyDetail')}</p>
                  <button
                    onClick={handleAddTool}
                    className="mt-2 flex items-center gap-1 rounded border border-accent/50 px-2.5 py-1 text-[12px] text-accent transition-colors hover:bg-accent/5"
                  >
                    <Plus className="h-3 w-3" />
                    {t('builder.tools.addTool')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------- JSON 模式 ---------- */}
        {mode === 'json' && (
          <textarea
            value={jsonText}
            onChange={handleJsonChange}
            spellCheck={false}
            className="h-full min-h-[400px] w-full resize-none border-0 bg-background p-3 font-mono text-[12px] leading-relaxed text-foreground outline-none"
            placeholder="[]"
          />
        )}
      </div>

      {/* ========== 底部说明栏 ========== */}
      <div className="shrink-0 border-t border-border/60 bg-muted/20 px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <FileJson className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {t('builder.tools.dataSource')}：<code className="font-mono">{TOOLS_JSON_PATH}</code>
          </span>
          <ArrowRight className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {t('builder.tools.generateTarget')}：<code className="font-mono">{TOOLS_TS_PATH}</code>
          </span>
        </div>
      </div>
    </div>
  )
}

export default ToolDefinitionEditor
