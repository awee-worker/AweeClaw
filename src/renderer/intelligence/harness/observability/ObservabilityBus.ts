import { Span, createSpan, endSpan, addSpanEvent, getSpanDuration, formatSpanTree } from './Trace'
import { MetricCollector } from './Metric'
import { AuditLog, AuditRecord } from './AuditLog'
import { HealthCheckRegistry } from './HealthCheck'

export type ObservabilityListener = (event: ObservabilityEvent) => void

export interface ObservabilityEvent {
  type: 'span_start' | 'span_end' | 'metric' | 'audit' | 'health'
  data: unknown
  timestamp: number
}

export class ObservabilityBus {
  private traces = new Map<string, Span[]>()
  private activeSpans = new Map<string, Span>()
  readonly metrics: MetricCollector
  readonly audit: AuditLog
  readonly health: HealthCheckRegistry
  private listeners = new Set<ObservabilityListener>()
  private readonly maxTraces: number

  constructor(maxTraces = 100) {
    this.maxTraces = maxTraces
    this.metrics = new MetricCollector()
    this.audit = new AuditLog()
    this.health = new HealthCheckRegistry()
  }

  startSpan(operation: string, traceId?: string, parentSpanId?: string, attributes?: Record<string, unknown>): Span {
    const tid = traceId ?? `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const span = createSpan(operation, tid, parentSpanId, attributes)

    if (!this.traces.has(tid)) {
      this.traces.set(tid, [])
      if (this.traces.size > this.maxTraces) {
        const oldestKey = this.traces.keys().next().value
        if (oldestKey) this.traces.delete(oldestKey)
      }
    }
    this.traces.get(tid)!.push(span)
    this.activeSpans.set(span.spanId, span)

    this.emit({ type: 'span_start', data: span, timestamp: Date.now() })
    return span
  }

  endSpan(span: Span, status: 'ok' | 'error' = 'ok'): Span {
    endSpan(span, status)
    this.activeSpans.delete(span.spanId)

    this.metrics.observe('span_duration_ms', getSpanDuration(span), {
      operation: span.operation,
      status,
    })

    this.emit({ type: 'span_end', data: span, timestamp: Date.now() })
    return span
  }

  addEvent(span: Span, name: string, attributes?: Record<string, unknown>): void {
    addSpanEvent(span, name, attributes)
  }

  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    this.metrics.gauge(name, value, labels)
    this.emit({ type: 'metric', data: { name, value, labels }, timestamp: Date.now() })
  }

  auditRecord(entry: Omit<AuditRecord, 'id' | 'timestamp'>): AuditRecord {
    const record = this.audit.record(entry)
    this.emit({ type: 'audit', data: record, timestamp: Date.now() })
    return record
  }

  getTrace(traceId: string): Span[] | undefined {
    return this.traces.get(traceId)
  }

  getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values())
  }

  formatTrace(traceId: string): string {
    const spans = this.traces.get(traceId)
    if (!spans || spans.length === 0) return `No trace found: ${traceId}`
    return formatSpanTree(spans)
  }

  addListener(listener: ObservabilityListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  reset(): void {
    this.traces.clear()
    this.activeSpans.clear()
    this.metrics.reset()
    this.audit.clear()
  }

  private emit(event: ObservabilityEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // swallow
      }
    }
  }
}

export const globalObservability = new ObservabilityBus()
