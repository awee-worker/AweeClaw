/**
 * 待办中心 · 动作层
 *
 * 汇总「来源 → 待办」的采集逻辑，以及待办的执行与来源跳转能力。
 * 采集函数都按 dedupeKey 去重，可安全地在事件回调里反复调用。
 */
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { getThreadDisplayTitle } from '@intelligence/providerTypes'
import { useTodoHubStore, type HubTodoItem, type TodoSourceType } from './todoHubStore'
import type { TaskItem } from '../explorer/panels/tasks/types'

/* ------------------------------------------------------------------ */
/* 来源元信息                                                          */
/* ------------------------------------------------------------------ */

export interface SourceMeta {
  labelZh: string
  labelEn: string
  color: string
}

export const TODO_SOURCE_META: Record<TodoSourceType, SourceMeta> = {
  manual: { labelZh: '手动创建', labelEn: 'Manual', color: '#8b5cf6' },
  conversation: { labelZh: '会话', labelEn: 'Conversation', color: '#3b82f6' },
  mounted: { labelZh: '挂载任务', labelEn: 'Mounted', color: '#f59e0b' },
  mail: { labelZh: '邮件', labelEn: 'Mail', color: '#06b6d4' },
  project: { labelZh: '项目任务', labelEn: 'Project', color: '#22c55e' },
}

/* ------------------------------------------------------------------ */
/* 采集                                                                */
/* ------------------------------------------------------------------ */

/**
 * 从会话收集「未完成的任务」与「挂载任务」。
 *
 * 会话执行过程中，AI 通过 todo_write 建立的待办清单里未完成的条目、
 * 以及用户主动停止会话后挂载的任务，都会进入待办中心。
 */
export function collectFromThread(threadId: string): void {
  const thread = useAgentStore.getState().threads[threadId]
  if (!thread) return

  const { add } = useTodoHubStore.getState()
  const sourceLabel = getThreadDisplayTitle(thread, 'New Chat')

  // 1) 未完成的会话待办清单
  for (const todo of thread.todos ?? []) {
    if (todo.status === 'completed') continue
    add({
      title: todo.content,
      detail: todo.activeForm && todo.activeForm !== todo.content ? todo.activeForm : undefined,
      status: 'pending',
      priority: 'medium',
      sourceType: 'conversation',
      sourceId: threadId,
      sourceLabel,
      dedupeKey: `conv:${threadId}:${todo.content}`,
    })
  }

  // 2) 挂载任务：同一会话可能先后挂载多次，去重键带上挂载时间，
  //    否则第二次挂载会命中上一次已完成（或已存在）的条目而被吞掉
  const mounted = thread.mountedTask
  if (mounted) {
    const pending = mounted.pendingSteps ?? []
    add({
      title: mounted.objective || '继续执行已挂载的任务',
      detail:
        pending.length > 0
          ? `${pending.length} 个待完成步骤`
          : mounted.summary?.slice(0, 200) || undefined,
      status: 'pending',
      priority: 'high',
      sourceType: 'mounted',
      sourceId: threadId,
      sourceLabel,
      dedupeKey: `mount:${threadId}:${mounted.mountedAt}`,
    })
  }
}

/**
 * 从邮件中心 AI 整理结果收集待办。
 *
 * @param params 邮件定位信息与 AI 提取出的待办列表
 */
export function collectFromMail(params: {
  accountId: string
  folder: string
  uid: number
  subject: string
  todos: Array<{ task: string; dueDate?: string }>
}): void {
  const { add } = useTodoHubStore.getState()
  const locator = `${params.accountId}:${params.folder}:${params.uid}`

  for (const todo of params.todos) {
    if (!todo.task?.trim()) continue
    add({
      title: todo.task.trim(),
      status: 'pending',
      priority: 'medium',
      sourceType: 'mail',
      sourceId: locator,
      sourceLabel: params.subject || '邮件',
      sourceMeta: {
        accountId: params.accountId,
        folder: params.folder,
        uid: String(params.uid),
      },
      dueDate: todo.dueDate,
      dedupeKey: `mail:${locator}:${todo.task.trim()}`,
    })
  }
}

/**
 * 从项目 / 后端任务收集未完成任务。
 *
 * 已取消与已完成的任务不进入清单。
 */
export function collectFromTasks(tasks: TaskItem[]): void {
  const { add } = useTodoHubStore.getState()

  for (const task of tasks) {
    if (task.status === 'DONE' || task.status === 'CANCELED') continue
    const priority: HubTodoItem['priority'] =
      task.priority === 'URGENT' || task.priority === 'HIGH'
        ? 'high'
        : task.priority === 'LOW'
          ? 'low'
          : 'medium'
    add({
      title: task.title,
      detail: task.description ?? undefined,
      status: 'pending',
      priority,
      sourceType: 'project',
      sourceId: task.id,
      sourceLabel: task.projectId ?? undefined,
      dueDate: task.dueAt ? task.dueAt.slice(0, 10) : undefined,
      dedupeKey: `task:${task.id}`,
    })
  }
}

