/**
 * 挂载任务栏 — 会话底部（输入框上方）的续跑入口
 *
 * 会话存在挂载任务时显示：
 * - 展示挂载时的任务目标与剩余步骤数
 * - 「继续执行任务」把执行情况静默交给 AI，接着停止前的进度继续做
 * - 「取消挂载」移除挂载（带二次确认，避免误点丢失整理好的执行情况）
 *
 * 生命周期（不让这条栏长期压在输入框上方）：
 * - 续跑执行期间收起：进度已经在时间线里逐条展开，此处的「剩余 N 步」既重复又过期；
 *   本轮 loop:end 复位标记，任务没跑完就重新出现
 * - 续跑正常收尾后挂载被自动卸下（见 mountedTaskService.settleMountedTaskResume）
 * - 未续跑的挂载是用户手动留下的「进度书签」，会一直保留到用户点 ✕ 取消
 *
 * 数据来源：useAgentStore 当前线程的 mountedTask / mountedTaskResuming
 */
import { memo, useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, PackageOpen, Play, X } from 'lucide-react'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { toast } from '@components/foundation/NotificationProvider'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { resumeMountedTask, unmountThreadTask } from '@intelligence/runtime/mountedTaskService'

function MountedTaskBarBase() {
  const language = useStore(s => s.language) as Language
  const currentThreadId = useAgentStore(s => s.currentThreadId)
  const mountedTask = useAgentStore(s =>
    currentThreadId ? s.threads[currentThreadId]?.mountedTask : undefined,
  )
  const streamPhase = useAgentStore(s =>
    currentThreadId ? s.threads[currentThreadId]?.streamState?.phase : undefined,
  )
  const isResuming = useAgentStore(s =>
    currentThreadId ? s.threads[currentThreadId]?.mountedTaskResuming === true : false,
  )

  const [isStarting, setIsStarting] = useState(false)

  const isBusy = streamPhase === 'streaming' || streamPhase === 'tool_running' || streamPhase === 'tool_pending'

  // 续跑执行期间收起：此时进度由时间线逐条呈现，任务栏的剩余步数只是过期快照。
  // 标记在 loop:end 复位 —— 任务没跑完（被停止 / 报错 / 需要用户回答）时会重新出现。
  const visible = !!mountedTask && !(isResuming && isBusy)

  const pendingLabel = useMemo(() => {
    if (!mountedTask) return ''
    if (mountedTask.pendingSteps.length === 0) return ''
    return t('mt.barPending', language, { count: mountedTask.pendingSteps.length })
  }, [mountedTask, language])

  const handleContinue = useCallback(() => {
    if (!currentThreadId || !mountedTask) return

    if (isBusy) {
      toast.warning(t('mt.resumeFailed', language))
      return
    }

    setIsStarting(true)
    const dispatched = resumeMountedTask(currentThreadId)
    if (!dispatched) {
      setIsStarting(false)
      toast.error(t('mt.mountFailed', language))
      return
    }
    // 续跑消息已派发，后续状态由流式渲染接管，这里只负责解除按钮的加载态
    setIsStarting(false)
  }, [currentThreadId, mountedTask, isBusy, language])

  const handleUnmount = useCallback(async () => {
    if (!currentThreadId) return

    const confirmed = await globalConfirm({
      title: t('mt.unmountConfirmTitle', language),
      message: t('mt.unmountConfirmMessage', language),
      confirmText: t('mt.unmountConfirmText', language),
      cancelText: t('mt.unmountConfirmCancel', language),
      variant: 'danger',
    })
    if (!confirmed) return

    unmountThreadTask(currentThreadId)
    toast.success(t('mt.unmounted', language))
  }, [currentThreadId, language])

  return (
    <AnimatePresence>
      {visible && mountedTask && (
        <motion.div
          key="mounted-task-bar"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          // 收起与自动卸下都滑走，让「任务跑完了、挂载已经不需要了」这件事看得出来
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.18 }}
          className="mx-1 mb-2 rounded-xl border border-accent/25 bg-accent/[0.06] overflow-hidden"
        >
          <div className="flex items-center gap-2.5 px-3 py-2">
            <PackageOpen className="w-4 h-4 shrink-0 text-accent" />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium text-accent">
                <span>{t('mt.barTitle', language)}</span>
                {pendingLabel && (
                  <span className="px-1.5 py-0.5 rounded-full bg-accent/12 text-accent/90 text-[10px] font-normal">
                    {pendingLabel}
                  </span>
                )}
                {mountedTask.resumedAt && !isBusy && (
                  <span className="text-[10px] font-normal text-text-muted">
                    {t('mt.barResumed', language)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-secondary truncate" title={mountedTask.objective}>
                {mountedTask.objective || t('mt.barTitle', language)}
              </p>
            </div>

            <button
              onClick={handleContinue}
              disabled={isStarting || isBusy}
              className="shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-accent/12 hover:bg-accent/20 text-accent text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isStarting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {t('mt.continue', language)}
            </button>

            <button
              onClick={() => void handleUnmount()}
              title={t('mt.unmount', language)}
              className="shrink-0 p-1.5 rounded-lg text-text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export const MountedTaskBar = memo(MountedTaskBarBase)
export default MountedTaskBar
