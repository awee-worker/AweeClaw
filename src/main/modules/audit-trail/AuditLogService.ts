import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'

export interface AuditEntry {
  pipelineId: string
  action: string
  resource: string
  outcome: 'allow' | 'deny' | 'error'
  timestamp: number
  details?: Record<string, unknown>
}

const MAX_FILE_SIZE = 10 * 1024 * 1024
const FLUSH_INTERVAL_MS = 5000
const MAX_BUFFER_SIZE = 100

class AuditLogService {
  private logDir: string
  private currentLogFile: string
  private buffer: AuditEntry[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private writeInProgress = false

  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'audit-logs')
    this.currentLogFile = this.getLogFilePath(new Date())
  }

  init(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }

    this.currentLogFile = this.getLogFilePath(new Date())
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)

    logger.ipc.info('[AuditLog] Service initialized, log dir:', this.logDir)
  }

  append(entry: AuditEntry): void {
    this.buffer.push(entry)
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush()
    }
  }

  appendBatch(entries: AuditEntry[]): void {
    this.buffer.push(...entries)
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush()
    }
  }

  async query(filter?: {
    pipelineId?: string
    action?: string
    outcome?: AuditEntry['outcome']
    since?: number
    limit?: number
  }): Promise<AuditEntry[]> {
    await this.flush()

    const files = this.getLogFiles()
    const entries: AuditEntry[] = []

    for (const file of files) {
      if (filter?.since) {
        const fileDate = this.extractDateFromPath(file)
        if (fileDate && fileDate.getTime() < filter.since) continue
      }

      try {
        const content = fs.readFileSync(file, 'utf-8')
        const lines = content.trim().split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const entry: AuditEntry = JSON.parse(line)
            if (this.matchesFilter(entry, filter)) {
              entries.push(entry)
            }
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    entries.sort((a, b) => b.timestamp - a.timestamp)
    if (filter?.limit) {
      return entries.slice(0, filter.limit)
    }
    return entries
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.writeInProgress) return

    this.writeInProgress = true
    const toWrite = this.buffer.splice(0)
    this.writeInProgress = false

    try {
      const today = this.getLogFilePath(new Date())
      if (today !== this.currentLogFile) {
        this.currentLogFile = today
      }

      this.rotateIfNeeded(this.currentLogFile)

      const lines = toWrite.map(e => JSON.stringify(e)).join('\n') + '\n'
      fs.appendFileSync(this.currentLogFile, lines, 'utf-8')
    } catch (error) {
      logger.ipc.error('[AuditLog] Failed to write:', error)
      this.buffer.unshift(...toWrite)
    }
  }

  cleanup(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
    this.cleanOldLogs()
  }

  private getLogFilePath(date: Date): string {
    const dateStr = date.toISOString().slice(0, 10)
    return path.join(this.logDir, `audit-${dateStr}.ndjson`)
  }

  private getLogFiles(): string[] {
    try {
      return fs
        .readdirSync(this.logDir)
        .filter(f => f.startsWith('audit-') && f.endsWith('.ndjson'))
        .sort()
        .map(f => path.join(this.logDir, f))
    } catch {
      return []
    }
  }

  private extractDateFromPath(filePath: string): Date | null {
    const match = filePath.match(/audit-(\d{4}-\d{2}-\d{2})\.ndjson$/)
    if (match) {
      return new Date(match[1])
    }
    return null
  }

  private matchesFilter(entry: AuditEntry, filter?: {
    pipelineId?: string
    action?: string
    outcome?: AuditEntry['outcome']
    since?: number
    limit?: number
  }): boolean {
    if (!filter) return true
    if (filter.pipelineId && entry.pipelineId !== filter.pipelineId) return false
    if (filter.action && entry.action !== filter.action) return false
    if (filter.outcome && entry.outcome !== filter.outcome) return false
    if (filter.since && entry.timestamp < filter.since) return false
    return true
  }

  private rotateIfNeeded(filePath: string): void {
    try {
      const stats = fs.statSync(filePath)
      if (stats.size > MAX_FILE_SIZE) {
        const rotated = filePath.replace('.ndjson', `-${Date.now()}.ndjson`)
        fs.renameSync(filePath, rotated)
      }
    } catch {
      // file doesn't exist yet, that's fine
    }
  }

  private cleanOldLogs(): void {
    const files = this.getLogFiles()
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

    for (const file of files) {
      const date = this.extractDateFromPath(file)
      if (date && date.getTime() < thirtyDaysAgo) {
        try {
          fs.unlinkSync(file)
        } catch {
          // ignore
        }
      }
    }
  }
}

export const auditLogService = new AuditLogService()
