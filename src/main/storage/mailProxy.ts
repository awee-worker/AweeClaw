/**
 * 邮件子进程代理 — 主进程侧薄封装（utilityProcess 隔离 + 内联回退）
 *
 * 职责：
 * - 将 IMAP 操作与邮件解析以 RPC 派发给 mail.worker 子进程，
 *   imapflow / mailparser 不再加载进主进程
 * - IDLE 实时收信事件（新邮件 / 连接断开）以消息流转发给订阅者
 * - 子进程 fork 失败 / 崩溃超限时回退主进程内联（动态 import 旧实现）
 *
 * 注意：回退路径会在主进程加载 imapflow / mailparser，仅作为子进程
 * 持续不可用时兜底。
 */

import { utilityProcess } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import type {
  ImapCredential,
  ImapFetchResult,
  ImapMailboxInfo,
  ImapTestResult,
} from './mailWorkerTypes'
import type { MailRequest, MailResponse, MailEvent } from './mail.worker'

/** 联合类型的分布式 Omit（保留各分支的可辨识字段） */
type MailRequestBody = MailRequest extends infer T
  ? T extends { id: number } ? Omit<T, 'id'> : never
  : never

/** 单操作超时（拉取大批邮件时较长） */
const OP_TIMEOUT_MS = 120_000

const MAX_RESTARTS = 3

interface PendingOp {
  resolve: (res: MailResponse) => void
  timer: NodeJS.Timeout
}

type IdleListener = (event: MailEvent) => void

class MailProxyImpl {
  private child: Electron.UtilityProcess | null = null
  private pending = new Map<number, PendingOp>()
  private nextId = 1
  private restarts = 0
  private inline = false
  private idleListeners = new Set<IdleListener>()
  /** IDLE 事件回调（ImapIdleManager 订阅） */
  private onIdleEvent: ((event: MailEvent) => void) | null = null

  private ensureChild(): Electron.UtilityProcess | null {
    if (this.inline) return null
    if (this.child) return this.child

    try {
      const workerPath = path.join(__dirname, 'mail.worker.js')
      this.child = utilityProcess.fork(workerPath, [], { stdio: 'pipe' })

      this.child.on('message', (raw: MailResponse | MailEvent) => {
        if (!('id' in raw)) {
          this.onIdleEvent?.(raw as MailEvent)
          return
        }
        const res = raw as MailResponse
        const task = this.pending.get(res.id)
        if (task) {
          this.pending.delete(res.id)
          clearTimeout(task.timer)
          task.resolve(res)
        }
      })

      this.child.on('exit', (code) => {
        this.failPending(`worker exited (code=${code})`)
        this.child = null
        // IDLE 连接随子进程一起丢失，通知主进程侧重启
        if (this.onIdleEvent) {
          logger.system.warn('[MailProxy] worker exited, IDLE connections lost')
        }
        if (this.restarts < MAX_RESTARTS) {
          this.restarts++
          const delay = Math.min(1000 * 2 ** (this.restarts - 1), 8000)
          logger.system.warn(`[MailProxy] worker crashed (code=${code}), restart #${this.restarts} in ${delay}ms`)
          setTimeout(() => { this.ensureChild() }, delay)
        } else {
          logger.system.warn('[MailProxy] restart limit reached, switch to inline fallback mode')
          this.inline = true
        }
      })

      this.restarts = 0
      return this.child
    } catch (err) {
      logger.system.warn('[MailProxy] fork failed, fallback to inline:', err)
      this.inline = true
      return null
    }
  }

  private call(req: MailRequestBody): Promise<MailResponse> {
    const child = this.ensureChild()
    if (!child) {
      return Promise.resolve({ id: -1, ok: false, error: 'mail worker in inline mode' })
    }
    return new Promise((resolve) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ id, ok: false, error: `timeout after ${OP_TIMEOUT_MS}ms` })
      }, OP_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      child.postMessage({ ...req, id } as MailRequest)
    })
  }

  private failPending(reason: string): void {
    if (this.pending.size === 0) return
    logger.system.warn(`[MailProxy] ${reason}, ${this.pending.size} pending op(s) fail`)
    for (const [id, task] of this.pending) {
      this.pending.delete(id)
      clearTimeout(task.timer)
      task.resolve({ id, ok: false, error: reason })
    }
  }

  /** 订阅子进程转发的 IDLE 事件 */
  setIdleListener(fn: ((event: MailEvent) => void) | null): void {
    this.onIdleEvent = fn
  }

  addIdleListener(fn: IdleListener): void {
    this.idleListeners.add(fn)
  }

  removeIdleListener(fn: IdleListener): void {
    this.idleListeners.delete(fn)
  }

  // ============================================
  // RPC 门面
  // ============================================

  async test(cfg: ImapCredential): Promise<ImapTestResult> {
    const res = await this.call({ op: 'test', cfg })
    return res.ok ? (res.value as ImapTestResult) : { success: false, error: res.error }
  }

  async fetchNew(
    cfg: ImapCredential, accountId: string, folder: string, sinceUid: number, maxFirst?: number,
  ): Promise<ImapFetchResult | null> {
    const res = await this.call({ op: 'fetchNew', cfg, accountId, folder, sinceUid, maxFirst })
    if (!res.ok) throw new Error(res.error)
    return res.value as ImapFetchResult
  }

  async fetchSource(cfg: ImapCredential, folder: string, uid: number): Promise<Buffer | null> {
    const res = await this.call({ op: 'fetchSource', cfg, folder, uid })
    if (!res.ok) throw new Error(res.error)
    return res.value as Buffer | null
  }

  async fetchAttachment(
    cfg: ImapCredential, folder: string, uid: number, filename: string,
  ): Promise<{ success: boolean; data?: Buffer; error?: string }> {
    const res = await this.call({ op: 'fetchAttachment', cfg, folder, uid, filename })
    if (!res.ok) return { success: false, error: res.error }
    return res.value as { success: boolean; data?: Buffer; error?: string }
  }

  async list(cfg: ImapCredential): Promise<ImapMailboxInfo[]> {
    const res = await this.call({ op: 'list', cfg })
    if (!res.ok) throw new Error(res.error)
    return res.value as ImapMailboxInfo[]
  }

  async setFlags(
    cfg: ImapCredential, folder: string, uid: number, add: string[], remove: string[],
  ): Promise<{ success: boolean; error?: string }> {
    const res = await this.call({ op: 'setFlags', cfg, folder, uid, add, remove })
    if (!res.ok) return { success: false, error: res.error }
    return res.value as { success: boolean; error?: string }
  }

  async idleStart(accountId: string, cfg: ImapCredential): Promise<void> {
    const res = await this.call({ op: 'idleStart', accountId, cfg })
    if (!res.ok) throw new Error(res.error)
  }

  async idleStop(accountId: string): Promise<void> {
    const res = await this.call({ op: 'idleStop', accountId })
    if (!res.ok) throw new Error(res.error)
  }

  dispose(): void {
    this.failPending('proxy disposed')
    this.child?.kill()
    this.child = null
    this.onIdleEvent = null
    this.idleListeners.clear()
  }
}

export const mailProxy = new MailProxyImpl()
