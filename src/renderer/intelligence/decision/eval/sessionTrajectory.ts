/**
 * 会话轨迹采集
 *
 * 定位：把主循环里散落的执行事实（工具调用、循环拦截、上下文压缩）攒成一条会话记录，
 * 会话结束时算出轨迹指标并交给主进程落库。
 *
 * 与 trajectory.ts 的分工：那边是纯函数（给数据算指标），这边负责从执行链路收集数据。
 *
 * `useful` 的口径：工具未返回错误即视为推进了任务。这个口径偏宽 ——
 * "执行成功但结论没用"的调用也会被算作有用。之所以先用它，是因为零成本：
 * 不需要额外模型调用，也不依赖任务清单是否存在。后续要收紧，只需在
 * recordToolCall 时显式传入 useful 覆写即可，下游指标无需改动。
 *
 * 采集只在会话结束时结算一次，不在每一步做计算，避免给主循环加实时开销。
 */

import { api } from '../../../adapters/electronBridge'
import {
  extractTrajectoryMetrics,
  signatureOf,
  type CompressionEvent,
  type TrajectoryStep,
} from './trajectory'

/** 一次可被记录的调用（已执行或已被拦截） */
export interface TraceToolCall {
  name: string
  arguments?: Record<string, unknown>
  /** 工具是否返回错误 */
  isError?: boolean
}

/** 单条会话的采集缓冲 */
interface SessionTraceBuffer {
  sessionId: string
  scenarioId?: string
  startedAt: number
  steps: TrajectoryStep[]
  compressionEvents: CompressionEvent[]
  /** 审批次数与人工介入次数，由调用方在审批发生时累加 */
  approvalTotal: number
  inputTokens: number
  outputTokens: number
  interventions: number
}

/** 活跃会话缓冲，键为 threadId */
const buffers = new Map<string, SessionTraceBuffer>()

/**
 * 开始采集一条会话
 *
 * 重复调用同一 sessionId 时保留已有缓冲：一轮对话可能被中断后续接，
 * 续接仍属同一条会话，从头计数会丢掉前半程的过程指标。
 */
export function beginSessionTrace(sessionId: string, scenarioId?: string): void {
  if (buffers.has(sessionId)) return
  buffers.set(sessionId, {
    sessionId,
    scenarioId,
    startedAt: Date.now(),
    steps: [],
    compressionEvents: [],
    approvalTotal: 0,
    interventions: 0,
    inputTokens: 0,
    outputTokens: 0,
  })
}

/** 记录一次已执行的工具调用 */
export function recordToolCall(sessionId: string, call: TraceToolCall, useful?: boolean): void {
  const buffer = buffers.get(sessionId)
  if (!buffer) return

  const step: TrajectoryStep = {
    index: buffer.steps.length + 1,
    toolName: call.name,
    argsSignature: signatureOf(call.arguments),
    useful: useful ?? call.isError !== true,
  }
  buffer.steps.push(step)
}

/**
 * 记录被循环检测拦下的调用
 *
 * 这些调用没有实际执行，但它们是「模型绕路」的直接证据，
 * 必须进轨迹 —— 否则循环检出次数永远是 0。
 */
export function recordLoopInterception(sessionId: string, calls: Array<{ name: string; arguments?: Record<string, unknown> }>): void {
  const buffer = buffers.get(sessionId)
  if (!buffer) return

  for (const call of calls) {
    buffer.steps.push({
      index: buffer.steps.length + 1,
      toolName: call.name,
      argsSignature: signatureOf(call.arguments),
      loopDetected: true,
      useful: false,
    })
  }
}

/** 记录一次上下文压缩（level 为压缩等级，0 表示未触发） */
export function recordCompression(sessionId: string, level: number): void {
  if (level <= 0) return
  const buffer = buffers.get(sessionId)
  if (!buffer) return
  buffer.compressionEvents.push({ level, at: Date.now() })
}

/**
 * 累加一次审批及其人工介入次数
 *
 * 介入口径：被用户拒绝才算介入 —— 批准是顺着 AI 的方案走，没有改变执行方向，
 * 把每次点击都算成介入会让这个指标失去区分度。
 */
export function recordApproval(sessionId: string, interventions = 0): void {
  const buffer = buffers.get(sessionId)
  if (!buffer) return
  buffer.approvalTotal += 1
  buffer.interventions += interventions
}

/** 累加 Token 用量 */
export function recordTokenUsage(sessionId: string, input: number, output: number): void {
  const buffer = buffers.get(sessionId)
  if (!buffer) return
  buffer.inputTokens += Math.max(0, Math.floor(input))
  buffer.outputTokens += Math.max(0, Math.floor(output))
}

/**
 * 结算会话并上报
 *
 * 上报失败只记日志，不影响会话本身 —— 采集是旁路，不能因为它出错而干扰执行链路。
 */
export function finishSessionTrace(sessionId: string): void {
  const buffer = buffers.get(sessionId)
  if (!buffer) return
  buffers.delete(sessionId)

  // 完全没产生工具调用的会话（纯问答）不进统计：这类会话的步数为 0，
  // 混进聚合会把「平均步数」拉低，掩盖真实的任务型会话表现。
  if (buffer.steps.length === 0) return

  const metrics = extractTrajectoryMetrics({
    steps: buffer.steps,
    compressionEvents: buffer.compressionEvents,
  })

  void api.effectMetrics
    .recordSession({
      sessionId: buffer.sessionId,
      scenarioId: buffer.scenarioId,
      startedAt: buffer.startedAt,
      endedAt: Date.now(),
      metrics: {
        totalSteps: metrics.totalSteps,
        futileRetries: metrics.futileRetries,
        futileRetryRatio: metrics.futileRetryRatio,
        loopDetections: metrics.loopDetections,
        firstUsefulStep: metrics.firstUsefulStep,
        compressionEvents: metrics.compressionEvents.length,
      },
      approvalTotal: buffer.approvalTotal,
      interventions: buffer.interventions,
      inputTokens: buffer.inputTokens,
      outputTokens: buffer.outputTokens,
    })
    .catch(() => {
      // 落库失败不影响会话结果；具体原因由主进程侧记录
    })
}

/** 丢弃一条会话的采集缓冲（会话被重置时使用） */
export function discardSessionTrace(sessionId: string): void {
  buffers.delete(sessionId)
}
