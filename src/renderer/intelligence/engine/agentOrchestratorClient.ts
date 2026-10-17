/**
 * 编排层客户端 — 渲染侧接驳主进程会话
 *
 * 窗口在这里扮演两个角色：
 * - 观察者：订阅会话事件，把轮次 / 工具 / 收尾状态渲染出来
 * - 执行者：收到工具执行请求后调用本地工具，把结果回传主进程
 *
 * 工具执行仍留在渲染层，因为大量工具依赖编辑器、终端面板与场景 SDK；
 * 只要还有一个窗口挂着这个客户端，会话就能继续推进。
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

export interface AgentToolCallView {
  id: string
  name: string
  arguments?: unknown
}

export interface AgentToolOutcome {
  ok: boolean
  content?: string
  error?: string
}

interface AgentToolRequestPayload {
  toolRequestId: string
  sessionId: string
  turn: number
  call: AgentToolCallView
}

/** 工具执行器：由调用方注入，接哪套工具由使用场景决定 */
export type AgentToolExecutor = (
  call: AgentToolCallView,
  ctx: { sessionId: string; turn: number },
) => Promise<AgentToolOutcome>

export interface AttachAgentSessionOptions {
  sessionId: string
  /** 会话事件回调（轮次开始 / 工具请求 / 会话结束等） */
  onEvent: (event: unknown) => void
  /** 工具执行器；缺省时会话内工具调用将以失败告终 */
  executeTool?: AgentToolExecutor
}

/**
 * 接入一场会话
 *
 * @returns 解除接入的函数；窗口卸载时必须调用，否则会继续接收事件
 */
export function attachAgentSession(options: AttachAgentSessionOptions): () => void {
  const { sessionId, onEvent, executeTool } = options

  const offEvent = api.agent.onEvent(sessionId, onEvent)

  const offToolCall = api.agent.onToolCall(sessionId, (raw) => {
    const payload = raw as AgentToolRequestPayload

    void (async () => {
      if (!executeTool) {
        await api.agent.submitToolResult(payload.toolRequestId, {
          ok: false,
          error: `本窗口未注册工具执行器，无法执行 ${payload.call.name}`,
        })
        return
      }

      try {
        const outcome = await executeTool(payload.call, {
          sessionId,
          turn: payload.turn,
        })
        await api.agent.submitToolResult(payload.toolRequestId, outcome)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.agent.warn('[agentOrchestratorClient] 工具执行异常', {
          sessionId,
          tool: payload.call.name,
          message,
        })
        await api.agent.submitToolResult(payload.toolRequestId, {
          ok: false,
          error: message,
        })
      }
    })()
  })

  void api.agent.subscribe(sessionId).catch((error: unknown) => {
    logger.agent.warn('[agentOrchestratorClient] 订阅会话失败', { sessionId, error })
  })

  return () => {
    offEvent()
    offToolCall()
    // 窗口卸载时主进程可能已经关闭，失败无需上报
    void api.agent.unsubscribe(sessionId).catch(() => { /* 忽略 */ })
  }
}
