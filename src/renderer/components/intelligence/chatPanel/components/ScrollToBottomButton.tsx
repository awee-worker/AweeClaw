/**
 * 滚动到底部按钮
 *
 * 定位：吸附在聊天输入框顶部中间，与输入框顶部视觉融为一体。
 * 当聊天内容未滚动到底部时显示，点击平滑滚动到底部。
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
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute -top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none"
        >
          <button
            onClick={onClick}
            className="pointer-events-auto w-7 h-7 rounded-full bg-surface border border-border/60 shadow-md shadow-black/10 flex items-center justify-center text-text-muted hover:text-text-primary hover:border-accent/40 transition-all"
            title={t('ai.scrolltobottom', language)}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

