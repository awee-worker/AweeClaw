/**
 * 微信 iLink 协议 context_token 缓存
 *
 * 微信发送消息必须携带 context_token（从收到的消息中获取），
 * 此缓存由 Long Polling 接收端填充，发送端读取。
 */

interface ContextTokenEntry {
  token: string
  createdAt: number
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时
const GC_THRESHOLD = 512

export class WeixinContextCache {
  private items = new Map<string, ContextTokenEntry>()
  private readonly ttlMs: number

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS
  }

  /** 存入 context_token */
  put(target: string, token: string): void {
    const key = target.trim()
    if (!key || !token.trim()) return

    this.items.set(key, {
      token: token.trim(),
      createdAt: Date.now(),
    })

    this.gc()
  }

  /** 获取 context_token，过期返回 undefined */
  get(target: string): string | undefined {
    const key = target.trim()
    if (!key) return undefined

    const entry = this.items.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.items.delete(key)
      return undefined
    }
    return entry.token
  }

  /** 是否存在有效的 context_token */
  has(target: string): boolean {
    return this.get(target) !== undefined
  }

  /** 删除指定 target 的缓存 */
  delete(target: string): void {
    this.items.delete(target.trim())
  }

  /** 清空所有缓存 */
  clear(): void {
    this.items.clear()
  }

  /** 获取所有已缓存的 target 列表（调试用） */
  keys(): string[] {
    return Array.from(this.items.keys())
  }

  /** 过期清理（条目超过阈值时触发） */
  private gc(): void {
    if (this.items.size < GC_THRESHOLD) return
    const now = Date.now()
    for (const [key, entry] of this.items) {
      if (now - entry.createdAt > this.ttlMs) {
        this.items.delete(key)
      }
    }
  }
}
