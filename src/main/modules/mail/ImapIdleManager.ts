/**
 * IMAP IDLE 实时收信管理器（主进程侧门面）
 *
 * IDLE 常驻连接与断线重连（指数退避）已在 mail.worker 子进程内完成，
 * 本文件负责：按账户配置下发启停指令、把子进程的新邮件事件转成
 * 增量同步并广播进度。
 */

import { BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { mailProxy } from '@main/storage/mailProxy'
import type { MailEvent } from '@main/storage/mail.worker'
import { mailAccountStore } from './MailAccountStore'
import { mailService } from './MailService'
import type { MailSyncProgress } from './types'

/** 广播到所有窗口 */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

class ImapIdleManager {
  private started = new Set<string>()

  constructor() {
    mailProxy.setIdleListener((event) => this.onWorkerEvent(event))
  }

  /** 为所有启用的账户启动 IDLE（幂等） */
  startAll(): void {
    for (const account of mailAccountStore.getAccounts(true)) {
      if (account.idleEnabled !== false) this.startAccount(account.id)
    }
  }

  /** 启动单个账户的 IDLE 连接（已在运行时跳过） */
  startAccount(accountId: string): void {
    if (this.started.has(accountId)) return
    const account = mailAccountStore.getAccount(accountId)
    if (!account) return
    const credential = mailService.buildCredential(accountId)
    if (!credential) {
      logger.system.info(`[ImapIdle] 账户 ${accountId} 缺少凭据，跳过实时收信`)
      return
    }
    this.started.add(accountId)
    mailProxy.idleStart(accountId, credential).catch((err) => {
      this.started.delete(accountId)
      logger.system.warn(
        `[ImapIdle] ${account.label || account.address} 启动实时收信失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }

  /** 停止全部连接（应用退出时调用） */
  stopAll(): void {
    for (const accountId of this.started) {
      mailProxy.idleStop(accountId).catch(() => {
        // 子进程可能已退出
      })
    }
    this.started.clear()
  }

  /** 子进程 IDLE 事件分发 */
  private onWorkerEvent(event: MailEvent): void {
    if (event.type === 'idle-exists') {
      void this.onNewMail(event.accountId)
      return
    }
    // idle-closed：重连由子进程内部完成，主进程无需处理
  }

  /** 收到新邮件 → 增量同步 */
  private async onNewMail(accountId: string): Promise<void> {
    try {
      const result = await mailService.syncAccount(accountId, (progress: MailSyncProgress) => {
        broadcast('mail:sync-progress', progress)
      })
      if (result.success && result.added > 0) {
        logger.system.info(`[ImapIdle] ${accountId} 收到 ${result.added} 封新邮件`)
      }
    } catch (err) {
      logger.system.warn(
        `[ImapIdle] ${accountId} 增量同步失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/** 全局单例 */
export const imapIdleManager = new ImapIdleManager()
