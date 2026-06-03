import { logger } from '@shared/toolkit/LogEngine'
import { DiscordClient, type DiscordMessage } from './DiscordClient'
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

interface DiscordConnection {
  accountId: string
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  client: DiscordClient
  selfUserId: string | null
  abortController: AbortController | null
  reconnectAttempts: number
}

/**
 * Discord 渠道插件
 *
 * 通过 Gateway WebSocket 接入 Discord，支持：
 * - DM 私聊、服务器频道消息
 * - @机器人提及、回复 bot 消息
 * - 文本消息发送
 * - 消息去重
 * - 自动重连（指数退避）
 * - Resume 断线恢复
 */
export class DiscordChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'discord'
  meta: ChannelMeta = {
    id: 'discord',
    label: 'Discord',
    labelZh: 'Discord',
    description: 'Connect Discord Bot via Gateway',
    descriptionZh: '通过 Gateway 接入 Discord 机器人',
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
    order: 9,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'botToken',
      label: 'Bot Token',
      labelZh: '机器人令牌',
      description: 'Discord Bot Token from Developer Portal',
      descriptionZh: 'Discord 开发者门户获取的机器人令牌',
      required: true,
      secret: true,
      placeholder: 'MTIzNDU2Nzg5MDEy...',
    },
  ]

  private connections = new Map<string, DiscordConnection>()
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
      const client = new DiscordClient(botToken)
      const user = await client.getSelfUser()
      if (!user.id) {
        return { valid: false, error: 'Invalid Bot Token' }
      }
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return

    const { botToken } = account.credentials
    if (!botToken) {
      throw new Error('Discord Bot Token is required')
    }

    try {
      const client = new DiscordClient(botToken)

      // 验证凭证并获取 bot 信息
      const selfUser = await client.getSelfUser()

      this.accounts.set(account.id, account)

      const abortController = new AbortController()
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'connected',
        lastConnectedAt: Date.now(),
        lastError: null,
        client,
        selfUserId: selfUser.id,
        abortController,
        reconnectAttempts: 0,
      })

      this.emitStatusChange(account.id)

      // 启动 Gateway 接收循环
      this.startReceiver(account.id)

      logger.channel.info(`Discord account ${account.id} connected (bot: ${selfUser.username}#${selfUser.discriminator})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'error',
        lastConnectedAt: null,
        lastError: errorMsg,
        client: new DiscordClient(botToken),
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
    if (conn) {
      conn.client.disconnectGateway()
      conn.abortController?.abort()
    }
    this.connections.delete(accountId)
    this.accounts.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`Discord account ${accountId} disconnected`)
  }

  destroy(): void {
    this.destroyed = true
    for (const conn of this.connections.values()) {
      conn.client.disconnectGateway()
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
    if (message.channelId !== 'discord') {
      return { success: false, error: 'Invalid channel ID' }
    }

    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Discord account not connected' }
    }

    try {
      const text = message.text || ''
      if (!text.trim()) {
        return { success: false, error: 'Empty message content' }
      }

      // message.to 是频道 ID
      let channel = message.to

      // 如果 to 看起来像用户 ID（纯数字），需要先创建 DM
      if (/^\d+$/.test(channel) && message.chatType === 'direct') {
        const dmChannel = await conn.client.createDM(channel)
        if (dmChannel) {
          channel = dmChannel
        }
      }

      // 回复消息
      const messageReference = message.replyToId
        ? { message_id: message.replyToId }
        : undefined

      const result = await conn.client.createMessage(channel, text, messageReference)
      return { success: true, messageId: result.id }
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

  // ─── Gateway 接收 ─────────────────────────────────────────────

  /** 启动消息接收循环 */
  private startReceiver(accountId: string): void {
    const conn = this.connections.get(accountId)
    if (!conn) return

    const signal = conn.abortController?.signal
    if (!signal) return

    this.runReceiver(accountId, signal).catch(err => {
      if (!this.destroyed && signal.aborted === false) {
        logger.channel.error(`[Discord] Receiver error for ${accountId}: ${err instanceof Error ? err.message : String(err)}`)
        this.scheduleReconnect(accountId)
      }
    })
  }

  /** 运行 Gateway WebSocket 接收循环 */
  private async runReceiver(accountId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.destroyed) {
      const conn = this.connections.get(accountId)
      if (!conn) break

      try {
        await conn.client.connectGateway(
          // onMessage
          (msg) => this.handleDiscordMessage(accountId, conn, msg),
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
            logger.channel.info(`[Discord] Gateway connected for ${accountId}`)
          },
          // onError
          (error) => {
            logger.channel.error(`[Discord] Gateway error for ${accountId}: ${error.message}`)
          },
          signal
        )
      } catch (err) {
        if (signal.aborted || this.destroyed) break

        const errMsg = err instanceof Error ? err.message : String(err)
        logger.channel.warn(`[Discord] Gateway disconnected for ${accountId}: ${errMsg}`)

        const c = this.connections.get(accountId)
        if (c) {
          c.status = 'error'
          c.lastError = errMsg
          this.emitStatusChange(accountId)
        }

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
      logger.channel.error(`[Discord] Max reconnect attempts reached for ${accountId}`)
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

    logger.channel.info(`[Discord] Reconnecting ${accountId} in ${delay}ms (attempt ${conn.reconnectAttempts})`)

    const signal = conn.abortController?.signal
    if (!signal) return

    this.delay(delay, signal).then(() => {
      if (!signal.aborted && !this.destroyed) {
        this.startReceiver(accountId)
      }
    })
  }

  // ─── 消息处理 ─────────────────────────────────────────────────

  /** 处理 Discord 消息 */
  private handleDiscordMessage(accountId: string, conn: DiscordConnection, msg: DiscordMessage): void {
    // 过滤 bot 消息和自身消息
    if (msg.author?.bot) return
    if (!msg.author || msg.author.id === conn.selfUserId) return

    const text = (msg.content || '').trim()
    if (!text) return

    // 消息去重
    if (conn.client.isDuplicate(accountId, msg.id)) return

    const chatType = DiscordClient.getChatType(msg.guild_id)
    const isMentioned = conn.client.isBotMentioned(msg)
    const isReplyToBot = conn.client.isReplyToBot(msg)

    const message: InboundMessage = {
      id: msg.id,
      channelId: 'discord',
      accountId,
      chatType,
      from: msg.author.id,
      fromName: msg.author.username,
      to: msg.channel_id,
      text,
      timestamp: Date.now(),
      replyToId: msg.referenced_message?.id || undefined,
      raw: {
        guildId: msg.guild_id,
        isMentioned,
        isReplyToBot,
        discriminator: msg.author.discriminator,
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

export const discordChannelPlugin = new DiscordChannelPlugin()
