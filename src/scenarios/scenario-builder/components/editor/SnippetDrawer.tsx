/**
 * 代码片段抽屉（SnippetDrawer）
 *
 * 独立组件，由 FileEditorShell 调起：
 *  - 内置左侧分类列表 + 右侧详情面板的 split 布局
 *  - 详情面板包含：代码预览（带语法提示）+ 变量填写 + 目标文件选择 + 插入按钮
 *  - 三种插入模式：insert_at_cursor（插入到光标）/ append_file（追加到末尾）/ replace_file（替换整个文件）
 *
 * 数据流：
 *   用户选择片段 → 填写变量 → resolveSnippet 替换 → onInsert 回调把最终代码交给 FileEditorShell
 *
 * 设计要点：
 *  - 字体 ≥ 12px（遵守 UI 规则）
 *  - 抽屉从右侧滑出，宽度 540px，桌面优先
 *  - 全屏遮罩点击关闭
 *  - 不依赖具体 IPC，由父组件实现 onInsert（保持纯 UI）
 */
import { useState, useMemo, useEffect, useCallback } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import {
  listSnippetMetas,
  getSnippetById,
  resolveSnippet,
  SNIPPET_CATEGORIES,
} from '../../snippets'
import type { SnippetMeta, SnippetCategory } from '../../snippets/types'
import {
  X,
  Search,
  Code2,
  Wrench,
  CheckSquare,
  ShieldAlert,
  Server,
  Power,
  PowerOff,
  HeartPulse,
  Layers,
  Database,
  ShieldCheck,
  Link2,
  Trash2,
  Sprout,
  Type,
  Hash,
  List,
  Box,
  Play,
  Bug,
  ListChecks,
  Factory,
  Layout,
  Plug,
  Package,
  ChevronRight,
} from 'lucide-react'

// ==========================================
// Props
// ==========================================

export type InsertMode = 'insert_at_cursor' | 'append_file' | 'replace_file'

export interface SnippetInsertPayload {
  /** 替换变量后的最终代码 */
  code: string
  /** 用户选择的目标文件相对路径（覆盖片段默认） */
  targetFile: string
  /** 插入模式 */
  mode: InsertMode
  /** 片段 ID（用于日志/反馈） */
  snippetId: string
}

interface SnippetDrawerProps {
  /** 是否打开 */
  open: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 当前编辑中的文件路径（用于"插入到光标"提示用户当前上下文） */
  currentFilePath?: string
  /** 插入回调（由 FileEditorShell 实现具体 IPC 写入与光标定位） */
  onInsert: (payload: SnippetInsertPayload) => void
}

// ==========================================
// 图标映射
// ==========================================

const CATEGORY_ICON_MAP: Record<SnippetCategory, React.ComponentType<{ className?: string }>> = {
  tool: Wrench,
  validation: CheckSquare,
  error: ShieldAlert,
  service: Server,
  lifecycle: Power,
  database: Database,
  ui: Layout,
  ipc: Plug,
  misc: Package,
}

const SNIPPET_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Wrench,
  Play,
  Database,
  Type,
  Hash,
  List,
  Box,
  ShieldAlert,
  Bug,
  ListChecks,
  Server,
  Factory,
  Power,
  PowerOff,
  HeartPulse,
  Layers,
  ShieldCheck,
  Link2,
  Trash2,
  Sprout,
  Layout,
  Plug,
  Package,
  Code2,
}

function getSnippetIcon(iconName: string): React.ComponentType<{ className?: string }> {
  return SNIPPET_ICON_MAP[iconName] || Code2
}

const DIFFICULTY_STYLE: Record<SnippetMeta['difficulty'], { badge: string; labelKey: string }> = {
  beginner: { badge: 'bg-emerald-500/10 text-emerald-600', labelKey: 'builder.snippet.difficulty.beginner' },
  intermediate: { badge: 'bg-sky-500/10 text-sky-600', labelKey: 'builder.snippet.difficulty.intermediate' },
  advanced: { badge: 'bg-pink-500/10 text-pink-600', labelKey: 'builder.snippet.difficulty.advanced' },
}

// ==========================================
// 主组件
// ==========================================

