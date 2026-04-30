/**
 * 文件缓存服务
 * 独立于 Agent 的缓存管理，避免循环依赖
 */

import { CacheService } from '@shared/utils'
import { normalizePath } from '@shared/utils/pathUtils'

// 文件缓存：避免重复读取相同文件
const fileCache = new CacheService<string>('AgentFileCache', {
  maxSize: 200,
  maxMemory: 30 * 1024 * 1024,
  defaultTTL: 10 * 60 * 1000,
})

/**
 * FNV-1a 哈希算法（用于文件内容哈希）
 */
function fnvHash(str: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  const len = str.length
  const mid = len >> 1

  for (let i = 0; i < mid; i++) {
    h1 ^= str.charCodeAt(i)
    h1 = Math.imul(h1, 0x01000193)
  }

  for (let i = mid; i < len; i++) {
    h2 ^= str.charCodeAt(i)
    h2 = Math.imul(h2, 0x01000193)
  }

  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

export const fileCacheService = {
  /**
   * 检查文件是否有有效缓存
   */
  hasValidCache(filePath: string): boolean {
    return fileCache.has(normalizePath(filePath))
  },

  /**
   * 标记文件已读取（用于缓存）
   */
  markFileAsRead(filePath: string, content: string): void {
    fileCache.set(normalizePath(filePath), fnvHash(content))
  },

  /**
   * 获取文件缓存哈希
   */
  getFileHash(filePath: string): string | null {
    return fileCache.get(normalizePath(filePath)) ?? null
  },

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return fileCache.getStats()
  },

  /**
   * 清除缓存
   */
  clear(): void {
    fileCache.clear()
  },
}
