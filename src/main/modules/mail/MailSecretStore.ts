/**
 * 邮件凭据安全存储
 *
 * 使用 Electron safeStorage（macOS Keychain / Windows DPAPI / Linux libsecret）
 * 对邮箱密码或授权码加密后落盘，密文存入 moduleDataStore 的 MAIL_SECRETS 键。
 *
 * 设计要点：
 * - 明文只在内存中短暂存在，绝不写入 config.json，也绝不随设置同步到后端
 * - 配置对象（emailConfig.accounts[].auth）只保留 hasSecret 布尔标记
 * - 系统不支持安全存储时拒绝保存（不降级为明文），由调用方提示用户
 */

import { safeStorage } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'

/** 密文格式版本，便于将来更换算法时迁移 */
const FORMAT_VERSION = 1

interface SecretRecord {
  /** 格式版本 */
  v: number
  /** base64 编码的密文 */
  data: string
}

type SecretMap = Record<string, SecretRecord>

class MailSecretStore {
  private readAll(): SecretMap {
    return moduleDataStore.get<SecretMap>(STORE_KEYS.MAIL_SECRETS) ?? {}
  }

  private writeAll(next: SecretMap): void {
    moduleDataStore.set(STORE_KEYS.MAIL_SECRETS, next)
  }

  /** 当前系统是否具备安全存储能力 */
  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /** 保存（覆盖）某账户的凭据 */
  setSecret(accountId: string, plain: string): { success: boolean; error?: string } {
    if (!accountId) return { success: false, error: '账户 ID 不能为空' }
    if (!plain) return { success: false, error: '凭据不能为空' }
    if (!this.isAvailable()) {
      return {
        success: false,
        error: '当前系统不支持安全存储（缺少 Keychain / DPAPI / libsecret），已拒绝保存以保护凭据',
      }
    }
    try {
      const encrypted = safeStorage.encryptString(plain)
      const next: SecretMap = {
        ...this.readAll(),
        [accountId]: { v: FORMAT_VERSION, data: encrypted.toString('base64') },
      }
      this.writeAll(next)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.system.error(`[MailSecretStore] 加密保存失败: ${message}`)
      return { success: false, error: message }
    }
  }

  /** 读取某账户的明文凭据（解密失败或不存在返回 null） */
  getSecret(accountId: string): string | null {
    const record = this.readAll()[accountId]
    if (!record?.data) return null
    if (!this.isAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(record.data, 'base64'))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.system.warn(`[MailSecretStore] 解密失败（账户 ${accountId}）: ${message}`)
      return null
    }
  }

  /** 是否已保存凭据 */
  hasSecret(accountId: string): boolean {
    return Boolean(this.readAll()[accountId]?.data)
  }

  /** 删除某账户的凭据 */
  deleteSecret(accountId: string): void {
    const current = this.readAll()
    if (!(accountId in current)) return
    const next: SecretMap = { ...current }
    delete next[accountId]
    this.writeAll(next)
  }
}

/** 全局单例 */
export const mailSecretStore = new MailSecretStore()
