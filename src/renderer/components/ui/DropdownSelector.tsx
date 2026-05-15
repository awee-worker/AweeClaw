import React, { useState, useRef, useEffect, memo, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search } from 'lucide-react'
import { useClickOutside } from '@hooks/usePerformance'
import { BRAND } from '@shared/brand'

export interface SelectOption {
  value: string
  label: string
  icon?: React.ReactNode
  group?: string
}

interface SelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  dropdownPosition?: 'top' | 'bottom' | 'auto'
  searchable?: boolean
  emptyText?: string
}

export const DropdownSelector = memo(function DropdownSelector({
  options, value, onChange, placeholder = 'Select...', className = '', disabled = false, dropdownPosition = 'auto', searchable = false, emptyText = 'No options',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const [query, setQuery] = useState('')
  const hostRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const chosen = options.find(o => o.value === value)

  const filtered = useMemo(() => {
    if (!query) return options
    const q = query.toLowerCase()
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  }, [options, query])

  const grouped = useMemo(() => {
    const map = new Map<string, SelectOption[]>()
    for (const o of filtered) {
      const g = o.group || ''
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(o)
    }
    return map
  }, [filtered])

  useClickOutside(() => setOpen(false), open, [hostRef, panelRef])

  useEffect(() => {
    if (open && hostRef.current) {
      const rect = hostRef.current.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom
      const above = rect.top
      const upward = dropdownPosition === 'top' || (dropdownPosition === 'auto' && below < 250 && above > below)
      setStyle({
        position: 'fixed', left: rect.left, width: rect.width, zIndex: 9999,
        ...(upward ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      })
      if (searchable && searchRef.current) setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open, dropdownPosition, searchable])

  useEffect(() => { if (!open) setQuery('') }, [open])

  const panel = open && (
    <div ref={panelRef} style={style} className="p-1.5 bg-background/95 backdrop-blur-2xl border border-border rounded-xl shadow-2xl animate-scale-in max-h-64 overflow-auto custom-scrollbar flex flex-col gap-0.5">
      {searchable && (
        <div className="sticky top-0 z-10 p-1 bg-background/95 backdrop-blur-xl">
          <div className="relative flex items-center">
            <Search className="absolute left-2 w-3.5 h-3.5 text-text-muted" />
            <input ref={searchRef} type="text" value={query} onChange={e => setQuery(e.target.value)} className="w-full h-7 pl-7 pr-2 text-xs bg-surface/50 border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40" placeholder="Search..." onKeyDown={e => { if (e.key === 'Escape') setQuery('') }} />
          </div>
        </div>
      )}
      {filtered.length === 0 && <div className="px-3 py-4 text-xs text-text-muted text-center">{emptyText}</div>}
      {Array.from(grouped.entries()).map(([group, opts]) => (
        <React.Fragment key={group}>
          {group && <div className="px-3 py-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1 first:mt-0">{group}</div>}
          {opts.map(opt => (
            <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false) }} className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left rounded-lg transition-all duration-200 ${opt.value === value ? 'text-accent bg-accent/10 font-bold' : 'text-text-secondary hover:bg-text-primary/[0.05] hover:text-text-primary'}`}>
              <div className="flex items-center gap-2.5 truncate">
                {opt.icon && <span className="flex-shrink-0 w-4 h-4 opacity-70">{opt.icon}</span>}
                <span>{opt.label}</span>
              </div>
              {opt.value === value && <Check className="w-3.5 h-3.5" strokeWidth={2} />}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  )

  return (
    <div ref={hostRef} className={`relative ${className}`}>
      <button type="button" onClick={() => !disabled && setOpen(!open)} disabled={disabled} className={`flex items-center justify-between w-full rounded-xl border px-3 h-10 py-1 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] transition-all duration-200 ease-out ${open ? 'bg-surface/80 border-accent/40 ring-4 ring-accent/10 shadow-[0_0_0_1px_rgba(var(--accent)/0.2)]' : 'bg-surface/50 backdrop-blur-sm border-border hover:bg-surface hover:border-border-active'} ${className}`}>
        <div className="flex items-center gap-2 truncate">
          {chosen?.icon && <span className="flex-shrink-0 w-4 h-4 text-text-muted">{chosen.icon}</span>}
          <span className={`truncate ${chosen ? 'text-text-primary' : 'text-text-muted'}`}>{chosen ? chosen.label : placeholder}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-text-muted/85 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {createPortal(panel, document.body)}
    </div>
  )
})

DropdownSelector.displayName = `${BRAND.name}DropdownSelector`
