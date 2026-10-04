/**
 * 邮件服务桥接 — SMTP 邮件发送的 IPC 处理器
 *
 * 职责：
 * - 暴露邮件发送 IPC 接口
 * - 基于原生 net 模块实现 SMTP 协议通信
 * - 支持收件人批量发送、HTML / 纯文本内容
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import { mailAccountStore } from '../../modules/mail/MailAccountStore'
import { resolveSmtpEndpoint } from '@shared/configuration/mailProviders'
import * as net from 'net'
import * as tls from 'tls'

interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

/** 由收件账户推导发件配置的结果 */
export type ResolvedSmtp =
  | { success: true; config: SmtpConfig; from: string }
  | { success: false; error: string }

/**
 * 由收件账户推导 SMTP 发件配置。
 *
 * 账户的登录账号与凭据（密码/授权码）同时用于收发，因此发件不需要用户
 * 再配置一遍：发件服务器优先取账户的 smtp 覆盖，其次按服务商规则推导。
 * 以下情形返回失败：
 * - 账户不存在，或该账户尚未保存密码/授权码
 * - 既未配置 smtp，也无法按规则推导出 SMTP 服务器
 */
export function resolveAccountSmtpConfig(accountId: string): ResolvedSmtp {
  const account = mailAccountStore.getAccount(accountId)
  if (!account) return { success: false, error: '账户不存在' }

  const pass = mailAccountStore.getCredential(accountId)
  if (!pass) return { success: false, error: '该账户尚未保存密码 / 授权码' }

  // 优先使用账户单独配置的外发端点；留空（或未填 host）时按服务商规则推导
  const explicit = account.smtp
  const endpoint =
    explicit && explicit.host
      ? { host: explicit.host, port: explicit.port, secure: explicit.secure }
      : resolveSmtpEndpoint(account.provider, account.imap.host)
  if (!endpoint) {
    return {
      success: false,
      error: '无法自动推导该邮箱的发件服务器，请在账户的「外发设置」中填写 SMTP 服务器地址',
    }
  }

  const user = account.auth.user || account.address
  return {
    success: true,
    config: {
      host: endpoint.host,
      port: endpoint.port,
      secure: endpoint.secure,
      user,
      pass,
    },
    from: account.address || user,
  }
}

interface EmailSendParams {
  to: string | string[]
  subject: string
  body: string
  html?: boolean
  cc?: string[]
  bcc?: string[]
  attachments?: Array<{
    filename: string
    /** base64 编码（不含 data: 前缀） */
    content: string
    encoding?: string
    /** MIME 类型，缺省按 application/octet-stream */
    contentType?: string
    /** 有值时作为正文内联资源，正文以 cid:<contentId> 引用 */
    contentId?: string
  }>
}

function buildSmtpCommand(command: string): string {
  return `${command}\r\n`
}

function readSmtpResponse(socket: net.Socket, timeoutMs: number): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      reject(new Error('SMTP response timeout'))
    }, timeoutMs)

    const onData = (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\r\n')
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i]
        if (line.length >= 4 && line[3] === ' ') {
          clearTimeout(timer)
          socket.removeListener('data', onData)
          const code = parseInt(line.substring(0, 3), 10)
          resolve({ code, lines: lines.slice(0, i + 1) })
          return
        }
      }
    }

    socket.on('data', onData)
    socket.once('error', (err) => {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      reject(err)
    })
  })
}

function sendCommandAndWait(
  socket: net.Socket,
  command: string,
  timeoutMs: number,
): Promise<{ code: number; lines: string[] }> {
  socket.write(buildSmtpCommand(command))
  return readSmtpResponse(socket, timeoutMs)
}

/** 建立明文 TCP 连接（STARTTLS 前使用） */
function createPlainSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)
    const onError = (err: Error) => {
      socket.destroy()
      reject(err)
    }
    socket.once('error', onError)
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error('Connection timeout'))
    })
    socket.connect(port, host, () => {
      socket.removeListener('error', onError)
      resolve(socket)
    })
  })
}

