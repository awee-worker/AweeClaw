/**
 * 日志中间件
 *
 * 直接复用 @aweeclaw/harness-core 的 LoggingMiddleware，
 * 日志端口在 Harness 初始化时通过 setLogger 注入客户端 LogEngine。
 */
export { LoggingMiddleware } from '@aweeclaw/harness-core'
