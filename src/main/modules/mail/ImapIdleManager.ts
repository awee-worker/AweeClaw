/**
 * IMAP IDLE 实时收信管理器
 *
 * 为启用了 idleEnabled 的收件账户维持常驻连接：ImapFlow 在无待处理命令时
 * 自动进入 IDLE 模式，服务器推送新邮件时触发 exists 事件，据此触发一次
 * 增量同步并广播进度。
 *
 * 断线重连：连接 close / error 后按指数退避重连（5s 起，上限 60s），
 * 账记 attempts；显式 stopAll 后不再重连。
 */

import { BrowserWindow } from 'electron'
import { ImapFlow } from 'imapflow'
import { logger } from '@shared/toolkit/LogEngine'
import { mailAccountStore } from './MailAccountStore'
import { mailService } from './MailService'
import type { MailSyncProgress } from './types'

/** 重连退避基数（ms） */
const RECONNECT_BASE_MS = 5000
/** 重连退避上限（ms） */
const RECONNECT_MAX_MS = 60000

/** 单个账户的 IDLE 连接记录 */
interface IdleConnection {
  client: ImapFlow
  reconnectTimer: ReturnType<typeof setTimeout> | null
  attempts: number
  stopped: boolean
}

/** 广播到所有窗口 */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

class ImapIdleManager {
  private connections = new Map<string, IdleConnection>()

  /** 为所有启用的账户启动 IDLE（幂等） */
  startAll(): void {
    for (const account of mailAccountStore.getAccounts(true)) {
      if (account.idleEnabled !== false) this.startAccount(account.id)
    }
  }

  /** 启动单个账户的 IDLE 连接（已在运行时跳过） */
  startAccount(accountId: string): void {
    if (this.connections.has(accountId)) return
    void this.connect(accountId)
  }

  /** 停止全部连接并清理定时器（应用退出时调用） */
  stopAll(): void {
    for (const [id, conn] of this.connections) {
      conn.stopped = true
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
      try {
        conn.client.close()
      } catch {
        // 忽略关闭异常
      }
      this.connections.delete(id)
    }
  }

  // --------------------------------------------
  // 内部实现
  // --------------------------------------------

  private async connect(accountId: string): Promise<void> {
    const account = mailAccountStore.getAccount(accountId)
    if (!account) return
    const credential = mailService.buildCredential(accountId)
    if (!credential) {
      logger.system.info(`[ImapIdle] 账户 ${accountId} 缺少凭据，跳过实时收信`)
      return
    }

    const client = new ImapFlow({
      host: credential.host,
      port: credential.port,
      secure: credential.secure,
      auth: { user: credential.user, pass: credential.pass },
      logger: false,
      greetingTimeout: 20000,
      socketTimeout: 0, // IDLE 长连接不设空闲超时
    })

    const record: IdleConnection = { client, reconnectTimer: null, attempts: 0, stopped: false }
    this.connections.set(accountId, record)

    try {
      await client.connect()
      await client.mailboxOpen('INBOX')
      record.attempts = 0

      // 服务器推送新邮件：INBOX 邮件数变化
      client.on('exists', () => {
        void this.onNewMail(accountId)
      })
      // 连接关闭：调度重连
      client.on('close', () => {
        this.scheduleReconnect(accountId)
      })
      client.on('error', (err) => {
        logger.system.warn(
          `[ImapIdle] ${account.label || account.address} 连接错误: ${err instanceof Error ? err.message : String(err)}`,
        )
      })

      logger.system.info(`[ImapIdle] ${account.label || account.address} 实时收信已启动`)
    } catch (err) {
      logger.system.warn(
        `[ImapIdle] ${account.label || account.address} 建立连接失败: ${err instanceof Error ? err.message : String(err)}`,
      )
      this.scheduleReconnect(accountId)
    }
  }

  /** 调度指数退避重连 */
  private scheduleReconnect(accountId: string): void {
    const record = this.connections.get(accountId)
    if (!record || record.stopped) {
      this.connections.delete(accountId)
      return
    }
    if (record.reconnectTimer) return

    record.attempts += 1
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (record.attempts - 1), RECONNECT_MAX_MS)
    logger.system.info(`[ImapIdle] ${accountId} 将在 ${delay}ms 后重连（第 ${record.attempts} 次）`)

    record.reconnectTimer = setTimeout(() => {
      this.connections.delete(accountId)
      void this.connect(accountId)
    }, delay)
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
