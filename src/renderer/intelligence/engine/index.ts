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
export { orchestrateToolBatch, executeTools, approvalService } from './toolOrchestrator'
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
export {
  initializeEngines,
  initializeBehaviorEngine,
  initializeSubAgentEngine,
  disposeEngines,
  getInitializedBehaviorEngine,
  getInitializedSubAgentEngine,
} from './engineInitializer'
export { BehaviorEngine } from '../runtime/BehaviorEngine'
export type { BehaviorRule, TriggerType, ActionType } from '../runtime/BehaviorEngine'
export { SubAgentEngine } from './SubAgentEngine'
export type { BackgroundTask, TaskStatus, TaskProgressEvent, TaskResultEvent } from './SubAgentEngine'

export type {
  LLMConfig,
  ToolExecutionContext,
  LLMCallResult,
  LoopCheckResult,
  CompressionStats,
  AgentToolExecutionResult,
} from '@intelligence/providerTypes'