/** 建立直连 TLS 连接（secure=true，通常端口 465） */
function createTlsSocket(host: string, port: number, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, timeout: timeoutMs },
      () => {
        socket.setTimeout(timeoutMs)
        resolve(socket)
      },
    )
    socket.once('error', (err) => {
      socket.destroy()
      reject(err)
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error('TLS connection timeout'))
    })
  })
}

/**
 * 将已建立的明文连接升级为 TLS（STARTTLS 握手）
 *
 * 返回承载加密通道的 TLSSocket，后续所有 SMTP 命令均在其上收发。
 */
function upgradeToTls(socket: net.Socket, host: string, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({ socket, servername: host }, () => {
      tlsSocket.setTimeout(timeoutMs)
      resolve(tlsSocket)
    })
    tlsSocket.once('error', (err) => {
      tlsSocket.destroy()
      reject(err)
    })
    tlsSocket.once('timeout', () => {
      tlsSocket.destroy()
      reject(new Error('STARTTLS handshake timeout'))
    })
  })
}

/** SMTP 认证：优先 AUTH PLAIN，失败回退 AUTH LOGIN */
async function smtpAuthenticate(
  socket: net.Socket,
  user: string,
  pass: string,
  timeoutMs: number,
): Promise<void> {
  const plainToken = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf-8').toString('base64')
  const plainResp = await sendCommandAndWait(socket, `AUTH PLAIN ${plainToken}`, timeoutMs)
  if (plainResp.code === 235) return

  const loginResp = await sendCommandAndWait(socket, 'AUTH LOGIN', timeoutMs)
  if (loginResp.code !== 334) {
    throw new Error(`AUTH declined: ${plainResp.lines.join(' ')}`)
  }

  socket.write(Buffer.from(user, 'utf-8').toString('base64') + '\r\n')
  const userResp = await readSmtpResponse(socket, timeoutMs)
  if (userResp.code !== 334) {
    throw new Error(`Auth username rejected: ${userResp.lines.join(' ')}`)
  }

  socket.write(Buffer.from(pass, 'utf-8').toString('base64') + '\r\n')
  const passResp = await readSmtpResponse(socket, timeoutMs)
  if (passResp.code !== 235) {
    throw new Error(`Authentication failed: ${passResp.lines.join(' ')}`)
  }
}

/**
 * 建立并认证 SMTP 连接
 *
 * - secure=true：直连 TLS（无需 STARTTLS）
 * - secure=false：明文连接 → EHLO → STARTTLS 升级 TLS → 重新 EHLO
 *   若服务器未宣告 STARTTLS，则中止（拒绝明文提交凭据）
 * - 最后执行 AUTH，成功后才返回可用连接
 */
async function connectAndAuthenticate(config: SmtpConfig, timeoutMs: number): Promise<net.Socket> {
  let socket: net.Socket

  if (config.secure) {
    socket = await createTlsSocket(config.host, config.port, timeoutMs)
    await readSmtpResponse(socket, timeoutMs)
    await sendCommandAndWait(socket, 'EHLO aweeclaw-local', timeoutMs)
  } else {
    socket = await createPlainSocket(config.host, config.port, timeoutMs)
    await readSmtpResponse(socket, timeoutMs)
    const ehlo = await sendCommandAndWait(socket, 'EHLO aweeclaw-local', timeoutMs)
    if (!/STARTTLS/i.test(ehlo.lines.join(' '))) {
      socket.destroy()
      throw new Error('服务器未提供 STARTTLS，已中止以避免明文提交凭据')
    }
    const starttls = await sendCommandAndWait(socket, 'STARTTLS', timeoutMs)
    if (starttls.code < 200 || starttls.code >= 300) {
      socket.destroy()
      throw new Error(`STARTTLS 被拒绝：${starttls.lines.join(' ')}`)
    }
    socket = await upgradeToTls(socket, config.host, timeoutMs)
    // STARTTLS 后必须重新 EHLO（此时才宣告 AUTH 能力）
    await sendCommandAndWait(socket, 'EHLO aweeclaw-local', timeoutMs)
  }

  await smtpAuthenticate(socket, config.user, config.pass, timeoutMs)
  return socket
}

