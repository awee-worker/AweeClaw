/**
 * 邮件凭据安全存储
 *
 * 使用 AES-256-GCM（本地密钥文件，见 guard/safeStorageUtil）对邮箱密码或
 * 授权码加密后落盘，密文存入 moduleDataStore 的 MAIL_SECRETS 键。
 *
 * 设计要点：
 * - 明文只在内存中短暂存在，绝不写入 config.json，也绝不随设置同步到后端
 * - 配置对象（emailConfig.accounts[].auth）只保留 hasSecret 布尔标记
 * - 密钥文件不可用时拒绝保存（不降级为明文），由调用方提示用户
 * - 旧版 v1 记录（safeStorage 密文）已无法解密，读取时返回 null
 */

import { logger } from '@shared/toolkit/LogEngine'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'
import { decryptString, encryptString, isSafeStorageAvailable } from '../../guard/safeStorageUtil'

/** 密文格式版本：v1 = safeStorage 密文（已弃用），v2 = AES-256-GCM */
const FORMAT_VERSION = 2

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

  /** 当前是否具备加密存储能力 */
  isAvailable(): boolean {
    try {
      return isSafeStorageAvailable()
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
        error: '当前密钥文件不可用，已拒绝保存以保护凭据',
      }
    }
    try {
      const encrypted = encryptString(plain)
      const next: SecretMap = {
        ...this.readAll(),
        [accountId]: { v: FORMAT_VERSION, data: encrypted },
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
    // 旧版 safeStorage 密文已无法解密
    if (record.v === 1) {
      logger.system.warn(`[MailSecretStore] 账户 ${accountId} 存在旧版密文，需重新设置凭据`)
      return null
    }
    if (!this.isAvailable()) return null
    try {
      const decrypted = decryptString(record.data)
      return decrypted || null
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
