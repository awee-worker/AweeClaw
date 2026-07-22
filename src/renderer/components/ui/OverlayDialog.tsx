import React, { memo, useMemo } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useEscapeKey } from '@hooks/usePerformance'
import { useElevatedToastLayer } from '@components/foundation/toastLayerStore'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full'
  noPadding?: boolean
  className?: string
  showCloseButton?: boolean
  disableGlassEffect?: boolean
}

const WIDTH_MAP: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  full: 'max-w-full mx-4 h-[90vh]',
}

export const OverlayDialog: React.FC<ModalProps> = memo(function OverlayDialog({
  isOpen, onClose, title, children, size = 'md', noPadding = false, className = '', showCloseButton = true, disableGlassEffect = false,
}) {
  useEscapeKey(onClose, isOpen)
  useElevatedToastLayer(isOpen)

  const widthCls = useMemo(() => WIDTH_MAP[size], [size])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className={`absolute inset-0 ${disableGlassEffect ? 'bg-text-inverted/60' : 'bg-text-inverted/50'}`}
        onClick={onClose}
      />
      {/*
        内容容器只使用 opacity 动画，不使用 scale/y。
        原因：framer-motion 的 scale/y 会在元素上残留 CSS transform，
        transform 会创建包含块（containing block），导致内部子模态的
        position:fixed 失效（被 overflow-hidden 裁剪），
        同时可能干扰 absolute 定位元素的命中测试。
        纯 opacity 动画不产生 transform，彻底消除此类问题。
      */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className={`relative w-full ${widthCls} max-h-[90vh] bg-background/95 border border-border/50 rounded-3xl shadow-2xl shadow-black/20 overflow-hidden flex flex-col ${className}`}
      >
        {!disableGlassEffect && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
            <div className="modal-orb-glow absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-accent/5 rounded-full blur-[100px]" />
            <div className="modal-orb-glow absolute bottom-[-20%] left-[-10%] w-[40%] h-[40%] bg-accent/3 rounded-full blur-[80px]" />
          </div>
        )}
        {title && (
          <div className="relative flex items-center justify-between px-5 py-3 border-b border-border/50 bg-text-primary/[0.02] z-10 shrink-0">
            <h3 className="text-sm font-bold text-text-primary tracking-tight">{title}</h3>
          </div>
        )}
        {showCloseButton && (
          <button onClick={onClose} className="absolute top-3 right-3 z-30 p-2 rounded-lg hover:bg-text-primary/[0.05] text-text-muted hover:text-text-primary transition-all duration-200 group">
            <X className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
          </button>
        )}
        <div className={`relative z-10 custom-scrollbar ${noPadding ? '' : 'p-6'} flex-1 overflow-auto`}>{children}</div>
      </motion.div>
    </div>,
    document.body,
  )
})
