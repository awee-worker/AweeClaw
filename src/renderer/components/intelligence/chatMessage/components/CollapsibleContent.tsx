/**
 * CollapsibleContent - 内容超高折叠组件
 *
 * 用于用户消息等长内容：当内容高度超过 maxHeight（默认 360px）时自动隐藏，
 * 底部显示「展开更多」按钮，点击展开查看全部内容；再次点击可收起。
 *
 * 特性：
 * - 内容变化后自动重新测量（延迟到渲染完成，兼容 Markdown 异步渲染）
 * - 折叠时底部有渐变遮罩（fadeColor 跟随气泡背景色，默认 var(--surface)）
 * - 展开/收起按钮文案与样式可通过 props 定制（适配主窗口/悬浮球不同主题）
 */
import { memo, useRef, useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface CollapsibleContentProps {
  children: React.ReactNode
  /** 折叠时的最大高度（px），默认 360 */
  maxHeight?: number
  /** 展开按钮文案 */
  expandLabel?: string
  /** 收起按钮文案 */
  collapseLabel?: string
  /** 折叠渐变遮罩颜色（需与气泡背景色一致），默认 var(--surface) */
  fadeColor?: string
  /** 展开/收起按钮自定义类名（适配浅色/深色气泡） */
  buttonClassName?: string
}

export const CollapsibleContent = memo(function CollapsibleContent({
  children,
  maxHeight = 360,
  expandLabel = '展开更多',
  collapseLabel = '收起',
  fadeColor = 'var(--surface)',
  buttonClassName = 'text-accent hover:text-accent-hover',
}: CollapsibleContentProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  /** 内容是否超过阈值（由测量决定，与展开状态独立） */
  const [overflow, setOverflow] = useState(false)
  /** 用户是否已展开 */
  const [expanded, setExpanded] = useState(false)

  // 内容变化后重新测量高度（延迟到渲染完成；scrollHeight 不受 max-height 裁剪影响）
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = contentRef.current
      if (el) {
        setOverflow(el.scrollHeight > maxHeight)
      }
    }, 60)
    return () => clearTimeout(timer)
  }, [children, maxHeight])

  const handleToggle = useCallback(() => {
    setExpanded((p) => !p)
  }, [])

  return (
    <div className="relative">
      <div
        ref={contentRef}
        style={{ maxHeight: expanded ? undefined : maxHeight, overflow: 'hidden' }}
      >
        {children}
      </div>

      {overflow && (
        <div className="relative">
          {/* 折叠时底部渐变遮罩：内容淡出到气泡背景色 */}
          {!expanded && (
            <div
              className="absolute bottom-full left-0 right-0 h-8 pointer-events-none"
              style={{ background: `linear-gradient(to top, ${fadeColor}, transparent)` }}
            />
          )}
          <button
            type="button"
            onClick={handleToggle}
            className={`flex items-center gap-1 text-xs font-medium pt-1 transition-colors ${buttonClassName}`}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? collapseLabel : expandLabel}
          </button>
        </div>
      )}
    </div>
  )
})

CollapsibleContent.displayName = 'CollapsibleContent'
