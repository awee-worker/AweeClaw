/**
 * 消息索引栏
 *
 * 浮动在聊天窗口左侧，以圆点形式索引用户消息：
 *  - 每个用户消息对应一个圆点
 *  - 鼠标悬浮显示消息内容 tooltip（限 3 行 + 省略号）
 *  - 点击圆点滚动定位到对应消息
 *  - 当前可见区域内的圆点高亮
 *
 * 设计原则：
 *  - 单一职责：只负责索引展示和点击事件，不处理滚动逻辑（通过 onJump 回调上抛）
 *  - 可访问性：支持键盘 Tab + Enter 操作
 *  - 性能：使用 React.memo 避免不必要重渲染
 *
 * 关键实现：
 *  - 容器使用 overflow-y 滚动但隐藏滚动条（scrollbar-width: none + ::-webkit-scrollbar）
 *  - tooltip 通过 createPortal 渲染到 document.body，避免被父容器 overflow 裁剪
 */
import { memo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'

/** 单个用户消息索引项 */
export interface MessageIndexItem {
  /** 消息 ID（唯一） */
  id: string
  /** 消息纯文本内容（用于 tooltip 显示） */
  preview: string
  /** 在虚拟列表中的索引（用于 scrollToIndex） */
  index: number
}

interface MessageIndexBarProps {
  /** 用户消息索引列表（按时间顺序） */
  items: MessageIndexItem[]
  /** 当前可见范围内首个用户消息的 ID（用于高亮） */
  activeMessageId?: string | null
  /** 点击索引项时触发跳转 */
  onJump: (index: number) => void
  /** 语言（保留接口） */
  language?: string
}

/** tooltip 中预览文本的最大字符数 */
const PREVIEW_MAX_CHARS = 200
/** tooltip 中预览文本的最大行数 */
const PREVIEW_MAX_LINES = 3

/** 截断长文本：保留前 N 个字符并按行截断 */
function truncatePreview(text: string): string {
  if (!text) return ''
  // 标准化换行：将连续空白压缩为单个空格，保留显式换行
  const normalized = text.replace(/\s+/g, ' ').trim()
  // 按字符数截断
  const charTruncated = normalized.length > PREVIEW_MAX_CHARS
    ? normalized.slice(0, PREVIEW_MAX_CHARS) + '…'
    : normalized
  return charTruncated
}

/** 单个圆点按钮 */
interface IndexDotProps {
  item: MessageIndexItem
  isActive: boolean
  isHovered: boolean
  onClick: () => void
  onHover: (id: string | null) => void
  /** 当 active 时挂载 ref，用于滚动到可视区 */
  activeRef?: (node: HTMLButtonElement | null) => void
}

const IndexDot = memo(function IndexDot({
  item,
  isActive,
  isHovered,
  onClick,
  onHover,
  activeRef,
}: IndexDotProps) {
  // active 时挂载 ref，用于滚动到可视区
  const setRef = useCallback((node: HTMLButtonElement | null) => {
    if (isActive) activeRef?.(node)
  }, [isActive, activeRef])

  return (
    <button
      type="button"
      ref={setRef}
      data-msg-id={item.id}
      onClick={onClick}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(item.id)}
      onBlur={() => onHover(null)}
      className="relative flex items-center justify-center w-5 h-5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60 transition-all"
      aria-label={`跳转到消息 ${item.preview.slice(0, 30)}`}
    >
      {/* 圆点本体 */}
      <span
        className={`block rounded-full transition-all duration-200 ${
          isActive
            ? 'w-2 h-2 bg-accent shadow-[0_0_0_3px_rgba(99,102,241,0.18)]'
            : isHovered
              ? 'w-1.5 h-1.5 bg-accent/70'
              : 'w-1.5 h-1.5 bg-text-muted/40 hover:bg-text-muted/70'
        }`}
      />
    </button>
  )
})

/** Tooltip 渲染到 body 的 Portal 组件 */
interface TooltipPortalProps {
  /** 触发 tooltip 的圆点节点 */
  anchorNode: HTMLButtonElement | null
  /** 预览文本 */
  preview: string
}

