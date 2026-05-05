import { safeIpcHandle } from './safeHandle'
import { auditLogService } from '../services/audit/AuditLogService'
import type { AuditEntry } from '../services/audit/AuditLogService'

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
