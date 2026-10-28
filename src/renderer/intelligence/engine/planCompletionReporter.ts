/**
 * 计划执行完成汇总回流
 *
 * 计划随后台异步执行（start_task_execution 立即返回），主 Agent 的对话轮次在派发
 * 执行时已经结束；若无人监听终态事件，子任务跑完后对话里不会有任何结果，用户只能
 * 在 ExecutionBoard 看到状态。本模块订阅 plan 终态事件，把各子任务结果压缩成一条
 * 续接指令派发回原线程，由主 Agent 生成「统筹汇报」：交付物与产出位置、关键结论、
 * 失败或跳过项的原因与影响、下一步建议。
 *
 * 与 autoResume 的分工：自动续接针对「异常中断」并受限次保护；这里是任务正常终结的
 * 确定性收尾，每次计划结束都应汇报一次，不受续接限次约束。
 *
 * 职责二：计划终态提示音。声音播放独立于线程绑定判断——从 ExecutionBoard 直接启动、
 * 未绑定会话的计划同样要提醒；开关判定完全交给 notificationSound → soundGate。
 */

import { logger } from '@toolkit/LogEngine'
import { EventBus } from './EventDispatcher'
import { useAgentStore } from '../state/IntelligenceStore'
import { dispatchContinuation } from './autoResume'
import { playNotificationSound } from '@utils/notificationSound'
import type { PlanTask } from '@intelligence/providerTypes'
import type { ExecutionStats } from '../planner/planTypes'

let installed = false

/** 单条子任务结果压缩为一行摘要 */
function summarizeTask(task: PlanTask): string {
  const body = (task.output || task.error || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  return `- ${task.title || task.id} [${task.status}]：${body || '（无输出）'}`
}

/** 解析计划归属线程：取第一个带 threadId 的任务 */
function resolveThreadId(tasks: PlanTask[]): string | null {
  for (const task of tasks) {
    const threadId = (task as { threadId?: string }).threadId
    if (threadId) return threadId
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 计划终态提示音                                                      */
/* ------------------------------------------------------------------ */

/** 同一计划的连击收敛窗口：complete 后紧跟 failed 之类的重复终态只响一次 */
const SOUND_DEDUPE_WINDOW_MS = 1500
/** 记录条数上限，避免长期运行无限增长 */
const MAX_TRACKED_PLANS = 64

/** planId → 上一次播放的终态签名与时间 */
const lastPlanSound = new Map<string, { sig: string; at: number }>()

/**
 * 判定本次终态是否需要发声。
 *
 * 去重口径：
 * - 签名相同 → 同一终态被重放或重复订阅，跳过；
 * - 距上次发声不足 SOUND_DEDUPE_WINDOW_MS → 视为同一终态的连击（例如 complete 带失败
 *   之后紧跟 plan:failed），跳过。
 * 签名带上 stats.startedAt（每次执行唯一）与 sessionId，因此同一计划重新执行不会被误判。
 */
function shouldPlayPlanSound(planId: string, sig: string): boolean {
  const now = Date.now()
  const last = lastPlanSound.get(planId)
  if (last && last.sig === sig) return false
  if (last && now - last.at < SOUND_DEDUPE_WINDOW_MS) return false

  lastPlanSound.delete(planId)
  lastPlanSound.set(planId, { sig, at: now })
  if (lastPlanSound.size > MAX_TRACKED_PLANS) {
    const oldest = lastPlanSound.keys().next().value
    if (oldest) lastPlanSound.delete(oldest)
  }
  return true
}

/**
 * 计划正常终结的发声分支。
 * 存在失败子任务时用错误音，全部成功才用完成音。
 */
function playPlanCompleteSound(planId: string, stats: ExecutionStats, sessionId?: string): void {
  const hasFailures = (stats?.failedTasks ?? 0) > 0
  const sig = `complete:${sessionId ?? '-'}:${stats?.startedAt ?? 0}:${stats?.failedTasks ?? 0}`
  if (!shouldPlayPlanSound(planId, sig)) return
  try {
    playNotificationSound(hasFailures ? 'error' : 'success')
  } catch (err) {
    logger.agent.debug('[PlanReporter] Failed to play plan complete sound:', err)
  }
}

/** 计划执行异常中止的发声分支 */
function playPlanFailedSound(planId: string, error: string, sessionId?: string): void {
  const sig = `failed:${sessionId ?? '-'}:${error}`
  if (!shouldPlayPlanSound(planId, sig)) return
  try {
    playNotificationSound('error')
  } catch (err) {
    logger.agent.debug('[PlanReporter] Failed to play plan failed sound:', err)
  }
}

/** 汇总计划终态并派发续接指令 */
function reportPlanOutcome(planId: string, outcome: 'completed' | 'failed', detail: string): void {
  try {
    const plan = useAgentStore.getState().getPlan(planId)
    if (!plan || plan.tasks.length === 0) return

    const threadId = resolveThreadId(plan.tasks)
    // 无归属线程（如从 ExecutionBoard 直接启动且未绑定会话）时不回流，避免派发到错误目标
    if (!threadId) return

    const done = plan.tasks.filter(t => t.status === 'completed').length
    const failed = plan.tasks.filter(t => t.status === 'failed').length
    const skipped = plan.tasks.filter(t => t.status === 'skipped').length

    const lines: string[] = [
      `【计划执行${outcome === 'completed' ? '完成' : '中止'}】${plan.name}（${planId}）`,
      `子任务：完成 ${done} / 失败 ${failed} / 跳过 ${skipped}`,
    ]
    if (outcome === 'failed' && detail) lines.push(`终止原因：${detail}`)
    lines.push('', '子任务结果：')
    for (const task of plan.tasks) lines.push(summarizeTask(task))
    lines.push(
      '',
      '请以主 Agent 身份向用户做一次统筹汇报：说明整体交付物与产出位置、关键结论、' +
      '失败或跳过项的原因与影响、以及下一步建议。直接面向用户输出，不要复述原始子任务日志。',
    )

    void dispatchContinuation(threadId, 0, lines.join('\n'))
    logger.agent.info(`[PlanReporter] Reported plan ${planId} (${outcome}) to thread ${threadId}`)
  } catch (err) {
    logger.agent.warn('[PlanReporter] Failed to report plan outcome:', err)
  }
}

/** 注册计划终态订阅（幂等，模块加载即安装一次） */
export function setupPlanCompletionReporter(): void {
  if (installed) return
  installed = true
  EventBus.on('plan:complete', (event) => {
    // 声音独立于线程绑定：未绑定会话（从 ExecutionBoard 直接启动）的计划同样要响
    playPlanCompleteSound(event.planId, event.stats, event.sessionId)
    reportPlanOutcome(event.planId, 'completed', '')
  })
  EventBus.on('plan:failed', (event) => {
    playPlanFailedSound(event.planId, event.error, event.sessionId)
    reportPlanOutcome(event.planId, 'failed', event.error)
  })
}
