/**
 * 可展开预览容器
 * 采用「尺寸测量器 + 渐变遮罩 + 展开切换」三层结构：
 *  - 尺寸测量器：通过 ResizeObserver 实时测量内容高度
 *  - 渐变遮罩：折叠时底部渐变提示可展开
 *  - 展开切换：点击切换展开/折叠状态
 *
 * 可选 autoScrollToBottom：流式输出场景（如命令执行）自动滚动到底部，
 * 用户向上滚动查看历史时不打断，滚回底部后恢复自动跟随。
 */
import { useState, useLayoutEffect, useMemo, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

/** 从 Tailwind 高度类名提取像素值 */
function parseHeightPx(heightClass: string): number {
  const bracketMatch = heightClass.match(/\[(\d+)px\]/)
  if (bracketMatch) return Number(bracketMatch[1])
  const remMatch = heightClass.match(/max-h-(\d+)/)
  if (remMatch) return Number(remMatch[1]) * 4
  return 200
}

/** 从高度类名提取展示值 */
function parseHeightDisplay(heightClass: string): string {
  const match = heightClass.match(/\[(.*?)\]/)
  return match ? match[1] : heightClass.replace('max-h-', '')
}

interface ExpandablePreviewContainerProps {
  children: React.ReactNode
  maxHeight?: string
  expandedHeight?: string
  language?: Language
  /** 初始是否展开（仅在组件首次挂载时生效，后续由用户操作控制） */
  defaultExpanded?: boolean
  /** 流式输出场景自动滚动到底部（用户向上滚动时不打断，滚回底部后恢复跟随） */
  autoScrollToBottom?: boolean
}

export function ExpandablePreviewContainer({
  children,
  maxHeight = 'max-h-[200px]',
  expandedHeight = 'max-h-[350px]',
  language = 'en',
  defaultExpanded = false,
  autoScrollToBottom = false,
}: ExpandablePreviewContainerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const contentRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [measuredHeight, setMeasuredHeight] = useState(0)
  // 用户是否手动向上滚动（用于 autoScrollToBottom 场景，避免打断用户查看历史）
  const userScrolledUpRef = useRef(false)

  const collapsedMaxHeight = useMemo(() => parseHeightPx(maxHeight), [maxHeight])
  const expandedMaxHeight = useMemo(() => parseHeightPx(expandedHeight), [expandedHeight])
  const activeMaxHeight = expanded ? expandedMaxHeight : collapsedMaxHeight
  const heightDisplay = useMemo(() => parseHeightDisplay(expandedHeight), [expandedHeight])

  // 监听用户滚动行为，区分「用户主动向上滚动」与「内容增长导致的滚动」
  useEffect(() => {
    if (!autoScrollToBottom) return
    const content = contentRef.current
    if (!content) return

    const handleScroll = () => {
      const distanceFromBottom = content.scrollHeight - content.scrollTop - content.clientHeight
      // 距离底部小于 10px 视为"在底部"，恢复自动跟随
      userScrolledUpRef.current = distanceFromBottom > 10
    }
    content.addEventListener('scroll', handleScroll, { passive: true })
    return () => content.removeEventListener('scroll', handleScroll)
  }, [autoScrollToBottom])

  useLayoutEffect(() => {
    const content = contentRef.current
    const inner = innerRef.current
    if (!content || !inner) return

    const measure = () => {
      const totalHeight = inner.scrollHeight
      const nextHeight = Math.max(1, Math.min(totalHeight, activeMaxHeight))
      const nextOverflowing = totalHeight > activeMaxHeight + 10
      setIsOverflowing(nextOverflowing)
      setMeasuredHeight(nextHeight)
    }

    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(content)
    resizeObserver.observe(inner)
    return () => resizeObserver.disconnect()
  }, [children, expanded, activeMaxHeight])

  // 内容变化时自动滚动到底部（仅在 autoScrollToBottom 启用且用户未向上滚动时）
  useLayoutEffect(() => {
    if (!autoScrollToBottom) return
    const content = contentRef.current
    if (!content) return
    if (userScrolledUpRef.current) return
    // 滚动到底部（使用 behavior: 'auto' 避免流式输出时的滚动动画延迟）
    content.scrollTop = content.scrollHeight
  }, [children, measuredHeight, autoScrollToBottom])

  return (
    <div className="mt-1 relative overflow-hidden">
      <div
        ref={contentRef}
        className="overflow-y-auto custom-scrollbar transition-[height,background-color] duration-300 ease-out relative"
        style={
          autoScrollToBottom
            ? {
                // 流式输出场景：直接用 max-height + overflow-y-auto，不依赖 JS 测量
                // 确保容器高度不会超过 max-height，内容超出时自动滚动
                maxHeight: activeMaxHeight,
                height: 'auto',
              }
            : {
                height: measuredHeight || undefined,
                maxHeight: activeMaxHeight,
              }
        }
      >
        <div ref={innerRef}>{children}</div>
      </div>
      {isOverflowing && !expanded && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(true)
          }}
          className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-surface/80 via-surface/40 to-transparent flex items-end justify-center pb-2 cursor-pointer transition-all opacity-90 hover:opacity-100"
        >
          <div className="flex items-center gap-1 font-medium pb-0.5 pointer-events-none bg-surface-elevated text-text-muted hover:text-accent px-3 py-1 rounded-full shadow-sm border border-border/40 text-[11px] transition-colors">
            <ChevronDown className="w-3 h-3" />
            {t('toolExpand', language as any, { height: heightDisplay })}
          </div>
        </div>
      )}
      {isOverflowing && expanded && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(false)
          }}
          className="w-full text-center py-2 mt-1 cursor-pointer flex items-center justify-center"
        >
          <div className="flex items-center gap-1 font-medium pointer-events-none bg-surface-elevated text-text-muted hover:text-accent px-4 py-1 rounded-full shadow-sm border border-border/40 text-[11px] transition-colors">
            <ChevronDown className="w-3 h-3 rotate-180 pointer-events-none" />
            {t('toolCollapse', language as any)}
          </div>
        </div>
      )}
    </div>
  )
}
