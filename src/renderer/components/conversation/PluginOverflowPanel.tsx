/**
 * 插件溢出面板
 *
 * 技能建议栏里的已安装插件超过内联上限（见 SkillSuggestionBar 的 MAX_INLINE_PLUGINS）后，
 * 行尾会出现「更多插件」按钮，点击在按钮正上方弹出本面板：
 * - 顶部搜索框：插件多时靠它定位，而不是横向滚动里一个个找
 * - 主体网格：图标 + 名称 + 描述，超出高度在面板内部滚动，不顶开输入区
 * - 选中态：插件是单选上下文（见 conversationSlice.addContextItem），因此点选即替换，
 *   与技能行的单选语义保持一致；再点已选项则取消
 *
 * 定位用 fixed + portal 到 body，而不是 absolute：
 * 技能栏所在容器带 overflow-y-auto，absolute 向上弹出会被裁剪。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Puzzle, Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PluginListEntry } from '@intelligence/runtime/skillRepository'
import { resolveLucideIcon, isImageIcon } from '@components/plugin/pluginIconResolver'

/** 面板纵向最大高度：超出后在面板内部滚动，不影响下方输入区布局 */
const PANEL_MAX_HEIGHT = 320
/** 面板与触发按钮之间的间距 */
const PANEL_GAP = 8
/** 网格列数，方向键上下移动的步长与它对齐 */
const GRID_COLUMNS = 3

function PluginIcon({ icon }: { icon?: string }) {
  if (isImageIcon(icon)) {
    return <img src={icon} alt="" className="w-5 h-5 rounded object-contain" />
  }
  const Icon: LucideIcon = resolveLucideIcon(icon) || Puzzle
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
  /** 全部已安装插件（含行内已展示的前 N 个，便于统一搜索） */
  plugins: PluginListEntry[]
  isZh: boolean
  /** 当前已选插件 id，用于打勾 */
  selectedPluginId?: string
  onSelect: (plugin: PluginListEntry) => void
  /** 取消当前已选插件 */
  onDeselect: () => void
  onClose: () => void
}

export default function PluginOverflowPanel({
  anchorEl,
  alignEl,
  plugins,
  isZh,
  selectedPluginId,
  onSelect,
  onDeselect,
  onClose,
}: PluginOverflowPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [placement, setPlacement] = useState<{ left: number; width: number; bottom: number } | null>(null)

  const getPluginLabel = useCallback(
    (plugin: PluginListEntry) => (isZh ? plugin.nameZh || plugin.name : plugin.name),
    [isZh],
  )

  const getPluginDesc = useCallback(
    (plugin: PluginListEntry) => (isZh && plugin.descriptionZh) || plugin.description || '',
    [isZh],
  )

  /** 中文名、英文名、标识、中英描述都参与匹配，中文界面下也能用英文搜到 */
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return plugins
    return plugins.filter(plugin => (
      [plugin.nameZh, plugin.name, plugin.pluginKey, plugin.descriptionZh, plugin.description]
        .some(field => typeof field === 'string' && field.toLowerCase().includes(keyword))
    ))
  }, [plugins, query])

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
      const plugin = filtered[activeIndex]
      if (plugin) onSelect(plugin)
    }
  }, [filtered, activeIndex, onSelect])

  if (!placement) return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={isZh ? '全部插件' : 'All plugins'}
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
            placeholder={isZh ? '搜索插件…' : 'Search plugins…'}
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
          {filtered.length}/{plugins.length}
        </span>
      </div>

      {/* 插件网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-xs text-text-muted">
            {isZh ? '没有匹配的插件' : 'No matching plugins'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {filtered.map((plugin, index) => {
              const selected = plugin.pluginKey === selectedPluginId
              return (
                <button
                  key={plugin.pluginKey}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => (selected ? onDeselect() : onSelect(plugin))}
                  title={getPluginDesc(plugin)}
                  className={[
                    'group relative flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-all duration-150',
                    selected
                      ? 'border-purple-500/60 bg-purple-500/10'
                      : 'border-transparent hover:border-purple-500/30 hover:bg-purple-500/5',
                    index === activeIndex ? 'ring-1 ring-purple-500/40' : '',
                  ].join(' ')}
                >
                  <span className={selected ? 'mt-0.5 text-purple-400' : 'mt-0.5 text-text-muted'}>
                    <PluginIcon icon={plugin.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text-primary">
                      {getPluginLabel(plugin)}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                      {getPluginDesc(plugin)}
                    </span>
                  </span>
                  {selected && <Check className="mt-0.5 w-3.5 h-3.5 shrink-0 text-purple-400" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 底部说明 */}
      <div className="flex shrink-0 items-center justify-between border-t border-border/50 px-3 py-1.5">
        <span className="text-[11px] text-text-muted">
          {isZh ? '插件为单选，点选即替换当前插件' : 'One plugin at a time — selecting replaces the current one'}
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
