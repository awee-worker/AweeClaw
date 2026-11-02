/**
 * 任务账本执行器
 *
 * 把 queued 状态的任务交给 Agent 跑，并把结果回写到账本。
 *
 * 为什么放在渲染层而不是主进程：
 * Agent 的模型调用、工具执行、会话写入全部在渲染进程，主进程只持有任务状态。
 * 与 useAutomationCronExecutor 同构：主进程决定"该跑了"，渲染层负责"真的跑"。
 *
 * 两条进入路径共用这里的 executeLedgerTask：
 * - 自动：autoExecuteTask 开启时主进程广播 ledger:task-execute
 * - 手动：用户点「开始执行」，面板直接调用
 * 手动路径不受 autoExecuteTask 约束 —— 用户主动点了就该执行。
 *
 * @module intelligence/proactive/ledgerTaskExecutor
 */

import { Agent } from '@intelligence/engine/IntelligenceCore'
import { useStore, useModeStore } from '@store'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { getEffectiveLLMConfigAsync } from '@services/modelConfigHelper'
import { logger } from '@toolkit/LogEngine'
import type { LedgerTaskView } from '../../../types/electronBridge'

/** 正在执行中的任务 id，防止同一任务被重复派发 */
const inflight = new Set<string>()

/** 单条指令最大长度，避免超长路径把提示词撑爆 */
const PROMPT_SUBJECT_MAX = 500

/**
 * 由任务实体拼出交给 Agent 的指令
 *
 * 触发器只提供"哪个文件变了 / 什么事件发生了"，没有具体要做什么。
 * 这里把可用的上下文如实交代给 Agent，由它判断该做什么——
 * 规则里配了 action.payload 时作为建议动作一并带上。
 */
export function buildTaskPrompt(task: LedgerTaskView): string {
  const req = (task.request ?? {}) as Record<string, unknown>
  const str = (key: string): string => {
    const value = req[key]
    return typeof value === 'string' && value ? value : ''
  }

  const ruleName = str('ruleName') || task.originId || '未知规则'
  const eventType = str('eventType') || '未知'
  const subject = str('subject').slice(0, PROMPT_SUBJECT_MAX) || '未知'

  const lines = [
    `[事件触发任务] ${task.title}`,
    '',
    `来源规则：${ruleName}`,
    `事件类型：${eventType}`,
    `事件主体：${subject}`,
  ]

  const action = req.action as { type?: string; payload?: string } | undefined
  if (action?.payload) {
    lines.push(`建议动作：${action.payload}`)
  }

  lines.push('', '请根据上述事件判断需要做什么，完成后简要说明结果。')
  return lines.join('\n')
}

/** 执行结果，供调用方决定提示文案 */
export type LedgerExecuteOutcome =
  | { ok: true; taskId: string; threadId: string }
  | { ok: false; taskId: string; reason: string; skipped?: boolean }

/**
 * 执行一个任务
 *
 * 幂等性由 inflight 集合保证：同一 taskId 并发进入时第二个直接返回 skipped。
 * 状态迁移的严格校验在 TaskLedger 内，这里只在执行前确认它确实处于 queued，
 * 避免对 pending_approval 的任务绕过人工审批。
 */
export async function executeLedgerTask(task: LedgerTaskView): Promise<LedgerExecuteOutcome> {
  const taskId = task.id

  if (inflight.has(taskId)) {
    return { ok: false, taskId, reason: '任务已在执行中', skipped: true }
  }

  if (task.status !== 'queued') {
    // pending_approval 必须先 approve，这里直接拒绝，不能绕过审批
    return { ok: false, taskId, reason: `任务状态为 ${task.status}，不可执行`, skipped: true }
  }

  inflight.add(taskId)

  try {
    const started = await window.electronAPI.trigger.startLedgerTask(taskId)
    if (!started?.success) {
      const reason = started?.error ?? '状态迁移失败'
      logger.agent?.warn(`[LedgerExecutor] 任务 ${taskId} 启动失败: ${reason}`)
      return { ok: false, taskId, reason }
    }

    const appState = useStore.getState()
    const modeState = useModeStore.getState()
    const agentConfig = getAgentConfig()
    const effectiveConfig = await getEffectiveLLMConfigAsync(appState.llmConfig)

    const result = await Agent.send(
      buildTaskPrompt(task),
      { ...effectiveConfig, contextLimit: agentConfig.maxContextTokens },
      appState.workspacePath,
      modeState.currentMode,
      {
        openFiles: appState.openFiles.map((file) => file.path),
        activeFile: appState.activeFilePath || undefined,
        customInstructions: appState.aiInstructions,
        promptTemplateId: appState.promptTemplateId,
      },
      {
        isProactive: true,
        proposalId: `ledger-${taskId}`,
      },
    )

    await window.electronAPI.trigger.succeedLedgerTask(taskId, {
      success: true,
      summary: '执行完成',
    })

    logger.agent?.info(`[LedgerExecutor] 任务执行完成: ${taskId} (thread=${result.threadId})`)
    return { ok: true, taskId, threadId: result.threadId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // 失败必须落回账本，否则任务会永远停在 running
    try {
      await window.electronAPI.trigger.failLedgerTask(taskId, message)
    } catch (failErr) {
      logger.agent?.error(
        `[LedgerExecutor] 任务失败回写也失败: ${taskId}: ${failErr instanceof Error ? failErr.message : String(failErr)}`,
      )
    }

    logger.agent?.error(`[LedgerExecutor] 任务执行失败: ${taskId}: ${message}`)
    return { ok: false, taskId, reason: message }
  } finally {
    inflight.delete(taskId)
  }
}

/** 该任务是否正在执行中（供 UI 禁用按钮） */
export function isTaskInflight(taskId: string): boolean {
  return inflight.has(taskId)
}
