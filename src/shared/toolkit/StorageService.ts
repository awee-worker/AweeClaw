/**
 * 统一存储服务
 *
 * 封装 localStorage，提供：
 * 1. 类型安全的读写接口
 * 2. 数据版本管理与自动迁移
 * 3. 过期时间支持
 * 4. 命名空间隔离，防止 key 冲突
 * 5. 安全的 JSON 序列化/反序列化
 */

import { logger } from './LogEngine'

/** 存储项元数据 */
interface StorageEntry<T> {
  v: T
  _ver?: number
  _exp?: number // 过期时间戳（ms）
}

/** 存储迁移函数 */
type MigrationFn<T> = (data: unknown, fromVersion: number) => T

/** 存储项配置 */
interface StorageSchema<T> {
  version?: number
  migrate?: MigrationFn<T>
  defaultValue: T
  ttl?: number // 存活时间（ms）
}

const NAMESPACE = 'aweeclaw'
const SEP = ':'

/**
 * 生成带命名空间的 key
 */
function namespacedKey(key: string): string {
  return `${NAMESPACE}${SEP}${key}`
}

/**
 * 统一存储服务
 */
export const StorageService = {
  /**
   * 读取存储值
   */
  get<T>(key: string, defaultValue?: T): T | null {
    try {
      const raw = localStorage.getItem(namespacedKey(key))
      if (raw === null) return defaultValue !== undefined ? defaultValue : null

      const entry: StorageEntry<T> = JSON.parse(raw)

      // 检查过期
      if (entry._exp && Date.now() > entry._exp) {
        localStorage.removeItem(namespacedKey(key))
        return defaultValue !== undefined ? defaultValue : null
      }

      return entry.v
    } catch (e) {
      logger.ui.debug(`[Storage] Failed to read key "${key}":`, e)
      return defaultValue !== undefined ? defaultValue : null
    }
  },

  /**
   * 写入存储值
   */
  set<T>(key: string, value: T, ttl?: number): void {
    try {
      const entry: StorageEntry<T> = { v: value }
      if (ttl) entry._exp = Date.now() + ttl
      localStorage.setItem(namespacedKey(key), JSON.stringify(entry))
    } catch (e) {
      logger.ui.warn(`[Storage] Failed to write key "${key}":`, e)
    }
  },

  /**
   * 删除存储值
   */
  remove(key: string): void {
    try {
      localStorage.removeItem(namespacedKey(key))
    } catch (e) {
      logger.ui.debug(`[Storage] Failed to remove key "${key}":`, e)
    }
  },

  /**
   * 按前缀批量删除
   */
  removeByPrefix(prefix: string): void {
    try {
      const nsPrefix = namespacedKey(prefix)
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(nsPrefix)) keysToRemove.push(k)
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k))
    } catch (e) {
      logger.ui.debug(`[Storage] Failed to remove by prefix "${prefix}":`, e)
    }
  },

  /**
   * 带版本和迁移的读取
   */
  getWithSchema<T>(key: string, schema: StorageSchema<T>): T {
    try {
      const raw = localStorage.getItem(namespacedKey(key))
      if (raw === null) return schema.defaultValue

      const entry: StorageEntry<T> = JSON.parse(raw)

      // 检查过期
      if (entry._exp && Date.now() > entry._exp) {
        localStorage.removeItem(namespacedKey(key))
        return schema.defaultValue
      }

      // 版本迁移
      if (schema.version && schema.migrate && (entry._ver ?? 0) < schema.version) {
        const migrated = schema.migrate(entry.v, entry._ver ?? 0)
        StorageService.setWithSchema(key, migrated, schema)
        return migrated
      }

      return entry.v
    } catch (e) {
      logger.ui.debug(`[Storage] Failed to read schema key "${key}":`, e)
      return schema.defaultValue
    }
  },

  /**
   * 带版本的写入
   */
  setWithSchema<T>(key: string, value: T, schema: StorageSchema<T>): void {
    try {
      const entry: StorageEntry<T> = { v: value, _ver: schema.version }
      if (schema.ttl) entry._exp = Date.now() + schema.ttl
      localStorage.setItem(namespacedKey(key), JSON.stringify(entry))
    } catch (e) {
      logger.ui.warn(`[Storage] Failed to write schema key "${key}":`, e)
    }
  },

  /**
   * 清除所有 aweeclaw 命名空间的存储
   */
  clearAll(): void {
    StorageService.removeByPrefix('')
  },
}
