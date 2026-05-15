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

function computePlacement(anchor: DOMRect, tipW: number, tipH: number, side: Side): { top: number; left: number } {
  switch (side) {
    case 'top': return { top: anchor.top - tipH - GAP, left: anchor.left + (anchor.width - tipW) / 2 }
    case 'bottom': return { top: anchor.bottom + GAP, left: anchor.left + (anchor.width - tipW) / 2 }
    case 'left': return { top: anchor.top + (anchor.height - tipH) / 2, left: anchor.left - tipW - GAP }
    case 'right': return { top: anchor.top + (anchor.height - tipH) / 2, left: anchor.right + GAP }
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
    setCoords(computePlacement(rect, tw, th, side))
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
      {createPortal(tip, document.body)}
    </div>
  )
}
