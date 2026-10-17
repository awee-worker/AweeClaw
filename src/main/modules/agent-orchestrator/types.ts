/**
 * 主进程编排层的数据契约
 *
 * 编排下沉后，一次「会话」由主进程持有：它记录每一轮模型输出、工具调用与
 * 最终结论，窗口只是观察者。这样窗口关掉不会打断任务，多个窗口也能看同一场
 * 会话，而不必各自发起一遍。
 */

import type { LLMConfig, LLMMessage, ToolDefinition } from '@protocols'

/** 会话生命周期状态 */
export type AgentSessionStatus =
  | 'running'
  | 'waiting-tool'
  | 'completed'
  | 'failed'
  | 'aborted'

/** 工具调用的对外视图（参数已解析） */
export interface AgentToolCallView {
  id: string
  name: string
  arguments?: unknown
}

/** 一轮模型调用的记录 */
export interface AgentTurnRecord {
  turn: number
  requestId: string
  content: string
  reasoning?: string
  toolCalls: AgentToolCallView[]
  startedAt: number
  durationMs: number
}

/** 会话完整状态 */
export interface AgentSessionState {
  sessionId: string
  status: AgentSessionStatus
  /** 业务标签，供观察方在列表里识别 */
  label?: string
  /** 首次发起它的窗口（窗口关闭后仍继续运行） */
  owner?: number
  turns: AgentTurnRecord[]
  /** 完整消息链，用于恢复与审计 */
  messages: LLMMessage[]
  startedAt: number
  updatedAt: number
  maxTurns: number
  error?: string
}

/** 启动一次会话的参数 */
export interface StartAgentSessionParams {
  sessionId: string
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  label?: string
  maxTurns?: number
}

/** 会话列表条目（不含完整消息链） */
export interface AgentSessionSummary {
  sessionId: string
  status: AgentSessionStatus
  label?: string
  turnCount: number
  startedAt: number
  updatedAt: number
  error?: string
}

/**
 * 编排事件
 *
 * 刻意不发逐字正文：观察方拿到 turn-started 里的 requestId 后，
 * 用自己的订阅去接收流式内容，避免同一份 token 在两条通道上重复传输。
 */
export type AgentSessionEvent =
  | { type: 'session-started'; sessionId: string; status: AgentSessionStatus }
  | { type: 'turn-started'; sessionId: string; turn: number; requestId: string }
  | { type: 'tool-requested'; sessionId: string; turn: number; call: AgentToolCallView }
  | {
      type: 'tool-finished'
      sessionId: string
      turn: number
      callId: string
      ok: boolean
      error?: string
    }
  | { type: 'turn-finished'; sessionId: string; turn: number; record: AgentTurnRecord }
  | {
      type: 'session-finished'
      sessionId: string
      status: AgentSessionStatus
      error?: string
    }

/** 工具执行结果（由渲染层回传） */
export interface AgentToolOutcome {
  ok: boolean
  content?: string
  error?: string
}

/** 主进程向渲染层发起的一次工具执行请求 */
export interface AgentToolRequestPayload {
  toolRequestId: string
  sessionId: string
  turn: number
  call: AgentToolCallView
}
