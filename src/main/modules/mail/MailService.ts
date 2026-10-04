/**
 * 邮件收件服务（编排层）
 *
 * 串联账户读取 → 凭据解密 → IMAP 拉取 → 解析 → 本地持久化，
 * 并向调用方暴露同步与查询能力。不直接依赖 Electron IPC。
 */

import { logger } from '@shared/toolkit/LogEngine'
import { mailAccountStore } from './MailAccountStore'
import { mailRepository } from './MailRepository'
import { simpleParser } from 'mailparser'
import {
  fetchMessageSource,
  fetchNewMessages,
  listMailboxes,
  setMessageFlags,
  testImapConnection,
  type ImapCredential,
  type ImapTestResult,
} from './ImapClient'
import { resolveAccountSmtpConfig, sendEmail } from '../../bridge/messaging/emailService'
import type { EmailAccount } from '@shared/configuration/configTypes'
import type {
  MailAiResult,
  MailBodyCache,
  MailDraft,
  MailDraftSaveParams,
  MailFolderAlias,
  MailFolderInfo,
  MailFolderListResult,
  MailFolderMap,
  MailFolderView,
  MailMessageMeta,
  MailOutboxItem,
  MailSendParams,
  MailSendResult,
  MailSetFlagsParams,
  MailSyncProgress,
} from './types'

/** 账户同步结果 */
export interface SyncAccountResult {
  success: boolean
  accountId: string
  /** 新增（去重后）邮件数 */
  added: number
  /** 本次扫描到的邮件数 */
  scanned: number
  error?: string
}

/** 单封邮件完整内容 */
export interface MailMessageDetail {
  meta: MailMessageMeta
  body: MailBodyCache | null
}

class MailService {
  /** 组装某账户的 IMAP 连接凭据（无凭据返回 null） */
  buildCredential(accountId: string): ImapCredential | null {
    const account = mailAccountStore.getAccount(accountId)
    if (!account) return null
    const pass = mailAccountStore.getCredential(accountId)
    if (!pass) return null
    return {
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      user: account.auth.user || account.address,
      pass,
    }
  }

  /** 测试连接（不落库，供设置页「测试连接」按钮使用） */
  async testAccount(params: {
    host: string
    port: number
    secure: boolean
    user: string
    pass: string
  }): Promise<ImapTestResult> {
    return testImapConnection(params)
  }

  /**
   * 同步单个账户的全部配置文件夹
   *
   * 增量策略：按文件夹 UID 游标只拉新邮件，首次同步限制历史数量。
   */
  async syncAccount(
    accountId: string,
    onProgress?: (progress: MailSyncProgress) => void,
  ): Promise<SyncAccountResult> {
    const account = mailAccountStore.getAccount(accountId)
    if (!account) {
      return { success: false, accountId, added: 0, scanned: 0, error: '账户不存在' }
    }
    const credential = this.buildCredential(accountId)
    if (!credential) {
      return {
        success: false,
        accountId,
        added: 0,
        scanned: 0,
        error: '未找到账户凭据，请先在设置中填写并保存邮箱密码/授权码',
      }
    }

    // 同步范围：收件箱 + 服务器上已识别的标准文件夹（已发送/已删除/垃圾邮件）
    const folders = await this.resolveSyncFolders(account, credential)
    let added = 0
    let scanned = 0

    try {
      for (const folder of folders) {
        const cursor = mailRepository.getCursor(accountId, folder)
        onProgress?.({ accountId, folder, fetched: 0, total: 0, phase: 'connecting' })

        const result = await fetchNewMessages(credential, accountId, folder, cursor?.lastUid ?? 0)

        onProgress?.({
          accountId,
          folder,
          fetched: result.mails.length,
          total: result.exists,
          phase: 'parsing',
        })

        const metas: MailMessageMeta[] = []
        for (const mail of result.mails) {
          mailRepository.saveBody(accountId, folder, mail.meta.uid, mail.body)
          metas.push(mail.meta)
        }

        added += mailRepository.upsertMessages(accountId, metas)
        scanned += result.mails.length

        const maxUid = result.mails.length
          ? Math.max(...result.mails.map((m) => m.meta.uid))
          : cursor?.lastUid ?? 0
        mailRepository.setCursor(accountId, folder, {
          uidValidity: result.uidValidity,
          lastUid: maxUid,
          lastSyncAt: Date.now(),
        })

        onProgress?.({
          accountId,
          folder,
          fetched: result.mails.length,
          total: result.exists,
          phase: 'done',
        })
      }

      return { success: true, accountId, added, scanned }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.system.error(`[MailService] 同步账户 ${accountId} 失败: ${message}`)
      onProgress?.({ accountId, folder: folders[0], fetched: 0, total: 0, phase: 'error', message })
      return { success: false, accountId, added, scanned, error: message }
    }
  }

