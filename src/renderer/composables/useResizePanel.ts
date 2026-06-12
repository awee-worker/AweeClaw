/**
 * 面板拖拽调整大小 Hook
 *
 * 基于起始位置 + 增量计算新宽度，避免绝对定位导致的跳动问题。
 * 拖拽期间通过 ref 直接操作 DOM，松手后才同步状态，减少重渲染。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { LAYOUT } from '@shared/appConstants'

type ResizeDirection = 'left' | 'right'

interface ResizeConfig {
  direction: ResizeDirection
  minSize: number
  maxSize: number
  onResizeEnd?: (size: number) => void
  panelRef?: React.RefObject<HTMLDivElement | null>
}

interface ResizeState {
  isResizing: boolean
  startResize: (e: React.MouseEvent) => void
}

export function useResizePanel(config: ResizeConfig): ResizeState {
  const [isResizing, setIsResizing] = useState(false)
  // 拖拽起始状态（用 ref 避免闭包引用过期值）
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const { direction, minSize, maxSize, onResizeEnd, panelRef } = config

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const currentWidth = panelRef?.current?.offsetWidth ?? 0
    dragStateRef.current = { startX: e.clientX, startWidth: currentWidth }
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
  }, [panelRef])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current
      if (!drag) return

      // 增量计算：left 方向向右拖增大，right 方向向左拖增大
      const delta = direction === 'left'
        ? e.clientX - drag.startX
        : drag.startX - e.clientX

      const newSize = Math.min(maxSize, Math.max(minSize, drag.startWidth + delta))

      if (panelRef?.current) {
        panelRef.current.style.width = `${newSize}px`
      }
    }

    const handleMouseUp = () => {
      const finalWidth = panelRef?.current?.offsetWidth ?? null
      setIsResizing(false)
      document.body.style.cursor = 'default'
      dragStateRef.current = null

      if (onResizeEnd && finalWidth !== null) {
        onResizeEnd(finalWidth)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    // 遮罩层防止选中文本和 iframe 拦截事件
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize'
    document.body.appendChild(overlay)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.removeChild(overlay)
    }
  }, [isResizing, direction, minSize, maxSize, onResizeEnd, panelRef])

  return { isResizing, startResize }
}

// 侧边栏 resize（从左边拖拽）
export function useSidebarResize(onResizeEnd: (width: number) => void, panelRef: React.RefObject<HTMLDivElement | null>) {
  const config = useMemo(() => ({
    direction: 'left' as const,
    minSize: LAYOUT.SIDEBAR_MIN_WIDTH,
    maxSize: LAYOUT.SIDEBAR_MAX_WIDTH,
    onResizeEnd,
    panelRef,
  }), [onResizeEnd, panelRef])

  return useResizePanel(config)
}

// 聊天面板 resize（从右边拖拽）
export function useChatResize(onResizeEnd: (width: number) => void, panelRef: React.RefObject<HTMLDivElement | null>) {
  const config = useMemo(() => ({
    direction: 'right' as const,
    minSize: LAYOUT.CHAT_MIN_WIDTH,
    maxSize: LAYOUT.CHAT_MAX_WIDTH,
    onResizeEnd,
    panelRef,
  }), [onResizeEnd, panelRef])

  return useResizePanel(config)
}
