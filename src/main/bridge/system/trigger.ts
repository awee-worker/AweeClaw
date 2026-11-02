/**
 * 事件触发器 / 任务账本 桥接层
 *
 * 职责边界：只做"参数契约校验 + 调用领域对象 + 结果结构化 + 事件广播"，
 * 不含业务状态机逻辑（状态机在 TaskLedger 内，非法迁移由它抛出）。
 *
 * 接口契约（频道 → 入参 → 出参）：
 *
 *   trigger:listRules        ()                          → { success, data: TriggerRule[] }
 *   trigger:upsertRule       (rule: TriggerRuleInput)    → { success, data: TriggerRule }
 *   trigger:removeRule       (ruleId: string)            → { success, data: { removed } }
 *   trigger:setRuleEnabled   (ruleId, enabled: boolean)  → { success, data: TriggerRule }
 *   trigger:listSources      ()                          → { success, data: Array<{id,type}> }
 *   trigger:getStats         ()                          → { success, data: TriggerStats }
 *
 *   ledger:list              (query?: TaskQuery)         → { success, data: LedgerTask[] }
 *   ledger:get               (taskId)                    → { success, data: LedgerTask }
 *   ledger:create            (input: CreateTaskInput)    → { success, data: LedgerTask, idempotent? }
 *   ledger:approve           (taskId)                    → { success, data: LedgerTask, idempotent? }
 *   ledger:start             (taskId)                    → { success, data: LedgerTask, idempotent? }
 *   ledger:succeed           (taskId, result)            → { success, data: LedgerTask }
 *   ledger:fail              (taskId, error)             → { success, data: LedgerTask }
 *   ledger:cancel            (taskId)                    → { success, data: LedgerTask, idempotent? }
 *   ledger:retry             (taskId)                    → { success, data: LedgerTask }
 *   ledger:progress          (taskId, progress, message) → { success, data: LedgerTask | null }
 *   ledger:counts            ()                          → { success, data: Record<TaskStatus, number> }
 *
 * 推送频道：
 *   trigger:hit              TriggerHit
 *   ledger:task-updated      LedgerTask
 *
 * 鉴权口径：
 * - 调用方限定为本机渲染进程（Electron ipcRenderer），契约上不对外网暴露
 * - 无跨用户数据，因此不做账号级鉴权；写入类频道启用每分钟调用上限，防误触发性刷写
 * - 高风险任务（risk=high）进入 pending_approval，审批动作由用户显式触发
 *
 * @module bridge/system/trigger
 */

import { BrowserWindow } from 'electron'
import { safeIpcHandle } from '../core/ipcGuard'
import { triggerRegistry } from '../../modules/trigger/TriggerRegistry'
import { taskLedger } from '../../modules/task-ledger/TaskLedger'
import { automationSettings } from '../../modules/automation-settings/AutomationSettingsStore'
import type { AutomationSettings } from '../../modules/automation-settings/types'
import type { TriggerRule } from '../../modules/trigger/types'
import type {
  CreateTaskInput,
  LedgerTask,
  TaskQuery,
  TaskResult,
  TaskStatus,
} from '../../modules/task-ledger/types'
import { logger } from '@shared/toolkit/LogEngine'

/** 结构化错误码（与 ipcGuard 的 code 字段约定一致） */
/** 结构化错误码（与 ipcGuard 的 code 字段约定一致） */
const ERR = {
  RULE_INVALID: 'ERR_TRIGGER_RULE_INVALID',
  RULE_NOT_FOUND: 'ERR_TRIGGER_RULE_NOT_FOUND',
  TASK_NOT_FOUND: 'ERR_TASK_NOT_FOUND',
  TASK_INVALID_INPUT: 'ERR_TASK_INVALID_INPUT',
  TASK_INVALID_TRANSITION: 'ERR_TASK_INVALID_TRANSITION',
  SETTINGS_INVALID: 'ERR_AUTOMATION_SETTINGS_INVALID',
} as const

/** 写入类频道限流（次/分钟） */
const WRITE_RATE_LIMIT = 120

function getAllWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** 结构化失败响应 */
function fail(code: string, error: string) {
  return { success: false, error, code, timestamp: Date.now() }
}

/**
 * 已下发执行指令的任务 id
 *
 * 用途：任务在 queued 状态下会经历多次 'updated'（进度、trace 追加等），
 * 不加这层去重会把同一个任务反复下发给执行器。任务离开 queued 时移出集合，
 * 这样 retry 回到 queued 后还能再次派发。
 */
