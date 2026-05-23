import { useState, useRef, useCallback, ReactNode, memo, useMemo } from 'react'
import { X } from 'lucide-react'
import { useClickOutside, useEscapeKey } from '@hooks/usePerformance'

export interface BottomBarPopoverProps {
  icon: ReactNode
  tooltip?: string
  title?: string
  children: ReactNode
  width?: number
  height?: number
  badge?: string | number
  language?: 'en' | 'zh'
  placement?: 'top' | 'bottom'
  headerActions?: ReactNode
}

export default memo(function DockPopover({ icon, tooltip, title, children, width = 400, height = 300, badge, placement = 'top', headerActions }: BottomBarPopoverProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen(v => !v), [])

  useClickOutside(close, open, [panelRef, triggerRef])
  useEscapeKey(close, open)

  const bodyH = useMemo(() => (title ? height - 40 : height), [title, height])

  const isTop = placement === 'top'

  return (
    <div className="relative">
      <button ref={triggerRef} onClick={toggle} className={`flex items-center justify-center p-1.5 rounded transition-colors relative ${open ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`} title={tooltip}>
        {icon}
        {badge !== undefined && <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center px-0.5 text-[10px] font-medium bg-accent text-white rounded-full">{badge}</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          className={`absolute ${isTop ? 'bottom-full right-0 mb-3 origin-bottom-right animate-slide-up' : 'top-full right-0 mt-2 origin-top-right animate-slide-down'} bg-surface/80 backdrop-blur-2xl border border-border/50 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden z-50`}
          style={{ width, height }}
        >
          {title && (
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-white/[0.02] z-10 shrink-0">
              <span className="text-[12px] font-bold text-text-muted uppercase tracking-wider">{title}</span>
              <div className="flex items-center gap-1">
                {headerActions}
                <button onClick={close} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
          <div className="overflow-auto custom-scrollbar" style={{ height: bodyH }}>{children}</div>
        </div>
      )}
    </div>
  )
})

const STYLE_ID = 'dock-popover-keyframes'

if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `@keyframes slide-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.animate-slide-up{animation:slide-up .15s ease-out}@keyframes slide-down{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}.animate-slide-down{animation:slide-down .15s ease-out}`
  document.head.appendChild(el)
}
