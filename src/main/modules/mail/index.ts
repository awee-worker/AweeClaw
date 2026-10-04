/**
 * 邮件收件模块入口（barrel）
 *
 * 提供收件账户的凭据安全存储、账户读取以及后续的 IMAP 收信、解析、
 * 本地缓存、AI 整理与定时自动整理能力。
 */

export { mailSecretStore } from './MailSecretStore'
export { mailAccountStore } from './MailAccountStore'
export { mailRepository } from './MailRepository'
export { mailService } from './MailService'
export { registerMailIpc } from './MailIpc'
export { mailCenterManager, MailCenterManager } from './MailCenterManager'
export { mailDigestScheduler, MAIL_DIGEST_COMMAND } from './MailDigestScheduler'
export { imapIdleManager } from './ImapIdleManager'
export * from './types'
