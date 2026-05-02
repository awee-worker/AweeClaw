import * as crypto from 'crypto'
import { logger } from '@shared/utils/Logger'
import type {
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
  ChatType,
  ChannelStatus,
} from '@shared/types/channel'

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

interface FeishuTokenCache {
  accessToken: string
  expiresAt: number
}

interface FeishuWsConnection {
  accountId: string
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
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
      streaming: false,
      voice: false,
      files: true,
    },
    order: 1,
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

  private tokenCaches = new Map<string, FeishuTokenCache>()
  private connections = new Map<string, FeishuWsConnection>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { appId, appSecret } = credentials
    if (!appId || !appSecret) {
      return { valid: false, error: 'App ID and App Secret are required' }
    }
    try {
      const token = await this.getTenantAccessToken(appId, appSecret)
      return { valid: !!token }
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
    try {
      await this.getTenantAccessToken(appId, appSecret)
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'connected',
        lastConnectedAt: Date.now(),
        lastError: null,
      })
      this.emitStatusChange(account.id)
      logger.channel.info(`Feishu account ${account.id} connected`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'error',
        lastConnectedAt: null,
        lastError: errorMsg,
      })
      this.emitStatusChange(account.id)
      throw err
    }
  }

  async disconnect(accountId: string): Promise<void> {
    this.connections.delete(accountId)
    this.tokenCaches.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`Feishu account ${accountId} disconnected`)
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
      const account = this.findAccount(message.accountId)
      if (!account) {
        return { success: false, error: 'Account config not found' }
      }
      const token = await this.getTenantAccessToken(account.credentials.appId, account.credentials.appSecret)
      const receiveIdType = message.chatType === 'group' ? 'chat_id' : 'open_id'
      const content = JSON.stringify({ text: message.text || '' })
      const body = {
        receive_id: message.to,
        msg_type: 'text',
        content,
      }
      const response = await fetch(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=${receiveIdType}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const result = await response.json() as { code?: number; msg?: string; data?: { message_id?: string } }
      if (result.code !== 0) {
        return { success: false, error: result.msg || `Feishu API error: ${result.code}` }
      }
      return { success: true, messageId: result.data?.message_id }
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
    this.connections.clear()
    this.tokenCaches.clear()
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  handleWebhookEvent(accountId: string, body: unknown): void {
    if (this.destroyed) return
    try {
      const event = this.parseWebhookEvent(body)
      if (!event) return
      const conn = this.connections.get(accountId)
      if (!conn || conn.status !== 'connected') return
      const message = this.normalizeInboundMessage(accountId, event)
      if (message) {
        for (const cb of this.messageCallbacks) cb(message)
      }
    } catch (err) {
      logger.channel.error(`Feishu webhook event error: ${err}`)
    }
  }

  verifyWebhookSignature(encryptKey: string, timestamp: string, nonce: string, body: string, signature: string): boolean {
    const content = timestamp + nonce + encryptKey + body
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    return hash === signature
  }

  private accounts = new Map<string, ChannelAccountConfig>()

  registerAccount(account: ChannelAccountConfig): void {
    this.accounts.set(account.id, account)
  }

  unregisterAccount(accountId: string): void {
    this.accounts.delete(accountId)
  }

  private findAccount(accountId?: string): ChannelAccountConfig | undefined {
    if (!accountId) return this.accounts.values().next().value
    return this.accounts.get(accountId)
  }

  private async getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
    const cacheKey = `${appId}`
    const cached = this.tokenCaches.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken
    }
    const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
    const result = await response.json() as { tenant_access_token?: string; expire?: number; code?: number; msg?: string }
    if (result.code !== undefined && result.code !== 0) {
      throw new Error(`Feishu auth failed: ${result.msg || result.code}`)
    }
    if (!result.tenant_access_token) {
      throw new Error('Feishu auth failed: no token returned')
    }
    const expiresIn = (result.expire || 7200) - 300
    this.tokenCaches.set(cacheKey, {
      accessToken: result.tenant_access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    })
    return result.tenant_access_token
  }

  private parseWebhookEvent(body: unknown): Record<string, unknown> | null {
    if (!body || typeof body !== 'object') return null
    const obj = body as Record<string, unknown>
    if (obj.type === 'url_verification') return null
    const event = obj.event as Record<string, unknown> | undefined
    if (!event) return null
    if (event.type !== 'im.message.receive_v1') return null
    return event
  }

  private normalizeInboundMessage(accountId: string, event: Record<string, unknown>): InboundMessage | null {
    const sender = event.sender as Record<string, unknown> | undefined
    const message = event.message as Record<string, unknown> | undefined
    if (!sender || !message) return null
    const chatType = (message.chat_type as string) === 'group' ? 'group' : 'direct'
    const contentType = message.message_type as string
    let text = ''
    if (contentType === 'text') {
      try {
        const content = JSON.parse((message.content as string) || '{}')
        text = content.text || ''
      } catch {
        text = message.content as string || ''
      }
    } else if (contentType === 'post') {
      try {
        const content = JSON.parse((message.content as string) || '{}')
        text = this.extractPostText(content)
      } catch {
        text = '[Rich Text]'
      }
    } else {
      text = `[${contentType}]`
    }
    const media: InboundMedia[] = []
    if (contentType === 'image' || contentType === 'file' || contentType === 'audio' || contentType === 'video') {
      try {
        const content = JSON.parse((message.content as string) || '{}')
        const mediaType = contentType === 'image' ? 'image' : contentType === 'audio' ? 'audio' : contentType === 'video' ? 'video' : 'file'
        media.push({
          type: mediaType,
          fileName: content.file_name,
          mimeType: content.file_type,
        })
      } catch {
        // ignore
      }
    }
    return {
      id: message.message_id as string,
      channelId: 'feishu',
      accountId,
      chatType: chatType as ChatType,
      from: (sender.sender_id as Record<string, string>)?.open_id || (sender.sender_id as Record<string, string>)?.user_id || '',
      fromName: sender.sender_name as string | undefined,
      to: message.chat_id as string,
      text,
      media: media.length > 0 ? media : undefined,
      threadId: message.root_id as string | undefined,
      timestamp: Date.now(),
    }
  }

  private extractPostText(content: Record<string, unknown>): string {
    const title = (content.title as string) || ''
    const lines: string[] = []
    if (title) lines.push(title)
    const contentArr = content.content as Array<Array<Record<string, unknown>>> | undefined
    if (contentArr) {
      for (const paragraph of contentArr) {
        const parts: string[] = []
        for (const element of paragraph) {
          if (element.text) parts.push(element.text as string)
          if (element.link) parts.push(element.link as string)
        }
        if (parts.length > 0) lines.push(parts.join(''))
      }
    }
    return lines.join('\n')
  }

  private emitStatusChange(accountId: string): void {
    const snapshot = this.getStatus(accountId)
    for (const cb of this.statusCallbacks) cb(snapshot)
  }
}

export const feishuChannelPlugin = new FeishuChannelPlugin()
