/**
 * IMAP 客户端（主进程侧门面）
 *
 * 原本直接基于 imapflow 实现；imapflow / mailparser 已迁 mail.worker
 * 子进程（utilityProcess），本文件只做参数组装与 RPC 转发，导出签名
 * 保持不变，调用方（MailService 等）零改动。
 */

import { mailProxy } from '@main/storage/mailProxy'
import type {
  ImapCredential,
  ImapFetchResult,
  ImapMailboxInfo,
  ImapTestResult,
} from '@main/storage/mailWorkerTypes'

export type { ImapCredential, ImapFetchResult, ImapMailboxInfo, ImapTestResult }
export { normalizeSpecialUse } from '@main/storage/mailWorkerTypes'

/** 测试 IMAP 连接并返回文件夹列表 */
export function testImapConnection(cfg: ImapCredential): Promise<ImapTestResult> {
  return mailProxy.test(cfg)
}

/**
 * 拉取指定文件夹的新邮件
 *
 * @param cfg       连接凭据
 * @param accountId 账户 ID（写入解析上下文）
 * @param folder    文件夹路径（默认 INBOX）
 * @param sinceUid  已同步到的最大 UID（0 表示首次全量）
 * @param maxFirst  首次同步的最大拉取数量（避免一次拉取过多历史邮件）
 */
export function fetchNewMessages(
  cfg: ImapCredential,
  accountId: string,
  folder: string,
  sinceUid: number,
  maxFirst = 200,
): Promise<ImapFetchResult> {
  return mailProxy.fetchNew(cfg, accountId, folder, sinceUid, maxFirst) as Promise<ImapFetchResult>
}

/**
 * 拉取单封邮件的原始报文
 *
 * 用于按需下载附件等场景（首次同步不落地附件二进制，避免缓存膨胀）。
 */
export function fetchMessageSource(
  cfg: ImapCredential,
  folder: string,
  uid: number,
): Promise<Buffer | null> {
  return mailProxy.fetchSource(cfg, folder, uid)
}

/** 列出服务器上的文件夹及其特殊用途 */
export function listMailboxes(cfg: ImapCredential): Promise<ImapMailboxInfo[]> {
  return mailProxy.list(cfg)
}

/** 设置单封邮件的标志位（已读 \Seen / 星标 \Flagged） */
export function setMessageFlags(
  cfg: ImapCredential,
  folder: string,
  uid: number,
  add: string[],
  remove: string[],
): Promise<{ success: boolean; error?: string }> {
  return mailProxy.setFlags(cfg, folder, uid, add, remove)
}

