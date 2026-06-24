/**
 * 缓存兼容层 — 统一不同缓存实现的接口
 *
 * 职责：
 * - 提供统一的缓存读写接口
 * - 支持 TTL 过期策略
 * - 为 PromptCacheLayer 和 ResponseCacheStore 提供兼容适配
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
