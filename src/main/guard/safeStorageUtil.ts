/**
 * 敏感数据安全存储工具模块（AES-256-GCM + 本地密钥文件）
 *
 * 不再依赖 Electron safeStorage / 系统钥匙串（macOS Keychain），
 * 避免应用启动时触发钥匙串授权弹窗。
 *
 * 方案：
 * - 密钥：首次使用时生成 32 字节随机密钥，持久化到 <userData>/.aweeclaw-secret.key
 *   （权限 0600，仅当前用户可读；备份 userData 目录即可迁移数据）
 * - 算法：AES-256-GCM，每次加密使用随机 IV
 * - 密文格式：enc:v2:base64(iv || authTag || ciphertext)
 *
 * 兼容性（升级路径见 guard/secretMigration）：
 * - 旧版 enc:v1:（safeStorage 加密）数据由启动迁移一次性转为 enc:v2:；
 *   迁移前通过 safeStorage 兜底解密保证可读，迁移后不再依赖系统钥匙串
 * - 无前缀的存量明文原样返回
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { app, safeStorage } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/** 新版本密文前缀（AES-256-GCM） */
const ENCRYPTED_PREFIX = 'enc:v2:'
/** 旧版本密文前缀（safeStorage），启动迁移后不再产生 */
const LEGACY_PREFIX = 'enc:v1:'

const KEY_FILE_NAME = '.aweeclaw-secret.key'
const KEY_BYTES = 32
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

let cachedKey: Buffer | null = null

/** 密钥文件路径（应用数据目录） */
function keyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILE_NAME)
}

/** 读取或创建本地密钥（进程内缓存，只首次读盘） */
function loadOrCreateKey(): Buffer {
  if (cachedKey) return cachedKey

  const file = keyFilePath()
  try {
    if (fs.existsSync(file)) {
      cachedKey = fs.readFileSync(file)
    }
    if (!cachedKey || cachedKey.length !== KEY_BYTES) {
      cachedKey = crypto.randomBytes(KEY_BYTES)
      fs.writeFileSync(file, cachedKey, { mode: 0o600 })
    }
    try {
      fs.chmodSync(file, 0o600)
    } catch {
      /* 非 POSIX 平台忽略 */
    }
    return cachedKey
  } catch (err) {
    logger.security.error('[SecretStore] 密钥文件读写失败:', err)
    throw err
  }
}

/**
 * 检查加密能力是否可用（密钥文件可读写即视为可用）
 */
export function isSafeStorageAvailable(): boolean {
  try {
    loadOrCreateKey()
    return true
  } catch {
    return false
  }
}

/**
 * 加密字符串（AES-256-GCM）
 *
 * @param plainText 明文字符串
 * @returns 加密后的字符串（enc:v2: 前缀），密钥不可用时降级返回原文并告警
 */
export function encryptString(plainText: string): string {
  if (!plainText) return ''

  try {
    const key = loadOrCreateKey()
    const iv = crypto.randomBytes(IV_BYTES)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return ENCRYPTED_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64')
  } catch (err) {
    logger.security.error('[SecretStore] 加密失败，降级为明文:', err)
    return plainText
  }
}

/**
 * 解密字符串
 *
 * @param cipherText 加密后的字符串（enc:v2: 前缀），也可能是存量明文或旧版密文
 * @returns 解密后的明文字符串；解密失败返回空串
 */
export function decryptString(cipherText: string): string {
  if (!cipherText) return ''

  // 旧版 safeStorage 密文：优先由启动迁移转为 enc:v2:；迁移前用 safeStorage 兜底解密
  if (cipherText.startsWith(LEGACY_PREFIX)) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const buf = Buffer.from(cipherText.slice(LEGACY_PREFIX.length), 'base64')
        return safeStorage.decryptString(buf)
      }
    } catch (err) {
      logger.security.warn('[SecretStore] 旧版密文解密失败（需重新配置凭据）:', err)
    }
    return ''
  }

  // 无前缀 = 存量明文，原样返回
  if (!cipherText.startsWith(ENCRYPTED_PREFIX)) {
    return cipherText
  }

  try {
    const key = loadOrCreateKey()
    const payload = Buffer.from(cipherText.slice(ENCRYPTED_PREFIX.length), 'base64')
    if (payload.length < IV_BYTES + TAG_BYTES) return ''
    const iv = payload.subarray(0, IV_BYTES)
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const data = payload.subarray(IV_BYTES + TAG_BYTES)
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch (err) {
    logger.security.error('[SecretStore] 解密失败:', err)
    return ''
  }
}

/**
 * 判断字符串是否已加密（新旧前缀都视为已加密）
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX) || value.startsWith(LEGACY_PREFIX)
}