const dispatchedForExecute = new Set<string>()

/**
 * 按开关决定是否把任务下发到渲染层执行器
 *
 * 只在 autoExecuteTask 开启时下发。关闭时任务安静地停在 queued，
 * 用户可在任务中心手动点「开始执行」——手动路径不经过这里。
 */
function maybeDispatchExecute(task: LedgerTask): void {
  if (task.status !== 'queued') {
    dispatchedForExecute.delete(task.id)
    return
  }
  if (dispatchedForExecute.has(task.id)) return
  if (!automationSettings.get().autoExecuteTask) return

  dispatchedForExecute.add(task.id)
  logger.system.info(`[Trigger] 任务下发执行: ${task.id} (${task.title})`)
  broadcast('ledger:task-execute', task)
}

/**
 * 校验触发器规则入参
 * @returns 规范化后的规则，或错误描述
 */
function normalizeRuleInput(raw: unknown): { rule: TriggerRule } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'rule must be an object' }
  const input = raw as Partial<TriggerRule>

  if (!input.id || typeof input.id !== 'string') return { error: 'rule.id is required' }
  if (!input.name || typeof input.name !== 'string') return { error: 'rule.name is required' }
  if (!input.sourceType || typeof input.sourceType !== 'string') {
    return { error: 'rule.sourceType is required' }
  }
  const validTypes = ['file', 'hook', 'channel', 'mail', 'custom']
  if (!validTypes.includes(input.sourceType)) {
    return { error: `rule.sourceType must be one of ${validTypes.join('|')}` }
  }
  if (input.action && typeof input.action === 'object') {
    const actionType = (input.action as { type?: string }).type
    if (actionType && !['notify', 'suggest', 'task'].includes(actionType)) {
      return { error: 'rule.action.type must be notify|suggest|task' }
    }
  }

  const rule: TriggerRule = {
    id: input.id,
    name: input.name,
    enabled: input.enabled !== false,
    sourceType: input.sourceType,
    include: Array.isArray(input.include) ? input.include.filter((s) => typeof s === 'string') : [],
    ignore: Array.isArray(input.ignore) ? input.ignore.filter((s) => typeof s === 'string') : [],
    eventTypes: Array.isArray(input.eventTypes)
      ? input.eventTypes.filter((s) => typeof s === 'string')
      : [],
    cooldownMs: typeof input.cooldownMs === 'number' ? input.cooldownMs : undefined,
    action: {
      type: input.action?.type ?? 'notify',
      payload: typeof input.action?.payload === 'string' ? input.action.payload : '',
    },
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(),
  } as TriggerRule

  return { rule }
}

/** 校验创建任务入参 */
function normalizeCreateInput(raw: unknown): { input: CreateTaskInput } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'input must be an object' }
  const input = raw as Partial<CreateTaskInput>
  const validOrigins = ['trigger', 'cron', 'manual', 'proactive']
  const validRisks = ['low', 'medium', 'high']

  if (!input.origin || !validOrigins.includes(input.origin)) {
    return { error: `origin must be one of ${validOrigins.join('|')}` }
  }
  if (!input.kind || typeof input.kind !== 'string') return { error: 'kind is required' }
  if (!input.title || typeof input.title !== 'string') return { error: 'title is required' }
  if (input.risk && !validRisks.includes(input.risk)) {
    return { error: `risk must be one of ${validRisks.join('|')}` }
  }

  return {
    input: {
      origin: input.origin,
      originId: input.originId,
      kind: input.kind,
      title: input.title,
      risk: input.risk ?? 'low',
      request: (input.request as Record<string, unknown> | null) ?? null,
      idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined,
    },
  }
}

/** 校验结果对象（succeed 频道） */
function normalizeResult(raw: unknown): { result: TaskResult } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'result must be an object' }
  const r = raw as Partial<TaskResult>
  if (Array.isArray(r.artifacts)) {
    for (const a of r.artifacts) {
      if (!a || typeof a !== 'object' || typeof (a as { title?: string }).title !== 'string') {
        return { error: 'artifact.title is required' }
      }
    }
  }
  return {
    result: {
      success: r.success !== false,
      summary: r.summary,
      artifacts: r.artifacts,
      output: r.output,
      error: r.error,
    },
  }
}

