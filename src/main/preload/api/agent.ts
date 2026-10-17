/**
 * Agent 编排 API
 *
 * 覆盖 IPC 频道：
 * - agent:start / abort / list / get / subscribe / unsubscribe / remove
 * - agent:tool-result（回传工具执行结果）
 * - agent:event:/tool-call:  动态频道
 */

import { invoke, dynamicChannel } from '../ipcHelpers'
import type {
  AgentSessionEvent,
  AgentSessionState,
  AgentSessionSummary,
  AgentToolOutcome,
  AgentToolRequestPayload,
  StartAgentSessionParams,
} from '../../modules/agent-orchestrator/types'

export function createAgentApi() {
  return {
    /** 启动一场会话（立即返回，进度走事件） */
    start: (params: StartAgentSessionParams) =>
      invoke('agent:start')(params) as Promise<{ ok: boolean; reason?: string }>,
    /** 中止会话 */
    abort: (sessionId: string) =>
      invoke('agent:abort')(sessionId) as Promise<{ ok: boolean }>,
    /** 会话列表 */
    list: () =>
      invoke('agent:list')() as Promise<{ sessions: AgentSessionSummary[] }>,
    /** 取会话完整状态 */
    get: (sessionId: string) =>
      invoke('agent:get')(sessionId) as Promise<{
        ok: boolean
        reason?: string
        state?: AgentSessionState
      }>,
    /** 观察会话事件 */
    subscribe: (sessionId: string) =>
      invoke('agent:subscribe')(sessionId) as Promise<{ ok: boolean }>,
    /** 停止观察 */
    unsubscribe: (sessionId: string) =>
      invoke('agent:unsubscribe')(sessionId) as Promise<{ ok: boolean }>,
    /** 清理已结束会话 */
    remove: (sessionId: string) =>
      invoke('agent:remove')(sessionId) as Promise<{ ok: boolean; reason?: string }>,
    /** 回传工具执行结果 */
    submitToolResult: (toolRequestId: string, outcome: AgentToolOutcome) =>
      invoke('agent:tool-result')(toolRequestId, outcome) as Promise<{ ok: boolean }>,

    /** 订阅会话事件 */
    onEvent: dynamicChannel<AgentSessionEvent>('agent:event:'),
    /** 订阅工具执行请求 */
    onToolCall: dynamicChannel<AgentToolRequestPayload>('agent:tool-call:'),
  }
}
