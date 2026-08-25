import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { LAYOUT } from '@shared/appConstants'

type ResizeDirection = 'left' | 'right'

interface ResizeConfig {
  direction: ResizeDirection
  minSize: number
  maxSize: number
  onResizeEnd?: (size: number) => void
  /**
   * 拖拽松手时，若最终尺寸 ≤ collapseThreshold 则触发，用于自动收起面板。
   * 传入后，拖拽过程中允许尺寸低于 minSize（提供"即将收起"的视觉反馈），
   * 松手时判断：大于阈值则钳制到 minSize 并回调 onResizeEnd，否则回调 onCollapse。
   */
  collapseThreshold?: number
  onCollapse?: () => void
  panelRef?: React.RefObject<HTMLDivElement | null>
}

interface ResizeState {
  isResizing: boolean
  startResize: (e: React.MouseEvent) => void
}

/** 拖拽会话上下文，保存起始坐标与初始宽度 */
interface DragSession {
  originX: number
  baseWidth: number
}

/** 根据方向将鼠标位移转换为宽度增量 */
function deltaToWidth(direction: ResizeDirection, delta: number): number {
  return direction === 'left' ? delta : -delta
}

/** 将宽度限制在允许范围内 */
function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, width))
}

/** 创建拖拽期间覆盖全屏的遮罩，阻止文本选中和 iframe 拦截事件 */
function createOverlay(): HTMLDivElement {
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize'
  document.body.appendChild(overlay)
  return overlay
}

/**
 * 面板拖拽调整大小 Hook
 *
 * 以拖拽会话为单位管理状态：按下时记录起始坐标与初始宽度，
 * 移动时基于增量计算新宽度并直接写入 DOM，松手时同步最终宽度到外部状态。
 */
export function useResizePanel(config: ResizeConfig): ResizeState {
  const [isResizing, setIsResizing] = useState(false)
  const sessionRef = useRef<DragSession | null>(null)
  const { direction, minSize, maxSize, onResizeEnd, collapseThreshold, onCollapse, panelRef } = config

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const baseWidth = panelRef?.current?.offsetWidth ?? 0
      sessionRef.current = { originX: e.clientX, baseWidth }
      setIsResizing(true)
      document.body.style.cursor = 'col-resize'
    },
    [panelRef],
  )

  useEffect(() => {
    if (!isResizing) return

    const hasCollapse = collapseThreshold !== undefined && onCollapse !== undefined

    const handleMouseMove = (e: MouseEvent) => {
      const session = sessionRef.current
      if (!session) return

      const delta = e.clientX - session.originX
      const raw = session.baseWidth + deltaToWidth(direction, delta)

      // 有收起阈值时，拖拽下限放宽到 collapseThreshold，给"即将收起"的视觉反馈
      const lowerBound = hasCollapse ? collapseThreshold! : minSize
      const next = clampWidth(raw, lowerBound, maxSize)

      const el = panelRef?.current
      if (el) el.style.width = `${next}px`
    }

    const handleMouseUp = () => {
      const finalWidth = panelRef?.current?.offsetWidth ?? null
      sessionRef.current = null
      setIsResizing(false)
      document.body.style.cursor = 'default'

      if (finalWidth === null) return

      // 收起判定：最终宽度 ≤ 阈值 → 收起面板
      if (hasCollapse && finalWidth <= collapseThreshold!) {
        onCollapse!()
        return
      }

      // 正常情况：钳制到 minSize~maxSize 并同步宽度
      const clamped = clampWidth(finalWidth, minSize, maxSize)
      const el = panelRef?.current
      if (el && clamped !== finalWidth) el.style.width = `${clamped}px`
      if (onResizeEnd) onResizeEnd(clamped)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    const overlay = createOverlay()

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      overlay.remove()
    }
  }, [isResizing, direction, minSize, maxSize, onResizeEnd, collapseThreshold, onCollapse, panelRef])

  return { isResizing, startResize }
}

/** 订阅窗口宽度变化，返回当前 window.innerWidth */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  )
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/**
 * 按窗口宽度动态计算侧边栏最小宽度（线性插值 + 上下限钳制）。
 *
 * 参考点：
 *   800px  → 266px
 *   1440px → 280px
 *   1920px → 320px
 *
 * 采用两段线性：800~1440 缓增，1440~1920 稍快，整体受 [266, 320] 钳制。
 */
export function computeSidebarMinWidth(windowWidth: number): number {
  let min: number
  if (windowWidth <= 800) {
    min = 266
  } else if (windowWidth <= 1440) {
    // 800→266, 1440→280
    min = 266 + Math.round(((windowWidth - 800) / (1440 - 800)) * (280 - 266))
  } else if (windowWidth <= 1920) {
    // 1440→280, 1920→320
    min = 280 + Math.round(((windowWidth - 1440) / (1920 - 1440)) * (320 - 280))
  } else {
    min = 320
  }
  return Math.max(LAYOUT.SIDEBAR_MIN_WIDTH, min)
}

/**
 * 侧边栏拖拽（从左侧拖拽）
 *
 * 最小宽度按窗口宽度动态计算（见 computeSidebarMinWidth），并受 SIDEBAR_MAX_WIDTH 约束。
 * 拖拽到最小宽度及以下时（松手判定）触发 onCollapse，用于自动收起侧边栏。
 */
export function useSidebarResize(
  onResizeEnd: (width: number) => void,
  panelRef: React.RefObject<HTMLDivElement | null>,
  onCollapse?: () => void,
) {
  const windowWidth = useWindowWidth()
  const config = useMemo(() => {
    const minSize = computeSidebarMinWidth(windowWidth)
    return {
      direction: 'left' as const,
      minSize,
      maxSize: LAYOUT.SIDEBAR_MAX_WIDTH,
      onResizeEnd,
      // 拖拽下限放宽到最小宽度，松手时若 ≤ 最小宽度则收起（与聊天面板行为一致）
      collapseThreshold: minSize,
      onCollapse,
      panelRef,
    }
  }, [onResizeEnd, onCollapse, panelRef, windowWidth])
  return useResizePanel(config)
}

/**
 * 聊天面板拖拽（从右侧拖拽）
 *
 * @param onResizeEnd 宽度变化完成回调（未收起时）
 * @param panelRef    面板 DOM 引用
 * @param onCollapse  拖拽到最小宽度以下时的收起回调（可选）
 */
export function useChatResize(
  onResizeEnd: (width: number) => void,
  panelRef: React.RefObject<HTMLDivElement | null>,
  onCollapse?: () => void,
) {
  const config = useMemo(
    () => ({
      direction: 'right' as const,
      minSize: LAYOUT.CHAT_MIN_WIDTH,
      maxSize: LAYOUT.CHAT_MAX_WIDTH,
      onResizeEnd,
      // 拖拽下限放宽到 CHAT_MIN_WIDTH，松手时若 ≤ 该值则收起
      collapseThreshold: LAYOUT.CHAT_MIN_WIDTH,
      onCollapse,
      panelRef,
    }),
    [onResizeEnd, onCollapse, panelRef],
  )
  return useResizePanel(config)
}