export async function testSmtpConnection(config: SmtpConfig): Promise<{ success: boolean; error?: string }> {
  const timeoutMs = 15000
  let socket: net.Socket | null = null
  try {
    // 真实完成 TLS 建立与 AUTH，避免“能连上即成功”的假阳性
    socket = await connectAndAuthenticate(config, timeoutMs)
    try {
      await sendCommandAndWait(socket, 'QUIT', timeoutMs)
    } catch {
      // 忽略
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (socket && !socket.destroyed) socket.destroy()
  }
}

function encodeEmailHeader(value: string): string {
  if (/^[\x20-\x7E]+$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

function buildMimeMessage(
  from: string,
  to: string[],
  subject: string,
  body: string,
  html: boolean,
  cc?: string[],
  attachments?: Array<{
    filename: string
    content: string
    encoding?: string
    contentType?: string
    contentId?: string
  }>,
): string {
  const lines: string[] = []

  lines.push(`From: ${from}`)
  lines.push(`To: ${to.join(', ')}`)
  if (cc && cc.length > 0) {
    lines.push(`Cc: ${cc.join(', ')}`)
  }
  lines.push(`Subject: ${encodeEmailHeader(subject)}`)
  lines.push('MIME-Version: 1.0')

  const all = attachments ?? []
  // 带 contentId 的作为正文内联资源（图片），其余作为普通附件
  const inlineParts = all.filter((a) => a.contentId)
  const fileParts = all.filter((a) => !a.contentId)

  const bodyPart = (): string[] => [
    `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf-8').toString('base64'),
  ]

  // 无附件：单部分正文
  if (all.length === 0) {
    lines.push(...bodyPart())
    return lines.join('\r\n')
  }

  // 有内联图片时，正文与图片必须放进同一个 multipart/related，cid: 引用才能解析
  const relatedBoundary = `----=_Rel_${Date.now()}_${Math.random().toString(36).substring(2)}`
  const relatedParts: string[] = []
  if (inlineParts.length > 0) {
    relatedParts.push(`--${relatedBoundary}`)
    relatedParts.push(...bodyPart())
    relatedParts.push('')
    for (const img of inlineParts) {
      relatedParts.push(`--${relatedBoundary}`)
      relatedParts.push(
        `Content-Type: ${img.contentType || 'application/octet-stream'}; name="${encodeEmailHeader(img.filename)}"`,
      )
      relatedParts.push('Content-Transfer-Encoding: base64')
      relatedParts.push(`Content-ID: <${img.contentId}>`)
      relatedParts.push(`Content-Disposition: inline; filename="${encodeEmailHeader(img.filename)}"`)
      relatedParts.push('')
      relatedParts.push(img.content)
      relatedParts.push('')
    }
    relatedParts.push(`--${relatedBoundary}--`)
  }

  // 只有内联图片：related 直接作为顶层
  if (fileParts.length === 0) {
    lines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`)
    lines.push('')
    lines.push(...relatedParts)
    return lines.join('\r\n')
  }

  // 含普通附件：外层 multipart/mixed 包裹正文（或 related）+ 附件
  const mixedBoundary = `----=_Mix_${Date.now()}_${Math.random().toString(36).substring(2)}`
  lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`)
  lines.push('')

  if (inlineParts.length > 0) {
    lines.push(`--${mixedBoundary}`)
    lines.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`)
    lines.push('')
    lines.push(...relatedParts)
    lines.push('')
  } else {
    lines.push(`--${mixedBoundary}`)
    lines.push(...bodyPart())
    lines.push('')
  }

  for (const att of fileParts) {
    lines.push(`--${mixedBoundary}`)
    lines.push(
      `Content-Type: ${att.contentType || 'application/octet-stream'}; name="${encodeEmailHeader(att.filename)}"`,
    )
    lines.push('Content-Transfer-Encoding: base64')
    lines.push(`Content-Disposition: attachment; filename="${encodeEmailHeader(att.filename)}"`)
    lines.push('')
    lines.push(att.content)
    lines.push('')
  }

  lines.push(`--${mixedBoundary}--`)
  return lines.join('\r\n')
}

