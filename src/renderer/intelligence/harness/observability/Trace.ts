export interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  operation: string
  startTime: number
  endTime?: number
  status: 'ok' | 'error' | 'pending'
  attributes: Record<string, unknown>
  events: SpanEvent[]
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, unknown>
}

let spanCounter = 0

export function createSpan(
  operation: string,
  traceId: string,
  parentSpanId?: string,
  attributes?: Record<string, unknown>
): Span {
  spanCounter++
  return {
    traceId,
    spanId: `span-${spanCounter}-${Date.now().toString(36)}`,
    parentSpanId,
    operation,
    startTime: performance.now(),
    status: 'pending',
    attributes: attributes ?? {},
    events: [],
  }
}

export function endSpan(span: Span, status: 'ok' | 'error' = 'ok'): Span {
  span.endTime = performance.now()
  span.status = status
  return span
}

export function addSpanEvent(span: Span, name: string, attributes?: Record<string, unknown>): void {
  span.events.push({
    name,
    timestamp: performance.now(),
    attributes,
  })
}

export function getSpanDuration(span: Span): number {
  if (span.endTime === undefined) return 0
  return span.endTime - span.startTime
}

export function formatSpanTree(spans: Span[]): string {
  const byId = new Map(spans.map(s => [s.spanId, s]))
  const roots = spans.filter(s => !s.parentSpanId || !byId.has(s.parentSpanId))

  function formatSpan(span: Span, indent: number): string {
    const duration = getSpanDuration(span)
    const statusIcon = span.status === 'ok' ? '✓' : span.status === 'error' ? '✗' : '…'
    const line = `${'  '.repeat(indent)}${statusIcon} [${duration.toFixed(1)}ms] ${span.operation}`
    const children = spans.filter(s => s.parentSpanId === span.spanId)
    const childLines = children.map(c => formatSpan(c, indent + 1)).join('\n')
    return childLines ? `${line}\n${childLines}` : line
  }

  return roots.map(r => formatSpan(r, 0)).join('\n')
}