/**
 * 幂等包裹：状态迁移命令重复提交时，若任务已处于目标状态，直接返回成功。
 *
 * 为什么放在桥接层而不是账本：账本必须严格校验迁移（它是状态机真相源），
 * 而"重复点击按钮"是 UI 层的常见现象，属于对外契约的兼容责任。
 */
function runTransition(
  taskId: string,
  target: TaskStatus,
  exec: () => unknown,
): { success: true; data: unknown; idempotent?: boolean } | ReturnType<typeof fail> {
  if (!taskId || typeof taskId !== 'string') {
    return fail(ERR.TASK_NOT_FOUND, 'taskId is required')
  }
  const existing = taskLedger.get(taskId)
  if (!existing) return fail(ERR.TASK_NOT_FOUND, `task not found: ${taskId}`)

  if (existing.status === target) {
    return { success: true, data: existing, idempotent: true }
  }

  try {
    return { success: true, data: exec() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('非法状态迁移')) {
      return fail(ERR.TASK_INVALID_TRANSITION, message)
    }
    throw err
  }
}

/**
 * 注册事件订阅：把触发器命中与任务变更广播到渲染层
 *
 * 与 registerAutomationEventListeners 同构，由 bootstrap 在启动阶段调用一次。
 */
export function registerTriggerEventListeners(): void {
  triggerRegistry.on('hit', (hit) => {
    broadcast('trigger:hit', hit)
  })

  taskLedger.on('updated', (task) => {
    broadcast('ledger:task-updated', task)
    // 同一份状态变更顺带判断要不要下发执行，避免再挂一个监听器
    maybeDispatchExecute(task)
  })

  // 新建即处于 queued 的任务（autoCreateTask 打开时由订阅者创建）
  // 必须同时广播：新建只发 'created'，不会走上面的 'updated'，
  // 漏了这条渲染层就永远看不到刚建出来的任务。
  taskLedger.on('created', (task) => {
    broadcast('ledger:task-updated', task)
    maybeDispatchExecute(task)
  })
}

