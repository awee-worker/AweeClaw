import { logger } from '@shared/toolkit/LogEngine'
import { MisskeyClient, type MisskeyNote } from './MisskeyClient'
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

interface MisskeyConnection {
  accountId: string
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  client: MisskeyClient
  selfUserId: string | null
  abortController: AbortController | null
  reconnectAttempts: number
}

/**
 * Misskey 渠道插件
 *
 * 通过 WebSocket Streaming 接入 Misskey 实例，支持：
 * - mention（提及）和 reply（回复）事件接收
 * - Note 创建（发帖/回复）
 * - 消息去重
 * - 自动重连（指数退避）
 * - Reaction 添加
 */
export class MisskeyChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'misskey'
  meta: ChannelMeta = {
    id: 'misskey',
    label: 'Misskey',
    labelZh: 'Misskey',
    description: 'Connect Misskey instance via Streaming API',
    descriptionZh: '通过 Streaming API 接入 Misskey 实例',
    icon: 'MessageCircle',
    connectionModes: ['websocket'],
    defaultConnectionMode: 'websocket',
    capabilities: {
      chatTypes: ['direct', 'group'],
      media: false,
      reactions: true,
      threads: false,
      edit: false,
      streaming: false,
      voice: false,
      files: false,
    },
    order: 11,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'instanceURL',
      label: 'Instance URL',
      labelZh: '实例地址',
      description: 'Misskey instance URL (e.g. https://misskey.io)',
      descriptionZh: 'Misskey 实例地址（如 https://misskey.io）',
      required: true,
      secret: false,
      placeholder: 'https://misskey.io',
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      labelZh: '访问令牌',
      description: 'Misskey Access Token for the bot account',
      descriptionZh: 'Misskey 机器人账号的访问令牌',
      required: true,
      secret: true,
      placeholder: 'AbCdEf1234567890',
    },
  ]

  private connections = new Map<string, MisskeyConnection>()
  private accounts = new Map<string, ChannelAccountConfig>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false

  // ─── 生命周期 ─────────────────────────────────────────────────

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { instanceURL, accessToken } = credentials
    if (!instanceURL || !accessToken) {
      return { valid: false, error: 'Instance URL and Access Token are required' }
    }
    try {
      const client = new MisskeyClient(instanceURL, accessToken)
      const me = await client.getMe()
      if (!me.id) {
        return { valid: false, error: 'Invalid credentials' }
      }
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return

    const { instanceURL, accessToken } = account.credentials
    if (!instanceURL || !accessToken) {
      throw new Error('Misskey Instance URL and Access Token are required')
    }

    try {
      const client = new MisskeyClient(instanceURL, accessToken)

      // 验证凭证
      const me = await client.getMe()

      this.accounts.set(account.id, account)

      const abortController = new AbortController()
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'connected',
        lastConnectedAt: Date.now(),
        lastError: null,
        client,
        selfUserId: me.id,
        abortController,
        reconnectAttempts: 0,
      })

      this.emitStatusChange(account.id)

      // 启动 Streaming 接收
      this.startReceiver(account.id)

      logger.channel.info(`Misskey account ${account.id} connected (bot: @${me.username})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'error',
        lastConnectedAt: null,
        lastError: errorMsg,
        client: new MisskeyClient(instanceURL, accessToken),
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
      conn.client.disconnectStream()
      conn.abortController?.abort()
    }
    this.connections.delete(accountId)
    this.accounts.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`Misskey account ${accountId} disconnected`)
  }

  destroy(): void {
    this.destroyed = true
    for (const conn of this.connections.values()) {
      conn.client.disconnectStream()
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
    if (message.channelId !== 'misskey') {
      return { success: false, error: 'Invalid channel ID' }
    }

    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Misskey account not connected' }
    }

    try {
      const text = message.text || ''
      if (!text.trim()) {
        return { success: false, error: 'Empty message content' }
      }

      // message.to 是 Note ID（回复目标）
      const replyId = message.replyToId || (message.to ? message.to : undefined)
      const visibility = message.chatType === 'direct' ? 'specified' : 'home'

      const result = await conn.client.createNote(text, replyId, visibility)
      return { success: true, messageId: result.createdNote.id }
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

  // ─── Streaming 接收 ───────────────────────────────────────────

  /** 启动消息接收循环 */
  private startReceiver(accountId: string): void {
    const conn = this.connections.get(accountId)
    if (!conn) return

    const signal = conn.abortController?.signal
    if (!signal) return

    this.runReceiver(accountId, signal).catch(err => {
      if (!this.destroyed && signal.aborted === false) {
        logger.channel.error(`[Misskey] Receiver error for ${accountId}: ${err instanceof Error ? err.message : String(err)}`)
        this.scheduleReconnect(accountId)
      }
    })
  }

  /** 运行 Streaming WebSocket 接收循环 */
  private async runReceiver(accountId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.destroyed) {
      const conn = this.connections.get(accountId)
      if (!conn) break

      try {
        await conn.client.connectStream(
          // onNote
          (note, eventType) => this.handleMisskeyNote(accountId, conn, note, eventType),
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
            logger.channel.info(`[Misskey] Streaming connected for ${accountId}`)
          },
          // onError
          (error) => {
            logger.channel.error(`[Misskey] Streaming error for ${accountId}: ${error.message}`)
          },
          signal
        )
      } catch (err) {
        if (signal.aborted || this.destroyed) break

        const errMsg = err instanceof Error ? err.message : String(err)
        logger.channel.warn(`[Misskey] Streaming disconnected for ${accountId}: ${errMsg}`)

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
      logger.channel.error(`[Misskey] Max reconnect attempts reached for ${accountId}`)
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

    logger.channel.info(`[Misskey] Reconnecting ${accountId} in ${delay}ms (attempt ${conn.reconnectAttempts})`)

    const signal = conn.abortController?.signal
    if (!signal) return

    this.delay(delay, signal).then(() => {
      if (!signal.aborted && !this.destroyed) {
        this.startReceiver(accountId)
      }
    })
  }

  // ─── 消息处理 ─────────────────────────────────────────────────

  /** 处理 Misskey Note */
  private handleMisskeyNote(accountId: string, conn: MisskeyConnection, note: MisskeyNote, eventType: 'mention' | 'reply'): void {
    // 消息去重
    if (conn.client.isDuplicate(accountId, note.id)) return

    let text = (note.text || '').trim()
    if (!text) return

    // 移除 @bot 提及
    text = conn.client.stripBotMention(text)
    if (!text) return

    const chatType = MisskeyClient.getChatType(note.visibility)
    const isMentioned = conn.client.isMentioned(note)
    const fromName = note.user.name || note.user.username

    const message: InboundMessage = {
      id: note.id,
      channelId: 'misskey',
      accountId,
      chatType,
      from: note.userId,
      fromName,
      to: note.userId,
      text,
      timestamp: Date.now(),
      replyToId: note.replyId || undefined,
      raw: {
        eventType,
        isMentioned,
        visibility: note.visibility,
        username: note.user.username,
        host: note.user.host,
        renoteId: note.renoteId,
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

export const misskeyChannelPlugin = new MisskeyChannelPlugin()
