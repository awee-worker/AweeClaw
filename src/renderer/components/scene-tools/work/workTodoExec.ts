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
import type { ToolExecutionContext } from '@shared/protocols/modelGateway'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { closeOverlaysForChat } from '@renderer/utils/chatOverlays'
import { useTodoStore, type WorkTodoItem } from '../stores'

/**
 * 给 work-todo 的写入补上执行会话。
 *
 * 条目被置为 executing 后，这一轮会话结束时要靠 executingThreadId 把执行态收回来
 * （见 resolveThreadWorkTodos）。AI 通过 scene_tools_update 直接把条目改成 executing
 * 时，patch 里没有这个字段，条目就会永远停在「AI 执行中」——用户既等不到结果，
 * 也没法重新执行。
 *
 * 退出执行态时一并清掉会话记录，避免下一轮把上一条执行会话的残留当成自己的。
 */
export function stampWorkTodoExecution(
  toolId: string,
  patch: Record<string, unknown>,
  context?: ToolExecutionContext,
): Record<string, unknown> {
  if (toolId !== 'work-todo' || patch.status === undefined) return patch
  if (patch.status === 'executing') {
    const threadId = context?.threadId ?? useAgentStore.getState().currentThreadId ?? undefined
    return { ...patch, executingThreadId: threadId }
  }
  return { ...patch, executingThreadId: undefined }
}

/**
 * 让 AI 执行该任务。
 *
 * 执行前先确定执行所在会话并记到条目上：这一轮结束时靠它把执行态收回来。
 * 同时确保聊天区可见——聊天区隐藏时 ChatPanel 处于卸载状态，收不到派发的事件，
 * 表现为点了「执行」却毫无反应、条目一直停在执行中。
 */
export function executeWorkTodo(item: WorkTodoItem): void {
  // 已经在执行的任务不再二次下发：重复执行会再发一轮 prompt，并把 executingThreadId
  // 覆写成当前会话——若用户此时切到了别的会话，原会话结束时就匹配不上，条目漏收敛。
  // 按钮在执行中已禁用，这里是数据层的兜底，防止其它入口绕过。
  const current = useTodoStore.getState().items.find((i) => i.id === item.id)
  if (current?.status === 'executing') return

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

  // 待办清单渲染在场景工具抽屉里，抽屉带遮罩盖住聊天区，执行前必须先收起来
  closeOverlaysForChat()

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
 * 会话一轮结束时，收敛「执行中」的任务状态。
 *
 * 两类条目都要处理：
 * - 记着执行会话（executingThreadId === threadId）的，按本轮结束原因收敛；
 * - 没有执行会话记录的，说明归属不明（历史数据，或 AI 通过 scene_tools_update
 *   直接把条目改成执行中），一律退回待办。不能标完成：它可能一步都没做，
 *   而「永远执行中」既没有进度也点不动，比退回待办更糟。
 *
 * @param threadId 本轮结束的会话 id
 * @param settled  这一轮是否正常收尾；收尾则标记完成，否则退回待办让用户可以重新执行
 */
export function resolveThreadWorkTodos(threadId: string, settled: boolean): void {
  const store = useTodoStore.getState()
  for (const item of store.items) {
    if (item.status !== 'executing') continue

    if (item.executingThreadId === threadId) {
      store.update(item.id, {
        status: settled ? 'done' : 'pending',
        executedAt: settled ? Date.now() : undefined,
        executingThreadId: undefined,
      })
      continue
    }

    if (!item.executingThreadId) {
      store.update(item.id, { status: 'pending', executingThreadId: undefined })
    }
  }
}
