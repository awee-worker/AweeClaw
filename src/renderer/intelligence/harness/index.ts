/**
 * Harness 模块入口
 *
 * 客户端 Agent 驾驭架构：
 * - AgentHarness：客户端入口，组合所有组件
 * - Container / Pipeline / Capability / Observability / Lifecycle：复用 @aweeclaw/harness-core
 * - 端口桥接：ClientLoggerBridge / ClientAuditSinkBridge
 */

export { AgentHarness, agentHarness } from './Harness'
export { HarnessContainer } from './kernel/Container'
export { InjectToken, TOKENS } from './kernel/Token'
export { Pipeline, PipelineAbortedError } from './pipeline/Pipeline'
export type { Middleware, MiddlewareContext } from './pipeline/Middleware'
export { PipelineContext } from './pipeline/Middleware'
export { CapabilityRegistry } from './capability/CapabilityRegistry'
export { ObservabilityBus, globalObservability } from './observability/ObservabilityBus'
export { LifecycleManager } from './lifecycle/LifecycleManager'
export { GracefulShutdown } from './lifecycle/GracefulShutdown'
export { ClientLoggerBridge, ClientAuditSinkBridge } from './ports'
export { initializeHarness } from './adapters'

// 端口工具（从共享包透出，供外部使用方注入）
export { setLogger, setAuditSink } from '@aweeclaw/harness-core'
export type { LoggerPort, AuditSink, AuditSinkEntry } from '@aweeclaw/harness-core'
