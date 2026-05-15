import { useRef, useState, useEffect, useCallback, useMemo, ReactNode, forwardRef, useImperativeHandle } from 'react'

export interface VirtualListProps<T> {
  items: T[]
  itemHeight: number
  renderItem: (item: T, index: number, style: React.CSSProperties) => ReactNode
  getKey: (item: T, index: number) => string | number
  className?: string
  bufferSize?: number
  emptyContent?: ReactNode
  onScroll?: (scrollTop: number) => void
  style?: React.CSSProperties
  contentStyle?: React.CSSProperties
}

export interface VirtualListRef {
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void
  scrollToTop: () => void
  scrollToBottom: () => void
  getScrollTop: () => number
}

function VirtualScrollerInner<T>(
  { items, itemHeight, renderItem, getKey, className = '', bufferSize = 5, emptyContent, onScroll, style, contentStyle }: VirtualListProps<T>,
  ref: React.Ref<VirtualListRef>,
) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  useImperativeHandle(ref, () => ({
    scrollToIndex: (idx: number, behavior: ScrollBehavior = 'smooth') => {
      scrollerRef.current?.scrollTo({ top: idx * itemHeight, behavior })
    },
    scrollToTop: () => scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }),
    scrollToBottom: () => {
      if (scrollerRef.current) scrollerRef.current.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' })
    },
    getScrollTop: () => offset,
  }))

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setViewportH(entry.contentRect.height)
    })
    ro.observe(el)
    setViewportH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const window = useMemo(() => {
    const from = Math.max(0, Math.floor(offset / itemHeight) - bufferSize)
    const to = Math.min(items.length, Math.ceil((offset + viewportH) / itemHeight) + bufferSize)
    return { from, to }
  }, [offset, viewportH, items.length, itemHeight, bufferSize])

  const slice = useMemo(() => items.slice(window.from, window.to), [items, window])

  const onScrollHandler = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    setOffset(top)
    onScroll?.(top)
  }, [onScroll])

  if (items.length === 0 && emptyContent) {
    return <div ref={scrollerRef} className={`overflow-y-auto custom-scrollbar ${className}`} style={style}>{emptyContent}</div>
  }

  return (
    <div ref={scrollerRef} className={`overflow-y-auto custom-scrollbar ${className}`} onScroll={onScrollHandler} style={style}>
      <div style={{ height: items.length * itemHeight, position: 'relative', ...contentStyle }}>
        {slice.map((item, i) => {
          const realIdx = window.from + i
          return (
            <div key={getKey(item, realIdx)} style={{ position: 'absolute', top: realIdx * itemHeight, left: 0, right: 0, height: itemHeight }}>
              {renderItem(item, realIdx, {})}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const VirtualList = forwardRef(VirtualScrollerInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.Ref<VirtualListRef> }
) => ReactNode

export function useVirtualListRef() {
  return useRef<VirtualListRef>(null)
}