/**
 * 执行一次 SMTP 投递
 *
 * 供 email:send IPC 与邮件中心的「写邮件」共用：
 * 完成 TLS 建立 → AUTH → MAIL FROM / RCPT TO / DATA 全流程。
 */
export async function sendEmail(
  config: SmtpConfig,
  fromAddress: string,
  params: EmailSendParams,
): Promise<{ success: boolean; error?: string }> {
  const timeoutMs = 30000
  const recipients = Array.isArray(params.to) ? params.to : [params.to]
  const allRecipients = [...recipients, ...(params.cc || []), ...(params.bcc || [])]

  let socket: net.Socket | null = null
  try {
    socket = await connectAndAuthenticate(config, timeoutMs)

    const mailFrom = await sendCommandAndWait(socket, `MAIL FROM:<${fromAddress}>`, timeoutMs)
    if (mailFrom.code >= 400) {
      throw new Error(`MAIL FROM rejected: ${mailFrom.lines.join(' ')}`)
    }

    for (const rcpt of allRecipients) {
      const rcptTo = await sendCommandAndWait(socket, `RCPT TO:<${rcpt}>`, timeoutMs)
      if (rcptTo.code >= 400) {
        throw new Error(`RCPT TO rejected for ${rcpt}: ${rcptTo.lines.join(' ')}`)
      }
    }

    const dataResp = await sendCommandAndWait(socket, 'DATA', timeoutMs)
    if (dataResp.code !== 354) {
      throw new Error(`DATA command failed: ${dataResp.lines.join(' ')}`)
    }

    const mimeMessage = buildMimeMessage(
      fromAddress,
      recipients,
      params.subject,
      params.body,
      params.html ?? false,
      params.cc,
      params.attachments,
    )

    socket.write(mimeMessage + '\r\n.\r\n')
    const endResp = await readSmtpResponse(socket, timeoutMs)

    // QUIT 失败不影响投递结果
    try {
      await sendCommandAndWait(socket, 'QUIT', timeoutMs)
    } catch {
      // 忽略
    }

    if (endResp.code >= 200 && endResp.code < 300) {
      return { success: true }
    }
    return { success: false, error: `Send failed: ${endResp.lines.join(' ')}` }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (socket && !socket.destroyed) socket.destroy()
  }
}

export function registerEmailHandlers() {
  safeIpcHandle(
    'email:testConnection',
    async (_event, config: SmtpConfig) => {
      try {
        if (!config.host || !config.port || !config.user || !config.pass) {
          return { success: false, error: 'Missing required SMTP configuration' }
        }
        return await testSmtpConnection(config)
      } catch (err) {
        logger.ipc.error('[Email] Test connection error:', err)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    'email',
  )

  safeIpcHandle(
    'email:send',
    async (
      _event,
      params: EmailSendParams & {
        /** 直连发件配置；与 accountId 二选一 */
        smtpConfig?: SmtpConfig
        /** 使用该收件账户的发件能力（自动推导 SMTP 与凭据） */
        accountId?: string
        fromAddress?: string
      },
    ) => {
      try {
        const { smtpConfig, accountId, fromAddress, ...sendParams } = params

        // 优先显式配置；否则由收件账户推导（设置页只维护收件账户的常见情形）
        let config = smtpConfig
        let from = fromAddress
        if (!config && accountId) {
          const resolved = resolveAccountSmtpConfig(accountId)
          if (!resolved.success) return { success: false, error: resolved.error }
          config = resolved.config
          from = from ?? resolved.from
        }

        if (!config?.host || !config?.user || !config?.pass) {
          return { success: false, error: 'SMTP not configured' }
        }
        return await sendEmail(config, from || config.user, sendParams)
      } catch (err) {
        logger.ipc.error('[Email] Send error:', err)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    'email',
  )

  logger.ipc.info('[Email] Handlers registered')
}
