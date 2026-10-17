/**
 * 旧版 safeStorage 密文（enc:v1:）一次性迁移到 AES-256-GCM（enc:v2:）
 *
 * 升级路径：历史版本使用 Electron safeStorage（macOS Keychain）加密敏感字段，
 * 本模块在应用启动早期对所有已知存储位置执行一次迁移：解密后用本地密钥
 * 文件重新加密写回，之后不再依赖系统钥匙串。
 *
 * 兼容策略：
 * - 解密失败（safeStorage 不可用 / Keychain 无授权）时保留原值，读取端由
 *   safeStorageUtil.decryptString 兜底，保证旧数据不丢、无需用户重新配置
 * - 迁移只触发一次：v1 值写回后即为 v2，后续扫描不再命中
 * - JSON 配置（electron-store / ModuleDataStore / memory-privacy 等）通用递归迁移；
 *   settings.db 由 SettingsDb.migrateLegacySecrets 定点迁移
 */

import * as fs from 'fs'
import * as path from 'path'
import { safeStorage } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { encryptString } from './safeStorageUtil'

export const V1_PREFIX = 'enc:v1:'
const V2_PREFIX = 'enc:v2:'

/** 用 safeStorage 解密 v1 密文；不可用或失败返回 null */
export function decryptLegacyV1(cipher: string): string | null {
  if (!cipher.startsWith(V1_PREFIX)) return null
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const buf = Buffer.from(cipher.slice(V1_PREFIX.length), 'base64')
    return safeStorage.decryptString(buf)
  } catch (err) {
    logger.security.warn('[SecretMigration] v1 密文解密失败（保留原值）:', err)
    return null
  }
}

/** 递归迁移任意 JSON 值中的 enc:v1: 字符串为 enc:v2: */
export function migrateV1Value(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(V1_PREFIX)) {
    const plain = decryptLegacyV1(value)
    if (plain !== null) {
      const next = encryptString(plain)
      if (next.startsWith(V2_PREFIX)) return next
    }
    // 解密失败：保留原值，读取端兜底
    return value
  }
  if (Array.isArray(value)) {
    return value.map((v) => migrateV1Value(v))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = migrateV1Value(v)
    }
    return out
  }
  return value
}

/**
 * 扫描 userData 下所有 .json 配置文件并就地迁移 enc:v1: 值。
 * settings.db（二进制）不在此处理，由 SettingsDb.migrateLegacySecrets 负责。
 */
export function migrateJsonSecrets(userDataPath: string): { scanned: number; migrated: number } {
  let scanned = 0
  let migrated = 0

  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      let raw: string
      try {
        raw = fs.readFileSync(full, 'utf-8')
      } catch {
        continue
      }
      if (!raw.includes(V1_PREFIX)) continue
      scanned++
      try {
        const next = migrateV1Value(JSON.parse(raw))
        const out = JSON.stringify(next, null, 2)
        if (out !== raw) {
          fs.writeFileSync(full, out, 'utf-8')
          migrated++
          logger.security.info(`[SecretMigration] 已迁移 ${path.relative(userDataPath, full)}`)
        }
      } catch (err) {
        logger.security.warn(`[SecretMigration] 跳过无法解析的文件 ${full}:`, err)
      }
    }
  }

  walk(userDataPath)
  if (migrated > 0) {
    logger.security.info(`[SecretMigration] 完成：${migrated} 个文件已升级为 enc:v2:`)
  }
  return { scanned, migrated }
}
