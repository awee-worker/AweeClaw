/**
 * 场景工具「待办清单」的 AI 执行支持
 *
 * 待办清单（work-todo）与待办中心（todo-hub）是两套独立数据，但「让 AI 执行」
 * 的流程一致：点击时把条目置为执行中并记下执行所在会话，会话一轮结束时由循环
 * 结束监听（TodoHubCollector）按结束原因收敛状态。
 *
 * 只在点击时标记执行中而不收敛，条目就会永远停在「AI 执行中」——用户手动停止
 * 会话、执行报错、达到轮次上限都属于这种情况。
 */
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useTodoStore, type WorkTodoItem } from '../stores'

/**
 * 让 AI 执行该任务。
 *
 * 执行前先确定执行所在会话并记到条目上：这一轮结束时靠它把执行态收回来。
 * 同时确保聊天区可见——聊天区隐藏时 ChatPanel 处于卸载状态，收不到派发的事件，
 * 表现为点了「执行」却毫无反应、条目一直停在执行中。
 */
export function executeWorkTodo(item: WorkTodoItem): void {
  const agent = useAgentStore.getState()

  // 优先复用当前会话；没有可用会话时新建一个并激活，保证 AI 有地方执行
  let threadId: string = agent.currentThreadId ?? ''
  if (!threadId || !agent.threads[threadId]) {
    threadId = agent.createThread({ activate: true })
  }

  useTodoStore.getState().update(item.id, {
    status: 'executing',
    executingThreadId: threadId,
  })

  const store = useStore.getState()
  store.closeAllFullPages()
  store.setChatVisible(true)

  const prompt = `请帮我执行以下任务，完成后告知结果：\n\n${item.text}${item.dueDate ? `\n（截止日期：${item.dueDate}）` : ''}`

  // 等聊天界面挂载后再派发，避免 ChatPanel 尚未监听时事件丢失。
  // 定向发往执行会话：目标会话是当前会话时正常显示为用户消息，用户已切走则
  // 静默发往原会话，两种情况都能落到正确的线程上。
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('chat-send-message', {
          detail: { content: prompt, messageId: '', threadId },
        }),
      )
    }, 80)
  }
}

/**
 * 会话一轮结束时，收敛由该会话发起执行的任务状态。
 *
 * @param threadId 本轮结束的会话 id
 * @param settled  这一轮是否正常收尾；收尾则标记完成，否则退回待办让用户可以重新执行
 */
export function resolveThreadWorkTodos(threadId: string, settled: boolean): void {
  const store = useTodoStore.getState()
  for (const item of store.items) {
    if (item.status !== 'executing' || item.executingThreadId !== threadId) continue
    store.update(item.id, {
      status: settled ? 'done' : 'pending',
      executedAt: settled ? Date.now() : undefined,
      executingThreadId: undefined,
    })
  }
}
