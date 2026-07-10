import { useCallback, useState, useLayoutEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import { LucideIcon, ChevronRight } from 'lucide-react'
import { useCloseOnOutsideOrEscape } from '@hooks/usePerformance'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: LucideIcon
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  onClick?: () => void
  /** 二级子菜单（存在子菜单时 onClick 被忽略） */
  children?: ContextMenuItem[]
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

const EDGE_MARGIN = 8
const SUBMENU_OFFSET = 4

export const FloatingMenu = memo(function FloatingMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useCloseOnOutsideOrEscape<HTMLDivElement>(onClose)
  const [pos, setPos] = useState({ x, y })
  const [submenuPos, setSubmenuPos] = useState<{ x: number; y: number } | null>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    let ax = x, ay = y
    if (x + rect.width > window.innerWidth) ax = window.innerWidth - rect.width - EDGE_MARGIN
    if (y + rect.height > window.innerHeight) {
      ay = y - rect.height
      if (ay < EDGE_MARGIN) ay = EDGE_MARGIN
    }
    setPos({ x: Math.max(EDGE_MARGIN, ax), y: Math.max(EDGE_MARGIN, ay) })
  }, [x, y])

  const onItem = useCallback((item: ContextMenuItem) => {
    if (item.disabled) return
    // 有子菜单时不关闭，由 hover/click 处理子菜单显示
    if (item.children && item.children.length > 0) return
    // 先执行 onClick 再关闭，避免 onClose 卸载组件后回调丢失
    item.onClick?.()
    onClose()
  }, [onClose])

  /** 处理子菜单项点击 */
  const onSubItem = useCallback((item: ContextMenuItem) => {
    if (item.disabled) return
    // 先执行 onClick 再关闭，确保回调可靠触发
    item.onClick?.()
    onClose()
  }, [onClose])

  /** 计算/显示子菜单位置 */
  const handleSubmenuHover = useCallback((item: ContextMenuItem, event: React.MouseEvent<HTMLButtonElement>) => {
    if (!item.children || item.children.length === 0) {
      setActiveSubmenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    let sx = rect.right - SUBMENU_OFFSET
    const sy = rect.top - 4
    // 预估子菜单宽度（min-w-[200px]）
    if (sx + 200 > window.innerWidth) {
      sx = rect.left - 200 + SUBMENU_OFFSET
    }
    setSubmenuPos({ x: sx, y: sy })
    setActiveSubmenu(item.id)
  }, [])

  return createPortal(
    <div ref={menuRef} className="fixed z-[99999] min-w-[220px] p-1.5 bg-surface/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl shadow-black/30 animate-scale-in flex flex-col gap-0.5" style={{ left: pos.x, top: pos.y }}>
      {items.map((item, idx) => {
        if (item.separator) return <div key={`sep-${idx}`} className="my-1 border-t border-border/50 mx-2" />
        const Icon = item.icon
        const hasSubmenu = item.children && item.children.length > 0
        const isSubmenuActive = activeSubmenu === item.id
        return (
          <button
            key={item.id}
            onClick={() => onItem(item)}
            onMouseEnter={(e) => handleSubmenuHover(item, e)}
            disabled={item.disabled}
            className={`w-full px-2.5 py-1.5 flex items-center gap-2.5 text-left text-[13px] transition-all rounded-lg select-none group ${item.disabled ? 'text-text-muted/85 cursor-not-allowed' : item.danger ? 'text-text-secondary hover:bg-red-500/10 hover:text-red-500' : isSubmenuActive ? 'bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-accent/10 hover:text-text-primary'}`}
          >
            {Icon && <Icon className={`w-4 h-4 flex-shrink-0 transition-colors ${item.danger ? 'text-red-400/70 group-hover:text-red-500' : 'text-text-muted group-hover:text-text-primary'}`} />}
            <span className="flex-1 font-medium tracking-tight">{item.label}</span>
            {hasSubmenu && <ChevronRight className="w-3.5 h-3.5 text-text-muted/70 flex-shrink-0" />}
            {item.shortcut && <span className="text-[11px] text-text-muted/90 font-mono tracking-tighter">{item.shortcut}</span>}
          </button>
        )
      })}

      {/* 二级子菜单 — 渲染在 menuRef 内部，避免 useClickOutside 误判为外部点击 */}
      {activeSubmenu && submenuPos && (() => {
        const parentItem = items.find(i => i.id === activeSubmenu)
        if (!parentItem?.children) return null
        // 转换为相对于父菜单的坐标（父菜单是 fixed 定位，子菜单用 absolute）
        const relX = submenuPos.x - pos.x
        const relY = submenuPos.y - pos.y
        return (
          <div
            className="absolute z-[100000] min-w-[200px] p-1.5 bg-surface/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl shadow-black/30 animate-scale-in flex flex-col gap-0.5"
            style={{ left: relX, top: relY }}
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            {parentItem.children.map((subItem, subIdx) => {
              if (subItem.separator) return <div key={`sub-sep-${subIdx}`} className="my-1 border-t border-border/50 mx-2" />
              const SubIcon = subItem.icon
              return (
                <button
                  key={subItem.id}
                  onClick={() => onSubItem(subItem)}
                  disabled={subItem.disabled}
                  className={`w-full px-2.5 py-1.5 flex items-center gap-2.5 text-left text-[13px] transition-all rounded-lg select-none group ${subItem.disabled ? 'text-text-muted/85 cursor-not-allowed' : subItem.danger ? 'text-text-secondary hover:bg-red-500/10 hover:text-red-500' : 'text-text-secondary hover:bg-accent/10 hover:text-text-primary'}`}
                >
                  {SubIcon && <SubIcon className={`w-4 h-4 flex-shrink-0 transition-colors ${subItem.danger ? 'text-red-400/70 group-hover:text-red-500' : 'text-text-muted group-hover:text-text-primary'}`} />}
                  <span className="flex-1 font-medium tracking-tight">{subItem.label}</span>
                </button>
              )
            })}
          </div>
        )
      })()}
    </div>,
    document.body,
  )
})

export interface ContextMenuState { x: number; y: number; data?: any }

export function useContextMenu<T = any>() {
  const [menu, setMenu] = useState<(ContextMenuState & { data?: T }) | null>(null)
  const show = useCallback((e: React.MouseEvent, data?: T) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, data }) }, [])
  const hide = useCallback(() => setMenu(null), [])
  return { menu, show, hide }
}
