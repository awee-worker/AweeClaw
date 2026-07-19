/**
 * 命令输出容器
 *
 * 专门用于 run_command 工具的输出展示：
 *  - 纯 CSS 控制最大高度（max-height + overflow-y-auto），不依赖 JS 测量
 *  - 流式输出时自动滚动到底部
 *  - 用户向上滚动查看历史时不打断，滚回底部后恢复跟随
 *
 * 设计原则：
 *  - 简单可靠：只用 CSS，不涉及 ResizeObserver / measuredHeight 等复杂逻辑
 *  - 与 ExpandablePreviewContainer 解耦：命令输出不需要折叠/展开，只需限制高度 + 滚动
 */
import { useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'

interface CommandOutputContainerProps {
  children: ReactNode
  /** 最大高度（像素），默认 400 */
  maxHeightPx?: number
}

export function CommandOutputContainer({
  children,
  maxHeightPx = 400,
}: CommandOutputContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 用户是否手动向上滚动（避免流式输出时打断用户查看历史）
  const userScrolledUpRef = useRef(false)

  // 监听用户滚动行为
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      // 距离底部 < 10px 视为"在底部"，恢复自动跟随
      userScrolledUpRef.current = distanceFromBottom > 10
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // 内容变化时自动滚动到底部（仅当用户未向上滚动时）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (userScrolledUpRef.current) return
    // 直接设置 scrollTop，避免 smooth scroll 的动画延迟
    el.scrollTop = el.scrollHeight
  }, [children])

  return (
    <div
      ref={scrollRef}
      className="mt-1 overflow-y-auto custom-scrollbar"
      style={{
        maxHeight: `${maxHeightPx}px`,
        // 关键：使用固定 max-height，height 由内容决定但不超过 max-height
        // overflow-y-auto 会在内容超出时启用滚动条
      }}
    >
      {children}
    </div>
  )
}
