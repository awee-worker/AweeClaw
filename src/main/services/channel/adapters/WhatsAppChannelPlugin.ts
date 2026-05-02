import * as crypto from 'crypto'
import { logger } from '@shared/utils/Logger'
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
  ChatType,
  ChannelStatus,
} from '@shared/types/channel'

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v18.0'

interface WhatsAppConnection {
  accountId: string
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
}

export class WhatsAppChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'whatsapp'
  meta: ChannelMeta = {
    id: 'whatsapp',
    label: 'WhatsApp Business',
    labelZh: 'WhatsApp商业版',
    description: 'Integrate with WhatsApp Business API for messaging',
    descriptionZh: '集成WhatsApp商业版API，实现消息通知和交互',
    icon: 'Smartphone',
    connectionModes: ['webhook'],
    defaultConnectionMode: 'webhook',
    capabilities: {
      chatTypes: ['direct', 'group'],
      media: true,
      reactions: true,
      threads: false,
      edit: false,
      streaming: false,
      voice: true,
      files: true,
    },
    order: 3,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'phoneNumberId',
      label: 'Phone Number ID',
      labelZh: '电话号码ID',
      description: 'WhatsApp Business phone number ID',
      descriptionZh: 'WhatsApp商业版电话号码ID',
      required: true,
      secret: false,
      placeholder: '123456789012345',
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      labelZh: '访问令牌',
      description: 'WhatsApp Business API access token',
      descriptionZh: 'WhatsApp商业版API访问令牌',
      required: true,
      secret: true,
      placeholder: 'EAAxxxxxxxxxx',
    },
    {
      key: 'webhookVerifyToken',
      label: 'Webhook Verify Token',
      labelZh: 'Webhook验证令牌',
      description: 'Token for webhook URL verification',
      descriptionZh: 'Webhook URL验证令牌',
      required: false,
      secret: true,
    },
    {
      key: 'businessAccountId',
      label: 'Business Account ID',
      labelZh: '商业账户ID',
      description: 'WhatsApp Business Account ID (optional, for management)',
      descriptionZh: 'WhatsApp商业账户ID（可选，用于管理）',
      required: false,
      secret: false,
    },
  ]

  private connections = new Map<string, WhatsAppConnection>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false
  private accounts = new Map<string, ChannelAccountConfig>()

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { phoneNumberId, accessToken } = credentials
    if (!phoneNumberId || !accessToken) {
      return { valid: false, error: 'Phone Number ID and Access Token are required' }
    }
    try {
      const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        const data = await response.json() as { error?: { message?: string } }
        return { valid: false, error: data.error?.message || `HTTP ${response.status}` }
      }
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return
    const { phoneNumberId, accessToken } = account.credentials
    if (!phoneNumberId || !accessToken) {
      throw new Error('WhatsApp Phone Number ID and Access Token are required')
    }
    try {
      const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        throw new Error(`WhatsApp API verification failed: HTTP ${response.status}`)
      }
      this.accounts.set(account.id, account)
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'connected',
        lastConnectedAt: Date.now(),
        lastError: null,
      })
      this.emitStatusChange(account.id)
      logger.channel.info(`WhatsApp account ${account.id} connected`)
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
    this.accounts.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`WhatsApp account ${accountId} disconnected`)
  }

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    if (message.channelId !== 'whatsapp') {
      return { success: false, error: 'Invalid channel ID' }
    }
    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'WhatsApp account not connected' }
    }
    try {
      const account = this.accounts.get(message.accountId || '')
      if (!account) {
        return { success: false, error: 'Account config not found' }
      }
      const { phoneNumberId, accessToken } = account.credentials
      const body = this.buildSendMessageBody(message)
      const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const result = await response.json() as { messages?: Array<{ id: string }>; error?: { message?: string } }
      if (result.error) {
        return { success: false, error: result.error.message || 'WhatsApp API error' }
      }
      const messageId = result.messages?.[0]?.id
      return { success: true, messageId }
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
    this.accounts.clear()
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  handleWebhookEvent(accountId: string, body: unknown): InboundMessage | null {
    if (this.destroyed) return null
    try {
      const account = this.accounts.get(accountId)
      if (!account) return null
      const conn = this.connections.get(accountId)
      if (!conn || conn.status !== 'connected') return null
      const messages = this.parseWebhookPayload(body)
      for (const msg of messages) {
        const inbound = this.normalizeInboundMessage(accountId, msg)
        if (inbound) {
          for (const cb of this.messageCallbacks) cb(inbound)
        }
      }
      return messages.length > 0 ? this.normalizeInboundMessage(accountId, messages[0]) : null
    } catch (err) {
      logger.channel.error(`WhatsApp webhook event error: ${err}`)
      return null
    }
  }

  verifyWebhookMode(hubMode: string, hubChallenge: string, hubVerifyToken: string, expectedToken: string): string | null {
    if (hubMode === 'subscribe' && hubVerifyToken === expectedToken) {
      return hubChallenge
    }
    return null
  }

  verifyWebhookSignature(appSecret: string, payload: string, signature: string): boolean {
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(payload).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  }

  private buildSendMessageBody(message: OutboundMessage): Record<string, unknown> {
    if (message.media && message.media.length > 0) {
      const media = message.media[0]
      const mediaType = media.type === 'audio' ? 'audio' : media.type === 'video' ? 'video' : media.type === 'image' ? 'image' : 'document'
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: message.to,
        type: mediaType,
        [mediaType]: {
          link: media.url,
          caption: message.text,
        },
      }
    }
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.to,
      type: 'text',
      text: { body: message.text || '' },
    }
  }

  private parseWebhookPayload(body: unknown): Array<Record<string, unknown>> {
    if (!body || typeof body !== 'object') return []
    const obj = body as Record<string, unknown>
    const entries = obj.entry as Array<Record<string, unknown>> | undefined
    if (!entries) return []
    const messages: Array<Record<string, unknown>> = []
    for (const entry of entries) {
      const changes = entry.changes as Array<Record<string, unknown>> | undefined
      if (!changes) continue
      for (const change of changes) {
        const value = change.value as Record<string, unknown> | undefined
        if (!value) continue
        const msgs = value.messages as Array<Record<string, unknown>> | undefined
        if (msgs) {
          for (const msg of msgs) {
            messages.push(msg)
          }
        }
      }
    }
    return messages
  }

  private normalizeInboundMessage(accountId: string, msg: Record<string, unknown>): InboundMessage | null {
    const msgId = msg.id as string | undefined
    const from = msg.from as string | undefined
    const timestamp = msg.timestamp as string | number | undefined
    const type = msg.type as string | undefined
    if (!msgId || !from) return null
    let text = ''
    const media: InboundMedia[] = []
    if (type === 'text') {
      const textObj = msg.text as Record<string, string> | undefined
      text = textObj?.body || ''
    } else if (type === 'image') {
      const imageObj = msg.image as Record<string, string> | undefined
      text = imageObj?.caption || ''
      media.push({ type: 'image', url: imageObj?.link, mimeType: imageObj?.mime_type })
    } else if (type === 'video') {
      const videoObj = msg.video as Record<string, string> | undefined
      text = videoObj?.caption || ''
      media.push({ type: 'video', url: videoObj?.link, mimeType: videoObj?.mime_type })
    } else if (type === 'audio') {
      const audioObj = msg.audio as Record<string, string> | undefined
      media.push({ type: 'audio', url: audioObj?.link, mimeType: audioObj?.mime_type })
    } else if (type === 'document') {
      const docObj = msg.document as Record<string, string> | undefined
      text = docObj?.caption || ''
      media.push({ type: 'file', url: docObj?.link, fileName: docObj?.filename, mimeType: docObj?.mime_type })
    } else if (type === 'sticker') {
      media.push({ type: 'sticker' })
    } else if (type === 'location') {
      const locObj = msg.location as Record<string, string | number> | undefined
      text = `Location: ${locObj?.latitude}, ${locObj?.longitude}`
      if (locObj?.name) text += ` - ${locObj.name}`
      if (locObj?.address) text += ` (${locObj.address})`
    } else {
      text = `[${type || 'unknown'}]`
    }
    const context = msg.context as Record<string, string> | undefined
    return {
      id: msgId,
      channelId: 'whatsapp',
      accountId,
      chatType: 'direct' as ChatType,
      from,
      to: '',
      text,
      media: media.length > 0 ? media : undefined,
      replyToId: context?.id,
      timestamp: typeof timestamp === 'number' ? timestamp * 1000 : parseInt(String(timestamp || '0')) * 1000 || Date.now(),
    }
  }

  private emitStatusChange(accountId: string): void {
    const snapshot = this.getStatus(accountId)
    for (const cb of this.statusCallbacks) cb(snapshot)
  }
}

export const whatsappChannelPlugin = new WhatsAppChannelPlugin()
