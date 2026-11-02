/**
 * 导航菜单显隐穿梭框
 *
 * 左右两栏分别是「已隐藏」与「已显示」：勾选后用中间的方向按钮成批移动，
 * 双击单条也能直接换到另一栏。这里只维护草稿，保存动作交给上层弹窗统一提交 ——
 * 用户在弹窗里改了又取消，不应该已经在左侧导航栏生效。
 *
 * 空态分三种：没有可管理的菜单、全部已显示、全部已隐藏，各自给出提示而非留白。
 *
 * @module renderer/components/layout/MenuVisibilityTransfer
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { getLucideIcon } from '../foundation/IconMap'
import { t, type Language } from '@renderer/i18n'
import type { NavMenuItem, NavMenuItemSource } from './navMenuCatalog'
import { splitMenusByHidden, showMenus, hideMenus, sortMenusByOrder, moveMenuTo } from './menuVisibilityModel'


export interface MenuVisibilityTransferProps {
  /** 可管理的全部菜单（场景 + 插件 + 自定义） */
  items: NavMenuItem[]
  /** 当前草稿中处于隐藏状态的菜单 id */
  hiddenIds: string[]
  /** 草稿变更回调，由上层在保存时提交 */
  onChange: (next: string[]) => void
  /** 当前草稿中的完整菜单顺序（包含已隐藏项） */
  order: string[]
  /** 拖曳排序后的顺序回调，同样由上层在保存时提交 */
  onOrderChange: (next: string[]) => void
  language: Language
}
interface TransferPaneProps {
  title: string
  items: NavMenuItem[]
  checkedIds: string[]
  onToggle: (id: string) => void
  onToggleAll: () => void
  onMoveOne: (id: string) => void
  emptyText: string
  language: Language
  /** 是否允许拖曳排序，只有「已显示」栏开启 */
  reorderable?: boolean
  /** 排序结果：入参是栏内下标，拖起项由 fromIndex 落到 toIndex */
  onReorder?: (fromIndex: number, toIndex: number) => void
}

/** 拖动会话：整段存活期都放在 ref 里，指针每动一像素都不触发 React 渲染 */
interface DragSession {
  id: string
  pointerId: number
  fromIndex: number
  toIndex: number
  /** 按下时的 Y，用来判断是否越过起拖阈值 */
  startY: number
  /** 最近一次的指针 Y，自动滚动与落点计算都读它 */
  lastY: number
  /** 已越过阈值，才算真正在拖 */
  active: boolean
  /** 各行的中线（滚动容器内容坐标系），拖起时量一次，之后不再重算 */
  mids: number[]
  /** 滚动容器顶边在视口中的位置，用来把 clientY 换算成内容坐标 */
  containerTop: number
  frame: number
  detach: () => void
}

/** 来源标签：让用户看得出某个入口是插件带的还是自己加的 */
function sourceLabel(source: NavMenuItemSource, language: Language): string | null {
  if (source === 'plugin') return t('layout.menusourceplugin', language)
  if (source === 'custom') return t('layout.menusourcecustom', language)
  return null
}

