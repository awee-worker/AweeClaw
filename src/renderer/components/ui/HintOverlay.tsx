import React, { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

type Side = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  side?: Side
  delay?: number
  className?: string
}

const GAP = 8

/** 提示框与视口边缘的最小留白：贴边会被窗口圆角、阴影裁掉 */
const EDGE = 8

interface Viewport {
  width: number
  height: number
}

/** 首选方向的反面：放不下时翻过去 */
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

function clamp(value: number, min: number, max: number): number {
  // 提示框比视口还宽时 max < min，以 min 为准，至少保证左/上边界可见
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** 该方向能否完整容纳提示框（含间距与边缘留白） */
function fits(anchor: DOMRect, tipW: number, tipH: number, side: Side, viewport: Viewport): boolean {
  switch (side) {
    case 'top': return anchor.top - GAP - tipH - EDGE >= 0
    case 'bottom': return anchor.bottom + GAP + tipH + EDGE <= viewport.height
    case 'left': return anchor.left - GAP - tipW - EDGE >= 0
    case 'right': return anchor.right + GAP + tipW + EDGE <= viewport.width
  }
}

/**
 * 计算提示框位置
 *
 * 两件事必须在这里做完，否则提示会被窗口边界切掉：
 * 1. 首选方向放不下就翻到对面（顶部按钮翻到下方、右侧导航翻到左侧），
 *    只要对面放得下就优先翻转；
 * 2. 翻转后仍可能越界 —— 最右侧按钮按锚点居中计算，右半截会跑到窗口外，
 *    而上下方向本来就放得下、翻转无从谈起。因此最终坐标统一钳制进视口。
 */
function computePlacement(anchor: DOMRect, tipW: number, tipH: number, preferred: Side, viewport: Viewport): { top: number; left: number } {
  const side = !fits(anchor, tipW, tipH, preferred, viewport) && fits(anchor, tipW, tipH, OPPOSITE[preferred], viewport)
    ? OPPOSITE[preferred]
    : preferred

  let top = 0
  let left = 0
  switch (side) {
    case 'top':
      top = anchor.top - tipH - GAP
      left = anchor.left + (anchor.width - tipW) / 2
      break
    case 'bottom':
      top = anchor.bottom + GAP
      left = anchor.left + (anchor.width - tipW) / 2
      break
    case 'left':
      top = anchor.top + (anchor.height - tipH) / 2
      left = anchor.left - tipW - GAP
      break
    case 'right':
      top = anchor.top + (anchor.height - tipH) / 2
      left = anchor.right + GAP
      break
  }

  return {
    top: clamp(top, EDGE, viewport.height - tipH - EDGE),
    left: clamp(left, EDGE, viewport.width - tipW - EDGE),
  }
}

export function HintOverlay({ content, children, side = 'top', delay = 300, className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const anchorRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reposition = useCallback(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const tw = tipRef.current?.offsetWidth ?? 0
    const th = tipRef.current?.offsetHeight ?? 0
    setCoords(computePlacement(rect, tw, th, side, { width: window.innerWidth, height: window.innerHeight }))
  }, [side])

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setVisible(true)
      requestAnimationFrame(reposition)
    }, delay)
  }, [delay, reposition])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  const tip = visible ? (
    <div
      ref={tipRef}
      className="fixed z-[9999] px-2.5 py-1 text-[12px] font-medium text-text-primary bg-surface-active/90 backdrop-blur-md border border-border rounded-lg shadow-xl animate-scale-in pointer-events-none whitespace-nowrap tracking-wide select-none origin-center"
      style={{ top: coords.top, left: coords.left }}
    >
      {content}
    </div>
  ) : null

  return (
    <div ref={anchorRef} onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide} className={`relative inline-block ${className}`}>
      {children}
      {/* 未显示时不创建 portal：标签栏等场景会同时挂载大量实例，空 portal 也有调和开销 */}
      {tip && createPortal(tip, document.body)}
    </div>
  )
}
