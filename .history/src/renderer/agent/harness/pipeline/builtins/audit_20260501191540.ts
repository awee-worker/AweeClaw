import { logger } from '@utils/Logger'
import type { Middleware, MiddlewareContext } from '../Middleware'

interface AuditEntry {
  pipelineId: string
  action: string
  resource: string
  outcome: 'allow' | 'deny' | 'error'
  timestamp: number
  details?: Record<string, unknown>
}

const auditLog: AuditEntry[] = []
const MAX_AUDIT_ENTRIES = 1000

export class AuditMiddleware<TInput, TOutput> implements Middleware<TInput, TOutput> {
  readonly id = 'audit'
  readonly order = 5

  private extractAction(input: unknown): string {
    if (typeof input === 'object' && input !== null) {
      const obj = input as Record<string, unknown>
      if (typeof obj.toolName === 'string') return obj.toolName
      if (typeof obj.action === 'string') return obj.action
      if (typeof obj.operation === 'string') return obj.operation
    }
    return 'unknown'
  }

  private extractResource(input: unknown): string {
    if (typeof input === 'object' && input !== null) {
      const obj = input as Record<string, unknown>
      const args = obj.args as Record<string, unknown> | undefined
      if (args) {
        if (typeof args.path === 'string') return args.path
        if (typeof args.filePath === 'string') return args.filePath
        if (typeof args.file === 'string') return args.file
      }
      if (typeof obj.path === 'string') return obj.path
    }
    return ''
  }

  async before(input: TInput, ctx: MiddlewareContext): Promise<void> {
    const entry: AuditEntry = {
      pipelineId: ctx.pipelineId,
      action: this.extractAction(input),
      resource: this.extractResource(input),
      outcome: 'allow',
      timestamp: Date.now(),
    }
    addAuditEntry(entry)
    ctx.set('__audit_entry__', entry)
  }

  async onError(error: Error, ctx: MiddlewareContext): Promise<void> {
    const entry = ctx.get<AuditEntry>('__audit_entry__')
    if (entry) {
      entry.outcome = 'error'
      entry.details = { error: error.message }
    }
  }
}

function addAuditEntry(entry: AuditEntry): void {
  auditLog.push(entry)
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES)
  }
}

export function getAuditLog(filter?: { pipelineId?: string; action?: string; outcome?: AuditEntry['outcome'] }): AuditEntry[] {
  let entries = auditLog
  if (filter?.pipelineId) entries = entries.filter(e => e.pipelineId === filter.pipelineId)
  if (filter?.action) entries = entries.filter(e => e.action === filter.action)
  if (filter?.outcome) entries = entries.filter(e => e.outcome === filter.outcome)
  return entries
}

export function clearAuditLog(): void {
  auditLog.length = 0
}