function TransferPane({
  title,
  items,
  checkedIds,
  onToggle,
  onToggleAll,
  onMoveOne,
  emptyText,
  language,
  reorderable = false,
  onReorder,
}: TransferPaneProps) {
  const allChecked = items.length > 0 && checkedIds.length === items.length
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** 行元素按 id 索引：拿到的是真实 DOM，量位置时不受渲染顺序影响 */
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const sessionRef = useRef<DragSession | null>(null)
  /** 拖动中的落点预览：条目先按目标位置画出来，松手才提交 */
  const [drag, setDrag] = useState<{ id: string; toIndex: number } | null>(null)

  const indexById = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items])

  /**
   * 拖动期间按落点重排一版
   *
   * 条目不跟着指针位移，而是直接排到目标位置 —— 松手前就能看清最终结果，
   * 落空也不会和预期不一致。
   */
  const displayItems = useMemo(() => {
    if (!drag) return items
    const moving = items.find((item) => item.id === drag.id)
    if (!moving) return items
    const rest = items.filter((item) => item.id !== drag.id)
    rest.splice(Math.min(Math.max(drag.toIndex, 0), rest.length), 0, moving)
    return rest
  }, [items, drag])

  /** 卸载时把挂在 window 上的监听一并摘掉，避免拖到一半切走 */
  useEffect(
    () => () => {
      const session = sessionRef.current
      if (!session) return
      if (session.frame) cancelAnimationFrame(session.frame)
      session.detach()
      sessionRef.current = null
    },
    [],
  )

  /**
   * 指针拖曳：pointerdown 起会话，越过 4px 阈值才进入拖动
   *
   * 不用原生 HTML5 拖放：预览、落点与自动滚动都要自己控，原生那套在 Electron 里
   * 落点还会被拖影和 dragleave 打断。
   */
  const beginDrag = (event: React.PointerEvent<HTMLLIElement>, item: NavMenuItem, index: number) => {
    if (!reorderable || !onReorder || sessionRef.current) return
    // 触屏交给原生滚动；拖曳只认鼠标与触控笔
    if (event.button !== 0 || event.pointerType === 'touch') return
    // 复选框、按钮有自己的点击语义，按下不算拖曳
    if ((event.target as HTMLElement).closest('input, button, a')) return
    const scroller = scrollRef.current
    if (!scroller) return

    const containerTop = scroller.getBoundingClientRect().top
    const baseScroll = scroller.scrollTop
    const mids = items.map((it) => {
      const row = rowRefs.current.get(it.id)
      if (!row) return Number.POSITIVE_INFINITY
      const rect = row.getBoundingClientRect()
      return rect.top + rect.height / 2 - containerTop + baseScroll
    })

    const session: DragSession = {
      id: item.id,
      pointerId: event.pointerId,
      fromIndex: index,
      toIndex: index,
      startY: event.clientY,
      lastY: event.clientY,
      active: false,
      mids,
      containerTop,
      frame: 0,
      detach: () => {},
    }

    /**
     * 指针落点下标
     *
     * 先数指针越过了几行中线（得到原列表里的插入槽位），再按「拖起行已经移出」
     * 修正一格：向下拖时那个槽位把拖起行自己也数了一次，不减就会出现偏移。
     */
    const resolveIndex = (clientY: number) => {
      const contentY = clientY - containerTop + scroller.scrollTop
      let slot = 0
      for (let i = 0; i < mids.length; i += 1) {
        if (mids[i] < contentY) slot = i + 1
      }
      const shifted = slot > index ? slot - 1 : slot
      return Math.min(Math.max(shifted, 0), Math.max(items.length - 1, 0))
    }

    /** 贴住上下边缘自动滚动，长列表也能一路拖到底 */
    const autoScroll = (clientY: number) => {
      const rect = scroller.getBoundingClientRect()
      const edge = 28
      const overTop = clientY - rect.top
      const overBottom = rect.bottom - clientY
      if (overTop < edge && scroller.scrollTop > 0) {
        scroller.scrollTop -= (edge - Math.max(overTop, 0)) * 0.5
      } else if (overBottom < edge) {
        scroller.scrollTop += (edge - Math.max(overBottom, 0)) * 0.5
      }
    }

    const syncTarget = (clientY: number) => {
      const to = resolveIndex(clientY)
      if (to === session.toIndex) return
      session.toIndex = to
      setDrag({ id: session.id, toIndex: to })
    }

    /** 指针压在边缘不动时靠这一帧循环推进滚动与落点 */
    const tick = () => {
      if (sessionRef.current !== session) return
      autoScroll(session.lastY)
      syncTarget(session.lastY)
      session.frame = requestAnimationFrame(tick)
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== session.pointerId) return
      session.lastY = ev.clientY
      if (!session.active) {
        if (Math.abs(ev.clientY - session.startY) < 4) return
        session.active = true
        setDrag({ id: session.id, toIndex: session.fromIndex })
        session.frame = requestAnimationFrame(tick)
      }
      // 拖动期间不选中文字
      ev.preventDefault()
      syncTarget(ev.clientY)
    }

    const finish = (commit: boolean) => {
      if (session.frame) cancelAnimationFrame(session.frame)
      session.detach()
      sessionRef.current = null
      setDrag(null)
      if (commit && session.active && session.toIndex !== session.fromIndex) {
        onReorder(session.fromIndex, session.toIndex)
      }
    }

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== session.pointerId) return
      finish(true)
    }
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== session.pointerId) return
      finish(false)
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    session.detach = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
    }
    sessionRef.current = session
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col rounded-lg border border-border/50 bg-text-primary/[0.02] overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 h-8 shrink-0 border-b border-border/40 bg-text-primary/[0.02]">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allChecked}
            disabled={items.length === 0}
            onChange={onToggleAll}
            style={{ accentColor: 'rgb(var(--accent))' }}
            className="w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed"
          />
          <span className="text-[11px] font-semibold text-text-muted">
            {title}（{items.length}）
          </span>
        </label>
      </div>
      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1 ${
          drag ? 'select-none' : ''
        }`}
      >
        {items.length === 0 ? (
          <div className="h-full min-h-[80px] flex items-center justify-center px-3 text-[11px] text-text-muted opacity-60 text-center">
            {emptyText}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {displayItems.map((item) => {
              const Icon = getLucideIcon(item.icon)
              const checked = checkedIds.includes(item.id)
              const tag = sourceLabel(item.source, language)
              const isDragging = drag?.id === item.id
              return (
                <li
                  key={item.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(item.id, el)
                    else rowRefs.current.delete(item.id)
                  }}
                  onPointerDown={
                    reorderable ? (e) => beginDrag(e, item, indexById.get(item.id) ?? 0) : undefined
                  }
                  className={isDragging ? 'relative z-10' : undefined}
                >
                  <label
                    onDoubleClick={() => onMoveOne(item.id)}
                    title={
                      reorderable
                        ? t('layout.menudisplaydrag', language)
                        : t('layout.menudisplaydblclick', language)
                    }
                    className={`group flex items-center gap-2 px-1.5 py-1.5 rounded-md transition-[background-color,box-shadow,transform] duration-150 ${
                      reorderable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                    } ${checked ? 'bg-accent/8' : 'hover:bg-text-primary/[0.05]'} ${
                      isDragging
                        ? 'bg-popover shadow-lg shadow-black/25 ring-1 ring-inset ring-accent/60 scale-[1.02]'
                        : ''
                    }`}
                  >
                    {/*
                      抓手本身表达拖动语义：指针用四处箭头（cursor-move），
                      悬停整行时提亮，方便找到可拖的位置
                    */}
                    {reorderable && (
                      <GripVertical
                        className="w-3 h-3 shrink-0 cursor-move text-text-muted opacity-40 transition-opacity group-hover:opacity-80"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    )}
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(item.id)}
                      style={{ accentColor: 'rgb(var(--accent))' }}
                      className="w-3.5 h-3.5 shrink-0 cursor-pointer"
                    />
                    <Icon className="w-3.5 h-3.5 shrink-0 opacity-60" strokeWidth={1.5} />
                    <span className="flex-1 min-w-0 truncate text-[12px] text-text-primary">
                      {language === 'zh' ? item.labelZh : item.label}
                    </span>
                    {tag && (
                      <span className="shrink-0 px-1 py-[1px] rounded text-[10px] text-text-muted bg-text-primary/[0.06]">
                        {tag}
                      </span>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
export default function MenuVisibilityTransfer({
  items,
  hiddenIds,
  onChange,
  order,
  onOrderChange,
  language,
}: MenuVisibilityTransferProps) {
  /** 两栏各自的勾选状态，移动后清空，避免残留 id 影响下一次操作 */
  const [checkedHidden, setCheckedHidden] = useState<string[]>([])
  const [checkedVisible, setCheckedVisible] = useState<string[]>([])

  /** 两栏都按草稿顺序渲染：拖动一落手就能看到结果，不必等保存 */
  const orderedItems = useMemo(() => sortMenusByOrder(items, order), [items, order])

  const { hiddenItems, visibleItems } = useMemo(
    () => splitMenusByHidden(orderedItems, hiddenIds),
    [orderedItems, hiddenIds],
  )

  /** 显示：把选中项从隐藏列表中移除 */
  const show = (ids: string[]) => {
    if (ids.length === 0) return
    onChange(showMenus(hiddenIds, ids))
    setCheckedHidden((prev) => prev.filter((id) => !ids.includes(id)))
  }

  /** 隐藏：并入隐藏列表 */
  const hide = (ids: string[]) => {
    if (ids.length === 0) return
    onChange(hideMenus(hiddenIds, ids))
    setCheckedVisible((prev) => prev.filter((id) => !ids.includes(id)))
  }

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id]

  /**
   * 拖曳重排「已显示」栏
   *
   * 落点下标以「已显示」栏为准，完整顺序的合并规则见 moveMenuTo：重排结果在前，
   * 已隐藏项按原相对顺序排在后面。草稿一变，上面这栏立刻按新顺序渲染。
   */
  const moveVisible = (fromIndex: number, toIndex: number) => {
    const allIds = orderedItems.map((item) => item.id)
    const next = moveMenuTo(allIds, visibleItems.map((item) => item.id), fromIndex, toIndex)
    if (next !== allIds) onOrderChange(next)
  }

  if (items.length === 0) {
    return (
      <div className="h-[240px] flex items-center justify-center text-[12px] text-text-muted opacity-60">
        {t('layout.menudisplaynone', language)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] text-text-muted opacity-70 leading-relaxed">
        {t('layout.menudisplayhint', language)}
      </p>
      <div className="flex items-stretch gap-2">
        <TransferPane
          title={t('layout.menudisplayhidden', language)}
          items={hiddenItems}
          checkedIds={checkedHidden}
          onToggle={(id) => setCheckedHidden((prev) => toggleIn(prev, id))}
          onToggleAll={() => setCheckedHidden(checkedHidden.length === hiddenItems.length ? [] : hiddenItems.map((i) => i.id))}
          onMoveOne={(id) => show([id])}
          emptyText={t('layout.menudisplayemptyhidden', language)}
          language={language}
        />

        <div className="flex flex-col items-center justify-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => show(checkedHidden)}
            disabled={checkedHidden.length === 0}
            title={t('layout.menushowselected', language)}
            aria-label={t('layout.menushowselected', language)}
            className="w-7 h-7 rounded-md flex items-center justify-center border border-border/50 text-text-primary transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-primary"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => hide(checkedVisible)}
            disabled={checkedVisible.length === 0}
            title={t('layout.menuhideselected', language)}
            aria-label={t('layout.menuhideselected', language)}
            className="w-7 h-7 rounded-md flex items-center justify-center border border-border/50 text-text-primary transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-primary"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <TransferPane
          title={t('layout.menudisplayvisible', language)}
          items={visibleItems}
          checkedIds={checkedVisible}
          onToggle={(id) => setCheckedVisible((prev) => toggleIn(prev, id))}
          onToggleAll={() => setCheckedVisible(checkedVisible.length === visibleItems.length ? [] : visibleItems.map((i) => i.id))}
          onMoveOne={(id) => hide([id])}
          emptyText={t('layout.menudisplayemptyvisible', language)}
          language={language}
          reorderable
          onReorder={moveVisible}
        />
      </div>
    </div>
  )
}
