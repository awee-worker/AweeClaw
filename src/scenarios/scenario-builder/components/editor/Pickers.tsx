/**
 * 选择器组件（IconPicker / MultiSelectPicker）
 *
 * 为 ScenarioConfigEditor 提供"选择式"字段输入：
 * - IconPicker：图标网格选择，支持搜索 + 推荐
 * - MultiSelectPicker：多选标签选择，支持按分组展示 + 搜索
 *
 * 设计：
 * - 弹出层用 absolute 定位，点击外部关闭（不用 portal，避免层级复杂）
 * - 键盘 Esc 关闭
 * - 选中项高亮，支持清除
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { getLucideIcon } from '@renderer/components/foundation/IconMap'
import { SCENARIO_ICON_OPTIONS, SCENARIO_ICON_RECOMMENDED } from '../../config/scenarioOptionCatalog'
import { ChevronDown, Search, Check, X } from 'lucide-react'

// ==========================================
// IconPicker 图标选择器
// ==========================================

interface IconPickerProps {
  value: string
  onChange: (icon: string) => void
}

const IconPicker: React.FC<IconPickerProps> = ({ value, onChange }) => {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const filteredIcons = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SCENARIO_ICON_OPTIONS
    return SCENARIO_ICON_OPTIONS.filter((name) => name.toLowerCase().includes(q))
  }, [search])

  const CurrentIcon = getLucideIcon(value)

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-[12px] transition-colors hover:border-accent/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
      >
        <CurrentIcon className="h-4 w-4 shrink-0 text-foreground" />
        <span className="flex-1 text-left text-foreground">{value || t('builder.config.icon.placeholder')}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-hidden rounded border border-border bg-background shadow-lg">
          {/* 搜索框 */}
          <div className="border-b border-border/60 p-2">
            <div className="flex items-center gap-1.5 rounded bg-muted/30 px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('builder.config.icon.search')}
                className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </div>

          {/* 推荐区（无搜索词时显示） */}
          {!search.trim() && (
            <div className="border-b border-border/60 px-2 py-1.5">
              <div className="mb-1 text-[11px] text-muted-foreground">{t('builder.config.icon.recommended')}</div>
              <div className="grid grid-cols-8 gap-1">
                {SCENARIO_ICON_RECOMMENDED.map((name) => {
                  const Icon = getLucideIcon(name)
                  const selected = name === value
                  return (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      onClick={() => {
                        onChange(name)
                        setOpen(false)
                        setSearch('')
                      }}
                      className={`flex items-center justify-center rounded p-1.5 transition-colors ${
                        selected ? 'bg-accent/15 text-accent' : 'text-foreground/70 hover:bg-muted/60 hover:text-foreground'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 全部图标网格 */}
          <div className="max-h-44 overflow-y-auto p-2">
            <div className="grid grid-cols-8 gap-1">
              {filteredIcons.map((name) => {
                const Icon = getLucideIcon(name)
                const selected = name === value
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    onClick={() => {
                      onChange(name)
                      setOpen(false)
                      setSearch('')
                    }}
                    className={`flex items-center justify-center rounded p-1.5 transition-colors ${
                      selected ? 'bg-accent/15 text-accent ring-1 ring-accent/30' : 'text-foreground/70 hover:bg-muted/60 hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                )
              })}
              {filteredIcons.length === 0 && (
                <div className="col-span-8 py-4 text-center text-[12px] text-muted-foreground">
                  {t('builder.config.icon.noMatch')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ==========================================
// MultiSelectPicker 多选选择器
// ==========================================

export interface MultiSelectOption {
  value: string
  labelKey: string
  descKey?: string
  group?: string
  /**
   * 预留选项：尚无可用实现（如无内置执行器的工具）。
   * UI 会标记为「未实现」并禁止勾选，避免用户选择后得到静默失效的配置；
   * 历史配置中已选中的预留项仍可手动移除。
   */
  reserved?: boolean
}

interface MultiSelectPickerProps {
  options: MultiSelectOption[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
}

/** 按分组整理选项 */
function groupOptions(options: MultiSelectOption[]): { group: string; items: MultiSelectOption[] }[] {
  const groups = new Map<string, MultiSelectOption[]>()
  for (const opt of options) {
    const g = opt.group ?? 'other'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(opt)
  }
  return Array.from(groups.entries()).map(([group, items]) => ({ group, items }))
}

const MultiSelectPicker: React.FC<MultiSelectPickerProps> = ({ options, value, onChange, placeholder }) => {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (opt) => opt.value.toLowerCase().includes(q) || t(opt.labelKey).toLowerCase().includes(q),
    )
  }, [options, search, t])

  const grouped = useMemo(() => groupOptions(filteredOptions), [filteredOptions])

  const toggle = (v: string) => {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v))
    } else {
      onChange([...value, v])
    }
  }

  const removeItem = (v: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(value.filter((x) => x !== v))
  }

  // 选项 value → { label, reserved } 映射，用于已选标签展示
  const valueInfoMap = useMemo(() => {
    const m = new Map<string, { label: string; reserved: boolean }>()
    for (const opt of options) m.set(opt.value, { label: t(opt.labelKey), reserved: !!opt.reserved })
    return m
  }, [options, t])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-[32px] w-full flex-wrap items-center gap-1 rounded border border-border bg-background px-2 py-1 text-left text-[12px] transition-colors hover:border-accent/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
      >
        {value.length === 0 ? (
          <span className="text-muted-foreground/60">{placeholder ?? t('builder.config.multiselect.placeholder')}</span>
        ) : (
          value.map((v) => {
            const info = valueInfoMap.get(v)
            const reserved = info?.reserved ?? false
            return (
              <span
                key={v}
                title={reserved ? t('builder.config.multiselect.reservedHint') : undefined}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                  reserved ? 'bg-destructive/10 text-destructive' : 'bg-accent/10 text-accent'
                }`}
              >
                {info?.label ?? v}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => removeItem(v, e)}
                  onKeyDown={(e) => e.key === 'Enter' && removeItem(v, e as any)}
                  className="cursor-pointer rounded-full hover:bg-accent/20"
                  title={t('builder.config.multiselect.remove')}
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              </span>
            )
          })
        )}
        <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-hidden rounded border border-border bg-background shadow-lg">
          {/* 搜索框 */}
          <div className="border-b border-border/60 p-2">
            <div className="flex items-center gap-1.5 rounded bg-muted/30 px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('builder.config.multiselect.search')}
                className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </div>

          {/* 选项列表（按分组） */}
          <div className="max-h-56 overflow-y-auto">
            {grouped.map(({ group, items }) => (
              <div key={group}>
                <div className="sticky top-0 bg-muted/30 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`builder.config.group.${group}`)}
                </div>
                {items.map((opt) => {
                  const selected = value.includes(opt.value)
                  // 预留选项无可用实现：已选中的允许取消，未选中的禁止勾选
                  const blocked = !!opt.reserved && !selected
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggle(opt.value)}
                      disabled={blocked}
                      title={opt.reserved ? t('builder.config.multiselect.reservedHint') : undefined}
                      className={`flex w-full items-start gap-2 px-2 py-1.5 text-left transition-colors ${
                        blocked ? 'cursor-not-allowed opacity-55' : 'hover:bg-muted/40'
                      }`}
                    >
                      <div
                        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          selected ? 'border-accent bg-accent text-accent-foreground' : 'border-border'
                        }`}
                      >
                        {selected && <Check className="h-2.5 w-2.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[12px] text-foreground">{t(opt.labelKey)}</span>
                          {opt.reserved && (
                            <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                              {t('builder.config.multiselect.reserved')}
                            </span>
                          )}
                          <span className="truncate text-[11px] text-muted-foreground/70">{opt.value}</span>
                        </div>
                        {opt.descKey && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground/80">{t(opt.descKey)}</div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
            {grouped.length === 0 && (
              <div className="py-4 text-center text-[12px] text-muted-foreground">
                {t('builder.config.multiselect.noMatch')}
              </div>
            )}
          </div>

          {/* 底部统计 */}
          <div className="border-t border-border/60 px-2 py-1 text-[11px] text-muted-foreground">
            {t('builder.config.multiselect.selected', { count: value.length })}
          </div>
        </div>
      )}
    </div>
  )
}

export { IconPicker, MultiSelectPicker }
