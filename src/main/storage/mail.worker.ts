/**
 * 邮件子进程入口 — imapflow / mailparser 的加载与执行在 utilityProcess 中
 *
 * 职责：
 * - 连接测试 / 增量拉取 / 单封报文 / 文件夹探测 / 标志位设置 / 附件提取
 * - IDLE 实时收信常驻连接（断线按指数退避在子进程内重连）
 * - 邮件解析（mailparser）全部在本进程完成，主进程不再加载这两个包
 *
 * 说明：作为 CJS 单独入口构建（mail.worker.js），不进主 bundle；
 * imapflow / mailparser 全部 external，由子进程从 node_modules 解析。
 */

if (!process.parentPort) {
  throw new Error('This file must be run as a utility process.')
}

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { parseRawMessage, type ParsedMail } from '../modules/mail/MailParser'
import type { ImapCredential, ImapFetchResult, ImapMailboxInfo } from './mailWorkerTypes'
import { normalizeSpecialUse } from './mailWorkerTypes'

/** 主进程 → 子进程请求 */
export type MailRequest =
  | { id: number; op: 'test'; cfg: ImapCredential }
  | { id: number; op: 'fetchNew'; cfg: ImapCredential; accountId: string; folder: string; sinceUid: number; maxFirst?: number }
  | { id: number; op: 'fetchSource'; cfg: ImapCredential; folder: string; uid: number }
  | { id: number; op: 'fetchAttachment'; cfg: ImapCredential; folder: string; uid: number; filename: string }
  | { id: number; op: 'list'; cfg: ImapCredential }
  | { id: number; op: 'setFlags'; cfg: ImapCredential; folder: string; uid: number; add: string[]; remove: string[] }
  | { id: number; op: 'idleStart'; accountId: string; cfg: ImapCredential }
  | { id: number; op: 'idleStop'; accountId: string }

/** 子进程 → 主进程响应 */
export interface MailResponse {
  id: number
  ok: boolean
  value?: unknown
  error?: string
}

/** 子进程 → 主进程事件（无 id） */
export interface MailEvent {
  type: 'idle-exists' | 'idle-closed'
  accountId: string
}

function ok(id: number, value?: unknown): void {
  process.parentPort!.postMessage({ id, ok: true, value })
}

function fail(id: number, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  process.parentPort!.postMessage({ id, ok: false, error: message })
}

function emit(event: MailEvent): void {
  process.parentPort!.postMessage(event)
}

function log(level: 'info' | 'warn', msg: string): void {
  // 子进程不接主进程日志引擎，落到 stderr 由 stdio pipe 丢弃/排查用
  console[level === 'info' ? 'log' : 'warn'](`[mail.worker] ${msg}`)
}

/** 构建 ImapFlow 实例（与主进程旧实现保持同一套超时配置） */
function createClient(cfg: ImapCredential, socketTimeout: number): ImapFlow {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    greetingTimeout: 20000,
    socketTimeout,
  })
  client.on('error', (err: unknown) => {
    log('warn', `${cfg.host} 连接错误: ${err instanceof Error ? err.message : String(err)}`)
  })
  return client
}

