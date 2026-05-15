import { useState, useEffect, useRef, ReactNode, useCallback, useMemo } from 'react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'

export interface PickerOption {
    id: string
    label: string
    description?: string
    icon?: React.ComponentType<{ className?: string }>
    category?: string
    data?: unknown
}

interface ContextualItemPickerProps<T extends PickerOption> {
    position: { x: number; y: number }
    items: T[]
    loading?: boolean
    onSelect: (item: T) => void
    onClose: () => void
    header?: ReactNode
    emptyText?: string
    showCategoryGroups?: boolean
    maxVisibleItems?: number
    renderItem?: (item: T, index: number, isSelected: boolean) => ReactNode
}

export function ContextualItemPicker<T extends PickerOption>({
    position,
    items,
    loading = false,
    onSelect,
    onClose,
    header,
    emptyText,
    showCategoryGroups = false,
    maxVisibleItems = 8,
    renderItem,
}: ContextualItemPickerProps<T>) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [searchFilter] = useState('')
    const listRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const language = useStore(s => s.language)

    const filteredItems = useMemo(() => {
        if (!searchFilter) return items
        const q = searchFilter.toLowerCase()
        return items.filter(item =>
            item.label.toLowerCase().includes(q) ||
            (item.description && item.description.toLowerCase().includes(q)) ||
            (item.category && item.category.toLowerCase().includes(q))
        )
    }, [items, searchFilter])

    const groupedItems = useMemo(() => {
        if (!showCategoryGroups) return null
        const groups: Record<string, T[]> = {}
        for (const item of filteredItems) {
            const cat = item.category || 'default'
            if (!groups[cat]) groups[cat] = []
            groups[cat].push(item)
        }
        return groups
    }, [filteredItems, showCategoryGroups])

    useEffect(() => { setSelectedIndex(0) }, [searchFilter, items])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault()
                    e.stopPropagation()
                    setSelectedIndex(i => Math.min(i + 1, filteredItems.length - 1))
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    e.stopPropagation()
                    setSelectedIndex(i => Math.max(i - 1, 0))
                    break
                case 'Enter':
                case 'Tab':
                    e.preventDefault()
                    e.stopPropagation()
                    if (filteredItems[selectedIndex]) {
                        onSelect(filteredItems[selectedIndex])
                    }
                    break
                case 'Escape':
                    e.preventDefault()
                    e.stopPropagation()
                    onClose()
                    break
                case 'Backspace':
                    if (searchFilter.length > 0) {
                        e.stopPropagation()
                    }
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [filteredItems, selectedIndex, onSelect, onClose, searchFilter])

    useEffect(() => {
        if (listRef.current) {
            const selectedEl = listRef.current.querySelector(`[data-pick-index="${selectedIndex}"]`)
            selectedEl?.scrollIntoView({ block: 'nearest' })
        }
    }, [selectedIndex])

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onClose()
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [onClose])

    const defaultRenderOption = useCallback((item: T, _index: number, isSelected: boolean) => {
        const Icon = item.icon
        return (
            <div
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-all duration-100 ${isSelected ? 'bg-accent/15 text-text-primary ring-1 ring-accent/15' : 'hover:bg-surface-hover text-text-secondary'}`}
            >
                {Icon && <Icon className="w-4 h-4 flex-shrink-0 text-accent/70" />}
                <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate">{item.label}</div>
                    {item.description && (
                        <div className="text-[10px] text-text-muted truncate mt-0.5">{item.description}</div>
                    )}
                </div>
                {item.category && (
                    <span className="text-[9px] font-bold text-text-muted/40 uppercase tracking-wider flex-shrink-0">{item.category}</span>
                )}
            </div>
        )
    }, [])

    const visibleItems = filteredItems.slice(0, maxVisibleItems)

    return (
        <div
            ref={containerRef}
            className="fixed z-50 bg-surface/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl overflow-hidden animate-fade-in"
            style={{
                left: position.x,
                bottom: `calc(100vh - ${position.y}px + 8px)`,
                minWidth: 300,
                maxWidth: 420,
                maxHeight: 360,
            }}
        >
            {header && (
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-surface-hover/50 text-[11px] text-text-muted font-medium">
                    {header}
                </div>
            )}

            <div ref={listRef} className="overflow-y-auto max-h-[260px]">
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : visibleItems.length === 0 ? (
                    <div className="py-8 text-center text-text-muted text-[12px]">
                        {emptyText || t('noResultsFound', language)}
                    </div>
                ) : groupedItems ? (
                    Object.entries(groupedItems).map(([category, categoryItems]) => (
                        <div key={category}>
                            <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.15em] text-text-muted/40 bg-surface/50 sticky top-0">{category}</div>
                            {categoryItems.slice(0, maxVisibleItems).map((item, index) => {
                                const flatIdx = filteredItems.indexOf(item)
                                return (
                                    <div
                                        key={item.id}
                                        data-pick-index={flatIdx}
                                        onClick={() => onSelect(item)}
                                        onMouseEnter={() => setSelectedIndex(flatIdx)}
                                    >
                                        {renderItem ? renderItem(item, index, flatIdx === selectedIndex) : defaultRenderOption(item, index, flatIdx === selectedIndex)}
                                    </div>
                                )
                            })}
                        </div>
                    ))
                ) : (
                    visibleItems.map((item, index) => (
                        <div
                            key={item.id}
                            data-pick-index={index}
                            onClick={() => onSelect(item)}
                            onMouseEnter={() => setSelectedIndex(index)}
                        >
                            {renderItem ? renderItem(item, index, index === selectedIndex) : defaultRenderOption(item, index, index === selectedIndex)}
                        </div>
                    ))
                )}
            </div>

            <div className="px-3 py-1.5 border-t border-border/30 bg-surface-hover/30 text-[10px] text-text-muted/60 flex items-center justify-between">
                <span>↑↓ {t('navigate', language)}</span>
                <span>↵ {t('selectItem', language)}</span>
                <span>Esc {t('closeMenu', language)}</span>
                {filteredItems.length > maxVisibleItems && (
                    <span className="text-accent/40">{filteredItems.length} total</span>
                )}
            </div>
        </div>
    )
}
