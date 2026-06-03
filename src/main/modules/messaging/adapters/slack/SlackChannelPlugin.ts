import { logger } from '@shared/toolkit/LogEngine'
import { SlackClient, type SlackEvent } from './SlackClient'
import type {
  ChannelId,
  ChannelPlugin,
  ChannelMeta,
  ChannelSecretSchema,
  ChannelAccountConfig,
  ChannelAccountSnapshot,
  InboundMessage,
  OutboundMessage,
  OutboundResult,
  ChannelEvent,
  ChannelStatus,
} from '@shared/protocols/channel'

/** 重连配置 */
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 60000
const RECONNECT_MAX_ATTEMPTS = 20

interface SlackConnection {
  accountId: string
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  client: SlackClient
  selfUserId: string | null
  abortController: AbortController | null
  reconnectAttempts: number
}

/**
 * Slack 渠道插件
 *
 * 通过 Socket Mode 接入 Slack，支持：
 * - DM、频道消息、线程回复
 * - @机器人提及
 * - 文本消息发送
 * - 消息去重
 * - 自动重连（指数退避）
 */
export class SlackChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'slack'
  meta: ChannelMeta = {
    id: 'slack',
    label: 'Slack',
    labelZh: 'Slack',
    description: 'Connect Slack Bot via Socket Mode',
    descriptionZh: '通过 Socket Mode 接入 Slack 机器人',
    icon: 'MessageCircle',
    connectionModes: ['websocket'],
    defaultConnectionMode: 'websocket',
    capabilities: {
      chatTypes: ['direct', 'group'],
      media: false,
      reactions: false,
      threads: true,
      edit: false,
      streaming: false,
      voice: false,
      files: false,
    },
    order: 8,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'botToken',
      label: 'Bot Token',
      labelZh: 'Bot 用户 OAuth 令牌',
      description: 'Slack Bot User OAuth Token (xoxb-...)',
      descriptionZh: 'Slack Bot 用户 OAuth 令牌（xoxb-...）',
      required: true,
      secret: true,
      placeholder: 'xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx',
    },
    {
      key: 'appToken',
      label: 'App-Level Token',
      labelZh: '应用级令牌',
      description: 'Slack App-Level Token for Socket Mode (xapp-...)',
      descriptionZh: 'Slack 应用级令牌，用于 Socket Mode（xapp-...）',
      required: true,
      secret: true,
      placeholder: 'xapp-1-xxxxxxxxxxxx',
    },
  ]

  private connections = new Map<string, SlackConnection>()
  private accounts = new Map<string, ChannelAccountConfig>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false

  // ─── 生命周期 ─────────────────────────────────────────────────

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { botToken } = credentials
    if (!botToken) {
      return { valid: false, error: 'Bot Token is required' }
    }
    try {
      const client = new SlackClient(botToken, credentials.appToken || '')
      const result = await client.authTest()
      if (!result.ok) {
        return { valid: false, error: result.error || 'Auth test failed' }
      }
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return

    const { botToken, appToken } = account.credentials
    if (!botToken || !appToken) {
      throw new Error('Slack Bot Token and App-Level Token are required')
    }

    try {
      const client = new SlackClient(botToken, appToken)

      // 验证凭证
      const authResult = await client.authTest()
      if (!authResult.ok) {
        throw new Error(`Slack auth test failed: ${authResult.error || 'unknown error'}`)
      }

      const selfUserId = authResult.user_id || null
      this.accounts.set(account.id, account)

      const abortController = new AbortController()
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'connected',
        lastConnectedAt: Date.now(),
        lastError: null,
        client,
        selfUserId,
        abortController,
        reconnectAttempts: 0,
      })

      this.emitStatusChange(account.id)

      // 启动 Socket Mode 接收循环
      this.startReceiver(account.id)

      logger.channel.info(`Slack account ${account.id} connected (bot: ${authResult.user || 'unknown'})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'error',
        lastConnectedAt: null,
        lastError: errorMsg,
        client: new SlackClient(botToken, appToken),
        selfUserId: null,
        abortController: null,
        reconnectAttempts: 0,
      })
      this.emitStatusChange(account.id)
      throw err
    }
  }

  async disconnect(accountId: string): Promise<void> {
    const conn = this.connections.get(accountId)
    if (conn?.abortController) {
      conn.abortController.abort()
    }
    this.connections.delete(accountId)
    this.accounts.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`Slack account ${accountId} disconnected`)
  }

  destroy(): void {
    this.destroyed = true
    for (const conn of this.connections.values()) {
      conn.abortController?.abort()
    }
    this.connections.clear()
    this.accounts.clear()
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  // ─── 消息发送 ─────────────────────────────────────────────────

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    if (message.channelId !== 'slack') {
      return { success: false, error: 'Invalid channel ID' }
    }

    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Slack account not connected' }
    }

    try {
      const text = message.text || ''
      if (!text.trim()) {
        return { success: false, error: 'Empty message content' }
      }

      // message.to 可能是频道 ID 或用户 ID
      let channel = message.to

      // 如果 to 看起来像用户 ID（以 U 开头），需要先打开 DM
      if (channel.startsWith('U') && message.chatType === 'direct') {
        const dmChannel = await conn.client.openConversation(channel)
        if (dmChannel) {
          channel = dmChannel
        }
      }

      // 线程回复
      const threadTs = message.replyToId || undefined

      const result = await conn.client.postMessage(channel, text, threadTs)
      if (!result.ok) {
        return { success: false, error: result.error || 'Failed to send message' }
      }

      return { success: true, messageId: result.ts }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  // ─── 状态与回调 ───────────────────────────────────────────────

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

  // ─── Socket Mode 接收 ────────────────────────────────────────

  /** 启动消息接收循环 */
  private startReceiver(accountId: string): void {
    const conn = this.connections.get(accountId)
    if (!conn) return

    const signal = conn.abortController?.signal
    if (!signal) return

    this.runReceiver(accountId, signal).catch(err => {
      if (!this.destroyed && signal.aborted === false) {
        logger.channel.error(`[Slack] Receiver error for ${accountId}: ${err instanceof Error ? err.message : String(err)}`)
        this.scheduleReconnect(accountId)
      }
    })
  }

  /** 运行 WebSocket 接收循环 */
  private async runReceiver(accountId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.destroyed) {
      const conn = this.connections.get(accountId)
      if (!conn) break

      try {
        await conn.client.connectSocketMode(
          // onMessage
          (event) => this.handleSlackEvent(accountId, event),
          // onConnected
          () => {
            const c = this.connections.get(accountId)
            if (c) {
              c.reconnectAttempts = 0
              c.status = 'connected'
              c.lastConnectedAt = Date.now()
              c.lastError = null
              this.emitStatusChange(accountId)
            }
            logger.channel.info(`[Slack] Socket Mode connected for ${accountId}`)
          },
          // onError
          (error) => {
            logger.channel.error(`[Slack] Socket Mode error for ${accountId}: ${error.message}`)
          },
          signal
        )
      } catch (err) {
        if (signal.aborted || this.destroyed) break

        const errMsg = err instanceof Error ? err.message : String(err)
        logger.channel.warn(`[Slack] Socket Mode disconnected for ${accountId}: ${errMsg}`)

        // 更新连接状态
        const c = this.connections.get(accountId)
        if (c) {
          c.status = 'error'
          c.lastError = errMsg
          this.emitStatusChange(accountId)
        }

        // 等待后重连
        if (!signal.aborted) {
          await this.delay(RECONNECT_BASE_DELAY_MS, signal)
        }
      }
    }
  }

  /** 调度重连 */
  private scheduleReconnect(accountId: string): void {
    const conn = this.connections.get(accountId)
    if (!conn || this.destroyed) return

    if (conn.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      logger.channel.error(`[Slack] Max reconnect attempts reached for ${accountId}`)
      conn.status = 'error'
      conn.lastError = 'Max reconnect attempts reached'
      this.emitStatusChange(accountId)
      return
    }

    conn.reconnectAttempts++
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, conn.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    )

    logger.channel.info(`[Slack] Reconnecting ${accountId} in ${delay}ms (attempt ${conn.reconnectAttempts})`)

    const signal = conn.abortController?.signal
    if (!signal) return

    this.delay(delay, signal).then(() => {
      if (!signal.aborted && !this.destroyed) {
        this.startReceiver(accountId)
      }
    })
  }

  // ─── 事件处理 ─────────────────────────────────────────────────

  /** 处理 Slack 事件 */
  private async handleSlackEvent(accountId: string, event: SlackEvent): Promise<void> {
    const conn = this.connections.get(accountId)
    if (!conn) return

    const eventType = event.type

    // 消息事件
    if (eventType === 'message') {
      this.handleMessageEvent(accountId, conn, event)
      return
    }

    // @机器人提及事件
    if (eventType === 'app_mention') {
      this.handleAppMentionEvent(accountId, conn, event)
      return
    }
  }

  /** 处理普通消息事件 */
  private async handleMessageEvent(accountId: string, conn: SlackConnection, event: SlackEvent): Promise<void> {
    // 过滤 bot 消息和自身消息
    if (event.bot_id || !event.user || event.user === conn.selfUserId) return

    // 过滤非普通消息子类型
    if (event.subtype && event.subtype !== 'file_share') return

    const text = (event.text || '').trim()
    if (!text) return

    // 消息去重
    if (conn.client.isDuplicate(accountId, event.ts || '')) return

    const chatType = SlackClient.getChatType(event.channel_type)
    const fromName = await conn.client.getUserDisplayName(event.user)
    const channelInfo = await conn.client.getConversationInfo(event.channel || '')
    const isMentioned = conn.selfUserId ? text.includes(`<@${conn.selfUserId}>`) : false

    const message: InboundMessage = {
      id: event.ts || crypto.randomUUID(),
      channelId: 'slack',
      accountId,
      chatType,
      from: event.user,
      fromName,
      to: event.channel || '',
      text,
      timestamp: Date.now(),
      replyToId: event.thread_ts || undefined,
      raw: {
        channelType: event.channel_type,
        channelName: channelInfo?.name,
        isMentioned,
        threadTs: event.thread_ts,
        subtype: event.subtype,
      },
    }

    for (const cb of this.messageCallbacks) cb(message)
  }

  /** 处理 @机器人提及事件 */
  private async handleAppMentionEvent(accountId: string, conn: SlackConnection, event: SlackEvent): Promise<void> {
    if (event.bot_id || !event.user) return

    const text = (event.text || '').trim()
    if (!text) return

    // 消息去重
    if (conn.client.isDuplicate(accountId, event.ts || '')) return

    const fromName = await conn.client.getUserDisplayName(event.user)
    const channelInfo = await conn.client.getConversationInfo(event.channel || '')

    const message: InboundMessage = {
      id: event.ts || crypto.randomUUID(),
      channelId: 'slack',
      accountId,
      chatType: 'group',
      from: event.user,
      fromName,
      to: event.channel || '',
      text,
      timestamp: Date.now(),
      replyToId: event.thread_ts || undefined,
      raw: {
        channelName: channelInfo?.name,
        isMentioned: true,
        threadTs: event.thread_ts,
      },
    }

    for (const cb of this.messageCallbacks) cb(message)
  }

  // ─── 工具方法 ─────────────────────────────────────────────────

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }

  private emitStatusChange(accountId: string): void {
    const snapshot = this.getStatus(accountId)
    for (const cb of this.statusCallbacks) cb(snapshot)
  }
}

export const slackChannelPlugin = new SlackChannelPlugin()
