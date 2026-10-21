/**
 * 技能栏溢出面板
 *
 * 技能建议栏的横向单行展示不了全部条目时，行尾会出现「更多技能」按钮，点击在按钮正上方弹出本面板：
 * - 顶部搜索框：条目多时靠它定位，而不是横向滚动里一个个找
 * - 主体网格：图标 + 名称 + 描述，超出高度在面板内部滚动，不顶开输入区
 * - 技能与插件混排：两者在技能栏里本就是同一种条目（见 SkillSuggestionBar 的 BarEntry）。
 *   面板若只列插件，声明为 skill 型的插件会被归并成技能条目，在这里就彻底找不到，
 *   与「更多技能」的字面语义不符
 * - 选中态：技能与插件都是单选上下文，点选即替换，再点已选项则取消
 *
 * 定位用 fixed + portal 到 body，而不是 absolute：
 * 技能栏所在容器带 overflow-y-auto，absolute 向上弹出会被裁剪。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Puzzle, Search, Wrench, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { resolveLucideIcon, isImageIcon } from '@components/plugin/pluginIconResolver'

/** 面板纵向最大高度：超出后在面板内部滚动，不影响下方输入区布局 */
const PANEL_MAX_HEIGHT = 320
/** 面板与触发按钮之间的间距 */
const PANEL_GAP = 8
/** 网格列数，方向键上下移动的步长与它对齐 */
const GRID_COLUMNS = 3

/**
 * 面板条目
 *
 * 只保留渲染与搜索需要的字段：条目是技能还是插件，只影响配色与点击语义，
 * 由调用方在 onSelect 里区分，面板本身不需要认识技能/插件的数据结构。
 */
export interface OverflowEntryItem {
  /** 稳定标识，同时用作 React key 与键盘高亮定位 */
  key: string
  kind: 'skill' | 'plugin'
  label: string
  description: string
  icon?: string
  /** 已挂在当前输入上下文里，用于打勾 */
  selected: boolean
  /** 当前智能体未启用来源插件：条目保留可点，但只用来弹出提示 */
  disabled?: boolean
  /** 禁用原因，作为悬停提示，缺省回落到 description */
  hint?: string
}

function EntryIcon({ icon, kind }: { icon?: string; kind: 'skill' | 'plugin' }) {
  if (isImageIcon(icon)) {
    return <img src={icon} alt="" className="w-5 h-5 rounded object-contain" />
  }
  const Icon: LucideIcon = resolveLucideIcon(icon) || (kind === 'skill' ? Wrench : Puzzle)
  return <Icon className="w-5 h-5" strokeWidth={1.5} />
}

interface PluginOverflowPanelProps {
  /** 触发面板的按钮元素：面板贴着它上沿展开，点击它时不关闭（由它自己 toggle） */
  anchorEl: HTMLElement | null
  /**
   * 左右边界与宽度对齐的容器（整条技能栏）。
   * 触发按钮只有百来像素宽，直接按它定宽会把面板挤成一条，因此宽度另取容器。
   */
  alignEl?: HTMLElement | null
  /** 全部条目：技能在前、插件在后，含行内已展示的部分，便于统一搜索 */
  items: OverflowEntryItem[]
  isZh: boolean
  onSelect: (item: OverflowEntryItem) => void
  /** 取消当前已选条目 */
  onDeselect: (item: OverflowEntryItem) => void
  onClose: () => void
}

