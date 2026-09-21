/**
 * 内嵌 DevTools 面板
 *
 * DevTools 本体由主进程渲染在原生视图（WebContentsView）上，覆盖在本面板之上。
 * 这里只做三件事：占出右侧的空间、把自己的矩形同步给主进程、内嵌不可用时通知调用方回退。
 *
 * 尺寸变化会连着来（拖动窗口边缘），统一合并到一帧里上报一次。
 */
import { useEffect, useRef } from 'react'
import { api } from '@renderer/adapters/electronBridge'

/** 面板默认宽度（px） */
export const DOCKED_DEVTOOLS_WIDTH = 420

interface DockedDevToolsPanelProps {
  /** 预览 webview 的 guest id */
  guestId: number
  /** 内嵌不可用时的回调：调用方负责收起本面板并改用独立窗口 */
  onUndock: () => void
}

export default function DockedDevToolsPanel({ guestId, onUndock }: DockedDevToolsPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // 回调放进 ref：父组件每次渲染都会给新的函数引用，不该因此重跑打开流程
  const onUndockRef = useRef(onUndock)
  onUndockRef.current = onUndock

  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    let frame = 0
    let disposed = false

    const measure = () => {
      const rect = node.getBoundingClientRect()
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    }

    const reportBounds = () => {
      frame = 0
      const rect = measure()
      if (rect.width <= 0 || rect.height <= 0) return
      void api.preview.setDevToolsBounds(guestId, rect)
    }

    const scheduleBounds = () => {
      if (frame) return
      frame = requestAnimationFrame(reportBounds)
    }

    const open = async () => {
      const rect = measure()
      if (rect.width <= 0 || rect.height <= 0) return

      try {
        const result = await api.preview.openDevTools(guestId, rect)
        if (disposed) return

        if (!result?.success || !result.data?.docked) {
          onUndockRef.current()
        }
      } catch {
        // 内嵌失败不能静默：交给调用方改用独立窗口
        if (!disposed) onUndockRef.current()
      }
    }

    void open()

    const observer = new ResizeObserver(scheduleBounds)
    observer.observe(node)
    window.addEventListener('resize', scheduleBounds)

    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', scheduleBounds)
    }
  }, [guestId])

  return (
    <div
      ref={containerRef}
      className="h-full shrink-0 border-l border-border/50 bg-background-editor"
      style={{ width: DOCKED_DEVTOOLS_WIDTH }}
      aria-label="DevTools"
    />
  )
}
