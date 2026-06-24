/**
 * 拖放遮罩组件
 * 当用户拖拽文件到聊天面板时显示视觉反馈
 */
import { motion, AnimatePresence } from 'framer-motion'
import { Upload } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

interface DragOverlayProps {
  isDragging: boolean
  language: Language
}

export function DragOverlay({ isDragging, language }: DragOverlayProps) {
  return (
    <AnimatePresence>
      {isDragging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 bg-background/80 flex items-center justify-center pointer-events-none"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="flex flex-col items-center gap-4 p-8 rounded-3xl border border-accent/30 bg-surface/90 shadow-2xl shadow-accent/20"
          >
            <div className="p-5 rounded-full bg-accent/10 border border-accent/20 relative">
              <div className="absolute inset-0 bg-accent/20 blur-xl rounded-full animate-pulse" />
              <Upload className="w-10 h-10 text-accent relative z-10" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-text-primary mb-1">
                {t('ai.dropfilestoaddcontext', language)}
              </p>
              <p className="text-sm text-text-muted">{t('ai.supportscodeandattachments', language)}</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
