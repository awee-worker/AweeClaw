export interface AuditRecord {
  id: string
  action: string
  resource: string
  outcome: 'allow' | 'deny' | 'error'
  timestamp: number
  actor?: string
  details?: Record<string, unknown>
  threadId?: string
  sessionId?: string
}

export class AuditLog {
  private records: AuditRecord[] = []
  private readonly maxRecords: number
  private listeners = new Set<(record: AuditRecord) => void>()

  constructor(maxRecords = 5000) {
    this.maxRecords = maxRecords
  }

  record(entry: Omit<AuditRecord, 'id' | 'timestamp'>): AuditRecord {
    const record: AuditRecord = {
      id: `audit-${this.records.length + 1}`,
      timestamp: Date.now(),
      ...entry,
    }
    this.records.push(record)
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords)
    }
    this.notifyListeners(record)
    return record
  }

  query(filter?: {
    action?: string
    resource?: string
    outcome?: AuditRecord['outcome']
    threadId?: string
    since?: number
    until?: number
  }): AuditRecord[] {
    let results = this.records
    if (filter?.action) results = results.filter(r => r.action === filter.action)
    if (filter?.resource) results = results.filter(r => r.resource === filter.resource)
    if (filter?.outcome) results = results.filter(r => r.outcome === filter.outcome)
    if (filter?.threadId) results = results.filter(r => r.threadId === filter.threadId)
    if (filter?.since) results = results.filter(r => r.timestamp >= filter.since!)
    if (filter?.until) results = results.filter(r => r.timestamp <= filter.until!)
    return results
  }

  addListener(listener: (record: AuditRecord) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.records.length = 0
  }

  get size(): number {
    return this.records.length
  }

  private notifyListeners(record: AuditRecord): void {
    for (const listener of this.listeners) {
      try {
        listener(record)
      } catch {
        // swallow
      }
    }
  }
}
