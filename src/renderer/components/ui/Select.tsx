import React, { useState, useRef, useEffect, memo, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search } from 'lucide-react'
import { useClickOutside } from '@renderer/hooks/usePerformance'
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

export const Select = memo(function Select({
    options,
    value,
    onChange,
    placeholder = 'Select...',
    className = '',
    disabled = false,
    dropdownPosition = 'auto',
    searchable = false,
    emptyText = 'No options',
}: SelectProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
    const [searchQuery, setSearchQuery] = useState('')
    const containerRef = useRef<HTMLDivElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)

    const selectedOption = options.find(opt => opt.value === value)

    const filteredOptions = useMemo(() => {
        if (!searchQuery) return options
        const q = searchQuery.toLowerCase()
        return options.filter(opt =>
            opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q)
        )
    }, [options, searchQuery])

    const groupedOptions = useMemo(() => {
        const groups = new Map<string, SelectOption[]>()
        for (const opt of filteredOptions) {
            const group = opt.group || ''
            if (!groups.has(group)) groups.set(group, [])
            groups.get(group)!.push(opt)
        }
        return groups
    }, [filteredOptions])

    useClickOutside(() => setIsOpen(false), isOpen, [containerRef, dropdownRef])

    useEffect(() => {
        if (isOpen && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect()
            const spaceBelow = window.innerHeight - rect.bottom
            const spaceAbove = rect.top
            const shouldShowAbove = dropdownPosition === 'top' ||
                (dropdownPosition === 'auto' && spaceBelow < 250 && spaceAbove > spaceBelow)

            setDropdownStyle({
                position: 'fixed',
                left: rect.left,
                width: rect.width,
                zIndex: 9999,
                ...(shouldShowAbove
                    ? { bottom: window.innerHeight - rect.top + 6 }
                    : { top: rect.bottom + 6 }
                ),
            })

            if (searchable && searchInputRef.current) {
                setTimeout(() => searchInputRef.current?.focus(), 50)
            }
        }
    }, [isOpen, dropdownPosition, searchable])

    useEffect(() => {
        if (!isOpen) setSearchQuery('')
    }, [isOpen])

    const dropdown = isOpen && (
        <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="p-1.5 bg-background/95 backdrop-blur-2xl border border-border rounded-xl shadow-2xl animate-scale-in max-h-64 overflow-auto custom-scrollbar flex flex-col gap-0.5"
        >
            {searchable && (
                <div className="sticky top-0 z-10 p-1 bg-background/95 backdrop-blur-xl">
                    <div className="relative flex items-center">
                        <Search className="absolute left-2 w-3.5 h-3.5 text-text-muted" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full h-7 pl-7 pr-2 text-xs bg-surface/50 border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40"
                            placeholder="Search..."
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    setSearchQuery('')
                                }
                            }}
                        />
                    </div>
                </div>
            )}
            {filteredOptions.length === 0 && (
                <div className="px-3 py-4 text-xs text-text-muted text-center">{emptyText}</div>
            )}
            {Array.from(groupedOptions.entries()).map(([group, opts]) => (
                <React.Fragment key={group}>
                    {group && (
                        <div className="px-3 py-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider mt-1 first:mt-0">
                            {group}
                        </div>
                    )}
                    {opts.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => { onChange(option.value); setIsOpen(false); }}
                            className={`
                                w-full flex items-center justify-between px-3 py-2 text-sm text-left rounded-lg transition-all duration-200
                                ${option.value === value
                                    ? 'text-accent bg-accent/10 font-bold'
                                    : 'text-text-secondary hover:bg-text-primary/[0.05] hover:text-text-primary'
                                }
                            `}
                        >
                            <div className="flex items-center gap-2.5 truncate">
                                {option.icon && <span className="flex-shrink-0 w-4 h-4 opacity-70">{option.icon}</span>}
                                <span>{option.label}</span>
                            </div>
                            {option.value === value && <Check className="w-3.5 h-3.5" strokeWidth={2} />}
                        </button>
                    ))}
                </React.Fragment>
            ))}
        </div>
    )

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`
          flex items-center justify-between w-full rounded-xl border px-3 h-10 py-1 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] transition-all duration-200 ease-out
          ${isOpen
                        ? 'bg-surface/80 border-accent/40 ring-4 ring-accent/10 shadow-[0_0_0_1px_rgba(var(--accent)/0.2)]'
                        : 'bg-surface/50 backdrop-blur-sm border-border hover:bg-surface hover:border-border-active'
                    }
          ${className}
        `}
            >
                <div className="flex items-center gap-2 truncate">
                    {selectedOption?.icon && <span className="flex-shrink-0 w-4 h-4 text-text-muted">{selectedOption.icon}</span>}
                    <span className={`truncate ${selectedOption ? 'text-text-primary' : 'text-text-muted'}`}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-text-muted/85 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {createPortal(dropdown, document.body)}
        </div>
    )
})

Select.displayName = `${BRAND.name}Select`
