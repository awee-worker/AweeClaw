/**
 * 编排器 — 在主进程驱动多轮 Agent 循环
 *
 * 改造前这套循环跑在渲染层：窗口一关、页面一刷新，任务就断在半路，
 * 也没办法让另一个窗口接着看。现在循环由主进程持有，窗口只订阅进度。
 *
 * 每一轮：
 * 1. 以 SYSTEM_SUBSCRIBER 身份发起一次流式请求
 * 2. 从流订阅表的快照里取本轮产生的工具调用（那里已经按事件累积好了）
 * 3. 把工具调用交给渲染层执行并等待结果
 * 4. 追加 assistant / tool 消息后进入下一轮，直到模型不再调工具
 */

import { logger } from '@shared/toolkit/LogEngine'
import { LLMService } from '../ai-provider/AIProviderService'
import {
  streamSubscriptions,
  SYSTEM_SUBSCRIBER,
} from '../ai-provider/services/StreamSubscriptions'
import type { LLMMessage } from '@protocols'
import { agentSessionRegistry } from './AgentSessionRegistry'
import type { ToolExecutionBridge } from './ToolExecutionBridge'
import type {
  AgentSessionState,
  AgentSessionStatus,
  AgentToolCallView,
  StartAgentSessionParams,
  AgentTurnRecord,
} from './types'

/** 未显式设置时的轮次上限，兜住「模型反复调工具却不收尾」 */
const DEFAULT_MAX_TURNS = 24

/** 「没有窗口能执行工具」这类结构性失败的标记，命中即终止会话 */
const NO_WINDOW_MARKER = '没有可执行工具的窗口'

interface RunningEntry {
  aborted: boolean
  requestId?: string
}

export class AgentOrchestrator {
  private readonly llm: LLMService
  private readonly running = new Map<string, RunningEntry>()

  constructor(private readonly tools: ToolExecutionBridge, llm?: LLMService) {
    this.llm = llm ?? new LLMService()
  }

  /**
   * 启动一场会话
   *
   * 立即返回，循环在后台推进 —— 调用方（IPC）不该等整场任务跑完，
   * 否则渲染层会一直挂着未 resolve 的调用。
   */
  start(
    params: StartAgentSessionParams,
    owner?: number,
  ): { ok: boolean; reason?: string } {
    if (agentSessionRegistry.isActive(params.sessionId)) {
      return { ok: false, reason: 'already-running' }
    }

    const now = Date.now()
    const state: AgentSessionState = {
      sessionId: params.sessionId,
      status: 'running',
      label: params.label,
      owner,
      turns: [],
      messages: [...params.messages],
      startedAt: now,
      updatedAt: now,
      maxTurns:
        typeof params.maxTurns === 'number' && params.maxTurns > 0
          ? params.maxTurns
          : DEFAULT_MAX_TURNS,
    }

    agentSessionRegistry.register(state)
    if (owner !== undefined) {
      agentSessionRegistry.addObserver(params.sessionId, owner)
    }
    this.running.set(params.sessionId, { aborted: false })

    agentSessionRegistry.emit(params.sessionId, {
      type: 'session-started',
      sessionId: params.sessionId,
      status: 'running',
    })

    void this.run(state, params)
    return { ok: true }
  }

  /** 中止会话：停掉当前请求、让等待中的工具立即失败 */
  abort(sessionId: string): boolean {
    const entry = this.running.get(sessionId)
    if (!entry) return false

    entry.aborted = true
    if (entry.requestId) {
      this.llm.abort(entry.requestId)
    }
    this.tools.failSession(sessionId, '会话已中止')

    logger.agent.info('[AgentOrchestrator] 会话已中止', { sessionId })
    return true
  }

