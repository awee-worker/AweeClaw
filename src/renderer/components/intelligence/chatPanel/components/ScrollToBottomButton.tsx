/**
 * 滚动到底部按钮
 */
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

interface ScrollToBottomButtonProps {
  visible: boolean
  onClick: () => void
  language: Language
}

export function ScrollToBottomButton({ visible, onClick, language }: ScrollToBottomButtonProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 10 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-3 right-4 z-30"
        >
          <button
            onClick={onClick}
            className="w-8 h-8 rounded-full bg-surface/90 backdrop-blur-sm border border-border/50 shadow-lg shadow-black/15 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface transition-all"
            title={t('ai.scrolltobottom', language)}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
