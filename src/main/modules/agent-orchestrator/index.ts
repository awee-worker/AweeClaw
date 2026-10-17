/**
 * 编排层入口
 *
 * 主进程持有 Agent 多轮循环与会话状态，窗口降为观察者。
 */

export { agentSessionRegistry } from './AgentSessionRegistry'
export { AgentOrchestrator } from './AgentOrchestrator'
export { ToolExecutionBridge } from './ToolExecutionBridge'
export {
  registerAgentOrchestratorIpc,
  cleanupAgentSessions,
  cleanupAllAgentSessions,
} from './AgentOrchestratorIpc'
export type {
  AgentSessionState,
  AgentSessionStatus,
  AgentSessionSummary,
  AgentSessionEvent,
  AgentToolCallView,
  AgentToolOutcome,
  AgentTurnRecord,
  StartAgentSessionParams,
} from './types'