export default function PluginOverflowPanel({
  anchorEl,
  alignEl,
  items,
  isZh,
  onSelect,
  onDeselect,
  onClose,
}: PluginOverflowPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [placement, setPlacement] = useState<{ left: number; width: number; bottom: number } | null>(null)

  /** 名称与描述都参与匹配，中文界面下也能用英文搜到 */
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter(item => (
      [item.label, item.description]
        .some(field => typeof field === 'string' && field.toLowerCase().includes(keyword))
    ))
  }, [items, query])

  // 贴着触发按钮上方展开：底边对齐按钮顶部，左右与宽度跟整条技能栏保持一致
  useLayoutEffect(() => {
    if (!anchorEl) return
    const place = () => {
      const triggerRect = anchorEl.getBoundingClientRect()
      const alignRect = (alignEl || anchorEl)!.getBoundingClientRect()
      setPlacement({
        left: alignRect.left,
        // 容器尚未完成布局时宽可能为 0，给一个下限避免面板退化成一条
        width: Math.max(alignRect.width, 280),
        // 用 bottom 定位，面板高度随内容自适应时始终紧贴按钮上沿
        bottom: window.innerHeight - triggerRect.top + PANEL_GAP,
      })
    }
    place()
    window.addEventListener('resize', place)
    // capture 用于捕获中间滚动容器的滚动事件，避免面板与锚点错位
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorEl, alignEl])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // 搜索词变化后重置高亮项，避免高亮停在已被过滤掉的位置
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 点击面板与锚点之外关闭；锚点自己负责 toggle，这里排除掉避免「关了又被打开」
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (anchorEl?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anchorEl, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (filtered.length === 0) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + GRID_COLUMNS, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - GRID_COLUMNS, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[activeIndex]
      if (!item) return
      if (item.selected) onDeselect(item)
      else onSelect(item)
    }
  }, [filtered, activeIndex, onSelect, onDeselect])

  if (!placement) return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={isZh ? '全部技能与插件' : 'All skills and plugins'}
      style={{
        left: placement.left,
        width: placement.width,
        bottom: placement.bottom,
        maxHeight: PANEL_MAX_HEIGHT,
      }}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-border/60 bg-surface shadow-2xl"
    >
      {/* 搜索区 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-background-chat px-2 py-1">
          <Search className="w-3.5 h-3.5 shrink-0 text-text-muted" strokeWidth={1.5} />
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isZh ? '搜索技能与插件…' : 'Search skills and plugins…'}
            className="w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={isZh ? '清空搜索' : 'Clear search'}
              className="shrink-0 text-text-muted hover:text-text-primary"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
          {filtered.length}/{items.length}
        </span>
      </div>

      {/* 条目网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-xs text-text-muted">
            {isZh ? '没有匹配的技能或插件' : 'No matching skills or plugins'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {filtered.map((item, index) => {
              const selected = item.selected
              return (
                <button
                  key={item.key}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => (selected ? onDeselect(item) : onSelect(item))}
                  title={item.hint ?? item.description}
                  aria-disabled={item.disabled}
                  className={[
                    'group relative flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-all duration-150',
                    item.disabled
                      ? 'border-transparent opacity-60 hover:border-border/60'
                      : item.kind === 'skill'
                        ? (selected
                          ? 'border-accent/60 bg-accent/10'
                          : 'border-transparent hover:border-accent/30 hover:bg-accent/5')
                        : (selected
                          ? 'border-purple-500/60 bg-purple-500/10'
                          : 'border-transparent hover:border-purple-500/30 hover:bg-purple-500/5'),
                    index === activeIndex && !item.disabled
                      ? (item.kind === 'skill' ? 'ring-1 ring-accent/40' : 'ring-1 ring-purple-500/40')
                      : '',
                  ].join(' ')}
                >
                  <span className={
                    selected && !item.disabled
                      ? (item.kind === 'skill' ? 'mt-0.5 text-accent' : 'mt-0.5 text-purple-400')
                      : 'mt-0.5 text-text-muted'
                  }>
                    <EntryIcon icon={item.icon} kind={item.kind} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text-primary">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                      {item.disabled ? (item.hint ?? item.description) : item.description}
                    </span>
                  </span>
                  {selected && !item.disabled && (
                    <Check
                      className={[
                        'mt-0.5 w-3.5 h-3.5 shrink-0',
                        item.kind === 'skill' ? 'text-accent' : 'text-purple-400',
                      ].join(' ')}
                      strokeWidth={2}
                    />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 底部说明 */}
      <div className="flex shrink-0 items-center justify-between border-t border-border/50 px-3 py-1.5">
        <span className="text-[11px] text-text-muted">
          {isZh ? '技能与插件均为单选，点选即替换' : 'One skill or plugin at a time — selecting replaces the current one'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-accent/10 hover:text-text-primary transition-colors"
        >
          {isZh ? '完成' : 'Done'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
