export interface HealthStatus {
  healthy: boolean
  message?: string
  details?: Record<string, unknown>
  checkedAt: number
}

export class HealthCheckRegistry {
  private checks = new Map<string, () => Promise<HealthStatus>>()
  private results = new Map<string, HealthStatus>()

  register(name: string, check: () => Promise<HealthStatus>): void {
    this.checks.set(name, check)
  }

  unregister(name: string): void {
    this.checks.delete(name)
    this.results.delete(name)
  }

  async runCheck(name: string): Promise<HealthStatus> {
    const check = this.checks.get(name)
    if (!check) {
      return { healthy: false, message: `No health check registered: ${name}`, checkedAt: Date.now() }
    }
    try {
      const result = await check()
      result.checkedAt = Date.now()
      this.results.set(name, result)
      return result
    } catch (error) {
      const result: HealthStatus = {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now(),
      }
      this.results.set(name, result)
      return result
    }
  }

  async runAll(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {}
    const entries = Array.from(this.checks.entries())
    await Promise.allSettled(
      entries.map(async ([name, check]) => {
        try {
          const result = await check()
          result.checkedAt = Date.now()
          this.results.set(name, result)
          results[name] = result
        } catch (error) {
          const result: HealthStatus = {
            healthy: false,
            message: error instanceof Error ? error.message : String(error),
            checkedAt: Date.now(),
          }
          this.results.set(name, result)
          results[name] = result
        }
      })
    )
    return results
  }

  getLastResults(): Record<string, HealthStatus> {
    return Object.fromEntries(this.results.entries())
  }

  getOverallHealth(): { healthy: boolean; checks: number; failing: string[] } {
    let healthy = true
    const failing: string[] = []
    for (const [name, status] of this.results.entries()) {
      if (!status.healthy) {
        healthy = false
        failing.push(name)
      }
    }
    return { healthy, checks: this.results.size, failing }
  }
}
