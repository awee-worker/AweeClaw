/**
 * 钉钉（DingTalk）渠道插件
 *
 * 通过钉钉开放平台 Stream 模式接入，实现消息收发
 * - 接收消息：Stream 模式 WebSocket 长连接（无需公网域名）
 * - 发送消息：sessionWebhook（优先） / REST API（兜底）
 * - 认证方式：Client ID (AppKey) + Client Secret (AppSecret)
 * - 支持场景：单聊、群聊（@机器人）
 */

import * as crypto from 'crypto'
import WebSocket from 'ws'
import { logger } from '@shared/toolkit/LogEngine'
import { DingTalkClient } from './DingTalkClient'
import type { BotMessageData, StreamEnvelope } from './DingTalkClient'
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

const PING_INTERVAL_MS = 30_000
const RECONNECT_BACKOFFS = [2_000, 5_000, 10_000, 30_000, 60_000]

/** Stream 推送 Topic：机器人消息回调 */
const TOPIC_BOT_MESSAGE = '/v1.0/im/bot/messages/get'

// ============================================
// 类型定义
// ============================================

interface DingTalkConnection {
  accountId: string
  client: DingTalkClient
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  ws: WebSocket | null
  abortController: AbortController | null
  pingTimer: ReturnType<typeof setInterval> | null
  /** sessionWebhook 缓存（按 conversationId） */
  sessionWebhooks: Map<string, { url: string; expiresAt: number }>
}

/** Stream WebSocket 下行消息 */
interface WSDownMessage {
  code: number
  headers: StreamEnvelope['headers']
  data: string
  message: string
}

// ============================================
// 插件实现
// ============================================

