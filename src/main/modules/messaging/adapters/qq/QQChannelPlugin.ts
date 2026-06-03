/**
 * QQ 渠道插件
 *
 * 通过 QQ 开放平台官方机器人 API 接入 QQ，实现消息收发
 * - 接收消息：WebSocket 长连接（Gateway）
 * - 发送消息：HTTP API（api.sgroup.qq.com）
 * - 认证方式：AppID + ClientSecret → access_token
 * - 支持场景：C2C 私聊、群 @ 消息、频道消息
 */

import * as crypto from 'crypto'
import WebSocket from 'ws'
import { logger } from '@shared/toolkit/LogEngine'
import { QQClient, parseTarget } from './QQClient'
import type {
  C2CMessageEvent,
  GroupMessageEvent,
  GuildMessageEvent,
  MessageAttachment,
} from './QQClient'
import type {
  ChannelId,
  ChannelPlugin,
  ChannelMeta,
  ChannelSecretSchema,
  ChannelAccountConfig,
  ChannelAccountSnapshot,
  InboundMessage,
  InboundMedia,
  OutboundMessage,
  OutboundResult,
  ChannelEvent,
  ChannelStatus,
} from '@shared/protocols/channel'

// ============================================
// 常量
// ============================================

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const RECONNECT_BACKOFFS = [1_000, 2_000, 5_000, 10_000, 30_000]

/** QQ Gateway Intents */
const QQ_INTENT_PUBLIC_GUILD_MESSAGES = 1 << 30
const QQ_INTENT_GROUP_AND_C2C = 1 << 25

// ============================================
// 类型定义
// ============================================

interface QQSessionState {
  sessionId: string
  lastSeq: number
  intentLevel: number
}

interface QQConnection {
  accountId: string
  appId: string
  client: QQClient
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  ws: WebSocket | null
  abortController: AbortController | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
}

interface WSPayload {
  op: number
  d?: unknown
  s?: number
  t?: string
}

interface HelloData {
  heartbeat_interval: number
}

interface ReadyData {
  session_id: string
  user?: { id?: string }
}

// ============================================
// 插件实现
// ============================================