const SnippetDrawer: React.FC<SnippetDrawerProps> = ({
  open,
  onClose,
  currentFilePath,
  onInsert,
}) => {
  const { t, language } = useI18n()
  const isZh = language === 'zh'

  // 状态：搜索关键字、分类筛选、选中片段、变量值、目标文件、插入模式
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<SnippetCategory | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [targetFile, setTargetFile] = useState<string>('')
  const [mode, setMode] = useState<InsertMode>('insert_at_cursor')
  const [error, setError] = useState<string>('')

  // 抽屉关闭时清理状态
  useEffect(() => {
    if (!open) {
      setSearch('')
      setCategory('all')
      setSelectedId(null)
      setVariables({})
      setTargetFile('')
      setMode('insert_at_cursor')
      setError('')
    }
  }, [open])

  // ESC 键关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // 选中片段时，初始化变量值（用默认值）和目标文件
  const selectedSnippet = useMemo(() => {
    if (!selectedId) return null
    return getSnippetById(selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!selectedSnippet) {
      setVariables({})
      setTargetFile('')
      return
    }
    // 初始化变量为默认值
    const initVars: Record<string, string> = {}
    for (const v of selectedSnippet.variables) {
      initVars[v.name] = v.defaultValue
    }
    setVariables(initVars)
    setTargetFile(selectedSnippet.targetFile || currentFilePath || '')
    setError('')
  }, [selectedSnippet, currentFilePath])

  // 过滤后的片段列表
  const filteredMetas = useMemo(() => {
    const metas = listSnippetMetas({
      category: category === 'all' ? undefined : category,
    })
    if (!search.trim()) return metas
    const q = search.toLowerCase().trim()
    return metas.filter((m) => {
      const haystack = [
        m.name,
        m.nameZh,
        m.description,
        m.descriptionZh,
        m.id,
        m.targetFile ?? '',
        ...m.tags,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [category, search])

  // 预览代码（用当前变量值替换）
  const previewCode = useMemo(() => {
    if (!selectedSnippet) return ''
    const resolved = resolveSnippet(selectedSnippet, variables)
    return resolved.success && resolved.code ? resolved.code : selectedSnippet.code
  }, [selectedSnippet, variables])

  // 处理变量值变更
  const handleVarChange = useCallback((name: string, value: string) => {
    setVariables((prev) => ({ ...prev, [name]: value }))
  }, [])

  // 插入
  const handleInsert = useCallback(() => {
    if (!selectedSnippet) return
    setError('')

    // 校验必填变量
    const missing: string[] = []
    for (const v of selectedSnippet.variables) {
      if (v.required) {
        const val = variables[v.name]
        if (!val || !val.trim()) {
          if (!v.defaultValue) missing.push(v.name)
        }
      }
    }
    if (missing.length > 0) {
      setError(t('builder.snippet.missingVar').replace('{names}', missing.join(', ')))
      return
    }

    // 校验目标文件
    if (!targetFile.trim()) {
      setError(t('builder.snippet.targetFile') + '：' + (isZh ? '不能为空' : 'cannot be empty'))
      return
    }

    // 替换变量生成最终代码
    const resolved = resolveSnippet(selectedSnippet, variables)
    if (!resolved.success || !resolved.code) {
      setError(resolved.error || 'Variable resolve failed')
      return
    }

    onInsert({
      code: resolved.code,
      targetFile: targetFile.trim(),
      mode,
      snippetId: selectedSnippet.id,
    })
    onClose()
  }, [selectedSnippet, variables, targetFile, mode, onInsert, onClose, t, isZh])

  // 渲染
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-[540px] flex-col border-l border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ========== 顶部标题栏 ========== */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <Code2 className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-medium">{t('builder.snippet.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ========== 搜索 + 分类筛选 ========== */}
        <div className="shrink-0 space-y-2 border-b border-border/60 px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('builder.snippet.search')}
              className="w-full rounded border border-border bg-background py-1.5 pl-7 pr-2 text-[12px] outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <CategoryChip
              active={category === 'all'}
              onClick={() => setCategory('all')}
              label={t('builder.snippet.allCategories')}
            />
            {SNIPPET_CATEGORIES.map((c) => {
              const Icon = CATEGORY_ICON_MAP[c.value] || Package
              return (
                <CategoryChip
                  key={c.value}
                  active={category === c.value}
                  onClick={() => setCategory(c.value)}
                  label={isZh ? c.labelZh : c.label}
                  icon={<Icon className="h-3 w-3" />}
                />
              )
            })}
          </div>
        </div>

        {/* ========== 片段列表 ========== */}
        <div className="shrink-0 overflow-y-auto border-b border-border/60" style={{ maxHeight: '40%' }}>
          {filteredMetas.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">
              {t('builder.snippet.empty')}
            </p>
          ) : (
            <ul>
              {filteredMetas.map((m) => {
                const Icon = getSnippetIcon(m.icon)
                const diff = DIFFICULTY_STYLE[m.difficulty]
                const active = m.id === selectedId
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => setSelectedId(m.id)}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 ${
                        active ? 'bg-accent/5 border-l-2 border-accent' : 'border-l-2 border-transparent'
                      }`}
                    >
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded ${
                        active ? 'bg-accent/10 text-accent' : 'bg-muted/40 text-muted-foreground'
                      }`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`truncate text-[12px] font-medium ${active ? 'text-accent' : 'text-foreground'}`}>
                            {isZh ? m.nameZh : m.name}
                          </span>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${diff.badge}`}>
                            {t(diff.labelKey)}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                          {isZh ? m.descriptionZh : m.description}
                        </p>
                        {m.targetFile && (
                          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
                            {m.targetFile}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ========== 详情面板 ========== */}
        <div className="flex min-h-0 flex-1 flex-col">
          {selectedSnippet ? (
            <>
              {/* 详情头部 */}
              <div className="shrink-0 border-b border-border/60 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[12px] font-medium text-foreground">
                    {isZh ? selectedSnippet.nameZh : selectedSnippet.name}
                  </span>
                </div>
                {selectedSnippet.usage && (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {selectedSnippet.usage}
                  </p>
                )}
              </div>

              {/* 变量填写 */}
              {selectedSnippet.variables.length > 0 && (
                <div className="shrink-0 space-y-1.5 border-b border-border/60 px-3 py-2">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {t('builder.snippet.variables')}
                  </p>
                  {selectedSnippet.variables.map((v) => (
                    <div key={v.name} className="flex items-center gap-2">
                      <label className="w-32 shrink-0 truncate font-mono text-[11px] text-foreground/80" title={v.name}>
                        {v.name}
                        {v.required && <span className="ml-0.5 text-destructive">*</span>}
                      </label>
                      <input
                        type="text"
                        value={variables[v.name] ?? ''}
                        onChange={(e) => handleVarChange(v.name, e.target.value)}
                        placeholder={v.defaultValue}
                        className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* 目标文件 + 模式选择 */}
              <div className="shrink-0 space-y-1.5 border-b border-border/60 px-3 py-2">
                <div className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-[11px] text-muted-foreground">
                    {t('builder.snippet.targetFile')}
                  </label>
                  <input
                    type="text"
                    value={targetFile}
                    onChange={(e) => setTargetFile(e.target.value)}
                    placeholder={selectedSnippet.targetFile || 'src/...'}
                    className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-[11px] text-muted-foreground">Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as InsertMode)}
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-accent/50"
                  >
                    <option value="insert_at_cursor">{t('builder.snippet.insert')}</option>
                    <option value="append_file">{t('builder.snippet.appendFile')}</option>
                    <option value="replace_file">{t('builder.snippet.replaceFile')}</option>
                  </select>
                </div>
              </div>

              {/* 代码预览 */}
              <div className="min-h-0 flex-1 overflow-hidden">
                <div className="flex items-center justify-between border-b border-border/40 px-3 py-1">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t('builder.snippet.preview')}
                  </span>
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {selectedSnippet.language}
                  </span>
                </div>
                <textarea
                  value={previewCode}
                  readOnly
                  spellCheck={false}
                  className="h-full w-full resize-none border-0 bg-muted/20 p-2 font-mono text-[11px] leading-relaxed text-foreground/90 outline-none"
                />
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[12px] text-destructive">
                  {error}
                </div>
              )}

              {/* 底部插入按钮 */}
              <div className="shrink-0 border-t border-border px-3 py-2">
                <button
                  onClick={handleInsert}
                  className="w-full rounded bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent/90"
                >
                  {mode === 'insert_at_cursor' && t('builder.snippet.insert')}
                  {mode === 'append_file' && t('builder.snippet.appendFile')}
                  {mode === 'replace_file' && t('builder.snippet.replaceFile')}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <Code2 className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-[12px] text-muted-foreground">
                {isZh ? '从上方列表选择一个片段以预览' : 'Select a snippet from the list above'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ==========================================
// 分类 Chip 子组件
// ==========================================

interface CategoryChipProps {
  active: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
}

const CategoryChip: React.FC<CategoryChipProps> = ({ active, onClick, label, icon }) => {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
        active
          ? 'border-accent/50 bg-accent/10 text-accent'
          : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

export default SnippetDrawer
