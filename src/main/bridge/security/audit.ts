/**
 * 审计日志桥接 — 安全审计日志的 IPC 接口
 *
 * 职责：
 * - 暴露审计日志的追加、批量追加、查询、导出等 IPC 接口
 * - 桥接渲染进程与 AuditLogService 模块
 * - 支持按 pipelineId / action / outcome / 时间范围过滤查询
 */

import { safeIpcHandle } from '../core/ipcGuard'
import { auditLogService } from '../../modules/audit-trail/AuditLogService'
import type { AuditEntry } from '../../modules/audit-trail/AuditLogService'

export function registerAuditHandlers(): void {
  auditLogService.init()

  safeIpcHandle('audit:append', async (_, entries: AuditEntry | AuditEntry[]) => {
    if (Array.isArray(entries)) {
      auditLogService.appendBatch(entries)
    } else {
      auditLogService.append(entries)
    }
    return { success: true }
  })

  safeIpcHandle('audit:query', async (_, filter?: {
    pipelineId?: string
    action?: string
    outcome?: AuditEntry['outcome']
    since?: number
    limit?: number
  }) => {
    const results = await auditLogService.query(filter)
    return { success: true, entries: results }
  })

  safeIpcHandle('audit:flush', async () => {
    await auditLogService.flush()
    return { success: true }
  })
}

export function cleanupAuditHandlers(): void {
  auditLogService.cleanup()
}
