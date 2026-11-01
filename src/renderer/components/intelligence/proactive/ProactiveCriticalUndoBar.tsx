/**
 * critical 撤销确认条（阶段10 P2 改造三）
 *
 * 用途：把 critical 级主动动作的「撤销窗口」变成用户看得见的东西。
 * 主进程只负责倒计时到期后执行，窗口期间用户在界面上看到的就是这个条：
 * 还剩几秒、要执行什么、两个出口（立即执行 / 撤销）。
 *
 * 与 ProactiveSuggestionCard 的区别：
 * - 卡片是 medium 级的「建议」，用户不点就不动
 * - 确认条是 critical 级的「即将执行」，用户不点也会执行
 * 所以这里用红色警示配色 + 进度条，并且不做自动消失以外的任何弱化处理。
 *
 * 数据流：
 *   ProactiveActionTrigger.scheduleCriticalWithUndo()
 *     → 'proactive:critical-pending'
 *     → useProactiveCriticalWindow
 *     → ProactiveCriticalUndoBar
 *     → confirmCritical / cancelCritical
 *
 * 集成位置：ChatPanel 顶部，ProactiveSuggestionsContainer 之上
 *
 * @module intelligence/proactive/ProactiveCriticalUndoBar
 */

import { memo, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap, Play, Undo2, CheckCircle2 } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import {
  useProactiveCriticalWindow,
  type CriticalWindowItem,
} from './useProactiveCriticalWindow'

/** 倒计时刷新间隔（ms）：100ms 足够让进度条看起来连续 */
const TICK_MS = 100

interface Props {
  language: Language
}

/**
 * 全局共享的「当前时间」，供所有确认条计算剩余时间
 *
 * 放在容器里统一 tick，是为了避免 N 条确认条各起一个定时器。
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    // 立刻对齐一次，避免第一帧用到挂载时的旧时间
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => {
      clearInterval(timer)
    }
  }, [active])

  return now
}

// ============================================================
// 容器
// ============================================================

export const ProactiveCriticalUndoBar = memo(function ProactiveCriticalUndoBar({
  language,
}: Props) {
  const { windows, confirm, cancel } = useProactiveCriticalWindow()
  const now = useNow(windows.length > 0)

  if (windows.length === 0) return null

  return (
    <div
      className="shrink-0 px-4 pt-2 z-20"
      role="region"
      aria-label={t('proactive.undo.ariaLabel', language)}
    >
      <AnimatePresence mode="popLayout">
        {windows.map((item) => (
          <UndoBarItem
            key={item.proposalId}
            item={item}
            now={now}
            language={language}
            onConfirm={confirm}
            onCancel={cancel}
          />
        ))}
      </AnimatePresence>
    </div>
  )
})

// ============================================================
// 单条确认条
// ============================================================

interface UndoBarItemProps {
  item: CriticalWindowItem
  now: number
  language: Language
  onConfirm: (proposalId: string) => void
  onCancel: (proposalId: string) => void
}

const UndoBarItem = memo(function UndoBarItem({
  item,
  now,
  language,
  onConfirm,
  onCancel,
}: UndoBarItemProps) {
  const remainingMs = Math.max(0, item.expiresAt - now)
  const remainingSec = Math.ceil(remainingMs / 1000)
  const progress = item.windowMs > 0 ? Math.min(1, remainingMs / item.windowMs) : 0
  const settled = item.settled === 'executed'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.2 }}
      role="alert"
      aria-live="assertive"
      className={`relative overflow-hidden rounded-xl border px-3 py-2.5 mb-2 ${
        settled
          ? 'border-text-muted/30 bg-text-muted/10'
          : 'border-red-500/40 bg-red-500/10'
      }`}
    >
      <div className="flex items-center gap-2.5">
        {/* 图标 */}
        <div
          className={`p-1.5 rounded-lg shrink-0 ${
            settled ? 'bg-text-muted/15' : 'bg-red-500/20'
          }`}
        >
          {settled ? (
            <CheckCircle2 className="w-4 h-4 text-text-muted" />
          ) : (
            <Zap className="w-4 h-4 text-red-400" />
          )}
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">
              {item.title}
            </span>
            {!settled && (
              <span className="text-[12px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-red-500/25 text-red-300">
                {t('proactive.undo.badge', language)}
              </span>
            )}
          </div>

          <div className="text-[12px] text-text-secondary truncate">
            {settled
              ? t('proactive.undo.executed', language)
              : t('proactive.undo.countdown', language, { seconds: remainingSec })}
          </div>

          {item.action.payload && (
            <div className="text-[12px] text-text-muted font-mono truncate">
              {item.action.payload}
            </div>
          )}
        </div>

        {/* 出口 */}
        {!settled && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onConfirm(item.proposalId)}
              title={t('proactive.undo.confirm', language)}
              aria-label={t('proactive.undo.confirm', language)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium transition-colors bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/30"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{t('proactive.undo.confirm', language)}</span>
            </button>
            <button
              type="button"
              onClick={() => onCancel(item.proposalId)}
              title={t('proactive.undo.cancel', language)}
              aria-label={t('proactive.undo.cancel', language)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium transition-colors bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>{t('proactive.undo.cancel', language)}</span>
            </button>
          </div>
        )}
      </div>

      {/* 倒计时进度条：走完即主进程自动执行 */}
      <div className="absolute left-0 bottom-0 h-[2px] w-full bg-red-500/15">
        <div
          className={`h-full ${settled ? 'bg-text-muted/40' : 'bg-red-500/70'}`}
          style={{
            width: `${progress * 100}%`,
            transition: `width ${TICK_MS}ms linear`,
          }}
        />
      </div>
    </motion.div>
  )
})
