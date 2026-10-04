/**
 * IMAP 客户端
 *
 * 基于 imapflow 实现：
 * - 连接测试（校验主机/端口/凭据，返回文件夹列表）
 * - 增量拉取（按 UID 游标只取新邮件，返回解析后的结构化数据）
 *
 * IDLE 实时收信在 P6 阶段基于同一 ImapFlow 实例扩展。
 */

import { ImapFlow } from 'imapflow'
import { logger } from '@shared/toolkit/LogEngine'
import { parseRawMessage, type ParsedMail } from './MailParser'
import type { MailFolderAlias } from './types'

/** IMAP 连接凭据（含明文密码，仅在主进程内存中短暂存在） */
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
  /** 服务器上可用的文件夹路径 */
  folders?: string[]
}

/** 单次拉取结果 */
export interface ImapFetchResult {
  uidValidity: number
  /** 服务器邮箱内邮件总数 */
  exists: number
  /** 解析后的新邮件 */
  mails: ParsedMail[]
}

/** 构建 ImapFlow 实例（统一日志与超时配置） */
function createClient(cfg: ImapCredential): ImapFlow {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    // 关闭 imapflow 自身的日志输出，避免污染应用日志
    logger: false,
    // 建立连接超时（毫秒）
    greetingTimeout: 20000,
    socketTimeout: 120000,
  })
  // 未处理的 error 事件会导致进程崩溃，这里统一吞掉并记录
  client.on('error', (err) => {
    logger.system.warn(`[ImapClient] ${cfg.host} 连接错误: ${err instanceof Error ? err.message : String(err)}`)
  })
  return client
}

/** 测试 IMAP 连接并返回文件夹列表 */
export async function testImapConnection(cfg: ImapCredential): Promise<ImapTestResult> {
  if (!cfg.host || !cfg.user || !cfg.pass) {
    return { success: false, error: 'IMAP 主机 / 用户名 / 密码 不能为空' }
  }
  const client = createClient(cfg)
  try {
    await client.connect()
    const list = await client.list()
    return { success: true, folders: list.map((f) => f.path) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  } finally {
    try {
      await client.logout()
    } catch {
      // 忽略登出异常（连接可能已断开）
    }
  }
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
export async function fetchNewMessages(
  cfg: ImapCredential,
  accountId: string,
  folder: string,
  sinceUid: number,
  maxFirst = 200,
): Promise<ImapFetchResult> {
  const client = createClient(cfg)
  await client.connect()
  const lock = await client.getMailboxLock(folder)
  try {
    const mailbox = client.mailbox
    const uidValidity = Number(
      mailbox && typeof mailbox !== 'boolean' ? mailbox.uidValidity : 0,
    )
    const exists = mailbox && typeof mailbox !== 'boolean' ? mailbox.exists : 0

    if (!exists) {
      return { uidValidity, exists: 0, mails: [] }
    }

    // UID 游标失效（uidValidity 变化）时按全量处理由上层决定，此处只按 sinceUid 拉取
    const range = sinceUid > 0 ? `${sinceUid + 1}:*` : '1:*'

    const mails: ParsedMail[] = []
    for await (const msg of client.fetch(
      range,
      { uid: true, source: true, flags: true, size: true },
      { uid: true },
    )) {
      try {
        const raw = msg.source
        if (!raw) continue
        const flags = msg.flags ? Array.from(msg.flags) : []
        const parsed = await parseRawMessage(raw, {
          accountId,
          folder,
          uid: msg.uid,
          size: msg.size ?? raw.length,
          flags,
        })
        mails.push(parsed)
      } catch (err) {
        logger.system.warn(
          `[ImapClient] 解析邮件失败 (uid=${msg.uid}): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // 首次同步限制数量：仅保留最近 maxFirst 封
    const limited = sinceUid === 0 && mails.length > maxFirst ? mails.slice(-maxFirst) : mails
    return { uidValidity, exists, mails: limited }
  } finally {
    lock.release()
    try {
      await client.logout()
    } catch {
      // 忽略登出异常
    }
  }
}

/**
 * 拉取单封邮件的原始报文
 *
 * 用于按需下载附件等场景（首次同步不落地附件二进制，避免缓存膨胀）。
 */
export async function fetchMessageSource(
  cfg: ImapCredential,
  folder: string,
  uid: number,
): Promise<Buffer | null> {
  const client = createClient(cfg)
  await client.connect()
  const lock = await client.getMailboxLock(folder)
  try {
    for await (const msg of client.fetch({ uid }, { uid: true, source: true }, { uid: true })) {
      return msg.source ?? null
    }
    return null
  } finally {
    lock.release()
    try {
      await client.logout()
    } catch {
      // 忽略登出异常
    }
  }
}

// ============================================
// 文件夹识别与状态标记
// ============================================

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

/**
 * 列出服务器上的文件夹及其特殊用途
 *
 * 用于同步前探测「已发送 / 草稿 / 已删除 / 垃圾邮件」的真实路径：
 * 各服务商命名不一致（Sent / 已发送 / INBOX.Sent），不能按名称硬编码。
 */
export async function listMailboxes(cfg: ImapCredential): Promise<ImapMailboxInfo[]> {
  const client = createClient(cfg)
  try {
    await client.connect()
    const list = await client.list()
    return list.map((item) => ({
      path: item.path,
      alias: normalizeSpecialUse((item as { specialUse?: string }).specialUse),
    }))
  } finally {
    try {
      await client.logout()
    } catch {
      // 忽略登出异常
    }
  }
}

/**
 * 设置单封邮件的标志位（已读 \Seen / 星标 \Flagged）
 *
 * 连接或操作失败只返回错误，不影响本地索引的更新。
 */
export async function setMessageFlags(
  cfg: ImapCredential,
  folder: string,
  uid: number,
  add: string[],
  remove: string[],
): Promise<{ success: boolean; error?: string }> {
  const client = createClient(cfg)
  try {
    await client.connect()
    const lock = await client.getMailboxLock(folder)
    try {
      if (add.length > 0) await client.messageFlagsAdd([uid], add, { uid: true })
      if (remove.length > 0) await client.messageFlagsRemove([uid], remove, { uid: true })
    } finally {
      lock.release()
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    try {
      await client.logout()
    } catch {
      // 忽略登出异常
    }
  }
}

