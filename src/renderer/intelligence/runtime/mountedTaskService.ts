/**
 * 挂载任务服务 — 会话被手动停止时把任务执行情况附着到会话上
 *
 * 背景：用户点击「停止会话」后，AI 已完成的步骤与未完成的步骤都留在会话里，
 * 但用户离开再回来时只能靠翻聊天记录自己回忆「做到哪了」。挂载功能把这份
 * - 停止后在会话底部展示挂载询问卡片，确认后由模型整理出执行情况（失败时退化为规则提取）
 * - 历史会话与侧边栏据此显示挂载标识
 * - 重新打开该会话后可从底部任务栏一键「继续执行」，把执行情况静默交给 AI 续跑
 * - 续跑期间收起底部任务栏；续跑正常收尾后自动卸下挂载，避免续跑上下文长期占用 token、
 *   任务栏长期压在输入框上方
 */

import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { generateSummary } from '@intelligence/capabilities/context/summaryEngine'
import { t, type Language } from '@renderer/i18n'
import { toast } from '@components/foundation/NotificationProvider'
import type { MountedTaskInfo } from '@intelligence/providerTypes'

/* ------------------------------------------------------------------ */
/* 常量                                                               */
/* ------------------------------------------------------------------ */

/** 挂在会话底部任务栏上的续跑指令（用户可见按钮对应的静默消息内容） */
export const MOUNTED_TASK_RESUME_MESSAGE = '继续执行已挂载的任务'

/** 执行情况整理的单次 token 上限 */
const SUMMARY_MAX_TOKENS = 1000

/** 执行情况里最多保留的未完成步骤数（超出会让续跑提示过于冗长） */
const MAX_PENDING_STEPS = 8

/**
 * 视为「续跑那一轮已经跑完」的结束原因
 *
 * complete 是正常收尾；tool_requested_stop 是工具主动要求结束循环（loopState 同样
 * 置为 completed），两者都不该再把挂载留下去。其余原因（被停止 / 报错 / 达到迭代
 * 上限 / 需要用户回答）都意味着任务还有下文，保留挂载让用户可以接着跑。
 */
const SETTLED_LOOP_END_REASONS = new Set(['complete', 'tool_requested_stop'])

/* ------------------------------------------------------------------ */
/* 执行情况整理                                                       */
/* ------------------------------------------------------------------ */

/** 组装交给模型/规则整理的完整任务执行情况文本 */
function composeSummary(
  objective: string,
  summary: string,
  completedSteps: string[],
  pendingSteps: string[],
): string {
  const lines: string[] = []

  if (objective.trim()) {
    lines.push(`## 任务目标\n${objective.trim()}`)
  }

  if (summary.trim()) {
    lines.push(`## 已完成的执行情况\n${summary.trim()}`)
  }

  if (completedSteps.length > 0) {
    lines.push(`## 已完成步骤\n${completedSteps.slice(-12).map(step => `- ${step}`).join('\n')}`)
  }

  if (pendingSteps.length > 0) {
    lines.push(`## 未完成步骤\n${pendingSteps.slice(0, MAX_PENDING_STEPS).map(step => `- ${step}`).join('\n')}`)
  }

  return lines.join('\n\n')
}

/**
 * 整理指定会话的任务执行情况
 *
 * 优先由模型整理（`generateSummary` 的 handoff 模式，与交接文档同源）；
 * 未配置模型或调用失败时，`generateSummary` 内部会自动退化为规则提取，
 * 因此这里不需要再写一套兜底逻辑，只需把 `source` 如实带出来。
 */
