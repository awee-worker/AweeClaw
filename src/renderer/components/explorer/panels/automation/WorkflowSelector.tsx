/**
 * WorkflowSelector — 工作流选择器
 *
 * 用于在自动化规则表单中选择目标工作流，替代原始的手动输入 workflowId。
 *
 * 数据源策略（优先级递减）：
 *   1. 后端工作流：workflowClientAPI.list()（后端可用时）
 *   2. 本地工作流：workflowEngine.getAll()（后端不可用时的兜底）
 *   3. 手动输入：列表为空或加载失败时，允许用户直接输入 workflowId
 *
 * 交互：
 *   - 点击触发按钮展开内联面板（搜索框 + 列表），避免 OverlayDialog overflow 裁剪
 *   - 支持按名称/id 模糊搜索
 *   - 选中后按钮显示「图标 + 名称」，并展示工作流描述
 *   - 面板底部提供「手动输入 ID」入口，切换为文本输入模式
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ChevronDown, Search, Workflow, Loader2, AlertCircle, Pencil, Check } from 'lucide-react'
import { workflowClientAPI } from '@shared/configuration/workflows/workflowClientAPI'
import { workflowEngine } from '@shared/protocols/workflow'
import type { WorkflowDefinition } from '@shared/protocols/workflow'
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'

/** 统一的工作流选项结构（兼容后端 V2 与本地引擎两种数据源） */
interface WorkflowOption {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  icon?: string
  category?: string
}

interface WorkflowSelectorProps {
  /** 当前选中的工作流 ID */
  value: string
  /** 选择变更回调 */
  onChange: (workflowId: string) => void
  /** 是否中文界面 */
  isZh: boolean
}

/** 判断字符串是否为 emoji（简单启发式：非 ASCII 且在 emoji 区间） */
function isEmoji(str: string): boolean {
  if (!str) return false
  // 常见 emoji 区间：杂项符号、表情符号、补充符号等
  return /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u.test(str)
}

/** 渲染工作流图标：emoji 直接显示，否则用 Workflow 图标兜底 */
function WorkflowIcon({ icon, className }: { icon?: string; className?: string }) {
  if (icon && isEmoji(icon)) {
    return <span className={className}>{icon}</span>
  }
  return <Workflow className={className} />
}