async function test(cfg: ImapCredential) {
  if (!cfg.host || !cfg.user || !cfg.pass) {
    return { success: false, error: 'IMAP 主机 / 用户名 / 密码 不能为空' }
  }
  const client = createClient(cfg, 120000)
  try {
    await client.connect()
    const list = await client.list()
    return { success: true, folders: list.map((f) => f.path) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    try { await client.logout() } catch { /* 连接可能已断开 */ }
  }
}

async function fetchNew(
  cfg: ImapCredential,
  accountId: string,
  folder: string,
  sinceUid: number,
  maxFirst = 200,
): Promise<ImapFetchResult> {
  const client = createClient(cfg, 120000)
  await client.connect()
  const lock = await client.getMailboxLock(folder)
  try {
    const mailbox = client.mailbox
    const uidValidity = Number(mailbox && typeof mailbox !== 'boolean' ? mailbox.uidValidity : 0)
    const exists = mailbox && typeof mailbox !== 'boolean' ? mailbox.exists : 0
    if (!exists) return { uidValidity, exists: 0, mails: [] }

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
        mails.push(await parseRawMessage(raw, {
          accountId, folder, uid: msg.uid, size: msg.size ?? raw.length, flags,
        }))
      } catch (err) {
        log('warn', `解析邮件失败 (uid=${msg.uid}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const limited = sinceUid === 0 && mails.length > maxFirst ? mails.slice(-maxFirst) : mails
    return { uidValidity, exists, mails: limited }
  } finally {
    lock.release()
    try { await client.logout() } catch { /* 忽略登出异常 */ }
  }
}

async function fetchSource(cfg: ImapCredential, folder: string, uid: number): Promise<Buffer | null> {
  const client = createClient(cfg, 120000)
  await client.connect()
  const lock = await client.getMailboxLock(folder)
  try {
    for await (const msg of client.fetch({ uid }, { uid: true, source: true }, { uid: true })) {
      return msg.source ?? null
    }
    return null
  } finally {
    lock.release()
    try { await client.logout() } catch { /* 忽略登出异常 */ }
  }
}

async function list(cfg: ImapCredential): Promise<ImapMailboxInfo[]> {
  const client = createClient(cfg, 120000)
  try {
    await client.connect()
    const list = await client.list()
    return list.map((item) => ({
      path: item.path,
      alias: normalizeSpecialUse((item as { specialUse?: string }).specialUse),
    }))
  } finally {
    try { await client.logout() } catch { /* 忽略登出异常 */ }
  }
}

async function setFlags(
  cfg: ImapCredential, folder: string, uid: number, add: string[], remove: string[],
): Promise<{ success: boolean; error?: string }> {
  const client = createClient(cfg, 120000)
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
    try { await client.logout() } catch { /* 忽略登出异常 */ }
  }
}

/** 按需提取附件：拉原始报文 + 解析 + 命中文件名 */
async function fetchAttachment(
  cfg: ImapCredential, folder: string, uid: number, filename: string,
): Promise<{ success: boolean; data?: Buffer; error?: string }> {
  try {
    const raw = await fetchSource(cfg, folder, uid)
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
// IDLE 实时收信（常驻连接 + 子进程内指数退避重连）
// ============================================

const RECONNECT_BASE_MS = 5000
const RECONNECT_MAX_MS = 60000

interface IdleRecord {
  client: ImapFlow
  timer: ReturnType<typeof setTimeout> | null
  attempts: number
  stopped: boolean
  cfg: ImapCredential
}

const idles = new Map<string, IdleRecord>()

function idleConnect(accountId: string, cfg: ImapCredential): void {
  const client = createClient(cfg, 0) // IDLE 长连接不设空闲超时
  const record: IdleRecord = { client, timer: null, attempts: 0, stopped: false, cfg }
  idles.set(accountId, record)

  client.connect()
    .then(async () => {
      await client.mailboxOpen('INBOX')
      record.attempts = 0
      client.on('exists', () => emit({ type: 'idle-exists', accountId }))
      client.on('close', () => scheduleReconnect(accountId))
      log('info', `${accountId} 实时收信已启动`)
    })
    .catch((err: unknown) => {
      log('warn', `${accountId} 建立连接失败: ${err instanceof Error ? err.message : String(err)}`)
      scheduleReconnect(accountId)
    })
}

function scheduleReconnect(accountId: string): void {
  const record = idles.get(accountId)
  if (!record || record.stopped) {
    idles.delete(accountId)
    return
  }
  if (record.timer) return
  record.attempts += 1
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** (record.attempts - 1), RECONNECT_MAX_MS)
  log('info', `${accountId} 将在 ${delay}ms 后重连（第 ${record.attempts} 次）`)
  record.timer = setTimeout(() => {
    idles.delete(accountId)
    idleConnect(accountId, record.cfg)
  }, delay)
}

function idleStart(accountId: string, cfg: ImapCredential): void {
  const existing = idles.get(accountId)
  if (existing) return
  idleConnect(accountId, cfg)
}

function idleStop(accountId: string): void {
  const record = idles.get(accountId)
  if (!record) return
  record.stopped = true
  if (record.timer) clearTimeout(record.timer)
  try { record.client.close() } catch { /* 忽略关闭异常 */ }
  idles.delete(accountId)
}

// ============================================
// 消息分发
// ============================================

async function handle(req: MailRequest): Promise<void> {
  try {
    switch (req.op) {
      case 'test':
        return ok(req.id, await test(req.cfg))
      case 'fetchNew':
        return ok(req.id, await fetchNew(req.cfg, req.accountId, req.folder, req.sinceUid, req.maxFirst))
      case 'fetchSource':
        return ok(req.id, await fetchSource(req.cfg, req.folder, req.uid))
      case 'fetchAttachment':
        return ok(req.id, await fetchAttachment(req.cfg, req.folder, req.uid, req.filename))
      case 'list':
        return ok(req.id, await list(req.cfg))
      case 'setFlags':
        return ok(req.id, await setFlags(req.cfg, req.folder, req.uid, req.add, req.remove))
      case 'idleStart':
        idleStart(req.accountId, req.cfg)
        return ok(req.id)
      case 'idleStop':
        idleStop(req.accountId)
        return ok(req.id)
    }
  } catch (err) {
    fail(req.id, err)
  }
}

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const data = e.data as MailRequest | MailEvent
  if ('op' in data) {
    void handle(data)
  }
  // 事件方向为子进程 → 主进程，主进程不会发 MailEvent 过来，忽略
})