/**
 * 会话某一轮结束时，收敛「由该会话发起执行」的待办状态。
 *
 * 待办点「执行」时会置为 executing 并记录执行所在会话（executingThreadId）。
 * 一轮无论以何种原因结束，都必须把执行态收回来，否则待办中心会永远停在
 * 「AI 执行中」——用户手动停止会话、执行报错、达到轮次上限都属于这种情况。
 *
 * @param threadId 本轮结束的会话 id
 * @param settled  这一轮是否正常收尾：收尾则标记完成（自动从进行中消失），
 *                 否则退回待办让用户可以重新执行
 */
export function resolveThreadTodos(threadId: string, settled: boolean): void {
  const hub = useTodoHubStore.getState()
  const running = hub.items.filter(
    (i) =>
      i.status === 'executing' &&
      // 优先按执行会话匹配；没有执行会话记录的历史数据退回按来源会话匹配
      (i.executingThreadId === threadId || (!i.executingThreadId && i.sourceId === threadId)),
  )
  if (running.length === 0) return

  if (settled) {
    for (const item of running) {
      hub.update(item.id, {
        status: 'done',
        completedAt: Date.now(),
        executingThreadId: undefined,
      })
    }
    return
  }

  for (const item of running) {
    hub.update(item.id, {
      status: 'pending',
      executingThreadId: undefined,
      aiNote: undefined,
    })
  }
}

/* ------------------------------------------------------------------ */
/* 执行 / 跳转                                                         */
/* ------------------------------------------------------------------ */

/** 回到聊天界面（关闭全屏页面与侧边面板，确保聊天区域可见） */
function backToChat(): void {
  const store = useStore.getState()
  store.closeAllFullPages()
  store.setActiveSidePanel(null)
  store.setChatVisible(true)
}

/**
 * 让 AI 执行该待办：标记执行中，并把待办内容带入聊天界面交给 AI。
 *
 * 执行前先锁定执行所在会话并记到待办上：这一轮结束时靠它把执行态收回来
 * （见 resolveThreadTodos）。若直接发往「当前会话」，用户中途切走会话后
 * 执行结束就匹配不上，待办会永远停在「AI 执行中」。
 */
export function executeHubTodo(item: HubTodoItem): void {
  const agent = useAgentStore.getState()

  // 优先复用当前会话；没有可用会话时新建一个并激活，保证 AI 有地方执行
  let threadId: string = agent.currentThreadId ?? ''
  if (!threadId || !agent.threads[threadId]) {
    threadId = agent.createThread({ activate: true })
  }

  useTodoHubStore.getState().update(item.id, {
    status: 'executing',
    aiNote: undefined,
    executingThreadId: threadId,
    executingAt: Date.now(),
  })
  backToChat()

  const lines = [`请帮我完成以下待办事项，完成后告知结果：`, '', item.title]
  if (item.detail) lines.push(`（补充说明：${item.detail}）`)
  if (item.dueDate) lines.push(`（截止日期：${item.dueDate}）`)
  if (item.sourceType !== 'manual' && item.sourceLabel) {
    lines.push(`（来源：${item.sourceLabel}）`)
  }
  const prompt = lines.join('\n')

  // 等聊天界面挂载后再派发，避免 ChatPanel 尚未监听时事件丢失。
  // 走 chat-send-message 定向发往执行会话：目标会话是当前会话时正常显示为用户
  // 消息，用户已切走则静默发往原会话，两种情况都能落到正确的线程上。
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
 * 打开待办来源，回到来源继续完成任务。
 *
 * - 会话 / 挂载任务 → 切换回对应会话
 * - 邮件 → 打开邮件中心（附定位信息，邮件中心支持时自动定位到该邮件）
 * - 项目任务 → 打开项目管理面板
 */
export async function openTodoSource(item: HubTodoItem): Promise<boolean> {
  const store = useStore.getState()

  switch (item.sourceType) {
    case 'conversation':
    case 'mounted': {
      if (!item.sourceId) return false
      backToChat()
      await useAgentStore.getState().switchThread(item.sourceId)
      return true
    }
    case 'mail': {
      store.setActiveSidePanel('mail-center')
      store.closeAllFullPages()
      if (typeof window !== 'undefined' && item.sourceMeta) {
        window.dispatchEvent(
          new CustomEvent('aweeclaw:mail-locate', { detail: item.sourceMeta }),
        )
      }
      return true
    }
    case 'project': {
      store.setActiveSidePanel('projects')
      store.closeAllFullPages()
      return true
    }
    default:
      return false
  }
}