export class DingTalkChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'dingtalk'
  meta: ChannelMeta = {
    id: 'dingtalk',
    label: 'DingTalk',
    labelZh: '钉钉',
    description: 'Connect DingTalk Bot via Stream Mode API',
    descriptionZh: '通过钉钉开放平台 Stream 模式接入钉钉机器人',
    icon: 'MessageCircle',
    connectionModes: ['websocket'],
    defaultConnectionMode: 'websocket',
    capabilities: {
      chatTypes: ['direct', 'group'],
      media: false,
      reactions: false,
      threads: false,
      edit: false,
      streaming: false,
      voice: false,
      files: false,
    },
    order: 4,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'clientId',
      label: 'Client ID',
      labelZh: '应用 AppKey',
      description: 'DingTalk App Client ID (AppKey) from open-dev.dingtalk.com',
      descriptionZh: '钉钉应用的 AppKey（开发者后台获取）',
      required: true,
      secret: false,
      placeholder: 'dingXXXXXXXXXXXXXXXX',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      labelZh: '应用 AppSecret',
      description: 'DingTalk App Client Secret (AppSecret)',
      descriptionZh: '钉钉应用的 AppSecret',
      required: true,
      secret: true,
      placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    },
    {
      key: 'robotCode',
      label: 'Robot Code',
      labelZh: '机器人编码',
      description: 'DingTalk Robot Code (defaults to Client ID if not set)',
      descriptionZh: '钉钉机器人编码（不填默认使用 AppKey）',
      required: false,
      secret: false,
      placeholder: 'optional, same as AppKey',
    },
  ]

  private connections = new Map<string, DingTalkConnection>()
  private accounts = new Map<string, ChannelAccountConfig>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false

  // ============================================
  // ChannelPlugin 接口实现
  // ============================================

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { clientId, clientSecret } = credentials
    if (!clientId || !clientSecret) {
      return { valid: false, error: 'Client ID and Client Secret are required' }
    }
    try {
      const client = new DingTalkClient(clientId, clientSecret)
      await client.accessToken()
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return

    const { clientId, clientSecret, robotCode } = account.credentials
    if (!clientId || !clientSecret) {
      throw new Error('DingTalk Client ID and Client Secret are required')
    }

    const existing = this.connections.get(account.id)
    if (existing) {
      this.closeConnection(existing)
    }

    const client = new DingTalkClient(clientId, clientSecret, robotCode)
    const abortController = new AbortController()

    const conn: DingTalkConnection = {
      accountId: account.id,
      client,
      status: 'connecting',
      lastConnectedAt: null,
      lastError: null,
      ws: null,
      abortController,
      pingTimer: null,
      sessionWebhooks: new Map(),
    }

    this.connections.set(account.id, conn)
    this.accounts.set(account.id, account)
    this.emitStatusChange(account.id)

    this.runReceiver(account.id, abortController.signal).catch(err => {
      logger.channel.error(`[DingTalk] Receiver error for ${account.id}: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  async disconnect(accountId: string): Promise<void> {
    const conn = this.connections.get(accountId)
    if (conn) {
      this.closeConnection(conn)
    }
    this.connections.delete(accountId)
    this.accounts.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`[DingTalk] Account ${accountId} disconnected`)
  }

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    if (message.channelId !== 'dingtalk') {
      return { success: false, error: 'Invalid channel ID' }
    }

    const conn = this.connections.get(message.accountId || '')
    if (!conn || (conn.status !== 'connected' && conn.status !== 'connecting')) {
      return { success: false, error: 'DingTalk account not connected' }
    }

    try {
      const text = message.text?.trim() || ''
      if (!text) {
        return { success: false, error: 'Empty message content' }
      }

      // 优先使用 sessionWebhook 回复
      const conversationId = message.to
      const cached = this.getValidSessionWebhook(conn, conversationId)

      if (cached) {
        await conn.client.replyViaSessionWebhook(cached, text)
        return { success: true }
      }

      // 兜底：REST API 发送（需要 userId，从 to 中解析）
      if (message.chatType === 'direct') {
        await conn.client.sendSingleMessage(message.to, text)
      } else {
        await conn.client.sendGroupMessage(message.to, text)
      }

      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`[DingTalk] Send message failed: ${msg}`)
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
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  // ============================================
  // WebSocket 接收循环
  // ============================================

  /** 运行 Stream WebSocket 接收器，支持自动重连 */
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
        logger.channel.warn(`[DingTalk] Connection error for ${accountId}: ${msg}`)
      }

      const backoff = healthySession
        ? RECONNECT_BACKOFFS[0]
        : RECONNECT_BACKOFFS[Math.min(attempt, RECONNECT_BACKOFFS.length - 1)]
      attempt = healthySession ? 0 : attempt + 1

      logger.channel.info(`[DingTalk] Reconnecting ${accountId} in ${backoff}ms (attempt ${attempt})`)
      await this.sleep(backoff, signal)
    }
  }

  /** 单次 WebSocket 连接服务 */
  private async serveConnection(accountId: string, signal: AbortSignal): Promise<boolean> {
    const conn = this.connections.get(accountId)
    if (!conn) return false

    let healthySession = false

    try {
      const credential = await conn.client.getStreamCredential()
      const wsUrl = `${credential.endpoint}?ticket=${encodeURIComponent(credential.ticket)}`
      logger.channel.info(`[DingTalk] Connecting to Stream for ${accountId}`)

      const ws = new WebSocket(wsUrl)
      conn.ws = ws

      healthySession = await new Promise<boolean>((resolve, reject) => {
        ws.on('open', () => {
          logger.channel.info(`[DingTalk] Stream WebSocket opened for ${accountId}`)

          // 启动 ping 保活
          if (conn.pingTimer) clearInterval(conn.pingTimer)
          conn.pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.ping()
            }
          }, PING_INTERVAL_MS)
        })

        ws.on('message', (data: WebSocket.Data) => {
          try {
            const msg = JSON.parse(data.toString()) as WSDownMessage
            this.handleStreamMessage(conn, msg)
          } catch (err) {
            logger.channel.error(`[DingTalk] Message parse error: ${err instanceof Error ? err.message : String(err)}`)
          }
        })

        ws.on('close', (code: number, _reason: Buffer) => {
          logger.channel.info(`[DingTalk] Stream WebSocket closed for ${accountId}: code=${code}`)
          if (conn.pingTimer) {
            clearInterval(conn.pingTimer)
            conn.pingTimer = null
          }
          resolve(healthySession)
        })

        ws.on('error', (err: Error) => {
          logger.channel.error(`[DingTalk] Stream WebSocket error for ${accountId}: ${err.message}`)
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

  /** 处理 Stream 推送消息 */
  private handleStreamMessage(conn: DingTalkConnection, msg: WSDownMessage): void {
    // code=200 表示正常推送
    if (msg.code !== 200) {
      logger.channel.warn(`[DingTalk] Stream message code=${msg.code}, message=${msg.message}`)
      return
    }

    const topic = msg.headers?.topic
    if (topic !== TOPIC_BOT_MESSAGE) {
      logger.channel.debug(`[DingTalk] Ignored topic: ${topic}`)
      return
    }

    // 解析消息数据
    try {
      const botMsg = JSON.parse(msg.data) as BotMessageData
      this.dispatchBotMessage(conn, botMsg, msg.headers.messageId)

      // 回复 ACK（通知钉钉已成功接收，避免重复推送）
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
        const ack = JSON.stringify({
          code: 200,
          headers: msg.headers,
          message: 'OK',
          data: msg.headers.messageId,
        })
        conn.ws.send(ack)
      }
    } catch (err) {
      logger.channel.error(`[DingTalk] Bot message parse error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 分发机器人消息 */
  private dispatchBotMessage(conn: DingTalkConnection, botMsg: BotMessageData, messageId: string): void {
    const accountId = conn.accountId
    const isGroup = botMsg.conversationType === '2'
    const chatType = isGroup ? 'group' : 'direct'

    const senderId = botMsg.senderStaffId || botMsg.senderId
    if (!senderId) {
      logger.channel.warn(`[DingTalk] Message missing sender info, skipping`)
      return
    }

    // 提取文本内容
    let text = ''
    if (botMsg.msgtype === 'text' && botMsg.text?.content) {
      text = botMsg.text.content.trim()
    } else if (botMsg.msgtype === 'richText' && botMsg.richText) {
      text = botMsg.richText
        .map(item => item.text || '')
        .filter(Boolean)
        .join(' ')
        .trim()
    } else if (botMsg.content) {
      text = botMsg.content.trim()
    }

    if (!text) {
      logger.channel.debug(`[DingTalk] Empty message from ${senderId}, skipping`)
      return
    }

    // 缓存 sessionWebhook
    if (botMsg.sessionWebhook && botMsg.sessionWebhookExpiredTime) {
      conn.sessionWebhooks.set(botMsg.conversationId, {
        url: botMsg.sessionWebhook,
        expiresAt: botMsg.sessionWebhookExpiredTime,
      })
    }

    const message: InboundMessage = {
      id: messageId || crypto.randomUUID(),
      channelId: 'dingtalk',
      accountId,
      chatType,
      from: senderId,
      fromName: botMsg.senderNick || senderId,
      to: botMsg.conversationId,
      text,
      media: this.toInboundMedia(botMsg),
      timestamp: parseInt(botMsg.createAt, 10) || Date.now(),
      replyToId: botMsg.msgId,
    }

    for (const cb of this.messageCallbacks) cb(message)
  }

  // ============================================
  // 工具方法
  // ============================================

  private toInboundMedia(botMsg: BotMessageData): InboundMedia[] | undefined {
    // 钉钉图片消息需要通过 downloadCode + API 下载，暂不支持
    if (botMsg.msgtype === 'picture' || botMsg.msgtype === 'richText') {
      return undefined
    }
    return undefined
  }

  /** 获取有效的 sessionWebhook */
  private getValidSessionWebhook(conn: DingTalkConnection, conversationId: string): string | null {
    const cached = conn.sessionWebhooks.get(conversationId)
    if (!cached) return null
    if (Date.now() >= cached.expiresAt) {
      conn.sessionWebhooks.delete(conversationId)
      return null
    }
    return cached.url
  }

  private closeConnection(conn: DingTalkConnection): void {
    if (conn.pingTimer) {
      clearInterval(conn.pingTimer)
      conn.pingTimer = null
    }
    if (conn.abortController) {
      conn.abortController.abort()
    }
    if (conn.ws) {
      try { conn.ws.close() } catch { /* ignore */ }
      conn.ws = null
    }
    conn.status = 'disconnected'
    conn.sessionWebhooks.clear()
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

export const dingtalkChannelPlugin = new DingTalkChannelPlugin()
