/**
 * 邮箱账户「草稿 → 正式账户」的公共构造逻辑
 *
 * 设置页的账户表单与设置保存共用同一套落库规则，避免两处各写一份导致行为不一致：
 * - 账户 id 由邮箱地址派生，保证「先存凭据、后落账户」时两侧 id 能对应
 * - 外发（SMTP）主机留空则不写入，由主进程按服务商规则自动推导
 */

import type { EmailAccount, EmailAccountDraft } from './configTypes'

/** 账户 id 前缀（id 由邮箱地址派生，收件配置与凭据共用同一 id） */
const ACCOUNT_ID_PREFIX = 'mail-'

/** 由邮箱地址派生稳定的账户 id：同一邮箱始终映射到同一账户，避免重复落库 */
export function mailAccountIdFromAddress(address: string): string {
  return `${ACCOUNT_ID_PREFIX}${address.trim().toLowerCase()}`
}

/** 草稿是否已具备落库条件（邮箱地址与收件服务器为必填） */
export function isAccountDraftCompletable(draft?: EmailAccountDraft | null): boolean {
  return Boolean(draft?.address?.trim() && draft?.host?.trim())
}

/**
 * 把一份填写完整的账户草稿转换为账户对象。
 *
 * 草稿不完整（缺邮箱地址或收件服务器）时返回 null。
 * hasSecret 仅为展示用标记：账户读取时主进程会按安全存储实时覆盖该值。
 */
export function buildEmailAccountFromDraft(
  draft: EmailAccountDraft,
  hasSecret = false,
): EmailAccount | null {
  const address = draft.address?.trim()
  const host = draft.host?.trim()
  if (!address || !host) return null

  const smtpHost = draft.smtpHost?.trim()
  return {
    id: mailAccountIdFromAddress(address),
    label: draft.label?.trim() || address,
    address,
    provider: draft.provider,
    imap: { host, port: draft.port || 993, secure: draft.secure ?? true },
    ...(smtpHost
      ? { smtp: { host: smtpHost, port: draft.smtpPort || 465, secure: draft.smtpSecure ?? true } }
      : {}),
    auth: { type: 'password', user: address, hasSecret },
    idleEnabled: true,
    folders: ['INBOX'],
    enabled: true,
    createdAt: Date.now(),
  }
}
