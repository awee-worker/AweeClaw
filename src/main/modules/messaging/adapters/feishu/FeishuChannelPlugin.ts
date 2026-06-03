import * as fs from 'fs'
import * as path from 'path'
import * as Lark from '@larksuiteoapi/node-sdk'
import { logger } from '@shared/toolkit/LogEngine'
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
  OutboundMedia,
  OutboundResult,
  ChannelEvent,
  ChatType,
  ChannelStatus,
} from '@shared/protocols/channel'

interface FeishuConnection {
  accountId: string
  channel: Lark.LarkChannel
  client: Lark.Client
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  activeReactions: Map<string, string>
}

export class FeishuChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'feishu'
  meta: ChannelMeta = {
    id: 'feishu',
    label: 'Feishu / Lark',
    labelZh: '飞书',
    description: 'Integrate with Feishu/Lark for messaging and notifications',
    descriptionZh: '集成飞书/Lark，实现消息通知和交互',
    icon: 'MessageCircle',
    connectionModes: ['websocket', 'webhook'],
    defaultConnectionMode: 'websocket',
    capabilities: {
      chatTypes: ['direct', 'group'],
      media: true,
      reactions: true,
      threads: true,
      edit: true,
      streaming: true,
      voice: false,
      files: true,
    },
    order: 6,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'appId',
      label: 'App ID',
      labelZh: '应用ID',
      description: 'Feishu application App ID',
      descriptionZh: '飞书自建应用的 App ID',
      required: true,
      secret: false,
      placeholder: 'cli_xxxxxxxx',
    },
    {
      key: 'appSecret',
      label: 'App Secret',
      labelZh: '应用密钥',
      description: 'Feishu application App Secret',
      descriptionZh: '飞书自建应用的 App Secret',
      required: true,
      secret: true,
      placeholder: 'xxxxxxxxxx',
    },
    {
      key: 'encryptKey',
      label: 'Encrypt Key',
      labelZh: '加密密钥',
      description: 'Event subscription encrypt key (optional)',
      descriptionZh: '事件订阅加密密钥（可选）',
      required: false,
      secret: true,
    },
    {
      key: 'verificationToken',
      label: 'Verification Token',
      labelZh: '验证令牌',
      description: 'Event subscription verification token (optional for webhook mode)',
      descriptionZh: '事件订阅验证令牌（Webhook模式可选）',
      required: false,
      secret: true,
    },
  ]

  private connections = new Map<string, FeishuConnection>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false
  private accounts = new Map<string, ChannelAccountConfig>()
  private userNameCache = new Map<string, string>()

  registerAccount(account: ChannelAccountConfig): void {
    this.accounts.set(account.id, account)
  }

  unregisterAccount(accountId: string): void {
    this.accounts.delete(accountId)
  }

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { appId, appSecret } = credentials
    if (!appId || !appSecret) {
      return { valid: false, error: 'App ID and App Secret are required' }
    }
    try {
      const client = new Lark.Client({ appId, appSecret })
      await client.im.v1.message.listWithIterator({
        params: { container_id_type: 'chat', container_id: '', page_size: 1 },
      })
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return
    const { appId, appSecret } = account.credentials
    if (!appId || !appSecret) {
      throw new Error('Feishu App ID and App Secret are required')
    }

    this.accounts.set(account.id, account)

    const existing = this.connections.get(account.id)
    if (existing) {
      try { existing.channel.disconnect() } catch { /* ignore */ }
      this.connections.delete(account.id)
    }

    try {
      const requireMention = account.groupPolicy !== 'open'
      const client = new Lark.Client({ appId, appSecret })

      const channel = Lark.createLarkChannel({
        appId,
        appSecret,
        loggerLevel: Lark.LoggerLevel.warn,
        policy: {
          dmMode: 'open',
          requireMention,
        },
        safety: {
          dedup: { ttl: 60000, maxEntries: 1000 },
          batch: {
            text: { delayMs: 2000, maxMessages: 5, maxChars: 2000 },
          },
          staleMessageWindowMs: 300000,
        },
        outbound: {
          streamThrottleMs: 200,
          streamInitialText: '...',
          retry: { maxAttempts: 2, baseDelayMs: 1000 },
        },
      })

      const accountId = account.id
      const self = this

      channel.on({
        message: async (msg: Lark.NormalizedMessage) => {
          try {
            if (!msg.senderName && msg.senderId) {
              await self.resolveSenderName(accountId, msg.senderId)
            }
            const inbound = self.normalizeMessage(accountId, msg)
            if (inbound) {
              for (const cb of self.messageCallbacks) cb(inbound)
            }
          } catch (err) {
            logger.channel.error(`[Feishu] Message normalize error: ${err}`)
          }
        },
        reconnecting: () => {
          const conn = self.connections.get(accountId)
          if (conn) {
            conn.status = 'connecting'
            conn.lastError = 'Reconnecting...'
            self.emitStatusChange(accountId)
          }
          logger.channel.warn(`[Feishu] Account ${accountId} reconnecting`)
        },
        reconnected: () => {
          const conn = self.connections.get(accountId)
          if (conn) {
            conn.status = 'connected'
            conn.lastConnectedAt = Date.now()
            conn.lastError = null
            self.emitStatusChange(accountId)
          }
          logger.channel.info(`[Feishu] Account ${accountId} reconnected`)
        },
        error: (err: Lark.LarkChannelError) => {
          logger.channel.error(`[Feishu] Channel error: ${err.code} - ${err.message}`)
          const conn = self.connections.get(accountId)
          if (conn) {
            conn.lastError = err.message
            self.emitStatusChange(accountId)
          }
        },
      })

      await channel.connect()

      this.connections.set(account.id, {
        accountId,
        channel,
        client,
        status: 'connected',
        lastConnectedAt: Date.now(),
        lastError: null,
        activeReactions: new Map(),
      })
      this.emitStatusChange(account.id)
      logger.channel.info(`[Feishu] Account ${account.id} connected`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.connections.set(account.id, {
        accountId: account.id,
        channel: null as any,
        client: null as any,
        status: 'error',
        lastConnectedAt: null,
        lastError: errorMsg,
        activeReactions: new Map(),
      })
      this.emitStatusChange(account.id)
      throw err
    }
  }

  async disconnect(accountId: string): Promise<void> {
    const conn = this.connections.get(accountId)
    if (conn) {
      try { conn.channel.disconnect() } catch { /* ignore */ }
    }
    this.connections.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`[Feishu] Account ${accountId} disconnected`)
  }

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    if (message.channelId !== 'feishu') {
      return { success: false, error: 'Invalid channel ID' }
    }
    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Feishu account not connected' }
    }

    try {
      const sendOpts: Lark.SendOptions = {}
      if (message.replyToId) {
        sendOpts.replyTo = message.replyToId
      }

      if (message.media && message.media.length > 0) {
        const results: OutboundResult[] = []
        if (message.text) {
          const textResult = await conn.channel.send(message.to, { markdown: message.text }, sendOpts)
          results.push({ success: true, messageId: textResult.messageId })
        }
        for (const media of message.media) {
          const mediaResult = await this.sendMedia(conn, message.to, media, sendOpts)
          results.push(mediaResult)
        }
        const failed = results.find(r => !r.success)
        if (failed) return failed
        return { success: true, messageId: results.map(r => r.messageId).filter(Boolean).join(',') }
      }

      const text = message.text || ''
      const result = await conn.channel.send(message.to, { markdown: text }, sendOpts)

      return { success: true, messageId: result.messageId }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  private async sendMedia(
    conn: FeishuConnection,
    to: string,
    media: OutboundMedia,
    sendOpts: Lark.SendOptions
  ): Promise<OutboundResult> {
    try {
      let source: string | Buffer

      if (media.buffer) {
        source = media.buffer
      } else if (media.localPath) {
        const resolved = path.resolve(media.localPath)
        if (!fs.existsSync(resolved)) {
          return { success: false, error: `File not found: ${media.localPath}` }
        }
        source = resolved
      } else if (media.url) {
        const response = await fetch(media.url)
        if (!response.ok) {
          return { success: false, error: `Failed to download file from URL: ${response.status}` }
        }
        source = Buffer.from(await response.arrayBuffer())
      } else {
        return { success: false, error: 'Media must have buffer, localPath, or url' }
      }

      const fileName = media.fileName || (media.localPath ? path.basename(media.localPath) : 'file')

      let sendInput: Lark.SendInput
      switch (media.type) {
        case 'image':
          sendInput = { image: { source } }
          break
        case 'file':
          sendInput = { file: { source, fileName } }
          break
        case 'audio':
          sendInput = { audio: { source } }
          break
        case 'video':
          sendInput = { video: { source } }
          break
        default:
          return { success: false, error: `Unsupported media type: ${media.type}` }
      }

      const result = await conn.channel.send(to, sendInput, sendOpts)
      return { success: true, messageId: result.messageId }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  async addReaction(accountId: string, messageId: string, emoji: string): Promise<string | null> {
    const conn = this.connections.get(accountId)
    if (!conn || conn.status !== 'connected') return null
    try {
      const reactionId = await conn.channel.addReaction(messageId, emoji)
      conn.activeReactions.set(messageId, reactionId)
      return reactionId
    } catch (err) {
      logger.channel.warn(`[Feishu] addReaction failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  async removeReaction(accountId: string, messageId: string, emoji: string): Promise<void> {
    const conn = this.connections.get(accountId)
    if (!conn || conn.status !== 'connected') return
    try {
      await conn.channel.removeReactionByEmoji(messageId, emoji)
      conn.activeReactions.delete(messageId)
    } catch (err) {
      logger.channel.warn(`[Feishu] removeReaction failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async streamReply(
    accountId: string,
    to: string,
    producer: (controller: Lark.MarkdownStreamController) => Promise<void>,
    replyToId?: string
  ): Promise<OutboundResult> {
    const conn = this.connections.get(accountId)
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Feishu account not connected' }
    }

    try {
      const sendOpts: Lark.SendOptions = {}
      if (replyToId) {
        sendOpts.replyTo = replyToId
      }

      const result = await conn.channel.stream(to, {
        markdown: producer as Lark.MarkdownStreamProducer,
      }, sendOpts)

      return { success: true, messageId: result.messageId }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
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
      try { conn.channel.disconnect() } catch { /* ignore */ }
    }
    this.connections.clear()
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  handleWebhookEvent(_accountId: string, _body: unknown): void {
    if (this.destroyed) return
  }

  verifyWebhookSignature(_encryptKey: string, _timestamp: string, _nonce: string, _body: string, _signature: string): boolean {
    return false
  }

  private normalizeMessage(accountId: string, msg: Lark.NormalizedMessage): InboundMessage | null {
    if (!msg.messageId || !msg.senderId) return null

    const chatType: ChatType = msg.chatType === 'group' ? 'group' : 'direct'
    const senderName = msg.senderName || this.userNameCache.get(msg.senderId)

    return {
      id: msg.messageId,
      channelId: 'feishu',
      accountId,
      chatType,
      from: msg.senderId,
      fromName: senderName,
      to: msg.chatId,
      text: msg.content || '',
      media: msg.resources?.length > 0
        ? msg.resources.map(r => ({
          type: r.type as InboundMedia['type'],
          fileName: r.fileName,
        }))
        : undefined,
      replyToId: msg.replyToMessageId,
      threadId: msg.rootId || msg.threadId,
      timestamp: msg.createTime || Date.now(),
      raw: msg.raw,
    }
  }

  async resolveSenderName(accountId: string, openId: string): Promise<string | null> {
    const cached = this.userNameCache.get(openId)
    if (cached) return cached
    const conn = this.connections.get(accountId)
    if (!conn?.client) return null
    try {
      const resp = await conn.client.contact.v3.user.get({
        path: { user_id: openId },
        params: { user_id_type: 'open_id' },
      })
      const name = (resp as any)?.data?.user?.name
      if (name) {
        this.userNameCache.set(openId, name)
        return name
      }
    } catch (err) {
      logger.channel.warn(`[Feishu] resolveSenderName failed for ${openId}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return null
  }

  private emitStatusChange(accountId: string): void {
    const snapshot = this.getStatus(accountId)
    for (const cb of this.statusCallbacks) cb(snapshot)
  }
}

export const feishuChannelPlugin = new FeishuChannelPlugin()