  /**
   * 列出某账户的邮件元数据
   *
   * - view='unread' / 'flagged'：跨全部已同步文件夹的本地筛选
   * - view='drafts' / 'outbox'：本地队列，不经此方法（由专用接口返回）
   * - folder：可传标准别名（inbox/sent/trash/junk），由服务器映射解析为真实路径
   */
  listMessages(accountId: string, folder?: string, view?: MailFolderView): MailMessageMeta[] {
    if (view === 'unread') {
      return mailRepository.listMessages(accountId).filter((m) => !m.seen)
    }
    if (view === 'flagged') {
      return mailRepository.listMessages(accountId).filter((m) => m.flagged)
    }
    if (view === 'drafts' || view === 'outbox') return []
    if (view === 'drafts' || view === 'outbox') return []
    if (!folder) return mailRepository.listMessages(accountId)

    const resolved = this.resolveFolderPath(accountId, folder)
    // 标准别名解析不到服务器路径时（该账户没有这个文件夹）必须返回空：
    // 一旦退化成「不过滤」或落到收件箱，已发送 / 已删除 / 垃圾邮件都会显示收件箱的内容。
    if (!resolved) return []
    return mailRepository.listMessages(accountId, resolved)
  }

  /**
   * 把标准文件夹别名解析为服务器真实路径
   *
   * 返回 undefined 表示该账户没有这个文件夹（未识别），调用方按空结果处理；
   * 收件箱是 IMAP 规定必然存在的，缺失时兜底为 INBOX；非别名（服务器真实路径）原样返回。
   */
  private resolveFolderPath(accountId: string, folder: string): string | undefined {
    const aliases: MailFolderAlias[] = ['inbox', 'sent', 'trash', 'junk']
    if ((aliases as string[]).includes(folder)) {
      const resolved = mailRepository.resolveFolderAlias(accountId, folder as MailFolderAlias)
      if (resolved) return resolved
      return folder === 'inbox' ? 'INBOX' : undefined
    }
    return folder
  }

  /** 统计全部账户的未读邮件数（供导航角标使用） */
  getUnreadCount(): number {
    return mailRepository.countUnread()
  }

  /** 读取单封邮件（元数据 + 正文缓存） */
  getMessage(accountId: string, folder: string, uid: number): MailMessageDetail | null {
    const meta = mailRepository.getMessage(accountId, folder, uid)
    if (!meta) return null
    return { meta, body: mailRepository.getBody(accountId, folder, uid) }
  }

  /** 写入某封邮件的 AI 整理结果 */
  setAiResult(accountId: string, folder: string, uid: number, ai: MailAiResult): boolean {
    return mailRepository.patchMessage(accountId, folder, uid, { ai })
  }

