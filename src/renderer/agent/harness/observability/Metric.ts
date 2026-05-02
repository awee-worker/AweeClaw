export interface MetricEntry {
  name: string
  value: number
  timestamp: number
  labels: Record<string, string>
  type: 'counter' | 'gauge' | 'histogram'
}

export class MetricCollector {
  private counters = new Map<string, number>()
  private gauges = new Map<string, number>()
  private histograms = new Map<string, number[]>()
  private history: MetricEntry[] = []
  private readonly maxHistory: number

  constructor(maxHistory = 10000) {
    this.maxHistory = maxHistory
  }

  increment(name: string, value = 1, labels: Record<string, string> = {}): void {
    const key = this.metricKey(name, labels)
    const current = this.counters.get(key) ?? 0
    this.counters.set(key, current + value)
    this.recordHistory({ name, value: current + value, timestamp: Date.now(), labels, type: 'counter' })
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.metricKey(name, labels)
    this.gauges.set(key, value)
    this.recordHistory({ name, value, timestamp: Date.now(), labels, type: 'gauge' })
  }

  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.metricKey(name, labels)
    let values = this.histograms.get(key)
    if (!values) {
      values = []
      this.histograms.set(key, values)
    }
    values.push(value)
    if (values.length > 1000) values.splice(0, values.length - 1000)
    this.recordHistory({ name, value, timestamp: Date.now(), labels, type: 'histogram' })
  }

  getCounter(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(this.metricKey(name, labels)) ?? 0
  }

  getGauge(name: string, labels: Record<string, string> = {}): number | undefined {
    return this.gauges.get(this.metricKey(name, labels))
  }

  getHistogramStats(name: string, labels: Record<string, string> = {}): {
    count: number
    min: number
    max: number
    avg: number
    p50: number
    p95: number
    p99: number
  } | null {
    const values = this.histograms.get(this.metricKey(name, labels))
    if (!values || values.length === 0) return null

    const sorted = [...values].sort((a, b) => a - b)
    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    }
  }

  getHistory(filter?: { name?: string; type?: MetricEntry['type'] }): MetricEntry[] {
    let entries = this.history
    if (filter?.name) entries = entries.filter(e => e.name === filter.name)
    if (filter?.type) entries = entries.filter(e => e.type === filter.type)
    return entries
  }

  reset(): void {
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
    this.history.length = 0
  }

  private metricKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',')
    return labelStr ? `${name}{${labelStr}}` : name
  }

  private recordHistory(entry: MetricEntry): void {
    this.history.push(entry)
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory)
    }
  }
}
