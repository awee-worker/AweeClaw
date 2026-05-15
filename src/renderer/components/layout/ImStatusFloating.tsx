import { useMemo } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useImProcessingStatus } from '@hooks/useImProcessingStatus'
import { useStore } from '@store'
import type { ImProcessingPhase } from '@shared/protocols/channel'

const phaseLabels: Record<ImProcessingPhase, { zh: string; en: string }> = {
  received: { zh: '已收到消息', en: 'Message received' },
  thinking: { zh: '正在思考', en: 'Thinking' },
  replying: { zh: '正在回复', en: 'Replying' },
  done: { zh: '回复完成', en: 'Reply sent' },
  error: { zh: '处理出错', en: 'Error' },
}

export default function ImStatusFloating() {
  const language = useStore(s => s.language)
  const imStatuses = useImProcessingStatus()

  const displayStatus = useMemo(() => {
    if (imStatuses.length === 0) return null
    const status = imStatuses[imStatuses.length - 1]
    const labels = phaseLabels[status.phase]
    const countLabel = imStatuses.length > 1
      ? (language === 'zh' ? ` (${imStatuses.length}条)` : ` (${imStatuses.length})`)
      : ''
    return {
      text: `${status.channelLabel} · ${status.senderName} - ${labels[language === 'zh' ? 'zh' : 'en']}${countLabel}`,
      phase: status.phase,
    }
  }, [imStatuses, language])

  return (
    <AnimatePresence>
      {displayStatus && (displayStatus.phase === 'thinking' || displayStatus.phase === 'replying' || displayStatus.phase === 'received') && (
        <motion.div
          initial={{ opacity: 0, y: 20, x: 20 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, y: 20, x: 20 }}
          transition={{ duration: 0.25 }}
          className="fixed bottom-4 right-4 z-[100] flex items-center gap-2 px-3 py-2 rounded-xl bg-surface/90 backdrop-blur-xl border border-border/50 shadow-lg shadow-black/15 text-[12px] font-medium select-none"
        >
          {displayStatus.phase === 'thinking' || displayStatus.phase === 'replying' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
          ) : (
            <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          )}
          <span className={`truncate max-w-[280px] ${
            displayStatus.phase === 'thinking' || displayStatus.phase === 'replying'
              ? 'text-accent'
              : 'text-text-muted'
          }`}>
            {displayStatus.text}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
