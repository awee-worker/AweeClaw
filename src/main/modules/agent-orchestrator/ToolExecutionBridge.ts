/**
 * 工具执行桥 — 主进程发起、渲染层执行、结果回传
 *
 * 工具实现大量依赖渲染层能力（编辑器、终端面板、剪贴板、场景 SDK），
 * 短期内不可能整体搬到主进程。所以编排循环留出一个「执行请求」出口：
 * 主进程决定调什么工具、带什么参数，渲染层负责真正执行并回传结果。
 *
 * 这里只保证三件事：请求可追踪（toolRequestId）、结果可配对、
 * 无人接手时会失败而不是永远挂起。
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { AgentToolCallView, AgentToolOutcome } from './types'

/** 单次工具执行的默认超时。长任务工具应在上层配置更长的值。 */
const DEFAULT_TOOL_TIMEOUT_MS = 120_000

interface PendingExecution {
  sessionId: string
  resolve: (outcome: AgentToolOutcome) => void
  timer: NodeJS.Timeout
}

/** 把执行请求交给渲染层的回调 */
export type ToolRequestDispatcher = (
  sessionId: string,
  payload: {
    toolRequestId: string
    sessionId: string
    turn: number
    call: AgentToolCallView
  },
) => boolean

export class ToolExecutionBridge {
  private readonly pending = new Map<string, PendingExecution>()

  constructor(private readonly dispatch: ToolRequestDispatcher) {}

  /**
   * 请求执行一次工具调用
   *
   * @returns 工具结果；无人接手或超时返回失败结果，由编排层决定是否终止会话
   */
  request(
    sessionId: string,
    turn: number,
    call: AgentToolCallView,
    timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS,
  ): Promise<AgentToolOutcome> {
    const toolRequestId = `${sessionId}#${turn}#${call.id}`

    return new Promise<AgentToolOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(toolRequestId)
        logger.agent.warn('[ToolExecutionBridge] 工具执行超时', {
          toolRequestId,
          tool: call.name,
          timeoutMs,
        })
        resolve({ ok: false, error: `工具 ${call.name} 执行超时（${timeoutMs}ms）` })
      }, timeoutMs)

      this.pending.set(toolRequestId, { sessionId, resolve, timer })

      const delivered = this.dispatch(sessionId, {
        toolRequestId,
        sessionId,
        turn,
        call,
      })

      if (!delivered) {
        clearTimeout(timer)
        this.pending.delete(toolRequestId)
        logger.agent.warn('[ToolExecutionBridge] 无窗口可执行工具', {
          sessionId,
          tool: call.name,
        })
        resolve({
          ok: false,
          error: `没有可执行工具的窗口（${call.name}），请保持发起窗口开启`,
        })
      }
    })
  }

  /** 渲染层回传结果 */
  settle(toolRequestId: string, outcome: AgentToolOutcome): boolean {
    const entry = this.pending.get(toolRequestId)
    if (!entry) {
      logger.agent.warn('[ToolExecutionBridge] 收到未知的工具结果', { toolRequestId })
      return false
    }
    clearTimeout(entry.timer)
    this.pending.delete(toolRequestId)
    entry.resolve(outcome)
    return true
  }

  /** 会话中止时，让它名下等待中的工具立即失败，避免循环卡住 */
  failSession(sessionId: string, reason: string): void {
    for (const [toolRequestId, entry] of this.pending) {
      if (entry.sessionId !== sessionId) continue
      clearTimeout(entry.timer)
      this.pending.delete(toolRequestId)
      entry.resolve({ ok: false, error: reason })
    }
  }

  /** 当前等待中的请求数，仅用于诊断 */
  get pendingCount(): number {
    return this.pending.size
  }
}