export async function buildMountedTask(threadId: string): Promise<MountedTaskInfo | null> {
  const thread = useAgentStore.getState().threads[threadId]
  if (!thread) {
    logger.agent.warn(`[MountedTask] Thread not found, skip mounting: ${threadId}`)
    return null
  }

  const messages = thread.messages ?? []
  if (messages.length === 0) {
    logger.agent.info(`[MountedTask] Empty thread, skip mounting: ${threadId}`)
    return null
  }

  try {
    const result = await generateSummary(messages, {
      type: 'handoff',
      maxTokens: SUMMARY_MAX_TOKENS,
      todos: thread.todos,
    })

    // 模型的 pendingSteps 已包含「最近一条未完成的用户请求」，
    // 但会话里的待办清单更贴近当前进度，两者合并去重后更完整。
    const pendingFromTodos = (thread.todos ?? [])
      .filter(todo => todo.status !== 'completed')
      .map(todo => (todo.status === 'in_progress' ? todo.activeForm : todo.content))
      .filter(Boolean)

    const pendingSteps = Array.from(new Set([...result.pendingSteps, ...pendingFromTodos]))
      .filter(step => step.trim().length > 0)
      .slice(0, MAX_PENDING_STEPS)

    const objective = result.objective?.trim() || thread.pendingObjective?.trim() || MOUNTED_TASK_RESUME_MESSAGE

    return {
      mountedAt: Date.now(),
      objective,
      pendingSteps,
      summary: composeSummary(objective, result.summary, result.completedSteps, pendingSteps),
      source: result.source,
    }
  } catch (error) {
    logger.agent.warn('[MountedTask] Failed to build task summary:', error)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 挂载 / 取消挂载 / 续跑                                              */
/* ------------------------------------------------------------------ */

/**
 * 等待线程停止流式输出
 *
 * 用户点「挂载」时刚发出中止信号，主循环还在收尾：此时读到的 `messages` 里
 * 助手消息可能只有一个片段，整理出的执行情况会不准确。轮询到线程真正空闲
 * 再整理；超时则直接用当前快照，宁可信息略糙也不让用户干等。
 */
async function waitForThreadIdle(threadId: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const phase = useAgentStore.getState().threads[threadId]?.streamState?.phase
    if (phase !== 'streaming' && phase !== 'tool_running' && phase !== 'tool_pending') return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  logger.agent.warn(`[MountedTask] Thread still busy after ${timeoutMs}ms, summarizing current snapshot`)
}

/**
 * 整理并把执行情况挂载到会话上
 *
 * @returns 挂载成功时返回写入的执行情况；整理失败（无消息 / 模型异常）返回 null，
 *          调用方据此提示用户挂载未完成，而不是留下一个空挂载。
 */
export async function mountThreadTask(threadId: string): Promise<MountedTaskInfo | null> {
  await waitForThreadIdle(threadId)

  const mounted = await buildMountedTask(threadId)
  if (!mounted) return null

  useAgentStore.getState().setMountedTask(mounted, threadId)
  logger.agent.info(`[MountedTask] Mounted task on thread ${threadId} (source=${mounted.source})`)
  return mounted
}

/** 取消会话上的挂载 */
export function unmountThreadTask(threadId: string): void {
  const thread = useAgentStore.getState().threads[threadId]
  if (!thread?.mountedTask) return

  useAgentStore.getState().setMountedTask(null, threadId)
  logger.agent.info(`[MountedTask] Unmounted task from thread ${threadId}`)
}

/**
 * 整理并把执行情况挂载到会话上，同时给出过程反馈
 *
 * 整理执行情况要调用一次模型，可能耗时几秒，交互由会话底部的挂载询问卡片承担：
 * 卡片在等待期间保持加载态，这里只负责把「整理中 → 成功 / 失败」反馈出来。
 * 整理失败（会话为空 / 模型异常）时明确告知没有挂载成功，而不是无声无息地什么都不发生。
 *
 * @returns 是否挂载成功，调用方据此决定卡片是收起还是回到可操作状态
 */
export async function mountThreadTaskWithFeedback(threadId: string): Promise<boolean> {
  const language = useStore.getState().language as Language

  toast.info(t('mt.mounting', language), 4000)

  const mounted = await mountThreadTask(threadId)
  if (!mounted) {
    toast.error(t('mt.mountFailed', language))
    return false
  }

  toast.success(t('mt.mounted', language))
  return true
}

/**
 * 组装静默注入给 AI 的续跑提示
 *
 * 这里只发一句短指令，完整的执行情况由 `RuntimeStateContext` 注入：
 * - 运行时快照每轮都会进上下文，且不受历史裁剪影响，执行情况不会因压缩而丢失
 * - 若两份都带上全文，续跑当轮会重复注入同一段执行情况，白白多花一份 token
 */
export function buildResumePrompt(task: MountedTaskInfo): string {
  const remaining = task.pendingSteps.length
  return remaining > 0
    ? `${MOUNTED_TASK_RESUME_MESSAGE}，剩余 ${remaining} 个步骤，不要重复已完成的工作。`
    : `${MOUNTED_TASK_RESUME_MESSAGE}，若已无剩余工作请确认收尾。`
}

/**
 * 继续执行挂载的任务：标记续跑时间 + 静默把执行情况交给 AI
 *
 * 走 `chat-send-message` 事件通道（与自动续接同一条路径），由 ChatPanel 统一
 * 转成 `sendToThread(..., { silent: true })`：
 * - silent 保证不显示成用户气泡，但消息仍会进入 LLM 上下文
 * - 显式携带 threadId，避免用户已经切到别的会话时续跑发错目标
 *
 * @returns 是否已派发续跑
 */
export function resumeMountedTask(threadId: string): boolean {
  const thread = useAgentStore.getState().threads[threadId]
  const task = thread?.mountedTask
  if (!task) {
    logger.agent.warn(`[MountedTask] No mounted task to resume: ${threadId}`)
    return false
  }

  if (typeof window === 'undefined') return false

  // 先写入 resumedAt，再派发消息：续跑那一轮的消息组装会读取线程状态，
  // 顺序反了会导致执行情况来不及注入（RuntimeStateContext 拿不到 resumedAt）。
  useAgentStore.getState().markMountedTaskResumed(threadId)

  window.dispatchEvent(new CustomEvent('chat-send-message', {
    detail: {
      content: buildResumePrompt(task),
      messageId: '',
      threadId,
      silent: true,
    },
  }))

  logger.agent.info(`[MountedTask] Resume dispatched for thread ${threadId}`)
  return true
}

/**
 * 续跑那一轮结束时的挂载收尾
 *
 * 每轮 `loop:end` 都应调用（同一个会话可能同时挂着挂载任务与普通问答）：
 * - 续跑标记一律复位：任务没跑完时底部任务栏重新出现，用户可以接着跑
 * - 已续跑且正常收尾 → 自动卸下挂载并提示，挂载与执行情况都不再压在会话上
 * - 中途被停止 / 报错 / 需要用户回答 → 保留挂载，用户可以再点「继续执行任务」
 *
 * 只在「已续跑」（`resumedAt` 存在）时自动卸下：用户仅仅挂载了任务、随后在这个会话
 * 里问了别的无关问题，那些问答正常结束不该把用户手动挂载的任务误删。
 */
export function settleMountedTaskResume(threadId: string, reason: string): void {
  const store = useAgentStore.getState()
  const task = store.threads[threadId]?.mountedTask

  if (task?.resumedAt && SETTLED_LOOP_END_REASONS.has(reason)) {
    // setMountedTask 内部会一并复位续跑标记，这里不用再清一次
    store.setMountedTask(null, threadId)

    const language = useStore.getState().language as Language
    toast.success(t('mt.autoUnmounted', language))
    logger.agent.info(`[MountedTask] Auto-unmounted after settled run (${reason}): ${threadId}`)
    return
  }

  store.setMountedTaskResuming(false, threadId)

  if (task?.resumedAt) {
    logger.agent.info(`[MountedTask] Resume run ended with ${reason}, mount kept: ${threadId}`)
  }
}
