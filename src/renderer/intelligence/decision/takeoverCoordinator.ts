/**
 * 接管闭环：发起 → 等待 → 重新核实 → 续跑 / 再发起
 *
 * 「用户点了已处理」不等于问题真的解决了。人可能在另一个窗口点了「继续」，
 * 也可能只关掉了弹窗、页面还停在登录页。所以要重新读一次界面状态，
 * 核实通过才续跑；不通过就再问一次。
 *
 * 重试上限 3 次，而不是无限重试：
 * - 同一次拦截连续三次核实不过，基本不是「用户手慢」，而是判定规则本身错了
 *   （例如页面永远有一段「登录」文案），继续问只会消耗用户的耐心；
 * - 到上限后转失败并写明「多次核实未通过」，让用户知道该人工介入了，
 *   而不是看着任务反复弹窗。
 *
 * 本模块只负责流程编排，所有外部动作都通过依赖注入传入：
 * 这样它能被单测覆盖，也不把 renderer 与主进程 / 网络耦合在一起。
 *
 * @module intelligence/decision/takeoverCoordinator
 */
import {
  takeoverTimeoutMs,
  type TakeoverOutcome,
  type TakeoverReason,
  type TakeoverRequest,
} from '@shared/protocols/deviceTaskProtocol'
import type { TakeoverDecision, TakeoverSignal } from './takeoverClassifier'

/** 同一次拦截最多核实几轮 */
export const MAX_TAKEOVER_ATTEMPTS = 3

/** 闭环结局 */
export type TakeoverLoopStatus =
  /** 无需接管，或用户处理并通过核实，可继续执行 */
  | 'continued'
  /** 用户选择跳过，能绕开就继续 */
  | 'skipped'
  /** 用户放弃本次任务 */
  | 'aborted'
  /** 等待超时，任务保持等待态，用户回来仍可继续 */
  | 'timeout'
  /** 无人值守：未发起接管，直接按需人工处理收尾 */
  | 'unattended'
  /** 多轮核实未通过 */
  | 'exhausted'

/** 闭环结果 */
export interface TakeoverLoopResult {
  status: TakeoverLoopStatus
  /** 实际发起的接管次数 */
  attempts: number
  reason?: TakeoverReason
  /** 给结果文案用的说明 */
  note?: string
}

/** 一次处置的返回值 */
export interface TakeoverResolution {
  outcome: TakeoverOutcome
  note?: string
}

/** 闭环所需的全部外部能力 */
export interface TakeoverLoopDeps {
  /** 判定当前信号是否需要接管 */
  classify: (signal: TakeoverSignal) => TakeoverDecision | Promise<TakeoverDecision>
  /** 发起接管：上报 task-takeover，移动端据此展示卡片 */
  request: (request: TakeoverRequest) => void | Promise<void>
  /** 等待移动端处置。实现方需自行按 timeoutMs 超时并返回 outcome='timeout' */
  awaitResolve: (timeoutMs: number) => Promise<TakeoverResolution>
  /** 重新核实界面状态。抛错按核实失败处理 */
  verify: () => Promise<boolean>
  /** 每轮发起前的回调（记录次数与原因，便于统计） */
  onAttempt?: (attempt: number, reason: TakeoverReason) => void
}

/** 单次接管的等待时长：优先用请求里的 expiresAt，缺省按在场情况给默认值 */
function resolveWaitMs(request: TakeoverRequest, decision: TakeoverDecision): number {
  if (request.expiresAt) {
    return Math.max(0, request.expiresAt - Date.now())
  }
  const fallback = takeoverTimeoutMs(decision.attendance)
  return fallback > 0 ? fallback : 0
}

/**
 * 执行一次接管闭环
 *
 * @param signal 触发接管的信号（首轮用于判定；后续轮次沿用同一原因）
 */
export async function runTakeoverLoop(
  signal: TakeoverSignal,
  deps: TakeoverLoopDeps,
): Promise<TakeoverLoopResult> {
  const decision = await deps.classify(signal)

  // 1. 不需要接管
  if (!decision.needed || !decision.reason || !decision.request) {
    return { status: 'continued', attempts: 0 }
  }

  // 2. 无人值守：不阻塞，直接收尾（结果里写明需要人工处理什么）
  if (!decision.shouldAwait) {
    return {
      status: 'unattended',
      attempts: 0,
      reason: decision.reason,
      note: decision.skipNote,
    }
  }

  const reason = decision.reason
  const baseRequest = decision.request
  let attempt = 0

  while (attempt < MAX_TAKEOVER_ATTEMPTS) {
    attempt += 1
    deps.onAttempt?.(attempt, reason)

    // 第二轮起在文案里说明这是复核未通过后的再次确认，
    // 否则用户会以为系统在重复弹同一张卡
    const request: TakeoverRequest =
      attempt === 1
        ? baseRequest
        : {
            ...baseRequest,
            message: `${baseRequest.message}（第 ${attempt} 次核实未通过，请再确认一次）`,
          }

    await deps.request(request)

    const waitMs = resolveWaitMs(request, decision)
    const resolved = await deps.awaitResolve(waitMs)

    if (resolved.outcome === 'timeout') {
      return { status: 'timeout', attempts: attempt, reason, note: '等待处置超时' }
    }
    if (resolved.outcome === 'aborted') {
      return { status: 'aborted', attempts: attempt, reason, note: resolved.note }
    }
    if (resolved.outcome === 'skipped') {
      return { status: 'skipped', attempts: attempt, reason, note: resolved.note }
    }

    // resolved：必须核实通过才算真的解决
    const verified = await deps.verify().catch(() => false)
    if (verified) {
      return { status: 'continued', attempts: attempt, reason, note: resolved.note }
    }
  }

  return {
    status: 'exhausted',
    attempts: MAX_TAKEOVER_ATTEMPTS,
    reason,
    note: `多次核实未通过（${MAX_TAKEOVER_ATTEMPTS} 次），请人工确认页面状态`,
  }
}

/** 单任务的接管统计 */
export interface TakeoverRecord {
  attempts: number
  lastReason?: TakeoverReason
  lastStatus?: TakeoverLoopStatus
  updatedAt: number
}

/**
 * 接管统计
 *
 * 记录每个任务触发过几轮接管、最后一轮的原因与结局，
 * 供任务结果与指标统计使用（「哪类接管最多」靠它回答）。
 */
export class TakeoverTracker {
  private readonly records = new Map<string, TakeoverRecord>()

  record(taskId: string, result: TakeoverLoopResult): TakeoverRecord {
    const record: TakeoverRecord = {
      attempts: result.attempts,
      lastReason: result.reason,
      lastStatus: result.status,
      updatedAt: Date.now(),
    }
    this.records.set(taskId, record)
    return record
  }

  get(taskId: string): TakeoverRecord | undefined {
    return this.records.get(taskId)
  }

  clear(taskId: string): void {
    this.records.delete(taskId)
  }

  snapshot(): Record<string, TakeoverRecord> {
    return Object.fromEntries(this.records)
  }
}

export const takeoverTracker = new TakeoverTracker()