export function registerTriggerHandlers(): void {
  // ─── 触发器规则 ───────────────────────────────────────────

  safeIpcHandle('trigger:listRules', async () => {
    return { success: true, data: triggerRegistry.listRules() }
  })

  safeIpcHandle(
    'trigger:upsertRule',
    async (_, rawRule: unknown) => {
      const normalized = normalizeRuleInput(rawRule)
      if ('error' in normalized) {
        return fail(ERR.RULE_INVALID, normalized.error)
      }
      const saved = triggerRegistry.upsertRule(normalized.rule)
      return { success: true, data: saved }
    },
    { rateLimitPerMinute: WRITE_RATE_LIMIT },
  )

  safeIpcHandle('trigger:removeRule', async (_, ruleId: string) => {
    if (!ruleId || typeof ruleId !== 'string') {
      return fail(ERR.RULE_NOT_FOUND, 'ruleId is required')
    }
    const removed = triggerRegistry.removeRule(ruleId)
    if (!removed) return fail(ERR.RULE_NOT_FOUND, `rule not found: ${ruleId}`)
    return { success: true, data: { removed: true } }
  })

  safeIpcHandle('trigger:setRuleEnabled', async (_, ruleId: string, enabled: boolean) => {
    if (!ruleId || typeof ruleId !== 'string') {
      return fail(ERR.RULE_NOT_FOUND, 'ruleId is required')
    }
    const rule = triggerRegistry.setRuleEnabled(ruleId, enabled !== false)
    if (!rule) return fail(ERR.RULE_NOT_FOUND, `rule not found: ${ruleId}`)
    return { success: true, data: rule }
  })

  safeIpcHandle('trigger:listSources', async () => {
    return { success: true, data: triggerRegistry.listSources() }
  })

  safeIpcHandle('trigger:getStats', async () => {
    return { success: true, data: triggerRegistry.getStats() }
  })

  // ─── 任务账本 ─────────────────────────────────────────────

  safeIpcHandle('ledger:list', async (_, query: unknown) => {
    const q = (query && typeof query === 'object' ? query : {}) as TaskQuery
    return { success: true, data: taskLedger.list(q) }
  })

  safeIpcHandle('ledger:get', async (_, taskId: string) => {
    const task = taskLedger.get(taskId)
    if (!task) return fail(ERR.TASK_NOT_FOUND, `task not found: ${taskId}`)
    return { success: true, data: task }
  })

  safeIpcHandle(
    'ledger:create',
    async (_, rawInput: unknown) => {
      const normalized = normalizeCreateInput(rawInput)
      if ('error' in normalized) {
        return fail(ERR.TASK_INVALID_INPUT, normalized.error)
      }
      const { idempotent, task } = taskLedger.createIdempotent(normalized.input)
      return idempotent
        ? { success: true, data: task, idempotent: true }
        : { success: true, data: task }
    },
    { rateLimitPerMinute: WRITE_RATE_LIMIT },
  )

  safeIpcHandle('ledger:approve', async (_, taskId: string) =>
    runTransition(taskId, 'queued', () => taskLedger.approve(taskId)),
  )

  safeIpcHandle('ledger:start', async (_, taskId: string) =>
    runTransition(taskId, 'running', () => taskLedger.start(taskId)),
  )

  safeIpcHandle('ledger:succeed', async (_, taskId: string, rawResult: unknown) => {
    const normalized = normalizeResult(rawResult)
    if ('error' in normalized) {
      return fail(ERR.TASK_INVALID_INPUT, normalized.error)
    }
    return runTransition(taskId, 'completed', () =>
      taskLedger.succeed(taskId, normalized.result),
    )
  })

  safeIpcHandle('ledger:fail', async (_, taskId: string, error: string) => {
    if (!error || typeof error !== 'string') {
      return fail(ERR.TASK_INVALID_INPUT, 'error message is required')
    }
    return runTransition(taskId, 'failed', () => taskLedger.fail(taskId, error))
  })

  safeIpcHandle('ledger:cancel', async (_, taskId: string) =>
    runTransition(taskId, 'cancelled', () => taskLedger.cancel(taskId)),
  )

  safeIpcHandle('ledger:retry', async (_, taskId: string) => {
    if (!taskId || typeof taskId !== 'string') {
      return fail(ERR.TASK_NOT_FOUND, 'taskId is required')
    }
    if (!taskLedger.get(taskId)) return fail(ERR.TASK_NOT_FOUND, `task not found: ${taskId}`)
    try {
      return { success: true, data: taskLedger.retry(taskId) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('非法状态迁移')) {
        return fail(ERR.TASK_INVALID_TRANSITION, message)
      }
      throw err
    }
  })

  safeIpcHandle(
    'ledger:progress',
    async (_, taskId: string, progress: number, message?: string) => {
      if (typeof progress !== 'number' || Number.isNaN(progress)) {
        return fail(ERR.TASK_INVALID_INPUT, 'progress must be a number')
      }
      const task = taskLedger.updateProgress(taskId, progress, message)
      // 任务已结束时不视为错误，只是不更新（返回 data:null 让调用方自行忽略）
      return { success: true, data: task }
    },
    { rateLimitPerMinute: 600 },
  )

  safeIpcHandle('ledger:counts', async () => {
    return { success: true, data: taskLedger.countByStatus() }
  })

  // ─── 本地自动化开关 ───────────────────────────────────────

  safeIpcHandle('trigger:getSettings', async () => {
    return { success: true, data: automationSettings.get() }
  })

  safeIpcHandle(
    'trigger:updateSettings',
    async (_, patch: unknown) => {
      if (!patch || typeof patch !== 'object') {
        return fail(ERR.SETTINGS_INVALID, 'settings patch must be an object')
      }
      const keys = Object.keys(patch)
      const allowed = ['triggersEnabled', 'autoCreateTask', 'autoExecuteTask']
      const unknownKeys = keys.filter((k) => !allowed.includes(k))
      if (unknownKeys.length > 0) {
        return fail(ERR.SETTINGS_INVALID, `unknown settings: ${unknownKeys.join(',')}`)
      }
      for (const key of keys) {
        if (typeof (patch as Record<string, unknown>)[key] !== 'boolean') {
          return fail(ERR.SETTINGS_INVALID, `${key} must be boolean`)
        }
      }
      const saved: AutomationSettings = automationSettings.update(
        patch as Partial<AutomationSettings>,
      )
      return { success: true, data: saved }
    },
    { rateLimitPerMinute: WRITE_RATE_LIMIT },
  )

  safeIpcHandle('trigger:resetSettings', async () => {
    return { success: true, data: automationSettings.reset() }
  })

  logger.system.info('[Trigger] 触发器 / 任务账本 IPC 已注册')
}
