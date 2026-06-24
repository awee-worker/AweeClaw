/**
 * 优雅停机
 *
 * 直接复用 @aweeclaw/harness-core 的 GracefulShutdown 实现，
 * 日志端口在 Harness 初始化时通过 setLogger 注入。
 */
export { GracefulShutdown } from '@aweeclaw/harness-core'
