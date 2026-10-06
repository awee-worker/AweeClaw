/**
 * 记忆内容加密（主进程）
 *
 * 本地 SQLite 中的敏感记忆以 AES-256-GCM 密文落库：加密密钥单独存放，
 * 并由系统级安全存储（Electron safeStorage，对应 macOS Keychain / Windows
 * DPAPI / Linux libsecret）保护，避免密钥与密文同处一份文件。
 *
 * 兼容策略：密文统一带 `enc:v1:` 前缀，读取时按前缀判断是否需要解密。
 * 存量明文数据与未命中敏感规则的记忆保持原样，无需数据迁移。
 *
 * 开关来自「记忆系统设置 → 隐私与安全 → 加密敏感记忆」，由渲染进程在
 * 保存设置时同步到主进程（memory-db:setEncryptionEnabled）。
 */

import * as crypto from 'crypto'
import Store from 'electron-store'
import { logger } from '@shared/toolkit/LogEngine'
import {
  detectSensitiveContent,
  hasSensitiveTag,
} from '@shared/memory/sensitiveContent'
import {
  decryptString,
  encryptString,
} from '../../guard/safeStorageUtil'

/** 记忆内容密文前缀（区别于 safeStorageUtil 用于凭证存储的前缀） */
const CIPHER_PREFIX = 'enc:v1:'

const CIPHER_ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12

/** 加密开关在 electron-store 中的键名，与设置面板字段同名 */
const ENCRYPTION_ENABLED_KEY = 'encryptSensitiveMemory'

/** 密钥与开关的持久化位置（userData 目录，与其它主进程 store 同级） */
let storeInstance: Store | null = null

let cachedKey: Buffer | null = null
/** 密钥无法获取时置位，避免反复尝试并阻止以新密钥覆盖旧密钥 */
let keyUnavailable = false

function getStore(): Store {
  if (!storeInstance) storeInstance = new Store({ name: 'memory-privacy' })
  return storeInstance
}

/**
 * 读取或创建内容加密密钥。
 *
 * 仅在从未生成过密钥时新建；已存在但无法解密时返回 null（本次不加密），
 * 不以新密钥覆盖，否则历史密文将永久无法还原。
 */
function loadOrCreateKey(): Buffer | null {
  if (cachedKey) return cachedKey
  if (keyUnavailable) return null

  try {
    const stored = getStore().get('contentKey')
    if (typeof stored === 'string' && stored) {
      const decrypted = decryptString(stored)
      const raw = decrypted ? Buffer.from(decrypted, 'base64') : Buffer.alloc(0)
      if (raw.length === KEY_BYTES) {
        cachedKey = raw
        return raw
      }
      logger.security.error('[MemoryCrypto] 已存密钥无法解密，跳过加密以免覆盖原密钥')
      keyUnavailable = true
      return null
    }

    const key = crypto.randomBytes(KEY_BYTES)
    getStore().set('contentKey', encryptString(key.toString('base64')))
    cachedKey = key
    logger.security.info('[MemoryCrypto] 已生成记忆内容加密密钥')
    return key
  } catch (err) {
    logger.security.error('[MemoryCrypto] 密钥读取失败:', err)
    keyUnavailable = true
    return null
  }
}

/** 判断一个 content 值是否为已加密的记忆密文 */
export function isEncryptedMemoryContent(value: string): boolean {
  return typeof value === 'string' && value.startsWith(CIPHER_PREFIX)
}

/**
 * 加密记忆内容，返回带前缀的密文。
 * 密钥不可用时原样返回，保证写入不失败。
 */
export function encryptMemoryContent(plain: string): string {
  const key = loadOrCreateKey()
  if (!key) return plain

  try {
    const iv = crypto.randomBytes(IV_BYTES)
    const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, key, iv)
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return (
      CIPHER_PREFIX +
      [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
    )
  } catch (err) {
    logger.security.error('[MemoryCrypto] 加密失败，按明文写入:', err)
    return plain
  }
}

/**
 * 解密记忆内容。
 * 非密文（存量明文）原样返回；解密失败返回占位符而非密文，避免界面上出现乱码。
 */
export function decryptMemoryContent(stored: string): string {
  if (!isEncryptedMemoryContent(stored)) return stored

  const key = loadOrCreateKey()
  if (!key) return stored

  try {
    const [ivB64, tagB64, dataB64] = stored.slice(CIPHER_PREFIX.length).split(':')
    const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch (err) {
    logger.security.error('[MemoryCrypto] 解密失败:', err)
    return '[加密内容解密失败]'
  }
}

/**
 * 敏感判定规则与标签集合统一维护在 @shared/memory/sensitiveContent：
 * 本地加密（本文件）与云端同步过滤（渲染进程）共用同一套口径。
 * 此处再导出一份，保持既有引用路径可用。
 */
export { detectSensitiveContent } from '@shared/memory/sensitiveContent'

/** 当前是否开启敏感记忆加密（默认开启，与设置面板默认值保持一致） */
export function isEncryptionEnabled(): boolean {
  try {
    const value = getStore().get(ENCRYPTION_ENABLED_KEY)
    return typeof value === 'boolean' ? value : true
  } catch {
    return true
  }
}

/** 由渲染进程在保存设置时调用，更新加密开关 */
export function setEncryptionEnabled(enabled: boolean): void {
  getStore().set(ENCRYPTION_ENABLED_KEY, !!enabled)
  logger.security.info(`[MemoryCrypto] 敏感记忆加密已${enabled ? '开启' : '关闭'}`)
}

/**
 * 写入前处理：开关开启且内容（或标签）命中敏感规则时加密，否则原样返回。
 */
export function protectMemoryContent(content: string, tags?: string): string {
  if (!content || isEncryptedMemoryContent(content)) return content
  if (!isEncryptionEnabled()) return content
  if (!hasSensitiveTag(tags) && !detectSensitiveContent(content)) return content
  return encryptMemoryContent(content)
}

/** 读取时处理：密文解密，明文原样返回 */
export function revealMemoryContent(stored: string): string {
  return decryptMemoryContent(stored)
}
