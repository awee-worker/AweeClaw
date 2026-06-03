import { logger } from '@shared/toolkit/LogEngine'
import { TelegramClient, type TelegramUpdate, type TelegramMessage } from './TelegramClient'
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

interface TelegramConnection {
  accountId: string
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  client: TelegramClient
  selfUserId: number | null
  abortController: AbortController | null
  reconnectAttempts: number
}

/**
 * Telegram 渠道插件
 *
 * 通过 Long Polling 接入 Telegram Bot API，支持：
 * - 私聊、群组、超级群组消息
 * - @bot 提及、回复 bot 消息
 * - 文本消息发送（Markdown + 纯文本降级）
 * - 消息去重
 * - 自动重连（指数退避）
 * - 自定义 API Base URL（反代场景）
 */
export class TelegramChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'telegram'
  meta: ChannelMeta = {
    id: 'telegram',
    label: 'Telegram',
    labelZh: 'Telegram',
    description: 'Connect Telegram Bot via Long Polling',
    descriptionZh: '通过 Long Polling 接入 Telegram 机器人',
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
    order: 10,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'botToken',
      label: 'Bot Token',
      labelZh: '机器人令牌',
      description: 'Telegram Bot API Token from @BotFather',
      descriptionZh: '从 @BotFather 获取的 Telegram 机器人 API 令牌',
      required: true,
      secret: true,
      placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    },
    {
      key: 'apiBaseURL',
      label: 'API Base URL',
      labelZh: 'API 基础地址',
      description: 'Custom API base URL for reverse proxy (optional)',
      descriptionZh: '自定义 API 基础地址，用于反代场景（可选）',
      required: false,
      secret: false,
      placeholder: 'https://api.telegram.org',
    },
  ]

  private connections = new Map<string, TelegramConnection>()
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
      const client = new TelegramClient(botToken, credentials.apiBaseURL)
      const user = await client.getMe()
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

    const { botToken, apiBaseURL } = account.credentials
    if (!botToken) {
      throw new Error('Telegram Bot Token is required')
    }

    try {
      const client = new TelegramClient(botToken, apiBaseURL)

      // 验证凭证
      const selfUser = await client.getMe()

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

      // 启动 Long Polling
      this.startPolling(account.id)

      logger.channel.info(`Telegram account ${account.id} connected (bot: @${selfUser.username || selfUser.first_name})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'error',
        lastConnectedAt: null,
        lastError: errorMsg,
        client: new TelegramClient(botToken, apiBaseURL),
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
      conn.client.stopPolling()
      conn.abortController?.abort()
    }
    this.connections.delete(accountId)
    this.accounts.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`Telegram account ${accountId} disconnected`)
  }

  destroy(): void {
    this.destroyed = true
    for (const conn of this.connections.values()) {
      conn.client.stopPolling()
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
    if (message.channelId !== 'telegram') {
      return { success: false, error: 'Invalid channel ID' }
    }

    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Telegram account not connected' }
    }

    try {
      const text = message.text || ''
      if (!text.trim()) {
        return { success: false, error: 'Empty message content' }
      }

      // message.to 是 chat_id
      const chatId = message.to
      const replyToMessageId = message.replyToId ? parseInt(message.replyToId, 10) : undefined

      const result = await conn.client.sendMessage(chatId, text, replyToMessageId)
      return { success: true, messageId: String(result.message_id) }
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

  // ─── Long Polling 接收 ────────────────────────────────────────

  /** 启动 Polling */
  private startPolling(accountId: string): void {
    const conn = this.connections.get(accountId)
    if (!conn) return

    const signal = conn.abortController?.signal
    if (!signal) return

    conn.client.startPolling(
      // onUpdate
      (update) => this.handleTelegramUpdate(accountId, conn, update),
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
        logger.channel.info(`[Telegram] Polling connected for ${accountId}`)
      },
      // onError
      (error) => {
        logger.channel.error(`[Telegram] Polling error for ${accountId}: ${error.message}`)
        const c = this.connections.get(accountId)
        if (c) {
          c.status = 'error'
          c.lastError = error.message
          this.emitStatusChange(accountId)
        }
        this.scheduleReconnect(accountId)
      },
      signal
    )
  }

  /** 调度重连 */
  private scheduleReconnect(accountId: string): void {
    const conn = this.connections.get(accountId)
    if (!conn || this.destroyed) return

    if (conn.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      logger.channel.error(`[Telegram] Max reconnect attempts reached for ${accountId}`)
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

    logger.channel.info(`[Telegram] Reconnecting ${accountId} in ${delay}ms (attempt ${conn.reconnectAttempts})`)

    const signal = conn.abortController?.signal
    if (!signal) return

    this.delay(delay, signal).then(() => {
      if (!signal.aborted && !this.destroyed) {
        this.startPolling(accountId)
      }
    })
  }

  // ─── 消息处理 ─────────────────────────────────────────────────

  /** 处理 Telegram Update */
  private handleTelegramUpdate(accountId: string, conn: TelegramConnection, update: TelegramUpdate): void {
    // 消息去重
    if (conn.client.isDuplicate(accountId, update.update_id)) return

    // 处理普通消息
    if (update.message) {
      this.handleMessage(accountId, conn, update.message)
      return
    }

    // 处理回调查询（按钮点击等）
    if (update.callback_query?.message) {
      this.handleMessage(accountId, conn, update.callback_query.message)
      return
    }
  }

  /** 处理 Telegram 消息 */
  private handleMessage(accountId: string, conn: TelegramConnection, msg: TelegramMessage): void {
    // 过滤 bot 消息和自身消息
    if (msg.from?.is_bot) return
    if (conn.selfUserId && msg.from?.id === conn.selfUserId) return

    const text = TelegramClient.extractText(msg)
    if (!text) return

    const chatType = TelegramClient.getChatType(msg.chat.type)
    const isMentioned = conn.client.isBotMentioned(msg)
    const isReplyToBot = conn.client.isReplyToBot(msg)

    const message: InboundMessage = {
      id: String(msg.message_id),
      channelId: 'telegram',
      accountId,
      chatType,
      from: String(msg.from?.id || ''),
      fromName: msg.from?.username || msg.from?.first_name || '',
      to: String(msg.chat.id),
      text,
      timestamp: msg.date * 1000,
      replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      raw: {
        chatType: msg.chat.type,
        chatTitle: msg.chat.title,
        chatUsername: msg.chat.username,
        isMentioned,
        isReplyToBot,
        mediaGroupId: msg.media_group_id,
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

export const telegramChannelPlugin = new TelegramChannelPlugin()