  /** 会话是否仍在推进 */
  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId)
  }

  private async run(
    state: AgentSessionState,
    params: StartAgentSessionParams,
  ): Promise<void> {
    const sessionId = state.sessionId
    const entry = this.running.get(sessionId)!

    try {
      for (let turn = 1; turn <= state.maxTurns; turn++) {
        if (entry.aborted) {
          this.finish(state, 'aborted')
          return
        }

        const requestId = `${sessionId}#${turn}#${crypto.randomUUID().slice(0, 8)}`
        entry.requestId = requestId

        // 主进程以虚拟订阅者身份登记，快照才会为它累积本轮的正文与工具调用
        streamSubscriptions.bindOwner(requestId, SYSTEM_SUBSCRIBER, state.label)
        state.updatedAt = Date.now()

        agentSessionRegistry.emit(sessionId, {
          type: 'turn-started',
          sessionId,
          turn,
          requestId,
        })

        const startedAt = Date.now()
        let content = ''
        let reasoning: string | undefined
        let toolCalls: AgentToolCallView[] = []

        try {
          const result = await this.llm.sendMessage({
            config: params.config,
            messages: state.messages,
            tools: params.tools,
            systemPrompt: params.systemPrompt,
            requestId,
          })

          content = result.content
          reasoning = result.reasoning

          // 必须在 release 之前取快照：release 会把整条订阅关系删掉
          const snapshot = streamSubscriptions.snapshotOf(requestId)
          toolCalls = (snapshot?.toolCalls ?? []).map((call) => ({
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          }))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (entry.aborted) {
            this.finish(state, 'aborted')
            return
          }
          logger.agent.error('[AgentOrchestrator] 模型调用失败', { sessionId, turn, message })
          this.finish(state, 'failed', message)
          return
        } finally {
          streamSubscriptions.release(requestId)
        }

        const record: AgentTurnRecord = {
          turn,
          requestId,
          content,
          reasoning,
          toolCalls,
          startedAt,
          durationMs: Date.now() - startedAt,
        }
        state.turns.push(record)
        state.updatedAt = Date.now()

        agentSessionRegistry.emit(sessionId, {
          type: 'turn-finished',
          sessionId,
          turn,
          record,
        })

        // 没有工具调用 = 模型给出最终答复
        if (toolCalls.length === 0) {
          this.finish(state, 'completed')
          return
        }

        state.messages.push(this.buildAssistantMessage(content, reasoning, toolCalls))

        for (const call of toolCalls) {
          if (entry.aborted) {
            this.finish(state, 'aborted')
            return
          }

          state.status = 'waiting-tool'
          agentSessionRegistry.emit(sessionId, {
            type: 'tool-requested',
            sessionId,
            turn,
            call,
          })

          const outcome = await this.tools.request(sessionId, turn, call)

          agentSessionRegistry.emit(sessionId, {
            type: 'tool-finished',
            sessionId,
            turn,
            callId: call.id,
            ok: outcome.ok,
            error: outcome.error,
          })

          if (!outcome.ok && outcome.error?.includes(NO_WINDOW_MARKER)) {
            this.finish(state, 'failed', outcome.error)
            return
          }

          state.messages.push({
            role: 'tool',
            content: outcome.ok
              ? (outcome.content ?? '')
              : `工具执行失败：${outcome.error ?? '未知错误'}`,
            tool_call_id: call.id,
            name: call.name,
          })
        }

        state.status = 'running'
      }

      // 轮次耗尽：把已有结果交出去，并说明原因
      this.finish(
        state,
        'failed',
        `达到最大轮次上限（${state.maxTurns}），任务未收敛`,
      )
    } finally {
      this.running.delete(sessionId)
    }
  }

  /** 把一轮 assistant 输出转成可回传模型的消息 */
  private buildAssistantMessage(
    content: string,
    reasoning: string | undefined,
    toolCalls: AgentToolCallView[],
  ): LLMMessage {
    return {
      role: 'assistant',
      content: content || null,
      reasoning_content: reasoning,
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      })),
    }
  }

  /** 收尾：落状态并广播，之后不再改动这场会话 */
  private finish(
    state: AgentSessionState,
    status: AgentSessionStatus,
    error?: string,
  ): void {
    state.status = status
    state.error = error
    state.updatedAt = Date.now()

    agentSessionRegistry.emit(state.sessionId, {
      type: 'session-finished',
      sessionId: state.sessionId,
      status,
      error,
    })

    logger.agent.info('[AgentOrchestrator] 会话结束', {
      sessionId: state.sessionId,
      status,
      turns: state.turns.length,
      error,
    })
  }
}
