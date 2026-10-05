/**
 * TodoHubCollector — 待办中心全局采集器
 *
 * 挂载在应用根部，作为「会话 → 待办」生命周期的唯一监听入口：
 * - 监听智能体循环结束事件，把会话中未完成的任务自动汇入待办中心；
 * - 监听挂载事件，把用户停止会话后挂载的任务汇入待办中心；
 * - 每一轮结束时收敛从该会话发起的「AI 执行中」条目（待办中心与场景工具
 *   「待办清单」两套数据一致处理）：正常收尾标记完成，其余结束原因（被停止 /
 *   报错 / 达到轮次上限…）退回待办，避免永远停在执行中。
 *
 * 邮件与项目任务属于组件层，直接在各自的数据回调里调用采集函数，不经过此处。
 */
import { useEffect } from 'react'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { collectFromThread, resolveThreadTodos } from './todoHubActions'
import { resolveThreadWorkTodos } from '@components/scene-tools/work/workTodoExec'

/** 请求采集指定会话的待办（供挂载等场景解耦派发） */
export const TODO_COLLECT_THREAD_EVENT = 'aweeclaw:todo-collect-thread'

/**
 * 视为「这一轮已正常收尾、执行中的条目可以标记完成」的结束原因。
 *
 * 其余原因（aborted / error / interrupted / max_iterations / no_messages /
 * waiting_for_user…）都意味着任务还有下文，条目退回待办让用户可以重新执行。
 */
const SETTLED_LOOP_END_REASONS = new Set(['complete', 'tool_requested_stop'])

export function TodoHubCollector() {
  useEffect(() => {
    // 1) 会话每轮执行结束：汇入未完成任务；并收敛执行中的条目状态。
    //    无论以何种原因结束都要收敛，否则用户手动停止会话后条目会一直显示执行中。
    //    Planner 子任务（带 planTaskId）单独结束，不代表整体收尾，跳过。
    const unsubLoop = EventBus.on('loop:end', (event) => {
      const threadId = event.threadId
      if (!threadId) return
      collectFromThread(threadId)
      if (!event.planTaskId) {
        const settled = SETTLED_LOOP_END_REASONS.has(event.reason)
        resolveThreadTodos(threadId, settled)
        resolveThreadWorkTodos(threadId, settled)
      }
    })

    // 2) 挂载任务：会话被停止后挂载成功，汇入待办中心
    const handleCollect = (e: Event) => {
      const threadId = (e as CustomEvent<string>).detail
      if (typeof threadId === 'string' && threadId) collectFromThread(threadId)
    }
    window.addEventListener(TODO_COLLECT_THREAD_EVENT, handleCollect)

    return () => {
      unsubLoop()
      window.removeEventListener(TODO_COLLECT_THREAD_EVENT, handleCollect)
    }
  }, [])

  return null
}

export default TodoHubCollector
