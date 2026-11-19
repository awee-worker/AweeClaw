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
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { collectFromThread, reconcileThreadTodos, resolveThreadTodos, settleConversationTodos } from './todoHubActions'
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
    // 1) 会话每轮执行结束：收敛执行中的条目；正常收尾时补录 AI 计划的未执行任务。
    //    无论以何种原因结束都要收敛，否则用户手动停止会话后条目会一直显示执行中。
    //    Planner 子任务（带 planTaskId）单独结束，不代表整体收尾，跳过。
    const unsubLoop = EventBus.on('loop:end', (event) => {
      const threadId = event.threadId
      if (!threadId) return

      const settled = SETTLED_LOOP_END_REASONS.has(event.reason)

      if (!event.planTaskId) {
        // 待办只收「AI 计划过、但一行都没开始做」的条目，且只在正常收尾时补录：
        // 中途停止 / 报错 / 等用户输入的轮次，任务还有下文（用户会接着让 AI 做），
        // 提前灌进待办中心只会制造一堆打不完的噪音条目。
        // 挂载任务是例外——它本身就是「用户主动停下、留待以后做」的产物，始终采集。
        const hasMountedTask = Boolean(useAgentStore.getState().threads[threadId]?.mountedTask)
        if (settled || hasMountedTask) {
          collectFromThread(threadId, { includeConversationTodos: settled })
        }

        resolveThreadTodos(threadId, settled)
        resolveThreadWorkTodos(threadId, settled)
        // 正常收尾且会话清单已全部完成 ⇒ 该会话遗留的待办都是做完的任务，一并收尾。
        // 此前只靠标题比对同步，措辞一变就漏，刚被 AI 做掉的任务会留在待办里。
        if (settled) settleConversationTodos(threadId)
        // AI 介入：对齐会话任务清单与待办中心条目（抑制重复、同步完成状态）。
        // 异步执行且自带降级，不阻塞 loop:end 的同步收尾。
        void reconcileThreadTodos(threadId)
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
