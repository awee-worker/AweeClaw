/**
 * Agent 核心模块导出
 */

export { Agent } from './IntelligenceCore'
export { EventBus, type AgentEvent, type EventType } from './EventDispatcher'
export { createStreamProcessor, type StreamProcessor } from './streamProcessor'
export { executeTools, approvalService } from './toolOrchestrator'

export type {
  LLMConfig,
  ToolExecutionContext,
  LLMCallResult,
  LoopCheckResult,
  CompressionStats,
  AgentToolExecutionResult,
} from '@intelligence/providerTypes'
