export { AgentHarness, agentHarness } from './Harness'
export type { ToolExecutionInput, ToolExecutionOutput, LlmCallInput, LlmCallOutput } from './Harness'

export { HarnessContainer } from './kernel/Container'
export { InjectToken, TOKENS } from './kernel/Token'
export type {
  IFileService,
  ILintService,
  IMemoryService,
  ISkillService,
  IStreamingEditService,
  IFileCacheService,
  IComposerService,
  IRulesService,
  IRetrievalService,
  ILlmConfigService,
  ITerminalManager,
  IToolRegistry,
  IToolManager,
  IEventBus,
  IAgentStore,
  IGlobalStore,
  IElectronAPI,
} from './kernel/Token'
export type { LifecycleParticipant, HealthStatus } from './kernel/Lifecycle'
export { AbstractLifecycleParticipant } from './kernel/Lifecycle'

export { Pipeline, PipelineAbortedError } from './pipeline/Pipeline'
export type { Middleware, MiddlewareContext } from './pipeline/Middleware'
export { PipelineContext } from './pipeline/Middleware'
export { LoggingMiddleware } from './pipeline/builtins/logging'
export { AuditMiddleware, getAuditLog, clearAuditLog } from './pipeline/builtins/audit'
export { RateLimitMiddleware, RateLimitError } from './pipeline/builtins/rateLimit'
export { RetryMiddleware, shouldRetryAfterError } from './pipeline/builtins/retry'
export { ErrorBoundaryMiddleware, CircuitBreakerMiddleware, CircuitBreakerOpenError } from './pipeline/builtins/errorBoundary'

export { CapabilityRegistry } from './capability/CapabilityRegistry'
export type { CapabilityRegistryListener } from './capability/CapabilityRegistry'
export type {
  Capability,
  CapabilityType,
  CapabilityInput,
  CapabilityOutput,
  CapabilityContext,
  CapabilityFilter,
  CapabilityProvider,
} from './capability/Capability'
export { ToolCapabilityProvider } from './capability/providers/ToolCapabilityProvider'
export { SkillCapabilityProvider } from './capability/providers/SkillCapabilityProvider'
export { ContextCapabilityProvider } from './capability/providers/ContextCapabilityProvider'
export { McpCapabilityProvider } from './capability/providers/McpCapabilityProvider'

export { ObservabilityBus, globalObservability } from './observability/ObservabilityBus'
export type { ObservabilityEvent, ObservabilityListener } from './observability/ObservabilityBus'
export { createSpan, endSpan, addSpanEvent, getSpanDuration, formatSpanTree } from './observability/Trace'
export type { Span, SpanEvent } from './observability/Trace'
export { MetricCollector } from './observability/Metric'
export type { MetricEntry } from './observability/Metric'
export { AuditLog } from './observability/AuditLog'
export type { AuditRecord } from './observability/AuditLog'
export { HealthCheckRegistry } from './observability/HealthCheck'
export type { HealthStatus as ObservabilityHealthStatus } from './observability/HealthCheck'

export { LifecycleManager } from './lifecycle/LifecycleManager'
export { GracefulShutdown } from './lifecycle/GracefulShutdown'
export type { LifecyclePhase, LifecyclePhaseTransition } from './lifecycle/Phase'
