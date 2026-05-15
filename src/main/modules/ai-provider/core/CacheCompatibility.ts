/**
 * Cache Compatibility layer
 */
export interface CacheEntry {
  key: string
  value: unknown
  timestamp: number
  ttl?: number
}

export class CacheCompatibility {
  private cache = new Map<string, CacheEntry>()

  get(key: string): unknown | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: unknown, ttl?: number): void {
    this.cache.set(key, { key, value, timestamp: Date.now(), ttl })
  }

  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }
}
