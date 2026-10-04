/**
 * 邮件账户读取层
 *
 * 账户元信息（地址、IMAP 主机、文件夹等）由渲染层设置页写入 app-settings.emailConfig，
 * 主进程只负责读取；凭据另存于 MailSecretStore（safeStorage 加密）。
 *
 * 这样保证：
 * - 单一真相：账户配置与其它设置走同一条保存链路
 * - 凭据隔离：主进程读取时按需解密，明文不进入设置结构
 */

import type { EmailAccount, EmailConfig } from '@shared/configuration/configTypes'
import { getConfigStore } from '../../bootstrap/stores'
import { mailSecretStore } from './MailSecretStore'

/** app-settings 存储键（与 settings-db 写入结构一致） */
const APP_SETTINGS_KEY = 'app-settings'

class MailAccountStore {
  /** 从 configStore 读取 emailConfig（读取失败一律视为无账户） */
  private readEmailConfig(): EmailConfig | undefined {
    try {
      const appSettings = getConfigStore().get(APP_SETTINGS_KEY) as
        | { emailConfig?: EmailConfig }
        | undefined
      return appSettings?.emailConfig
    } catch {
      return undefined
    }
  }

  /** 读取全部收件账户（合并 hasSecret 实时标记） */
  getAccounts(onlyEnabled = false): EmailAccount[] {
    const accounts = this.readEmailConfig()?.accounts ?? []
    return accounts
      .filter((a) => (onlyEnabled ? a.enabled !== false : true))
      .map((a) => ({
        ...a,
        auth: { ...a.auth, hasSecret: mailSecretStore.hasSecret(a.id) },
      }))
  }

  /** 按 ID 读取单个账户 */
  getAccount(id: string): EmailAccount | undefined {
    if (!id) return undefined
    return this.getAccounts().find((a) => a.id === id)
  }

  /** 读取定时自动整理设置 */
  getAutoOrganize(): EmailConfig['autoOrganize'] {
    return this.readEmailConfig()?.autoOrganize
  }

  /** 取账户凭据明文（不存在或解密失败返回 null） */
  getCredential(id: string): string | null {
    return mailSecretStore.getSecret(id)
  }
}

/** 全局单例 */
export const mailAccountStore = new MailAccountStore()
