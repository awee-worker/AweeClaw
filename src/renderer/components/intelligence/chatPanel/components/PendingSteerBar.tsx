/**
 * 待生效插话提示条
 *
 * 插话入队时不再往会话里塞用户气泡：那条气泡会落在消息列表末尾，而 AI 的后续输出
 * 仍写进同一条助手消息，读起来就成了「AI 先说完、才看到补充」。既然位置由采纳时刻
 * 决定，等待期就必须有个不依赖消息流的交代，这一行就是那个交代。
 *
 * 生效（被取走）或丢弃时队列会广播，提示条随之收起 —— 收起本身就是「已经进去了」
 * 的信号，不必再弹一条 toast 去解释。
 */
import { useCallback, useSyncExternalStore } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { pendingLocalSteerCount, subscribeLocalSteer } from '@intelligence/runtime/localSteer'
import { t, type Language } from '@renderer/i18n'

/** 订阅函数必须保持稳定引用，否则 useSyncExternalStore 每轮都会重新订阅 */
const subscribe = subscribeLocalSteer

export function PendingSteerBar() {
  const threadId = useAgentStore(s => s.currentThreadId)
  const language = useStore(s => s.language)

  const getSnapshot = useCallback(
    () => (threadId ? pendingLocalSteerCount(threadId) : 0),
    [threadId],
  )
  const count = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  if (count <= 0) return null

  return (
    <div className="w-full max-w-[800px] mx-auto px-4 pb-1.5 flex justify-end">
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface px-2.5 py-1 text-[12px] text-text-tertiary"
        role="status"
        aria-live="polite"
      >
        <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
        {count > 1
          ? t('chat.steer.pendingMany', language as Language, { count })
          : t('chat.steer.pendingOne', language as Language)}
      </span>
    </div>
  )
}
