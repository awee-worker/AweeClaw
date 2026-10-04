/**
 * 邮件收件 IPC 处理器（主进程）
 *
 * 集中注册 mail:* 频道 handler，统一返回 { success, ... } 结构。
 * 同步进度通过 mail:sync-progress 事件广播到渲染进程。
 */

import { BrowserWindow, dialog } from 'electron'
import * as fs from 'fs'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { mailService } from './MailService'
import { mailSecretStore } from './MailSecretStore'
import { resolveAccountSmtpConfig, testSmtpConnection } from '../../bridge/messaging/emailService'
import type {
  MailAiResult,
  MailDraftSaveParams,
  MailMessageListParams,
  MailOutboxRetryParams,
  MailSendParams,
  MailSetFlagsParams,
  MailSyncProgress,
} from './types'

let registered = false

/** 向所有窗口广播事件 */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** 注册邮件相关 IPC handler（幂等） */
export function registerMailIpc(): void {
  if (registered) {
    logger.system.warn('[MailIpc] Already registered, skipping')
    return
  }
  registered = true

  // --------------------------------------------
  // 账户：连接测试
  // --------------------------------------------
  safeIpcHandle(
    'mail:account:test',
    async (
      _,
      params: { host: string; port: number; secure: boolean; user: string; pass: string },
    ) => {
      const result = await mailService.testAccount(params)
      return { success: result.success, error: result.error, folders: result.folders }
    },
    { rateLimitPerMinute: 20 },
  )

  // --------------------------------------------
  // 账户：凭据（加密存储）
  // --------------------------------------------
  safeIpcHandle(
    'mail:account:set-secret',
    async (_, params: { accountId: string; secret: string }) => {
      const result = mailSecretStore.setSecret(params.accountId, params.secret)
      return { success: result.success, error: result.error }
    },
  )

  safeIpcHandle('mail:account:has-secret', async (_, accountId: string) => {
    return { success: true, hasSecret: mailSecretStore.hasSecret(accountId) }
  })

  safeIpcHandle('mail:account:delete-secret', async (_, accountId: string) => {
    mailSecretStore.deleteSecret(accountId)
    return { success: true }
  })

  // --------------------------------------------
  // 账户：发件能力测试
  //
  // 设置页只维护收件账户，发件直接复用账户的账号与凭据，
  // 因此这里按账户推导 SMTP 端点并完成一次真实 AUTH，验证「该账户能发邮件」。
  // --------------------------------------------
  safeIpcHandle(
    'mail:account:test-smtp',
    async (_, accountId: string) => {
      const resolved = resolveAccountSmtpConfig(accountId)
      if (!resolved.success) return { success: false, error: resolved.error }
      const result = await testSmtpConnection(resolved.config)
      return { success: result.success, error: result.error }
    },
    { rateLimitPerMinute: 20 },
  )

  // --------------------------------------------
  // 同步
  // --------------------------------------------
  safeIpcHandle(
    'mail:sync:account',
    async (_, accountId: string) => {
      const result = await mailService.syncAccount(accountId, (progress: MailSyncProgress) => {
        broadcast('mail:sync-progress', progress)
      })
      // 同步可能拉入新邮件，未读总数随之变化，通知各窗口刷新角标
      if (result.success) {
        broadcast('mail:unread-changed', { count: mailService.getUnreadCount() })
      }
      return result
    },
    { rateLimitPerMinute: 30 },
  )

  // --------------------------------------------
  // 邮件读取
  // --------------------------------------------
  safeIpcHandle('mail:message:list', async (_, params: MailMessageListParams) => {
    const messages = mailService.listMessages(params.accountId, params.folder, params.view)
    return { success: true, messages }
  })

  /** 未读邮件总数（导航角标轮询用，只读本地索引，不触发网络） */
  safeIpcHandle('mail:unread:count', async () => {
    return { success: true, count: mailService.getUnreadCount() }
  })

  safeIpcHandle(
    'mail:message:get',
    async (_, params: { accountId: string; folder: string; uid: number }) => {
      const detail = mailService.getMessage(params.accountId, params.folder, params.uid)
      if (!detail) return { success: false, error: '邮件不存在或尚未同步' }
      return { success: true, data: detail }
    },
  )

  // --------------------------------------------
  // AI 整理结果持久化
  // --------------------------------------------
  safeIpcHandle(
    'mail:message:set-ai',
    async (
      _,
      params: { accountId: string; folder: string; uid: number; ai: MailAiResult },
    ) => {
      const ok = mailService.setAiResult(params.accountId, params.folder, params.uid, params.ai)
      return { success: ok }
    },
  )

  // --------------------------------------------
  // 附件下载
  // --------------------------------------------
  safeIpcHandle(
    'mail:attachment:download',
    async (
      event,
      params: { accountId: string; folder: string; uid: number; filename: string },
    ) => {
      const res = await mailService.downloadAttachment(
        params.accountId,
        params.folder,
        params.uid,
        params.filename,
      )
      if (!res.success || !res.data) return { success: false, error: res.error }

      const win = BrowserWindow.fromWebContents(event.sender)
      const options = { defaultPath: params.filename }
      const saved = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      try {
        fs.writeFileSync(saved.filePath, res.data)
        return { success: true, path: saved.filePath }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // --------------------------------------------
  // 文件夹识别（已发送 / 草稿 / 已删除 / 垃圾邮件）
  // --------------------------------------------
  safeIpcHandle('mail:folder:list', async (_, accountId: string) => {
    return mailService.listFolders(accountId)
  })

  // --------------------------------------------
  // 邮件状态标记（已读 / 星标）
  // --------------------------------------------
  safeIpcHandle('mail:message:set-flags', async (_, params: MailSetFlagsParams) => {
    const result = await mailService.setFlags(params)
    // 已读状态变化会改变未读总数：本地索引已先行更新，这里直接广播最新值，
    // 让主窗口的「邮件中心」角标即时刷新（否则要等轮询或窗口重新获得焦点）
    broadcast('mail:unread-changed', { count: mailService.getUnreadCount() })
    return result
  })

  // --------------------------------------------
  // 写邮件 / 草稿 / 发件箱
  // --------------------------------------------
  safeIpcHandle(
    'mail:send',
    async (_, params: MailSendParams) => mailService.sendMail(params),
    { rateLimitPerMinute: 30 },
  )

  safeIpcHandle('mail:draft:save', async (_, params: MailDraftSaveParams) => {
    return { success: true, draft: mailService.saveDraft(params) }
  })

  safeIpcHandle('mail:draft:list', async (_, accountId: string) => {
    return { success: true, drafts: mailService.listDrafts(accountId) }
  })

  safeIpcHandle('mail:draft:delete', async (_, id: string) => {
    mailService.deleteDraft(id)
    return { success: true }
  })

  safeIpcHandle('mail:outbox:list', async (_, accountId: string) => {
    return { success: true, items: mailService.listOutbox(accountId) }
  })

  safeIpcHandle(
    'mail:outbox:retry',
    async (_, params: MailOutboxRetryParams) => mailService.retryOutbox(params.id),
    { rateLimitPerMinute: 30 },
  )

  safeIpcHandle('mail:outbox:delete', async (_, id: string) => {
    mailService.deleteOutbox(id)
    return { success: true }
  })
}
