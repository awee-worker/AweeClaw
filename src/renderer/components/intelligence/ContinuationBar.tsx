/**
 * 继续任务栏 — 会话底部（输入框上方）的确定性续做入口
 *
 * 与 MountedTaskBar（用户手动挂载的任务）不同，这里不依赖任何显式挂载：
 * 只要当前会话的待办清单里还有未完成项，且会话已经空闲，就出现这条栏，
 * 让用户一键继续，省去手动复制剩余清单再发给 AI 的麻烦。
 *
 * 与模型自觉调用 offer_continuation 的分工：
 * - offer_continuation：覆盖「AI 只口头说了没做完、并未建立待办清单」的情况
 * - 本组件：覆盖「AI 建立了待办清单但这一轮没做完」的情况，属确定性兜底，
 *   不依赖模型是否记得调用工具
 *
 * 展示条件（同时满足）：
 * - 当前会话存在未完成待办（剔除已完成项，以及「已有完成副本」的重复项，见 pickUncompletedTodos）
 * - 会话已空闲（不在流式输出 / 工具执行中）
 * - 没有已挂载任务在展示（避免与 MountedTaskBar 叠成两条续做入口）
 *
 * 默认只露第一条，条目多于一条时提供展开/收起，展开后列表在栏内滚动。
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ListChecks, Play, ChevronDown, ChevronUp } from 'lucide-react'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { buildContinuationPrompt } from '@intelligence/utils/continuationReply'
import { pickUncompletedTodos } from '@intelligence/utils/continuationItems'

/**
 * 折叠时展示的条目数
 *
 * 这条栏贴在输入框上方，本意是提示「还有活没干完」而不是把清单铺满视野，
 * 因此默认只露第一条，其余靠展开查看。
 */
const COLLAPSED_ITEM_COUNT = 1

function ContinuationBarBase() {
  const language = useStore(s => s.language) as Language
  const currentThreadId = useAgentStore(s => s.currentThreadId)
  const todos = useAgentStore(s =>
    currentThreadId ? s.threads[currentThreadId]?.todos : undefined,
  )
  const streamPhase = useAgentStore(s =>
    currentThreadId ? s.threads[currentThreadId]?.streamState?.phase : undefined,
  )
  const hasMountedTask = useAgentStore(s =>
    currentThreadId ? !!s.threads[currentThreadId]?.mountedTask : false,
  )

  // 用户点过「继续」或主动忽略后收起；切会话时复位，否则在一个会话里忽略后
  // 别的会话也看不到入口
  const [dismissed, setDismissed] = useState(false)
  // 展开态同样按会话来，避免上一个会话展开的清单带到下一个会话
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setDismissed(false)
    setExpanded(false)
  }, [currentThreadId])

  /**
   * 待办清单 → 待续做条目
   *
   * 不能只按 `status !== 'completed'` 过滤：模型重述清单时若只改了空白或标点，
   * todo_write 的精确比较会把旧的已完成项和新的未完成项同时留在清单里，那条
   * 「其实已经做完」的任务就会被渲染成待续做。pickUncompletedTodos 以完成态为准
   * 收敛这类重复副本，顺带丢掉空条目与重复条目。
   */
  const pendingItems = useMemo(
    () =>
      pickUncompletedTodos(todos || [])
        .map(todo => (todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content))
        .filter(Boolean),
    [todos],
  )

  const isBusy =
    streamPhase === 'streaming' || streamPhase === 'tool_running' || streamPhase === 'tool_pending'

  const visible = !dismissed && !hasMountedTask && !isBusy && pendingItems.length > 0

  const collapsible = pendingItems.length > COLLAPSED_ITEM_COUNT
  const hiddenCount = pendingItems.length - COLLAPSED_ITEM_COUNT
  const expandedList = expanded && collapsible

  const handleContinue = useCallback(() => {
    if (!currentThreadId || pendingItems.length === 0) return
    // 先收起，再派发：续接那一轮会进入流式状态，这里提前隐藏避免闪现
    setDismissed(true)
    window.dispatchEvent(new CustomEvent('chat-send-message', {
      detail: {
        content: buildContinuationPrompt(pendingItems),
        threadId: currentThreadId,
      },
    }))
  }, [currentThreadId, pendingItems])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="continuation-bar"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.18 }}
          className="mx-1 mb-2 rounded-xl border border-accent/25 bg-accent/[0.06] overflow-hidden"
        >
          <div className="flex items-center gap-2.5 px-3 py-2">
            <ListChecks className="w-4 h-4 shrink-0 text-accent" />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium text-accent">
                <span>{t('continue.bar.title', language)}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-accent/12 text-accent/90 text-[10px] font-normal">
                  {t('continue.bar.pending', language, { count: pendingItems.length })}
                </span>
                {collapsible && (
                  <button
                    type="button"
                    onClick={() => setExpanded(v => !v)}
                    className="flex items-center gap-0.5 text-[10px] font-normal text-accent/90 hover:text-accent transition-colors"
                  >
                    {expanded ? (
                      <>
                        <ChevronUp className="w-3 h-3" />
                        {t('continue.card.collapse', language)}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        {t('continue.card.expand', language, { count: hiddenCount })}
                      </>
                    )}
                  </button>
                )}
              </div>

              {expandedList ? (
                <ol className="mt-1 space-y-0.5 max-h-44 overflow-y-auto pr-1">
                  {pendingItems.map((item, index) => (
                    <li key={`${index}-${item}`} className="flex gap-1.5 text-xs text-text-secondary">
                      <span className="shrink-0 text-text-muted tabular-nums">{index + 1}.</span>
                      <span className="min-w-0 break-words">{item}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p
                  className="mt-0.5 text-xs text-text-secondary line-clamp-2 break-words"
                  title={pendingItems[0]}
                >
                  {pendingItems[0]}
                </p>
              )}
            </div>

            <div className="shrink-0 flex items-center gap-1.5">
              <button
                onClick={() => setDismissed(true)}
                className="h-7 px-2.5 rounded-lg text-text-muted hover:bg-text-primary/[0.04] text-xs transition-colors"
              >
                {t('continue.bar.skip', language)}
              </button>
              <button
                onClick={handleContinue}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-accent/12 hover:bg-accent/20 text-accent text-xs font-medium transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                {t('continue.bar.continue', language)}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export const ContinuationBar = memo(ContinuationBarBase)
export default ContinuationBar
