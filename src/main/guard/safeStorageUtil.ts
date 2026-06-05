/**
 * 安全存储工具模块
 *
 * 使用 Electron safeStorage API 对敏感数据（如 API Key）进行加密/解密。
 * 加密数据以 Base64 字符串形式存入 SQLite，renderer 进程无法直接读取明文。
 *
 * 安全保障:
 * - macOS: 使用 Keychain 存储
 * - Windows: 使用 DPAPI
 * - Linux: 使用 libsecret（需安装）
 *
 * 注意: safeStorage 在 app ready 后才可用，且需要确保 isEncryptionAvailable()
 */

import { safeStorage } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/** 加密前缀标识，用于区分加密数据和明文数据 */
const ENCRYPTED_PREFIX = 'enc:v1:'

/**
 * 检查 safeStorage 是否可用
 */
export function isSafeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * 加密字符串
 *
 * @param plainText 明文字符串
 * @returns 加密后的 Base64 字符串（带前缀标识），如果加密不可用则返回原文
 */
export function encryptString(plainText: string): string {
  if (!plainText) return ''

  try {
    if (!isSafeStorageAvailable()) {
      logger.security.warn('[SafeStorage] Encryption not available, storing as plaintext')
      return plainText
    }

    const encrypted = safeStorage.encryptString(plainText)
    return ENCRYPTED_PREFIX + encrypted.toString('base64')
  } catch (err) {
    logger.security.error('[SafeStorage] Encryption failed:', err)
    return plainText
  }
}

/**
 * 解密字符串
 *
 * @param cipherText 加密后的字符串（可能带前缀标识，也可能是旧版明文）
 * @returns 解密后的明文字符串
 */
export function decryptString(cipherText: string): string {
  if (!cipherText) return ''

  // 非加密数据（旧版明文兼容）
  if (!cipherText.startsWith(ENCRYPTED_PREFIX)) {
    return cipherText
  }

  try {
    const base64Data = cipherText.slice(ENCRYPTED_PREFIX.length)
    const buffer = Buffer.from(base64Data, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (err) {
    logger.security.error('[SafeStorage] Decryption failed:', err)
    return ''
  }
}

/**
 * 判断字符串是否已加密
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX)
}
