/**
 * Pipeline 模块入口
 *
 * 全部中间件复用 @aweeclaw/harness-core，保持客户端与后端行为一致。
 * RetryMiddleware 使用共享包的 Pipeline 中间件实现（替代旧 @toolkit/retryPolicy 的非中间件版本）。
 */
export { Pipeline, PipelineAbortedError } from './Pipeline'
export type { Middleware, MiddlewareContext } from './Middleware'
export { PipelineContext } from './Middleware'
export { LoggingMiddleware } from './builtins/logging'
export { AuditMiddleware, getAuditLog, clearAuditLog } from './builtins/audit'
export type { AuditEntry } from './builtins/audit'
export { RateLimitMiddleware, RateLimitError } from './builtins/rateLimit'
export { RetryMiddleware, shouldRetryAfterError } from './builtins/retry'
export type { RetryConfig } from './builtins/retry'
export { ErrorBoundaryMiddleware, CircuitBreakerMiddleware, CircuitBreakerOpenError } from './builtins/errorBoundary'
