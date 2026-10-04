/**
 * 邮箱服务商收发服务器对照表
 *
 * IMAP 收信与 SMTP 发信属于两套协议，但主流服务商共用同一个账号与同一份
 * 凭据（登录密码 / 授权码），且发信服务器可按固定规则由收信服务器推导
 * （imap.qq.com → smtp.qq.com:465）。
 *
 * 因此设置页只需录入收件账户，发件连接参数由本表推导，
 * 避免用户把同一套账号密码填写两遍。
 */

import type { MailProviderId } from './configTypes'

/** SMTP 发件连接参数（不含凭据） */
export interface SmtpEndpoint {
  host: string
  port: number
  /** true = 直连 TLS（通常 465），false = STARTTLS（通常 587） */
  secure: boolean
}

/**
 * 常见服务商的 SMTP 端点。
 *
 * 未列入的（custom）走主机名规则推导，见 resolveSmtpEndpoint。
 */
const PROVIDER_SMTP: Partial<Record<MailProviderId, SmtpEndpoint>> = {
  qq: { host: 'smtp.qq.com', port: 465, secure: true },
  '163': { host: 'smtp.163.com', port: 465, secure: true },
  '126': { host: 'smtp.126.com', port: 465, secure: true },
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  // Outlook 使用 STARTTLS + 587，与 IMAP 的 993 直连不同
  outlook: { host: 'smtp.office365.com', port: 587, secure: false },
  aliyun: { host: 'smtp.aliyun.com', port: 465, secure: true },
}

/**
 * 推导某收件账户对应的 SMTP 发件端点。
 *
 * 优先按服务商标识查表；自定义服务商回退到主机名规则：
 * `imap.<domain>` → `smtp.<domain>:465`。无法推导时返回 null，
 * 由调用方提示用户该邮箱不支持自动发件。
 *
 * @param provider 服务商标识（账户配置中的 provider 字段）
 * @param imapHost 收件服务器主机名，用于 custom 场景推导
 */
export function resolveSmtpEndpoint(
  provider: MailProviderId,
  imapHost: string,
): SmtpEndpoint | null {
  const preset = PROVIDER_SMTP[provider]
  if (preset) return preset

  const host = (imapHost || '').trim().toLowerCase()
  if (host.startsWith('imap.')) {
    return { host: `smtp.${host.slice('imap.'.length)}`, port: 465, secure: true }
  }
  return null
}