export class QQChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'qq'
  meta: ChannelMeta = {
    id: 'qq',
    label: 'QQ Bot',
    labelZh: 'QQ 机器人',
    description: 'Connect QQ Bot via official QQ Open Platform API',
    descriptionZh: '通过 QQ 开放平台官方机器人 API 接入 QQ',
    icon: 'MessageCircle',
    connectionModes: ['websocket'],
    defaultConnectionMode: 'websocket',
    capabilities: {
      chatTypes: ['direct', 'group', 'channel'],
      media: true,
      reactions: false,
      threads: true,
      edit: false,
      streaming: false,
      voice: false,
      files: true,
    },
    order: 3,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'appId',
      label: 'App ID',
      labelZh: '应用ID',
      description: 'QQ Bot App ID from q.qq.com',
      descriptionZh: 'QQ 机器人的 AppID（q.qq.com 获取）',
      required: true,
      secret: false,
      placeholder: '10xxxxxxxxx',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      labelZh: '应用密钥',
      description: 'QQ Bot Client Secret',
      descriptionZh: 'QQ 机器人的 ClientSecret',
      required: true,
      secret: true,
      placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    },
    {
      key: 'markdownSupport',
      label: 'Markdown Support',
      labelZh: 'Markdown 支持',
      description: 'Enable QQ markdown message mode for C2C and group replies',
      descriptionZh: '启用 QQ Markdown 消息模式（需机器人有权限）',
      required: false,
      secret: false,
      placeholder: 'true',
    },
    {
      key: 'enableInputHint',
      label: 'Input Hint',
      labelZh: '输入提示',
      description: 'Send QQ input-notify hints for direct messages while processing',
      descriptionZh: '处理消息时发送「正在输入」提示',
      required: false,
      secret: false,
      placeholder: 'true',
    },
  ]

  private connections = new Map<string, QQConnection>()
  private accounts = new Map<string, ChannelAccountConfig>()
  private sessions = new Map<string, QQSessionState>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false

  // ============================================
  // ChannelPlugin 接口实现
  // ============================================

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { appId, clientSecret } = credentials
    if (!appId || !clientSecret) {
      return { valid: false, error: 'App ID and Client Secret are required' }
    }
    try {
      const client = new QQClient(appId, clientSecret)
      await client.accessToken()
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return

    const { appId, clientSecret } = account.credentials
    if (!appId || !clientSecret) {
      throw new Error('QQ App ID and Client Secret are required')
    }

    const existing = this.connections.get(account.id)
    if (existing) {
      this.closeConnection(existing)
    }

    const client = new QQClient(appId, clientSecret)
    const abortController = new AbortController()

    const conn: QQConnection = {
      accountId: account.id,
      appId,
      client,
      status: 'connecting',
      lastConnectedAt: null,
      lastError: null,
      ws: null,
      abortController,
      heartbeatTimer: null,
    }

    this.connections.set(account.id, conn)
    this.accounts.set(account.id, account)
    this.emitStatusChange(account.id)

    this.runReceiver(account.id, abortController.signal).catch(err => {
      logger.channel.error(`[QQ] Receiver error for ${account.id}: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  async disconnect(accountId: string): Promise<void> {
    const conn = this.connections.get(accountId)
    if (conn) {
      this.closeConnection(conn)
    }
    this.connections.delete(accountId)
    this.accounts.delete(accountId)
    this.sessions.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`[QQ] Account ${accountId} disconnected`)
  }

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    if (message.channelId !== 'qq') {
      return { success: false, error: 'Invalid channel ID' }
    }

    const conn = this.connections.get(message.accountId || '')
    if (!conn || (conn.status !== 'connected' && conn.status !== 'connecting')) {
      return { success: false, error: 'QQ account not connected' }
    }

    try {
      const target = parseTarget(message.to)
      const replyTo = message.replyToId || undefined
      const account = this.accounts.get(message.accountId || '')
      const markdown = account?.credentials.markdownSupport === 'true'

      const result = await conn.client.sendText(target, message.text || '', replyTo, markdown)
      return { success: true, messageId: result.id }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`[QQ] Send message failed: ${msg}`)
      return { success: false, error: msg }
    }
  }

  getStatus(accountId: string): ChannelAccountSnapshot {
    const conn = this.connections.get(accountId)
    return {
      accountId,
      enabled: conn?.status === 'connected',
      configured: !!conn,
      status: conn?.status || 'disconnected',
      connected: conn?.status === 'connected',
      lastConnectedAt: conn?.lastConnectedAt ?? null,
      lastError: conn?.lastError ?? null,
    }
  }

  onMessage(callback: (message: InboundMessage) => void): void {
    this.messageCallbacks.push(callback)
  }

  onStatusChange(callback: (snapshot: ChannelAccountSnapshot) => void): void {
    this.statusCallbacks.push(callback)
  }

  onEvent(callback: (event: ChannelEvent) => void): void {
    this.eventCallbacks.push(callback)
  }

  destroy(): void {
    this.destroyed = true
    for (const conn of this.connections.values()) {
      this.closeConnection(conn)
    }
    this.connections.clear()
    this.accounts.clear()
    this.sessions.clear()
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  // ============================================
  // WebSocket 接收循环
  // ============================================

  /** 运行 WebSocket 接收器，支持自动重连 */
  private async runReceiver(accountId: string, signal: AbortSignal): Promise<void> {
    let attempt = 0
    let healthySession = false

    while (!signal.aborted && !this.destroyed) {
      try {
        healthySession = await this.serveConnection(accountId, signal)
        if (signal.aborted) return
      } catch (err) {
        if (signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        logger.channel.warn(`[QQ] Connection error for ${accountId}: ${msg}`)
      }

      const backoff = healthySession
        ? RECONNECT_BACKOFFS[0]
        : RECONNECT_BACKOFFS[Math.min(attempt, RECONNECT_BACKOFFS.length - 1)]
      attempt = healthySession ? 0 : attempt + 1

      logger.channel.info(`[QQ] Reconnecting ${accountId} in ${backoff}ms (attempt ${attempt})`)
      await this.sleep(backoff, signal)
    }
  }

  /** 单次 WebSocket 连接服务 */
  private async serveConnection(accountId: string, signal: AbortSignal): Promise<boolean> {
    const conn = this.connections.get(accountId)
    if (!conn) return false

    let healthySession = false

    try {
      const gatewayURL = await conn.client.gatewayURL()
      logger.channel.info(`[QQ] Connecting to gateway for ${accountId}`)

      const ws = new WebSocket(gatewayURL)
      conn.ws = ws

      healthySession = await new Promise<boolean>((resolve, reject) => {
        let session = this.sessions.get(accountId) || { sessionId: '', lastSeq: 0, intentLevel: 0 }

        ws.on('open', () => {
          logger.channel.info(`[QQ] WebSocket opened for ${accountId}`)
        })

        ws.on('message', (data: WebSocket.Data) => {
          try {
            const payload: WSPayload = JSON.parse(data.toString())
            if (payload.s && payload.s > 0) {
              session.lastSeq = payload.s
              this.sessions.set(accountId, session)
            }

            switch (payload.op) {
              case 10: // Hello
                this.handleHello(ws, accountId, session, payload.d as HelloData)
                break

              case 0: // Dispatch
                healthySession = this.handleDispatch(accountId, payload.t || '', payload.d, session) || healthySession
                break

              case 7: // Reconnect
                logger.channel.info(`[QQ] Gateway requested reconnect for ${accountId}`)
                ws.close()
                resolve(healthySession)
                break

              case 9: // Invalid Session
                session = { sessionId: '', lastSeq: 0, intentLevel: 0 }
                this.sessions.set(accountId, session)
                logger.channel.warn(`[QQ] Invalid session for ${accountId}, will re-identify`)
                ws.close()
                resolve(false)
                break

              case 11: // Heartbeat ACK
                break

              default:
                logger.channel.debug(`[QQ] Unknown op=${payload.op} for ${accountId}`)
            }
          } catch (err) {
            logger.channel.error(`[QQ] Message parse error: ${err instanceof Error ? err.message : String(err)}`)
          }
        })

        ws.on('close', (code: number, _reason: Buffer) => {
          logger.channel.info(`[QQ] WebSocket closed for ${accountId}: code=${code}`)
          if (code === 4004) {
            conn.client.clearToken()
          } else if (code === 4006 || code === 4007 || code === 4009) {
            this.sessions.delete(accountId)
          }
          resolve(healthySession)
        })

        ws.on('error', (err: Error) => {
          logger.channel.error(`[QQ] WebSocket error for ${accountId}: ${err.message}`)
          reject(err)
        })

        const onAbort = () => {
          ws.close()
          resolve(healthySession)
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      conn.status = 'error'
      conn.lastError = msg
      this.emitStatusChange(accountId)
    }

    return healthySession
  }

  /** 处理 Gateway Hello（op=10），发送 Identify 或 Resume */
  private handleHello(ws: WebSocket, accountId: string, session: QQSessionState, data: HelloData): void {
    const conn = this.connections.get(accountId)
    if (!conn) return

    const interval = data?.heartbeat_interval || DEFAULT_HEARTBEAT_INTERVAL_MS

    // 清理旧心跳
    if (conn.heartbeatTimer) clearInterval(conn.heartbeatTimer)

    // 启动心跳
    conn.heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 1, d: session.lastSeq }))
      }
    }, interval)

    // 发送 Identify 或 Resume
    conn.client.accessToken().then(token => {
      if (session.sessionId && session.lastSeq > 0) {
        ws.send(JSON.stringify({
          op: 6,
          d: { token: `QQBot ${token}`, session_id: session.sessionId, seq: session.lastSeq },
        }))
      } else {
        const intents = QQ_INTENT_PUBLIC_GUILD_MESSAGES | QQ_INTENT_GROUP_AND_C2C
        ws.send(JSON.stringify({
          op: 2,
          d: { token: `QQBot ${token}`, intents, shard: [0, 1] },
        }))
      }
    }).catch(err => {
      logger.channel.error(`[QQ] Identify/Resume failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  /** 处理 Gateway Dispatch 事件 */
  private handleDispatch(accountId: string, eventType: string, data: unknown, session: QQSessionState): boolean {
    switch (eventType) {
      case 'READY': {
        const ready = data as ReadyData
        session.sessionId = ready?.session_id || ''
        this.sessions.set(accountId, session)

        const conn = this.connections.get(accountId)
        if (conn) {
          conn.status = 'connected'
          conn.lastConnectedAt = Date.now()
          conn.lastError = null
          this.emitStatusChange(accountId)
        }
        logger.channel.info(`[QQ] Session ready for ${accountId}`)
        return true
      }

      case 'RESUMED':
        this.sessions.set(accountId, session)
        logger.channel.info(`[QQ] Session resumed for ${accountId}`)
        return true

      case 'C2C_MESSAGE_CREATE': {
        const event = data as C2CMessageEvent
        this.dispatchC2CMessage(accountId, event)
        return false
      }

      case 'GROUP_AT_MESSAGE_CREATE': {
        const event = data as GroupMessageEvent
        this.dispatchGroupMessage(accountId, event)
        return false
      }

      case 'AT_MESSAGE_CREATE': {
        const event = data as GuildMessageEvent
        this.dispatchGuildMessage(accountId, event)
        return false
      }

      default:
        return false
    }
  }

  // ============================================
  // 消息分发
  // ============================================

  private dispatchC2CMessage(accountId: string, event: C2CMessageEvent): void {
    const userOpenId = event.author?.user_openid?.trim()
    if (!userOpenId) return

    const message: InboundMessage = {
      id: event.id || crypto.randomUUID(),
      channelId: 'qq',
      accountId,
      chatType: 'direct',
      from: userOpenId,
      fromName: userOpenId,
      to: event.author?.union_openid || userOpenId,
      text: event.content?.trim() || '',
      media: this.toInboundMedia(event.attachments),
      timestamp: this.parseTimestamp(event.timestamp),
      replyToId: event.message_reference?.message_id,
    }

    for (const cb of this.messageCallbacks) cb(message)
  }

  private dispatchGroupMessage(accountId: string, event: GroupMessageEvent): void {
    const memberOpenId = event.author?.member_openid?.trim()
    const groupOpenId = event.group_openid?.trim()
    if (!memberOpenId || !groupOpenId) return

    const message: InboundMessage = {
      id: event.id || crypto.randomUUID(),
      channelId: 'qq',
      accountId,
      chatType: 'group',
      from: memberOpenId,
      fromName: memberOpenId,
      to: groupOpenId,
      text: event.content?.trim() || '',
      media: this.toInboundMedia(event.attachments),
      timestamp: this.parseTimestamp(event.timestamp),
      replyToId: event.message_reference?.message_id,
    }

    for (const cb of this.messageCallbacks) cb(message)
  }

  private dispatchGuildMessage(accountId: string, event: GuildMessageEvent): void {
    const authorId = event.author?.id?.trim()
    const channelId = event.channel_id?.trim()
    if (!authorId || !channelId) return

    const message: InboundMessage = {
      id: event.id || crypto.randomUUID(),
      channelId: 'qq',
      accountId,
      chatType: 'channel',
      from: authorId,
      fromName: event.author?.username || authorId,
      to: channelId,
      text: event.content?.trim() || '',
      media: this.toInboundMedia(event.attachments),
      timestamp: this.parseTimestamp(event.timestamp),
      replyToId: event.message_reference?.message_id,
    }

    for (const cb of this.messageCallbacks) cb(message)
  }

  // ============================================
  // 工具方法
  // ============================================

  private toInboundMedia(attachments?: MessageAttachment[]): InboundMedia[] | undefined {
    if (!attachments || attachments.length === 0) return undefined
    return attachments.map(att => {
      const contentType = att.content_type?.toLowerCase() || ''
      let type: InboundMedia['type'] = 'file'
      if (contentType.startsWith('image/')) type = 'image'
      else if (contentType.startsWith('video/')) type = 'video'
      else if (contentType.startsWith('audio/') || att.voice_wav_url) type = 'audio'

      const url = att.url?.startsWith('//') ? `https:${att.url}` : att.url
      return { type, url }
    })
  }

  private parseTimestamp(raw?: string): number {
    if (!raw) return Date.now()
    const ts = new Date(raw).getTime()
    return isNaN(ts) ? Date.now() : ts
  }

  private closeConnection(conn: QQConnection): void {
    if (conn.heartbeatTimer) {
      clearInterval(conn.heartbeatTimer)
      conn.heartbeatTimer = null
    }
    if (conn.abortController) {
      conn.abortController.abort()
    }
    if (conn.ws) {
      try { conn.ws.close() } catch { /* ignore */ }
      conn.ws = null
    }
    conn.status = 'disconnected'
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms)
      const onAbort = () => { clearTimeout(timer); resolve() }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private emitStatusChange(accountId: string): void {
    const snapshot = this.getStatus(accountId)
    for (const cb of this.statusCallbacks) cb(snapshot)
  }
}

export const qqChannelPlugin = new QQChannelPlugin()
