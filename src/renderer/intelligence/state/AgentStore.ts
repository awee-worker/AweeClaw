/**
 * Agent Store - 统一导出智能体状态管理
 *
 * 本文件为向后兼容入口，重新导出 IntelligenceStore 中的状态管理。
 */
export { useAgentStore, type AgentStore as StoreState } from './IntelligenceStore'
export type { AgentStore } from './IntelligenceStore'
