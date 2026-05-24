/**
 * Agent 核心模块导出
 */

export { Agent } from './IntelligenceCore'
export { EventBus, type AgentEvent, type EventType } from './EventDispatcher'
export {
  BackpressureEventBus,
  BackpressureEventBusInstance,
} from './BackpressureEventBus'
export { createStreamProcessor, type StreamProcessor } from './streamProcessor'
export { executeTools, approvalService } from './toolOrchestrator'
export {
  agentRuntime,
  useAgentRuntime,
  type AgentRuntime,
  type RunLoopFn,
  type LoopExecutionParams,
} from './AgentRuntime'
export {
  initializeAgentRuntime,
  startStoreSynchronization,
  setupAgentRuntime,
} from './runtimeInitializer'

export type {
  LLMConfig,
  ToolExecutionContext,
  LLMCallResult,
  LoopCheckResult,
  CompressionStats,
  AgentToolExecutionResult,
} from '@intelligence/providerTypes'
