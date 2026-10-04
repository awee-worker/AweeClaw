/**
 * 邮件定时自动整理调度器
 *
 * 通过 CronScheduler 注册一条内部定时任务（command = __email_digest__），
 * 按用户配置的表达式周期触发，在主进程内完成：
 *   1. 逐个同步已启用的收件账户
 *   2. 汇总各账户未读与最新邮件
 *   3. 将汇总结果落盘（{userData}/mail-digest/latest.json）
 *   4. 向所有窗口广播 mail:digest-created 事件，供 UI 提示与展示
 *
 * 该 command 以 __ 前缀标记为模块内部指令，不会转发给 Agent
 * （约定见 shared/protocols/cronCommandProtocol）。
 *
 * 与 ProactiveLearner 的差异：本调度器不使用规则引擎，仅做同步与汇总，
 * AI 分析由渲染层按需（手动或收到事件后）触发，避免主进程后台无窗口时
 * 无法建立 LLM 流式会话。
 */

import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { cronScheduler } from '../automation/CronScheduler'
import { mailAccountStore } from './MailAccountStore'
import { mailService } from './MailService'
import type { EmailAutoOrganizeConfig } from '@shared/configuration/configTypes'
import type { MailDigestPayload } from '@shared/protocols/mail'

/** 内部命令标记：以 __ 开头，仅主进程消费 */
export const MAIL_DIGEST_COMMAND = '__email_digest__'

/** Cron 任务显示名（用于去重与查找） */
const CRON_TASK_NAME = 'mail-digest'

/** 默认表达式：每天 08:00 */
const DEFAULT_EXPRESSION = '0 8 * * *'

/** 汇总单账户携带的最新邮件条数 */
const LATEST_PER_ACCOUNT = 5

/** 汇总载荷：复用共享契约（主进程 ↔ 渲染层） */
type DigestPayload = MailDigestPayload
/** 单账户汇总：复用共享契约 */
type DigestAccountSummary = MailDigestPayload['accounts'][number]

class MailDigestScheduler {
  private subscribed = false
  private taskId: string | null = null
  private running = false

  constructor() {
    // 构造时注册设置更新 IPC（不注册任务，等 applyConfig）
    this.registerIpc()
  }

  /**
   * 应用配置（启动时与设置变更时调用）
   *
   * - enabled=false：移除已注册任务
   * - enabled=true：注册或更新任务表达式
   */
  applyConfig(config?: EmailAutoOrganizeConfig): void {
    const cfg = config ?? mailAccountStore.getAutoOrganize()
    const enabled = Boolean(cfg?.enabled)
    const expression = cfg?.expression?.trim() || DEFAULT_EXPRESSION

    if (!enabled) {
      if (this.taskId) {
        try {
          cronScheduler.unregister(this.taskId)
        } catch (err) {
          logger.system.warn(`[MailDigest] 移除任务失败: ${String(err)}`)
        }
        this.taskId = null
      }
      // 兜底：按名称清理可能残留的任务
      const leftover = cronScheduler.getAllTasks().find((t) => t.name === CRON_TASK_NAME)
      if (leftover) {
        try {
          cronScheduler.unregister(leftover.id)
        } catch {
          // 忽略
        }
      }
      logger.system.info('[MailDigest] 定时自动整理已关闭')
      return
    }

    const existing = cronScheduler.getAllTasks().find((t) => t.name === CRON_TASK_NAME)
    if (existing) {
      cronScheduler.update(existing.id, { expression })
      this.taskId = existing.id
      logger.system.info(`[MailDigest] 已更新任务表达式: ${expression}`)
    } else {
      const task = cronScheduler.register({
        name: CRON_TASK_NAME,
        description: '定时自动同步并整理邮件',
        expression,
        command: MAIL_DIGEST_COMMAND,
        active: true,
        maxCalls: 0,
      })
      this.taskId = task.id
      logger.system.info(`[MailDigest] 已注册任务: ${expression}`)
    }

    this.subscribe()
  }

  /** 订阅 Cron 执行事件（幂等） */
  private subscribe(): void {
    if (this.subscribed) return
    this.subscribed = true
    cronScheduler.on('task-execute', (event: { command?: string }) => {
      if (event?.command !== MAIL_DIGEST_COMMAND) return
      void this.run()
    })
  }

  /** 注册设置更新 IPC */
  private registerIpc(): void {
    safeIpcHandle(
      'mail:auto-organize:update',
      async (_, params: { enabled: boolean; expression: string }) => {
        this.applyConfig({
          enabled: Boolean(params?.enabled),
          expression: params?.expression?.trim() || DEFAULT_EXPRESSION,
          ruleId: '',
        })
        return { success: true }
      },
    )
  }

  /**
   * 执行一次自动整理
   *
   * 重入保护：上一轮未结束时跳过本轮，避免多账户同步叠加。
   */
  async run(): Promise<DigestPayload | null> {
    if (this.running) {
      logger.system.warn('[MailDigest] 上一轮仍在执行，跳过本轮')
      return null
    }
    this.running = true
    try {
      const accounts = mailAccountStore.getAccounts(true)
      if (accounts.length === 0) {
        logger.system.info('[MailDigest] 无启用的收件账户，跳过')
        return null
      }

      const summaries: DigestAccountSummary[] = []
      for (const account of accounts) {
        const label = account.label || account.address
        try {
          const result = await mailService.syncAccount(account.id)
          const msgs = mailService.listMessages(account.id)
          summaries.push({
            accountId: account.id,
            label,
            address: account.address,
            added: result.added,
            total: msgs.length,
            unread: msgs.filter((m) => !m.seen).length,
            latest: msgs.slice(0, LATEST_PER_ACCOUNT).map((m) => ({
              subject: m.subject,
              date: m.date,
              from: m.from[0]?.name || m.from[0]?.address || '',
            })),
            error: result.success ? undefined : result.error,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.system.warn(`[MailDigest] 账户 ${label} 同步失败: ${message}`)
          summaries.push({
            accountId: account.id,
            label,
            address: account.address,
            added: 0,
            total: 0,
            unread: 0,
            latest: [],
            error: message,
          })
        }
      }

      const payload: DigestPayload = { generatedAt: Date.now(), accounts: summaries }
      this.persist(payload)
      this.broadcast(payload)

      const totalUnread = summaries.reduce((sum, s) => sum + s.unread, 0)
      logger.system.info(
        `[MailDigest] 整理完成：${accounts.length} 个账户，未读 ${totalUnread} 封`,
      )
      return payload
    } catch (err) {
      logger.system.error(`[MailDigest] 执行失败: ${String(err)}`)
      return null
    } finally {
      this.running = false
    }
  }

  /** 将汇总结果落盘（用户数据目录） */
  private persist(payload: DigestPayload): void {
    try {
      const dir = path.join(app.getPath('userData'), 'mail-digest')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(payload, null, 2), 'utf-8')
    } catch (err) {
      logger.system.warn(`[MailDigest] 汇总落盘失败: ${String(err)}`)
    }
  }

  /** 向所有窗口广播汇总事件 */
  private broadcast(payload: DigestPayload): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mail:digest-created', payload)
    }
  }
}

/** 全局单例 */
export const mailDigestScheduler = new MailDigestScheduler()
