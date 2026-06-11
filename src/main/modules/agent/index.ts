/**
 * Agent 模块入口
 *
 * 提供多 Agent 路由与隔离能力。
 */

export { agentRouter } from './AgentRouter'
export type {
  AgentBinding,
  AgentBindingScope,
  AgentRoutingRule,
  AgentWorkspace,
  AgentAuthContext,
  RoutingResult,
} from './AgentRouter'
