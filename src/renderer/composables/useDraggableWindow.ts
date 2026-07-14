/**
 * useDraggableWindow - 可拖拽浮动窗口 hook
 *
 * 提供：
 * - 窗口位置状态
 * - 拖拽事件处理
 * - 边界约束（不超出视口）
 * - 位置记忆（localStorage）
 */

import { useState, useCallback, useRef, useEffect } from 'react'

interface Position {
  x: number
  y: number
}

interface DraggableWindowOptions {
  /** 默认位置（相对于视口右上角的偏移） */
  defaultPosition?: Position
  /** localStorage 存储键（为空则不持久化） */
  storageKey?: string
  /** 窗口尺寸（用于边界约束） */
  windowSize?: { width: number; height: number }
}

interface DraggableWindowResult {
  position: Position
  isDragging: boolean
  dragHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void
  }
  setPosition: (pos: Position) => void
  resetPosition: () => void
}

export function useDraggableWindow(options: DraggableWindowOptions = {}): DraggableWindowResult {
  const {
    defaultPosition = { x: 0, y: 0 },
    storageKey,
    windowSize = { width: 320, height: 400 },
  } = options

  const [position, setPosition] = useState<Position>(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey)
        if (saved) {
          const parsed = JSON.parse(saved) as Position
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            // 边界校验：确保窗口不超出视口
            const maxX = window.innerWidth - windowSize.width - 10
            const maxY = window.innerHeight - windowSize.height - 10
            return {
              x: Math.min(parsed.x, maxX),
              y: Math.min(parsed.y, Math.max(10, maxY)),
            }
          }
        }
      } catch {
        // ignore
      }
    }
    return defaultPosition
  })

  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0, startY: 0, posX: 0, posY: 0,
  })

  // 持久化位置
  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(position))
    } catch {
      // ignore
    }
  }, [position, storageKey])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // 只响应左键
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: position.x,
      posY: position.y,
    }
    setIsDragging(true)

    const handleMove = (ev: PointerEvent) => {
      const dx = ev.clientX - dragStartRef.current.startX
      const dy = ev.clientY - dragStartRef.current.startY
      let newX = dragStartRef.current.posX + dx
      let newY = dragStartRef.current.posY + dy

      // 边界约束：不超出视口，保留 10px 边距
      const maxX = window.innerWidth - windowSize.width - 10
      const maxY = window.innerHeight - windowSize.height - 10
      newX = Math.max(10, Math.min(maxX, newX))
      newY = Math.max(10, Math.min(maxY, newY))

      setPosition({ x: newX, y: newY })
    }

    const handleUp = () => {
      setIsDragging(false)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [position, windowSize.width, windowSize.height])

  const resetPosition = useCallback(() => {
    setPosition(defaultPosition)
  }, [defaultPosition])

  return {
    position,
    isDragging,
    dragHandleProps: { onPointerDown },
    setPosition,
    resetPosition,
  }
}