function TooltipPortal({ anchorNode, preview }: TooltipPortalProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  // 根据圆点位置计算 tooltip 定位
  useLayoutEffect(() => {
    if (!anchorNode) {
      setPosition(null)
      return
    }
    const rect = anchorNode.getBoundingClientRect()
    // tooltip 显示在圆点右侧，垂直居中
    // left = 圆点右边缘 + 12px 间距
    // top = 圆点垂直中心 - tooltip 高度的一半（动态高度无法精确，用 transform: translateY(-50%) 处理）
    setPosition({
      top: rect.top + rect.height / 2,
      left: rect.right + 12,
    })
  }, [anchorNode])

  // 监听窗口滚动和尺寸变化，实时更新 tooltip 位置
  useEffect(() => {
    if (!anchorNode) return
    const update = () => {
      const rect = anchorNode.getBoundingClientRect()
      setPosition({
        top: rect.top + rect.height / 2,
        left: rect.right + 12,
      })
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchorNode])

  if (!position || !preview) return null

  return createPortal(
    <motion.div
      initial={{ opacity: 0, x: -4, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -4, scale: 0.96 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="fixed z-[9999] max-w-[280px] min-w-[120px] pointer-events-none"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translateY(-50%)',
      }}
    >
      <div
        className="bg-surface-elevated text-text-primary text-[12px] leading-relaxed px-3 py-2 rounded-lg border border-border/50 shadow-lg whitespace-pre-wrap break-words"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: PREVIEW_MAX_LINES,
          WebkitBoxOrient: 'vertical' as const,
          overflow: 'hidden',
        }}
      >
        {truncatePreview(preview)}
      </div>
      {/* 小箭头：指向圆点 */}
      <div className="absolute right-full top-1/2 -translate-y-1/2 border-[6px] border-transparent border-r-surface-elevated" />
    </motion.div>,
    document.body,
  )
}

function MessageIndexBarImpl({
  items,
  activeMessageId,
  onJump,
}: MessageIndexBarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeNodeRef = useRef<HTMLButtonElement | null>(null)
  // hovered 圆点的 DOM 节点（通过 querySelector 查找，用于 tooltip 定位）
  const [hoveredNode, setHoveredNode] = useState<HTMLButtonElement | null>(null)

  const handleClick = useCallback(
    (index: number) => {
      onJump(index)
    },
    [onJump],
  )

  // activeRef 回调：仅在 active 圆点挂载时设置 ref
  const setActiveNode = useCallback((node: HTMLButtonElement | null) => {
    activeNodeRef.current = node
  }, [])

  // hoveredId 变化时，通过 data-msg-id 查找对应 DOM 节点
  useEffect(() => {
    if (!hoveredId || !containerRef.current) {
      setHoveredNode(null)
      return
    }
    const node = containerRef.current.querySelector<HTMLButtonElement>(
      `button[data-msg-id="${CSS.escape(hoveredId)}"]`
    )
    setHoveredNode(node)
  }, [hoveredId, items])

  // 当 activeMessageId 变化时，滚动到对应圆点（保持可见）
  useEffect(() => {
    if (!activeMessageId) return
    const node = activeNodeRef.current
    if (!node || !containerRef.current) return
    // 仅在圆点不在可视区域时滚动
    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()
    const nodeRect = node.getBoundingClientRect()
    if (nodeRect.top < containerRect.top || nodeRect.bottom > containerRect.bottom) {
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeMessageId])

  // 当前 hovered 项的 preview
  const hoveredItem = hoveredId ? items.find(it => it.id === hoveredId) : null

  // 消息过少时不显示索引栏
  if (items.length <= 1) return null

  return (
    <>
      <div
        ref={containerRef}
        className="absolute left-0.5 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-2 py-1 max-h-[320px] overflow-y-auto scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        role="navigation"
        aria-label="用户消息索引"
      >
        {items.map((item) => {
          const isActive = item.id === activeMessageId
          const isHovered = item.id === hoveredId
          return (
            <IndexDot
              key={item.id}
              item={item}
              isActive={isActive}
              isHovered={isHovered}
              onClick={() => handleClick(item.index)}
              onHover={setHoveredId}
              activeRef={setActiveNode}
            />
          )
        })}
      </div>

      {/* Tooltip 通过 Portal 渲染到 body，避免被父容器 overflow 裁剪 */}
      <AnimatePresence>
        {hoveredItem && hoveredNode && (
          <TooltipPortal
            anchorNode={hoveredNode}
            preview={hoveredItem.preview}
          />
        )}
      </AnimatePresence>
    </>
  )
}

export const MessageIndexBar = memo(MessageIndexBarImpl)
