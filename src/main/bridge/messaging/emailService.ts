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
import * as net from 'net'

interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

interface EmailSendParams {
  to: string | string[]
  subject: string
  body: string
  html?: boolean
  cc?: string[]
  bcc?: string[]
  attachments?: Array<{ filename: string; content: string; encoding?: string }>
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

async function testSmtpConnection(config: SmtpConfig): Promise<{ success: boolean; error?: string }> {
  const timeoutMs = 15000

  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)

    socket.on('timeout', () => {
      socket.destroy()
      resolve({ success: false, error: 'Connection timeout' })
    })

    socket.on('error', (err) => {
      socket.destroy()
      resolve({ success: false, error: err.message })
    })

    socket.connect(config.port, config.host, async () => {
      try {
        const greeting = await readSmtpResponse(socket, timeoutMs)
        if (greeting.code < 200 || greeting.code >= 400) {
          socket.destroy()
          resolve({ success: false, error: `SMTP greeting failed: ${greeting.lines.join(' ')}` })
          return
        }

        const ehlo = await sendCommandAndWait(socket, `EHLO aweeclaw-local`, timeoutMs)
        if (ehlo.code < 200 || ehlo.code >= 400) {
          socket.destroy()
          resolve({ success: false, error: `EHLO failed: ${ehlo.lines.join(' ')}` })
          return
        }

        if (config.secure) {
          socket.destroy()
          resolve({ success: true })
          return
        }

        const starttls = await sendCommandAndWait(socket, 'STARTTLS', timeoutMs)
        if (starttls.code >= 200 && starttls.code < 300) {
          socket.destroy()
          resolve({ success: true })
          return
        }

        const auth = await sendCommandAndWait(socket, 'AUTH LOGIN', timeoutMs)
        if (auth.code !== 334) {
          socket.destroy()
          resolve({ success: false, error: `AUTH LOGIN not supported: ${auth.lines.join(' ')}` })
          return
        }

        socket.write(Buffer.from(config.user, 'utf-8').toString('base64') + '\r\n')
        const userResp = await readSmtpResponse(socket, timeoutMs)
        if (userResp.code !== 334) {
          socket.destroy()
          resolve({ success: false, error: `Auth user rejected: ${userResp.lines.join(' ')}` })
          return
        }

        socket.write(Buffer.from(config.pass, 'utf-8').toString('base64') + '\r\n')
        const passResp = await readSmtpResponse(socket, timeoutMs)
        socket.destroy()

        if (passResp.code === 235) {
          resolve({ success: true })
        } else {
          resolve({ success: false, error: `Authentication failed: ${passResp.lines.join(' ')}` })
        }
      } catch (err) {
        socket.destroy()
        resolve({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  })
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
  attachments?: Array<{ filename: string; content: string; encoding?: string }>,
): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`
  const lines: string[] = []

  lines.push(`From: ${from}`)
  lines.push(`To: ${to.join(', ')}`)
  if (cc && cc.length > 0) {
    lines.push(`Cc: ${cc.join(', ')}`)
  }
  lines.push(`Subject: ${encodeEmailHeader(subject)}`)
  lines.push('MIME-Version: 1.0')

  if (attachments && attachments.length > 0) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    lines.push('')
    lines.push(`--${boundary}`)
    lines.push(`Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`)
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(body, 'utf-8').toString('base64'))
    lines.push('')

    for (const att of attachments) {
      lines.push(`--${boundary}`)
      lines.push(`Content-Type: application/octet-stream; name="${encodeEmailHeader(att.filename)}"`)
      lines.push('Content-Transfer-Encoding: base64')
      lines.push(`Content-Disposition: attachment; filename="${encodeEmailHeader(att.filename)}"`)
      lines.push('')
      lines.push(att.content)
      lines.push('')
    }

    lines.push(`--${boundary}--`)
  } else {
    lines.push(`Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`)
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(body, 'utf-8').toString('base64'))
  }

  return lines.join('\r\n')
}

async function sendEmail(
  config: SmtpConfig,
  fromAddress: string,
  params: EmailSendParams,
): Promise<{ success: boolean; error?: string }> {
  const timeoutMs = 30000
  const recipients = Array.isArray(params.to) ? params.to : [params.to]
  const allRecipients = [...recipients, ...(params.cc || []), ...(params.bcc || [])]

  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)

    socket.on('timeout', () => {
      socket.destroy()
      resolve({ success: false, error: 'Connection timeout' })
    })

    socket.on('error', (err) => {
      socket.destroy()
      resolve({ success: false, error: err.message })
    })

    socket.connect(config.port, config.host, async () => {
      try {
        await readSmtpResponse(socket, timeoutMs)

        await sendCommandAndWait(socket, 'EHLO aweeclaw-local', timeoutMs)

        if (!config.secure) {
          const starttls = await sendCommandAndWait(socket, 'STARTTLS', timeoutMs)
          if (starttls.code < 200 || starttls.code >= 300) {
            socket.destroy()
            resolve({ success: false, error: 'STARTTLS not supported by server' })
            return
          }
        }

        await sendCommandAndWait(socket, 'AUTH LOGIN', timeoutMs)
        socket.write(Buffer.from(config.user, 'utf-8').toString('base64') + '\r\n')
        await readSmtpResponse(socket, timeoutMs)
        socket.write(Buffer.from(config.pass, 'utf-8').toString('base64') + '\r\n')
        const authResp = await readSmtpResponse(socket, timeoutMs)
        if (authResp.code !== 235) {
          socket.destroy()
          resolve({ success: false, error: `Authentication failed: ${authResp.lines.join(' ')}` })
          return
        }

        const mailFrom = await sendCommandAndWait(socket, `MAIL FROM:<${fromAddress}>`, timeoutMs)
        if (mailFrom.code >= 400) {
          socket.destroy()
          resolve({ success: false, error: `MAIL FROM rejected: ${mailFrom.lines.join(' ')}` })
          return
        }

        for (const rcpt of allRecipients) {
          const rcptTo = await sendCommandAndWait(socket, `RCPT TO:<${rcpt}>`, timeoutMs)
          if (rcptTo.code >= 400) {
            socket.destroy()
            resolve({ success: false, error: `RCPT TO rejected for ${rcpt}: ${rcptTo.lines.join(' ')}` })
            return
          }
        }

        const dataResp = await sendCommandAndWait(socket, 'DATA', timeoutMs)
        if (dataResp.code !== 354) {
          socket.destroy()
          resolve({ success: false, error: `DATA command failed: ${dataResp.lines.join(' ')}` })
          return
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

        await sendCommandAndWait(socket, 'QUIT', timeoutMs)
        socket.destroy()

        if (endResp.code >= 200 && endResp.code < 300) {
          resolve({ success: true })
        } else {
          resolve({ success: false, error: `Send failed: ${endResp.lines.join(' ')}` })
        }
      } catch (err) {
        socket.destroy()
        resolve({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  })
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
    async (_event, params: EmailSendParams & { smtpConfig: SmtpConfig; fromAddress?: string }) => {
      try {
        const { smtpConfig, fromAddress, ...sendParams } = params
        if (!smtpConfig?.host || !smtpConfig?.user || !smtpConfig?.pass) {
          return { success: false, error: 'SMTP not configured' }
        }
        const from = fromAddress || smtpConfig.user
        return await sendEmail(smtpConfig, from, sendParams)
      } catch (err) {
        logger.ipc.error('[Email] Send error:', err)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    'email',
  )

  logger.ipc.info('[Email] Handlers registered')
}