  /**
   * 按需下载某封邮件的附件
   *
   * 从服务器重新拉取原始报文并解析，命中指定文件名后返回其二进制内容。
   * 首次同步不落地附件二进制，避免缓存膨胀。
   */
  async downloadAttachment(
    accountId: string,
    folder: string,
    uid: number,
    filename: string,
  ): Promise<{ success: boolean; data?: Buffer; error?: string }> {
    const credential = this.buildCredential(accountId)
    if (!credential) return { success: false, error: '未找到账户凭据，请先在设置中填写' }
    try {
      const raw = await fetchMessageSource(credential, folder, uid)
      if (!raw) return { success: false, error: '无法获取邮件原始内容' }
      const parsed = await simpleParser(raw)
      const target = (parsed.attachments ?? []).find((a) => (a.filename || '') === filename)
      if (!target) return { success: false, error: `未找到附件：${filename}` }
      return { success: true, data: target.content }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ============================================
  // 标准文件夹识别与同步范围
  // ============================================

  /**
   * 读取账户的标准文件夹映射（首次访问时探测服务器）
   *
   * 以「已识别收件箱」作为已探测过缓存标记：绝大多数服务器都会返回 INBOX，
   * 避免每次同步都额外建立一次 list 连接。
   */
  private async ensureFolderMap(
    accountId: string,
    credential: ImapCredential,
  ): Promise<MailFolderMap> {
    const cached = mailRepository.getFolderMap(accountId)
    // 只有收件箱不足以判定「探测完成」：早期版本或探测失败会让缓存里只剩 inbox，
    // 沿用它会令已发送 / 已删除 / 垃圾邮件永远识别不到、也同步不到。
    // 除收件箱外还识别出至少一个标准文件夹，才认为这次探测有效。
    if (cached.inbox && Object.keys(cached).length > 1) return cached

    try {
      const boxes = await listMailboxes(credential)
      const map: MailFolderMap = {}
      for (const box of boxes) {
        const alias = box.alias ?? guessAliasFromPath(box.path)
        if (alias && !map[alias]) map[alias] = box.path
      }
      if (!map.inbox) map.inbox = 'INBOX'
      mailRepository.setFolderMap(accountId, map)
      return map
    } catch (err) {
      logger.system.warn(
        `[MailService] 探测文件夹失败（${accountId}）: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { inbox: 'INBOX' }
    }
  }

  /** 该账户参与同步的文件夹（收件箱 + 已识别的标准文件夹 + 账户自定义） */
  private async resolveSyncFolders(
    account: EmailAccount,
    credential: ImapCredential,
  ): Promise<string[]> {
    const map = await this.ensureFolderMap(account.id, credential)
    const standard = Object.values(map).filter((p): p is string => Boolean(p))
    const explicit = (account.folders ?? []).filter(Boolean)
    return Array.from(new Set(['INBOX', ...standard, ...explicit]))
  }

  /** 查询账户在服务器上的文件夹列表（含标准用途识别） */
  async listFolders(accountId: string): Promise<MailFolderListResult> {
    const account = mailAccountStore.getAccount(accountId)
    if (!account) return { success: false, folders: [], map: {}, error: '账户不存在' }

    const credential = this.buildCredential(accountId)
    if (!credential) {
      return {
        success: false,
        folders: [],
        map: mailRepository.getFolderMap(accountId),
        error: '未找到账户凭据，请先在设置中填写密码 / 授权码',
      }
    }

    try {
      const boxes = await listMailboxes(credential)
      const map: MailFolderMap = { ...mailRepository.getFolderMap(accountId) }
      const folders: MailFolderInfo[] = boxes.map((box) => {
        const alias = box.alias ?? guessAliasFromPath(box.path)
        if (alias && !map[alias]) map[alias] = box.path
        return { path: box.path, alias, name: lastPathSegment(box.path) }
      })
      if (!map.inbox) map.inbox = 'INBOX'
      mailRepository.setFolderMap(accountId, map)
      return { success: true, folders, map }
    } catch (err) {
      return {
        success: false,
        folders: [],
        map: mailRepository.getFolderMap(accountId),
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // ============================================
  // 邮件状态标记
  // ============================================

  /**
   * 标记邮件的已读 / 星标状态
   *
   * 先更新本地索引保证界面即时反馈，再尽力同步到服务器；
   * 离线或服务器拒绝时仅本地生效，不阻断交互。
   */
  async setFlags(params: MailSetFlagsParams): Promise<{ success: boolean; error?: string }> {
    const patch: Partial<Pick<MailMessageMeta, 'seen' | 'flagged'>> = {}
    if (params.seen !== undefined) patch.seen = params.seen
    if (params.flagged !== undefined) patch.flagged = params.flagged
    const localOk = mailRepository.patchMessage(params.accountId, params.folder, params.uid, patch)

    const credential = this.buildCredential(params.accountId)
    if (!credential) {
      return { success: localOk, error: localOk ? undefined : '账户不存在或缺少凭据' }
    }

    const add: string[] = []
    const remove: string[] = []
    if (params.seen !== undefined) (params.seen ? add : remove).push('\\Seen')
    if (params.flagged !== undefined) (params.flagged ? add : remove).push('\\Flagged')

    const remote = await setMessageFlags(credential, params.folder, params.uid, add, remove)
    if (!remote.success) {
      logger.system.warn(`[MailService] 同步邮件标志失败: ${remote.error}`)
    }
    return { success: localOk || remote.success, error: remote.error }
  }

  // ============================================
  // 写邮件 / 草稿 / 发件箱
  // ============================================

  /** 投递一封邮件（不含失败入箱逻辑） */
  private async deliver(params: MailSendParams): Promise<{ success: boolean; error?: string }> {
    const resolved = resolveAccountSmtpConfig(params.accountId)
    if (!resolved.success) return { success: false, error: resolved.error }

    return sendEmail(resolved.config, resolved.from, {
      to: splitAddresses(params.to),
      cc: params.cc ? splitAddresses(params.cc) : undefined,
      subject: params.subject,
      body: params.body,
      html: params.html ?? false,
      attachments: params.attachments,
    })
  }

  /**
   * 发送邮件
   *
   * 发送失败时写入本地发件箱并记录失败原因，用户可在发件箱中重试，
   * 避免内容因一次网络抖动而丢失。
   */
  async sendMail(params: MailSendParams): Promise<MailSendResult> {
    const result = await this.deliver(params)
    if (params.draftId) mailRepository.deleteDraft(params.draftId)
    if (result.success) return { success: true }

    const item: MailOutboxItem = {
      id: newLocalId('out'),
      accountId: params.accountId,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      body: params.body,
      html: params.html ?? false,
      attachments: params.attachments,
      createdAt: Date.now(),
      attempts: 1,
      lastError: result.error,
    }
    mailRepository.addOutbox(item)
    return { success: false, error: result.error, outboxId: item.id }
  }

  /** 重试发件箱中的一封邮件 */
  async retryOutbox(id: string): Promise<MailSendResult> {
    const item = mailRepository.getOutbox(id)
    if (!item) return { success: false, error: '发件箱条目不存在' }

    const result = await this.deliver({
      accountId: item.accountId,
      to: item.to,
      cc: item.cc,
      subject: item.subject,
      body: item.body,
      html: item.html,
      attachments: item.attachments,
    })
    if (result.success) {
      mailRepository.deleteOutbox(id)
      return { success: true }
    }
    mailRepository.updateOutbox(id, { attempts: item.attempts + 1, lastError: result.error })
    return { success: false, error: result.error }
  }

  /** 保存草稿（传入 id 则更新） */
  saveDraft(params: MailDraftSaveParams): MailDraft {
    const existing = params.id ? mailRepository.getDraft(params.id) : undefined
    const draft: MailDraft = {
      id: existing?.id ?? newLocalId('draft'),
      accountId: params.accountId,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      body: params.body,
      html: params.html ?? false,
      attachments: params.attachments,
      updatedAt: Date.now(),
    }
    mailRepository.saveDraft(draft)
    return draft
  }

  /** 列出草稿 */
  listDrafts(accountId: string): MailDraft[] {
    return mailRepository.listDrafts(accountId)
  }

  /** 删除草稿 */
  deleteDraft(id: string): void {
    mailRepository.deleteDraft(id)
  }

  /** 列出待重发的发件箱条目 */
  listOutbox(accountId: string): MailOutboxItem[] {
    return mailRepository.listOutbox(accountId)
  }

  /** 删除发件箱条目 */
  deleteOutbox(id: string): void {
    mailRepository.deleteOutbox(id)
  }
}

// ============================================
// 工具函数
// ============================================

/** 按常见命名猜测文件夹别名（服务器未返回 special-use 时的兜底） */
function guessAliasFromPath(path: string): MailFolderAlias | undefined {
  const name = lastPathSegment(path).toLowerCase().replace(/^\\/, '')
  if (name === 'inbox') return 'inbox'
  if (/^sent( messages| items)?$/.test(name) || name === '已发送') return 'sent'
  if (/^drafts?$/.test(name) || name === '草稿箱') return 'drafts'
  if (/^(trash|deleted( items| messages)?|已删除|回收站)$/.test(name)) return 'trash'
  if (/^(junk( e-?mail)?|spam|垃圾邮件)$/.test(name)) return 'junk'
  return undefined
}

/** 取路径最后一段（兼容 / 与 . 两种层级分隔符） */
function lastPathSegment(path: string): string {
  const parts = path.split(/[/.]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : path
}

/** 把「a@x.com, b@y.com」拆为地址数组 */
function splitAddresses(input: string): string[] {
  return input
    .split(/[,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 生成本地唯一 id */
function newLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 全局单例 */
export const mailService = new MailService()
