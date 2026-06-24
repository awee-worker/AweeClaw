/**
 * 通用虚拟列表组件
 * 采用「视口计算器 + 滚动会话 Hook + 渲染层」三层架构：
 *  - 视口计算器：纯函数模块，根据滚动位置与容器尺寸推导可见区间，便于单测
 *  - 滚动会话 Hook：封装滚动/尺寸监听与 rAF 节流，组件层只消费结果
 *  - 渲染层：使用 transform 定位条目，避免触发重排，性能优于 absolute top
 */
import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
  forwardRef,
  useImperativeHandle,
} from 'react'

export interface VirtualListProps<T> {
  /** 数据项数组 */
  items: T[]
  /** 每项固定高度（像素） */
  itemHeight: number
  /** 单项渲染函数 */
  renderItem: (item: T, index: number, style: React.CSSProperties) => ReactNode
  /** 获取项唯一 key */
  getKey: (item: T, index: number) => string | number
  /** 容器类名 */
  className?: string
  /** 视口外缓冲条目数，用于减少滚动边缘白屏 */
  bufferSize?: number
  /** 空列表占位内容 */
  emptyContent?: ReactNode
  /** 滚动位置变更回调 */
  onScroll?: (scrollTop: number) => void
  /** 容器样式 */
  style?: React.CSSProperties
  /** 内容区域额外样式 */
  contentStyle?: React.CSSProperties
}

export interface VirtualListRef {
  /** 滚动到指定索引 */
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void
  /** 滚动到顶部 */
  scrollToTop: () => void
  /** 滚动到底部 */
  scrollToBottom: () => void
  /** 获取当前滚动位置 */
  getScrollTop: () => number
}

/** 可见区间计算结果 */
interface VisibleRange {
  start: number
  end: number
}

/**
 * 视口计算器：根据滚动偏移、视口高度、条目高度与缓冲量推导可见区间
 * 抽离为纯函数，便于独立测试与复用
 */
function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  itemCount: number,
  itemHeight: number,
  bufferSize: number,
): VisibleRange {
  if (itemCount === 0 || itemHeight <= 0) return { start: 0, end: 0 }
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize)
  const visibleEnd = Math.ceil((scrollTop + viewportHeight) / itemHeight) + bufferSize
  const end = Math.min(itemCount, visibleEnd)
  return { start, end }
}

/** 构造单条目的定位样式，使用 transform 替代 top 以利用 GPU 合成层 */
function buildItemStyle(index: number, itemHeight: number): React.CSSProperties {
  return {
    position: 'absolute',
    transform: `translateY(${index * itemHeight}px)`,
    left: 0,
    right: 0,
    height: itemHeight,
    willChange: 'transform',
  }
}

interface ScrollSession {
  containerRef: React.RefObject<HTMLDivElement>
  scrollTop: number
  viewportHeight: number
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void
}

/**
 * 滚动会话 Hook：管理容器引用、滚动位置与视口高度
 * 使用 rAF 节流滚动事件，避免高频 setState 造成渲染抖动
 */
function useScrollSession(onScroll?: (scrollTop: number) => void): ScrollSession {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const frameRef = useRef<number | null>(null)
  const pendingTopRef = useRef(0)

  // 滚动事件经 rAF 节流后批量更新
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      pendingTopRef.current = e.currentTarget.scrollTop
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        const top = pendingTopRef.current
        setScrollTop(top)
        onScroll?.(top)
      })
    },
    [onScroll],
  )

  // 监听容器尺寸变化，初始化与 ResizeObserver 双保险
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setViewportHeight(el.clientHeight)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { containerRef, scrollTop, viewportHeight, handleScroll }
}

function VirtualListInner<T>(
  {
    items,
    itemHeight,
    renderItem,
    getKey,
    className = '',
    bufferSize = 5,
    emptyContent,
    onScroll,
    style,
    contentStyle,
  }: VirtualListProps<T>,
  ref: React.Ref<VirtualListRef>,
) {
  const session = useScrollSession(onScroll)
  const { containerRef, scrollTop, viewportHeight, handleScroll } = session

  useImperativeHandle(
    ref,
    (): VirtualListRef => ({
      scrollToIndex: (index, behavior = 'smooth') => {
        containerRef.current?.scrollTo({ top: index * itemHeight, behavior })
      },
      scrollToTop: () => containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }),
      scrollToBottom: () => {
        const el = containerRef.current
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      },
      getScrollTop: () => scrollTop,
    }),
    [containerRef, scrollTop, itemHeight],
  )

  const range = useMemo(
    () => computeVisibleRange(scrollTop, viewportHeight, items.length, itemHeight, bufferSize),
    [scrollTop, viewportHeight, items.length, itemHeight, bufferSize],
  )

  const visibleSlice = useMemo(
    () => items.slice(range.start, range.end).map((item, i) => ({ item, index: range.start + i })),
    [items, range],
  )

  if (items.length === 0 && emptyContent) {
    return (
      <div ref={containerRef} className={`overflow-y-auto custom-scrollbar ${className}`} style={style}>
        {emptyContent}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto custom-scrollbar ${className}`}
      onScroll={handleScroll}
      style={style}
    >
      <div style={{ height: items.length * itemHeight, position: 'relative', ...contentStyle }}>
        {visibleSlice.map(({ item, index }) => (
          <div key={getKey(item, index)} style={buildItemStyle(index, itemHeight)}>
            {renderItem(item, index, {})}
          </div>
        ))}
      </div>
    </div>
  )
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.Ref<VirtualListRef> },
) => ReactNode

/** 便捷获取虚拟列表 ref 的 Hook */
export function useVirtualListRef() {
  return useRef<VirtualListRef>(null)
}
