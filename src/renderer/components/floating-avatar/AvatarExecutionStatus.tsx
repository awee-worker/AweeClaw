/**
 * AvatarExecutionStatus — 悬浮球上方的执行状态指示器
 *
 * 当有项目任务执行时，在悬浮球正上方显示一个简洁的状态条，
 * 宽度与悬浮球一致（41px），看起来像从球体顶部延伸出去。
 *
 * 边缘感知设计：
 * - 球体在屏幕右侧时（edge='right'）：状态栏和球体在窗口右侧，tooltip 向左延伸
 * - 球体在屏幕左侧时（edge='left'）：状态栏和球体在窗口左侧，tooltip 向右延伸
 * - 球体屏幕位置始终保持不变（窗口扩展时边缘固定）
 *
 * 布局（窗口扩展后，宽度=220px）：
 * ┌────────────────────────┐  ← y=0（窗口顶部）
 * │      tooltip text      │  ← tooltip 预留区（TOOLTIP_RESERVE_HEIGHT）
 * ├────────────────────────┤
 * │                  ⟳  2 │  ← 状态栏（41px，靠右/靠左对齐）
 * ├────────────────────────┤  ← 间距（STATUS_BAR_GAP）
 * │                      ● │  ← 球体（41×41，靠右/靠左对齐）
 * └────────────────────────┘
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@renderer/adapters/electronBridge'
import type { ExecutionStatusSummary } from '../../types/electronBridge'

interface AvatarExecutionStatusProps {
  /** 执行状态摘要（来自执行窗口 IPC 推送） */
  status: ExecutionStatusSummary | null
  /** 状态栏边缘方向（来自主进程 IPC 推送，决定状态栏和 tooltip 的水平定位） */
  edge: 'left' | 'right' | null
  /** 点击打开执行窗口 */
  onClick: () => void
}

/** 状态条高度（与主进程 STATUS_BAR_HEIGHT 联动） */
const STATUS_BAR_HEIGHT = 28
/** tooltip 预留高度（与主进程 TOOLTIP_RESERVE_HEIGHT 联动） */
const TOOLTIP_RESERVE_HEIGHT = 44

export function AvatarExecutionStatus({ status, edge, onClick }: AvatarExecutionStatusProps) {
  const [hovered, setHovered] = useState(false)
  const hasActive = status && (status.runningCount > 0 || status.queuedCount > 0)

  // 活跃任务总数
  const activeCount = useMemo(() => {
    if (!status) return 0
    return status.runningCount + status.queuedCount
  }, [status])

  // tooltip 文案
  const tooltip = useMemo(() => {
    if (!status || activeCount === 0) return ''
    if (status.runningCount > 0 && status.queuedCount > 0) {
      return `${status.runningCount} 个项目执行中，${status.queuedCount} 个排队中`
    }
    if (status.runningCount > 0) {
      return `${activeCount} 个项目正在执行`
    }
    return `${status.queuedCount} 个任务排队中`
  }, [status, activeCount])

  // 有/无执行状态时，扩展/收起窗口
  useEffect(() => {
    if (hasActive) {
      api.floatingAvatar.expandForStatus()
    } else {
      api.floatingAvatar.collapseForStatus()
    }
  }, [hasActive])

  // 无状态不渲染（但 useEffect 仍需执行以收起窗口）
  if (!status || !hasActive) return null

  // 根据边缘方向计算定位样式
  // - edge='right'：球体在右侧，状态栏靠右对齐（right: 0）
  // - edge='left'：球体在左侧，状态栏靠左对齐（left: 0）
  // - edge=null：居中（窗口=球体宽度，居中=靠左=靠右）
  const barAlignStyle =
    edge === 'right'
      ? { right: 0 }
      : edge === 'left'
        ? { left: 0 }
        : { left: '50%', transform: 'translateX(-50%)' }

  return (
    <>
      {/* ============ 自定义 tooltip（悬停时显示在状态栏上方） ============ */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: `${TOOLTIP_RESERVE_HEIGHT}px`,
              display: 'flex',
              alignItems: 'center',
              // tooltip 文字向球体对侧延伸
              justifyContent: edge === 'right' ? 'flex-end' : edge === 'left' ? 'flex-start' : 'center',
              paddingRight: edge === 'right' ? '4px' : '0',
              paddingLeft: edge === 'left' ? '4px' : '0',
              zIndex: 20,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <div
              style={{
                padding: '4px 10px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.78)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
              }}
            >
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#ffffff',
                  lineHeight: 1.3,
                }}
              >
                {tooltip}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ 状态条（球体上方，渐变背景） ============ */}
      <motion.div
        initial={{ opacity: 0, y: 4, scale: 0.85 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.85 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onMouseEnter={() => {
          setHovered(true)
          api.floatingAvatar.expandForTooltip()
        }}
        onMouseLeave={() => {
          setHovered(false)
          api.floatingAvatar.collapseForTooltip()
        }}
        // ⚠️ 阻止 mousedown/mouseup/click 冒泡到父容器的球体拖拽/点击逻辑
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        style={{
          position: 'absolute',
          top: `${TOOLTIP_RESERVE_HEIGHT}px`,
          width: '41px',
          height: `${STATUS_BAR_HEIGHT}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '3px',
          cursor: 'pointer',
          zIndex: 10,
          // 根据边缘方向定位（与球体对齐）
          ...barAlignStyle,
          // 仅上方圆角，下方方角与球体衔接
          borderRadius: '10px 10px 0 0',
          // 渐变背景：accent 色渐变，视觉醒目
          background:
            'linear-gradient(180deg, var(--color-accent, #3b82f6), rgba(var(--color-accent-rgb, 59 130 246), 0.82))',
          // 顶部高光 + 外发光
          boxShadow:
            '0 -2px 12px rgba(var(--color-accent-rgb, 59 130 246), 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
        }}
      >
        {/* 旋转图标（白色） */}
        <Loader2
          style={{
            width: '12px',
            height: '12px',
            color: '#ffffff',
            animation: 'spin 1.2s linear infinite',
            flexShrink: 0,
          }}
        />
        {/* 活跃任务数量（白色加粗） */}
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1,
          }}
        >
          {activeCount}
        </span>
      </motion.div>
    </>
  )
}
