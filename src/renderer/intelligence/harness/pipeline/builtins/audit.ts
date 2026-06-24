/**
 * 审计中间件
 *
 * 直接复用 @aweeclaw/harness-core 的 AuditMiddleware，
 * 审计持久化端口在 Harness 初始化时通过 setAuditSink 注入 Electron IPC 桥接。
 */
export { AuditMiddleware, getAuditLog, clearAuditLog } from '@aweeclaw/harness-core'
export type { AuditEntry } from '@aweeclaw/harness-core'
