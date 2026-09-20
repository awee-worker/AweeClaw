/**
 * 挂载任务询问卡片 —— 会话被手动停止后内嵌在输入框上方
 *
 * 停止会话时不再用弹窗打断：弹窗会盖住整个界面，用户必须先处理掉它才能继续
 * 看上下文。这里把「是否挂载当前任务」做成会话内的一张卡片，用户当场决定，
 * 卡片收起后位置自然让回给输入框。
 *
 * 数据来源与后续流程见 mountedTaskService。
 */
import { memo, useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, Loader2, PackageOpen } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { mountThreadTaskWithFeedback } from '@intelligence/runtime/mountedTaskService'

interface MountedTaskPromptCardProps {
  /** 需要挂载执行情况的会话 */
  threadId: string
  /** 用户作出选择后回调，用于收起卡片 */
  onResolved: () => void
}

function MountedTaskPromptCardBase({ threadId, onResolved }: MountedTaskPromptCardProps) {
  const language = useStore(s => s.language) as Language
  const [isMounting, setIsMounting] = useState(false)

  /**
   * 挂载：整理期间卡片保持加载态，结束后一律收起。
   * 失败原因由 service 内部 toast 说明，卡片没必要留在界面上重复提示。
   */
  const handleMount = useCallback(() => {
    if (isMounting) return
    setIsMounting(true)
    void mountThreadTaskWithFeedback(threadId).finally(() => {
      setIsMounting(false)
      onResolved()
    })
  }, [threadId, isMounting, onResolved])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="mb-2 overflow-hidden rounded-xl border border-accent/25 bg-background-tertiary"
    >
      <div className="flex items-start gap-3 px-3.5 pt-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/15">
          {isMounting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          ) : (
            <PackageOpen className="h-3.5 w-3.5 text-accent" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="text-[12px] font-semibold text-text-primary">
            {t('mt.promptTitle', language)}
          </h4>
          <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-text-secondary">
            {isMounting ? t('mt.mounting', language) : t('mt.promptMessage', language)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 px-3.5 py-2.5">
        <button
          onClick={onResolved}
          disabled={isMounting}
          className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('mt.promptCancel', language)}
        </button>
        <button
          onClick={handleMount}
          disabled={isMounting}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isMounting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5" />
          )}
          {t('mt.promptConfirm', language)}
        </button>
      </div>
    </motion.div>
  )
}

export const MountedTaskPromptCard = memo(MountedTaskPromptCardBase)
export default MountedTaskPromptCard
