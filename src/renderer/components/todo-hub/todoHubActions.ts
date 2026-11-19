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
import { openBuiltinPanel } from '@renderer/plugins/pluginDrawerStore'
import { closeOverlaysForChat } from '@renderer/utils/chatOverlays'
import { useTodoHubStore, type HubTodoItem, type TodoSourceType } from './todoHubStore'
import { isSameContinuationItem, normalizeContinuationItem } from '@intelligence/utils/continuationItems'
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
 * 采集口径只认「AI 规划了、但还没开始做」的条目（status === 'pending'）：
 * - in_progress 表示 AI 正在执行，把它当待办会让用户看到一条「明明在做」的待办，
 *   而且它永远不会被收尾（reconcile 明确禁止把 in_progress 判为完成）；
 * - verifying 表示已经做完、正在过验证门，同样不属于待办。
 * 已完成的条目本来就被排除在外，因此这里不会再出现「AI 做完了还进待办」的情况。
 *
 * @param options.includeConversationTodos 是否采集会话待办清单。
 *        会话中途停止 / 报错 / 等待用户输入的轮次传 false：那些任务还有下文，
 *        补录成待办只会制造噪音；挂载任务不受此开关影响，始终采集。
 */
export function collectFromThread(
  threadId: string,
  options?: { includeConversationTodos?: boolean },
): void {
  const thread = useAgentStore.getState().threads[threadId]
  if (!thread) return

  const { add } = useTodoHubStore.getState()
  const sourceLabel = getThreadDisplayTitle(thread, 'New Chat')
  const includeConversationTodos = options?.includeConversationTodos !== false

  // 1) 未开始的会话待办清单：只收 pending，正在做和已做完的都不进待办中心
  if (includeConversationTodos) {
    for (const todo of thread.todos ?? []) {
      if (todo.status !== 'pending') continue
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

/**
 * 会话某一轮正常收尾时，把该会话遗留在待办中心里的条目一并收尾。
 *
 * AI 做完活之后，清单里全是 completed，但待办中心里由上一轮采集进去的条目
 * 可能因为措辞变化而没被同步到——它们其实是「已经执行完的任务」，却仍以
 * 待办形态留在清单里，用户会重复执行一遍。这里用一条不依赖模型的确定性规则兜底：
 * 本轮正常收尾 + 该会话清单存在且全部完成 ⇒ 该会话来源的待办都已做完。
 *
 * 清单为空时不收尾：todo_write 清空清单既可能是「全做完了」，也可能是模型
 * 中途放弃重排，无从判断，留给用户决定。
 * 执行中的条目由 resolveThreadTodos 按结束原因处理，此处不越权。
 */
export function settleConversationTodos(threadId: string): void {
  const thread = useAgentStore.getState().threads[threadId]
  if (!thread) return

  const todos = thread.todos ?? []
  if (todos.length === 0) return
  if (todos.some((t) => t.status !== 'completed')) return

  const hub = useTodoHubStore.getState()
  const pending = hub.items.filter(
    (i) =>
      i.sourceType === 'conversation' &&
      i.sourceId === threadId &&
      i.status === 'pending',
  )
  for (const item of pending) hub.complete(item.id)
}

/* ------------------------------------------------------------------ */
/* 执行 / 跳转                                                         */
/* ------------------------------------------------------------------ */

/** 回到聊天界面（关闭全屏页面、侧边面板与抽屉，确保聊天区域可见） */
function backToChat(): void {
  closeOverlaysForChat()
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
      // 面板以抽屉打开：先收起全屏页，再拉起抽屉，主区域的会话保持原样
      store.closeAllFullPages()
      openBuiltinPanel('mail-center')
      if (typeof window !== 'undefined' && item.sourceMeta) {
        window.dispatchEvent(
          new CustomEvent('aweeclaw:mail-locate', { detail: item.sourceMeta }),
        )
      }
      return true
    }
    case 'project': {
      store.closeAllFullPages()
      openBuiltinPanel('projects')
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

  // 1) 确定性同步：会话里已完成的任务，标题措辞有出入也一并收尾。
  //    这里不能只做字符串全等比对：模型重写清单时常把「编写登录页」改成
  //    「完成登录页实现」，全等比对会一条都匹配不上，已完成的任务就残留在待办里。
  const completedKeys = (thread.todos ?? [])
    .filter((t) => t.status === 'completed')
    .map((t) => normalizeContinuationItem(t.content))
    .filter(Boolean)
  if (completedKeys.length > 0) {
    const hub = useTodoHubStore.getState()
    for (const item of related) {
      const titleKey = normalizeContinuationItem(item.title ?? '')
      if (!titleKey) continue
      if (completedKeys.some((done) => isSameContinuationItem(done, titleKey))) {
        hub.complete(item.id)
      }
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
