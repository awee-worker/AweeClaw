import { useCallback, useState, useLayoutEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import { LucideIcon } from 'lucide-react'
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
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

const EDGE_MARGIN = 8

export const FloatingMenu = memo(function FloatingMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useCloseOnOutsideOrEscape<HTMLDivElement>(onClose)
  const [pos, setPos] = useState({ x, y })

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
    onClose()
    window.setTimeout(() => item.onClick?.(), 0)
  }, [onClose])

  return createPortal(
    <div ref={menuRef} className="fixed z-[99999] min-w-[220px] p-1.5 bg-surface/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl shadow-black/30 animate-scale-in flex flex-col gap-0.5" style={{ left: pos.x, top: pos.y }}>
      {items.map((item, idx) => {
        if (item.separator) return <div key={`sep-${idx}`} className="my-1 border-t border-border/50 mx-2" />
        const Icon = item.icon
        return (
          <button key={item.id} onClick={() => onItem(item)} disabled={item.disabled} className={`w-full px-2.5 py-1.5 flex items-center gap-2.5 text-left text-[13px] transition-all rounded-lg select-none group ${item.disabled ? 'text-text-muted/85 cursor-not-allowed' : item.danger ? 'text-text-secondary hover:bg-red-500/10 hover:text-red-500' : 'text-text-secondary hover:bg-accent/10 hover:text-text-primary'}`}>
            {Icon && <Icon className={`w-4 h-4 flex-shrink-0 transition-colors ${item.danger ? 'text-red-400/70 group-hover:text-red-500' : 'text-text-muted group-hover:text-text-primary'}`} />}
            <span className="flex-1 font-medium tracking-tight">{item.label}</span>
            {item.shortcut && <span className="text-[11px] text-text-muted/90 font-mono tracking-tighter">{item.shortcut}</span>}
          </button>
        )
      })}
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
