/**
 * 消息内联浮层
 * 用于在消息操作栏的 chip 旁弹出内容（任务列表、文件变更等）
 * 采用 fixed 定位，点击外部关闭
 */
import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

interface MessagePopoverProps {
  /** 触发器（chip 按钮） */
  trigger: React.ReactNode
  /** 弹层内容 */
  children: React.ReactNode
  /** 弹层标题 */
  title?: string
  /** 弹层宽度 */
  width?: number
  /** 受控打开（可选） */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function MessagePopoverBase({
  trigger,
  children,
  title,
  width = 360,
  open: controlledOpen,
  onOpenChange,
}: MessagePopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setOpen = (v: boolean) => {
    setInternalOpen(v)
    onOpenChange?.(v)
  }

  // 定位弹层：在触发器上方
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const top = rect.top - 8 // 8px 间距
    const left = rect.left
    setPos({ top, left })
  }, [isOpen])

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [isOpen])

  // 滚动时关闭
  useEffect(() => {
    if (!isOpen) return
    const handleScroll = () => setOpen(false)
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('scroll', handleScroll, opts)
    return () => window.removeEventListener('scroll', handleScroll, opts)
  }, [isOpen])

  return (
    <>
      <span
        ref={triggerRef as React.RefObject<HTMLSpanElement>}
        onClick={(e) => {
          e.stopPropagation()
          if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect()
            setPos({ top: rect.top - 8, left: rect.left })
          }
          setOpen(!isOpen)
        }}
      >
        {trigger}
      </span>

      <AnimatePresence>
        {isOpen && pos && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width,
              zIndex: 9999,
              transform: 'translateY(-100%)',
            }}
            className="bg-surface border border-border/60 rounded-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
                <span className="text-xs font-medium text-text-primary">{title}</span>
                <button
                  onClick={() => setOpen(false)}
                  className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export const MessagePopover = React.memo(MessagePopoverBase)
MessagePopover.displayName = 'MessagePopover'