export function WorkflowSelector({ value, onChange, isZh }: WorkflowSelectorProps) {
  const [options, setOptions] = useState<WorkflowOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [manualMode, setManualMode] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // ─── 加载工作流列表 ─────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const loadFromBackend = async (): Promise<WorkflowOption[]> => {
      const list = await workflowClientAPI.list({ pageSize: 200 })
      return list.map((w: WorkflowDefinitionV2) => ({
        id: w.id,
        name: w.name,
        nameZh: w.nameZh || w.name,
        description: w.description || '',
        descriptionZh: w.descriptionZh || w.description || '',
        icon: w.icon,
        category: w.category,
      }))
    }

    const loadFromLocal = (): WorkflowOption[] => {
      const list: WorkflowDefinition[] = workflowEngine.getAll()
      return list.map(w => ({
        id: w.id,
        name: w.name,
        nameZh: w.nameZh || w.name,
        description: w.description || '',
        descriptionZh: w.descriptionZh || w.description || '',
        icon: w.icon,
        category: w.category,
      }))
    }

    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        if (workflowClientAPI.isAvailable()) {
          const list = await loadFromBackend()
          if (!cancelled) {
            setOptions(list)
            // 后端可用但列表为空时，不视为错误，允许手动输入
          }
        } else {
          // 后端未认证，回退本地
          const list = loadFromLocal()
          if (!cancelled) setOptions(list)
        }
      } catch (e) {
        if (!cancelled) {
          // 后端请求失败，尝试本地兜底
          try {
            const list = loadFromLocal()
            setOptions(list)
          } catch {
            setLoadError(e instanceof Error ? e.message : String(e))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  // ─── 编辑模式下，若当前 value 不在列表中，自动进入手动输入 ───
  useEffect(() => {
    if (!loading && value && options.length > 0) {
      const found = options.some(o => o.id === value)
      if (!found) setManualMode(true)
    }
  }, [loading, value, options])

  // ─── 点击面板外部收起 ───────────────────────────────
  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    // 延迟绑定，避免触发展开的同一事件立刻收起
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [expanded])

  // ─── 搜索过滤 ───────────────────────────────────────
  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options
    const kw = search.trim().toLowerCase()
    return options.filter(o =>
      o.id.toLowerCase().includes(kw) ||
      o.name.toLowerCase().includes(kw) ||
      o.nameZh.toLowerCase().includes(kw) ||
      (o.category || '').toLowerCase().includes(kw),
    )
  }, [options, search])

  // ─── 当前选中的工作流 ───────────────────────────────
  const selectedOption = useMemo(
    () => options.find(o => o.id === value) || null,
    [options, value],
  )

  // ─── 选择工作流 ─────────────────────────────────────
  const handleSelect = useCallback((id: string) => {
    onChange(id)
    setExpanded(false)
    setSearch('')
    setManualMode(false)
  }, [onChange])

  // ─── 渲染 ───────────────────────────────────────────

  // 手动输入模式
  if (manualMode) {
    return (
      <div>
        <div className="flex gap-2">
          <input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={isZh ? '输入工作流 ID...' : 'Enter workflow ID...'}
            className="flex-1 px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors font-mono"
          />
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => setManualMode(false)}
              className="flex items-center gap-1 px-3 py-2 bg-surface/50 rounded-lg border border-border/40 text-[13px] text-text-primary hover:border-accent/50 hover:bg-surface-hover/40 transition-colors whitespace-nowrap"
              title={isZh ? '返回选择列表' : 'Back to list'}
            >
              <Search className="w-3.5 h-3.5 text-accent" />
              {isZh ? '选择' : 'Pick'}
            </button>
          )}
        </div>
        <p className="text-[11px] text-text-muted mt-1">
          {isZh ? '手动输入工作流 ID（需与后端已保存的工作流 ID 完全一致）' : 'Manual workflow ID (must match a saved workflow on the server)'}
        </p>
      </div>
    )
  }

  // 选择模式
  return (
    <div ref={panelRef} className="relative">
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors text-left"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
            <span className="text-text-muted">{isZh ? '加载工作流列表...' : 'Loading workflows...'}</span>
          </>
        ) : selectedOption ? (
          <>
            <WorkflowIcon icon={selectedOption.icon} className="w-4 h-4 text-accent flex-shrink-0" />
            <span className="flex-1 truncate">{isZh ? selectedOption.nameZh : selectedOption.name}</span>
            <span className="text-[11px] text-text-muted font-mono truncate max-w-[120px]">{selectedOption.id}</span>
          </>
        ) : (
          <>
            <Workflow className="w-4 h-4 text-text-muted flex-shrink-0" />
            <span className="flex-1 text-text-muted">
              {loadError
                ? (isZh ? '加载失败，点击重试或手动输入' : 'Load failed, click to retry or enter manually')
                : options.length === 0
                  ? (isZh ? '暂无可用工作流' : 'No workflows available')
                  : (isZh ? '选择工作流...' : 'Select a workflow...')}
            </span>
          </>
        )}
        <ChevronDown className={`w-4 h-4 text-text-muted flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* 选中工作流的描述 */}
      {selectedOption && (selectedOption.description || selectedOption.descriptionZh) && (
        <p className="text-[11px] text-text-muted mt-1 px-1">
          {isZh ? (selectedOption.descriptionZh || selectedOption.description) : selectedOption.description}
        </p>
      )}

      {/* 展开面板（内联，避免 OverlayDialog overflow 裁剪） */}
      {expanded && !loading && (
        <div className="mt-1 rounded-lg border border-border/40 bg-background/95 shadow-lg overflow-hidden">
          {/* 搜索框 */}
          <div className="p-2 border-b border-border/30">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-surface/40 rounded-md">
              <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={isZh ? '搜索工作流...' : 'Search workflows...'}
                className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>
          </div>

          {/* 列表 */}
          <div className="max-h-[220px] overflow-y-auto custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-text-muted">
                {options.length === 0
                  ? (isZh ? '暂无工作流，请先在工作流页面创建' : 'No workflows yet, create one in the Workflow page')
                  : (isZh ? '无匹配结果' : 'No matches')}
              </div>
            ) : (
              filteredOptions.map(opt => {
                const isSelected = opt.id === value
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelect(opt.id)}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? 'bg-accent/10'
                        : 'hover:bg-surface-hover/40'
                    }`}
                  >
                    <WorkflowIcon icon={opt.icon} className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isSelected ? 'text-accent' : 'text-text-muted'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium text-text-primary truncate">
                          {isZh ? opt.nameZh : opt.name}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
                      </div>
                      {(opt.descriptionZh || opt.description) && (
                        <p className="text-[11px] text-text-muted truncate mt-0.5">
                          {isZh ? (opt.descriptionZh || opt.description) : opt.description}
                        </p>
                      )}
                      <p className="text-[11px] text-text-muted/70 font-mono mt-0.5">{opt.id}</p>
                    </div>
                    {opt.category && (
                      <span className="px-1.5 py-0.5 rounded bg-surface/60 text-[10px] text-text-muted flex-shrink-0">
                        {opt.category}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* 底部：手动输入入口 */}
          <div className="border-t border-border/30 p-2">
            <button
              type="button"
              onClick={() => { setManualMode(true); setExpanded(false) }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[12px] text-text-secondary hover:bg-surface-hover/40 hover:text-text-primary transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              {isZh ? '手动输入工作流 ID' : 'Enter workflow ID manually'}
            </button>
          </div>
        </div>
      )}

      {/* 加载失败提示 */}
      {loadError && !expanded && (
        <div className="flex items-center gap-1 mt-1 text-[11px] text-amber-500">
          <AlertCircle className="w-3 h-3" />
          <span>{isZh ? '后端工作流加载失败，已回退本地数据' : 'Backend load failed, using local data'}</span>
        </div>
      )}
    </div>
  )
}
