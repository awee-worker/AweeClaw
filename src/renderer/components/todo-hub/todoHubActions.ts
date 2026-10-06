/**
 * 待办中心 · 动作层
 *
 * 汇总「来源 → 待办」的采集逻辑，以及待办的执行与来源跳转能力。
 * 采集函数都按 dedupeKey 去重，可安全地在事件回调里反复调用。
 */
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { getThreadDisplayTitle, type TodoItem } from '@intelligence/providerTypes'
import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
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

/* ------------------------------------------------------------------ */
/* 会话待办协调：抑制重复并同步完成状态                                  */
/* ------------------------------------------------------------------ */

/**
 * 每个会话最近一次的协调签名。
 *
 * loop:end 每轮都会触发协调，但「会话任务清单 + 待办中心条目」在多数轮次里
 * 并没有变化。用签名短路重复判断，避免每轮都打一次模型。
 */
const reconcileSignatures = new Map<string, string>()

const RECONCILE_SYSTEM_PROMPT = `You are reconciling one user-facing todo list with the task list kept inside a single conversation.

Input:
- CONVERSATION_TODOS: the task list the assistant maintains in the conversation. Each line is "[status] content", status is one of pending / in_progress / verifying / completed.
- HUB_ITEMS: the todos currently shown in the hub that came from this conversation. Each line is "id=<id> | title=<title> | status=<status>".

Decide only two things:
1. complete: ids of HUB_ITEMS whose task is already finished in the conversation, even when the wording differs. A task that is still pending / in_progress / verifying in the conversation must NEVER be completed.
2. remove: ids of HUB_ITEMS that are semantic duplicates of another HUB_ITEM - keep one copy (prefer the earliest original) and remove the rest. Never remove the only copy of a task.

Rules:
- Only output ids that appear in HUB_ITEMS. Never invent ids.
- When unsure about an item, leave it out of both lists.
- Output JSON only: {"complete": [...], "remove": [...]}`

const TODO_RECONCILE_SCHEMA = {
  type: 'object',
  properties: {
    complete: { type: 'array', items: { type: 'string' } },
    remove: { type: 'array', items: { type: 'string' } },
  },
  required: ['complete', 'remove'],
  additionalProperties: false,
} as const

function buildReconcilePrompt(todos: TodoItem[], items: HubTodoItem[]): string {
  const todoLines = todos.map((t) => `- [${t.status}] ${t.content}`).join('\n')
  const itemLines = items.map((i) => `id=${i.id} | title=${i.title} | status=${i.status}`).join('\n')
  return [
    'CONVERSATION_TODOS:',
    todoLines || '(empty)',
    '',
    'HUB_ITEMS:',
    itemLines || '(empty)',
  ].join('\n')
}

/**
 * 协调某个会话的待办：把待办中心里来自该会话的条目与会话内任务清单对齐。
 *
 * 分两步：
 * 1. 确定性同步：会话里已标记完成、且标题与待办条目一致的，直接标记完成，
 *    不依赖模型，保证未配置模型时也能收敛。
 * 2. AI 语义协调：处理「措辞不同但属同一任务」（完成同步）与「同一任务的多条
 *    重复条目」（去重）。未配置模型、调用失败或返回异常都静默跳过，只保留
 *    第 1 步的确定性结果，不影响主流程。
 */
export async function reconcileThreadTodos(threadId: string): Promise<void> {
  const thread = useAgentStore.getState().threads[threadId]
  if (!thread) return

  const related = useTodoHubStore
    .getState()
    .items.filter(
      (i) => i.sourceType === 'conversation' && i.sourceId === threadId && i.status !== 'done',
    )
  if (related.length === 0) return

  // 1) 确定性同步：会话里已完成的任务，同名条目一并收尾
  const completedContents = new Set(
    (thread.todos ?? [])
      .filter((t) => t.status === 'completed')
      .map((t) => t.content.trim()),
  )
  if (completedContents.size > 0) {
    const hub = useTodoHubStore.getState()
    for (const item of related) {
      if (completedContents.has((item.title ?? '').trim())) hub.complete(item.id)
    }
  }

  // 内容未变化时跳过语义判断，避免每轮都打模型
  const signature = JSON.stringify({
    todos: (thread.todos ?? []).map((t) => [t.content, t.status]),
    items: related.map((i) => [i.id, i.title, i.status]),
  })
  if (reconcileSignatures.get(threadId) === signature) return
  reconcileSignatures.set(threadId, signature)

  const { llmConfig } = useStore.getState()
  if (!llmConfig?.apiKey) return

  // 2) AI 语义协调
  try {
    const result = await api.llm.generateObject({
      config: { ...llmConfig, temperature: 0, maxTokens: 600 },
      schema: TODO_RECONCILE_SCHEMA,
      system: RECONCILE_SYSTEM_PROMPT,
      prompt: buildReconcilePrompt(thread.todos ?? [], related),
    })
    if (result.error || !result.object) {
      logger.agent.warn('[TodoHub] Reconcile skipped:', result.error || 'empty object')
      return
    }

    const validIds = new Set(related.map((i) => i.id))
    const complete = Array.isArray(result.object.complete) ? (result.object.complete as string[]) : []
    const remove = Array.isArray(result.object.remove) ? (result.object.remove as string[]) : []
    const completeSet = new Set(complete.filter((id) => validIds.has(id)))

    const hub = useTodoHubStore.getState()
    for (const id of completeSet) hub.complete(id)
    // 只删真正的重复项；已判定完成的条目优先保留，避免被去重覆盖
    for (const id of remove) {
      if (validIds.has(id) && !completeSet.has(id)) hub.remove(id)
    }
  } catch (error) {
    logger.agent.warn('[TodoHub] Reconcile failed, keep deterministic result:', error)
  }
}
