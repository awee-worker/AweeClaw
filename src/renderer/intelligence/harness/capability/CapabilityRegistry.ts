/**
 * 能力注册中心
 *
 * 直接复用 @aweeclaw/harness-core 的 CapabilityRegistry 实现，
 * 日志端口在 Harness 初始化时通过 setLogger 注入。
 */
export { CapabilityRegistry } from '@aweeclaw/harness-core'
export type { CapabilityRegistryListener } from '@aweeclaw/harness-core'
