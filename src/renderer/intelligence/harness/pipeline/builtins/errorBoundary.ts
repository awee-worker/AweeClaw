/**
 * 错误边界与熔断器中间件
 *
 * 直接复用 @aweeclaw/harness-core 的 ErrorBoundaryMiddleware / CircuitBreakerMiddleware。
 */
export { ErrorBoundaryMiddleware, CircuitBreakerMiddleware, CircuitBreakerOpenError } from '@aweeclaw/harness-core'
