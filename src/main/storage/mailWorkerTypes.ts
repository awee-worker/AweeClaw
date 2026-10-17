/**
 * 邮件子进程协议类型 — 主进程代理与 worker 共用
 *
 * imapflow / mailparser 的类型不引入主进程编译面，这里只声明
 * 跨进程传输所需的纯数据结构。
 *
 * @module storage/mailWorkerTypes
 */

import type { ParsedMail } from '../modules/mail/MailParser'
import type { MailFolderAlias } from '../modules/mail/types'

export type { ParsedMail }

/** IMAP 连接凭据（含明文密码，仅跨主/子进程传输，不落盘） */
export interface ImapCredential {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

/** 连接测试结果 */
export interface ImapTestResult {
  success: boolean
  error?: string
  folders?: string[]
}

/** 单次拉取结果 */
export interface ImapFetchResult {
  uidValidity: number
  exists: number
  mails: ParsedMail[]
}

/** 服务器文件夹（含归一化后的特殊用途别名） */
export interface ImapMailboxInfo {
  path: string
  alias?: MailFolderAlias
}

/** 将 IMAP special-use 标记（\Sent / \Drafts …）归一化为稳定别名 */
export function normalizeSpecialUse(use?: string | null): MailFolderAlias | undefined {
  if (!use) return undefined
  const key = use.toLowerCase().replace(/^\\/, '')
  switch (key) {
    case 'inbox':
      return 'inbox'
    case 'sent':
      return 'sent'
    case 'drafts':
      return 'drafts'
    case 'trash':
      return 'trash'
    case 'junk':
    case 'spam':
      return 'junk'
    default:
      return undefined
  }
}
