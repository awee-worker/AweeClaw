/**
 * 请求缓存 — AI Provider 请求结果缓存
 *
 * 职责：
 * - 缓存 AI 请求的响应结果，避免重复调用
 * - 支持 TTL 过期策略
 * - 基于 Map 的轻量级内存缓存
 */
export class RequestCache {
  private cache = new Map<string, { response: unknown; timestamp: number }>()
  private defaultTtl = 5 * 60 * 1000

  get<T = unknown>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > this.defaultTtl) {
      this.cache.delete(key)
      return undefined
    }
    return entry.response as T
  }

  set(key: string, response: unknown, _ttl?: number): void {
    this.cache.set(key, { response, timestamp: Date.now() })
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear()
      return
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
  }
}
