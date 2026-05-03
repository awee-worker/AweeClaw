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

const WECOM_API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin'

interface WeComTokenCache {
  accessToken: string
  expiresAt: number
}

interface WeComConnection {
  accountId: string
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
}

export class WechatChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'wechat'
  meta: ChannelMeta = {
    id: 'wechat',
    label: 'WeCom / WeChat Work',
    labelZh: '企业微信',
    description: 'Integrate with WeCom (Enterprise WeChat) for messaging',
    descriptionZh: '集成企业微信，实现消息通知和交互',
    icon: 'MessageSquare',
    connectionModes: ['webhook'],
    defaultConnectionMode: 'webhook',
    capabilities: {
      chatTypes: ['direct', 'group'],
      media: true,
      reactions: false,
      threads: false,
      edit: false,
      streaming: false,
      voice: false,
      files: true,
    },
    order: 2,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'corpId',
      label: 'Corp ID',
      labelZh: '企业ID',
      description: 'WeCom Corporation ID',
      descriptionZh: '企业微信的企业ID',
      required: true,
      secret: false,
      placeholder: 'wwxxxxxxxxxxxxxx',
    },
    {
      key: 'agentId',
      label: 'Agent ID',
      labelZh: '应用AgentId',
      description: 'WeCom application Agent ID',
      descriptionZh: '企业微信应用的 AgentId',
      required: true,
      secret: false,
      placeholder: '1000002',
    },
    {
      key: 'secret',
      label: 'Secret',
      labelZh: '应用密钥',
      description: 'WeCom application Secret',
      descriptionZh: '企业微信应用的 Secret',
      required: true,
      secret: true,
      placeholder: 'xxxxxxxxxx',
    },
    {
      key: 'token',
      label: 'Callback Token',
      labelZh: '回调Token',
      description: 'Callback URL verification token',
      descriptionZh: '回调URL验证Token',
      required: false,
      secret: true,
    },
    {
      key: 'encodingAesKey',
      label: 'Encoding AES Key',
      labelZh: '加密密钥',
      description: 'Callback message encryption key',
      descriptionZh: '回调消息加密密钥',
      required: false,
      secret: true,
    },
  ]

  private tokenCaches = new Map<string, WeComTokenCache>()
  private connections = new Map<string, WeComConnection>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false
  private accounts = new Map<string, ChannelAccountConfig>()
  private corpIdIndex = new Map<string, ChannelAccountConfig>()
  private userNameCache = new Map<string, string>()

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { corpId, secret } = credentials
    if (!corpId || !secret) {
      return { valid: false, error: 'Corp ID and Secret are required' }
    }
    try {
      const token = await this.getAccessToken(corpId, secret)
      return { valid: !!token }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return
    const { corpId, secret } = account.credentials
    if (!corpId || !secret) {
      throw new Error('WeCom Corp ID and Secret are required')
    }
    try {
      await this.getAccessToken(corpId, secret)
      this.accounts.set(account.id, account)
      if (corpId) {
        this.corpIdIndex.set(corpId, account)
      }
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'connected',
        lastConnectedAt: Date.now(),
        lastError: null,
      })
      this.emitStatusChange(account.id)
      logger.channel.info(`WeCom account ${account.id} connected`)
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
    const account = this.accounts.get(accountId)
    if (account?.credentials.corpId) {
      this.corpIdIndex.delete(account.credentials.corpId)
    }
    this.connections.delete(accountId)
    this.tokenCaches.delete(accountId)
    this.accounts.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`WeCom account ${accountId} disconnected`)
  }

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    if (message.channelId !== 'wechat') {
      return { success: false, error: 'Invalid channel ID' }
    }
    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'WeCom account not connected' }
    }
    try {
      const account = this.accounts.get(message.accountId || '')
      if (!account) {
        return { success: false, error: 'Account config not found' }
      }
      const token = await this.getAccessToken(account.credentials.corpId, account.credentials.secret)
      const body = {
        touser: message.chatType === 'group' ? undefined : message.to,
        toparty: message.chatType === 'group' ? message.to : undefined,
        msgtype: 'text',
        agentid: parseInt(account.credentials.agentId || '0'),
        text: { content: message.text || '' },
      }
      const response = await fetch(`${WECOM_API_BASE}/message/send?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json() as { errcode?: number; errmsg?: string; msgid?: string }
      if (result.errcode !== 0) {
        return { success: false, error: result.errmsg || `WeCom API error: ${result.errcode}` }
      }
      return { success: true, messageId: result.msgid }
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
    this.accounts.clear()
    this.corpIdIndex.clear()
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  findAccountBySignature(
    accounts: ChannelAccountConfig[],
    timestamp: string,
    nonce: string,
    encryptedMsg: string,
    signature: string
  ): ChannelAccountConfig | null {
    for (const account of accounts) {
      const token = account.credentials.token
      if (!token) continue
      if (this.verifyCallbackSignature(token, timestamp, nonce, encryptedMsg, signature)) {
        return account
      }
    }
    return null
  }

  decryptEchostr(encodingAesKey: string, echostr: string): string {
    const aesKey = Buffer.from(encodingAesKey + '=', 'base64')
    const iv = aesKey.subarray(0, 16)
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv)
    decipher.setAutoPadding(false)
    let decrypted = decipher.update(echostr, 'base64', 'utf8')
    decrypted += decipher.final('utf8')
    const pad = decrypted.charCodeAt(decrypted.length - 1)
    decrypted = decrypted.substring(0, decrypted.length - pad)
    const contentLen = decrypted.charCodeAt(16) << 24
      | decrypted.charCodeAt(17) << 16
      | decrypted.charCodeAt(18) << 8
      | decrypted.charCodeAt(19)
    return decrypted.substring(20, 20 + contentLen)
  }

  async handleWebhookEvent(accountId: string, body: unknown, query: Record<string, string>): Promise<InboundMessage | null> {
    if (this.destroyed) return null
    try {
      const account = this.accounts.get(accountId)
      if (!account) return null
      const conn = this.connections.get(accountId)
      if (!conn || conn.status !== 'connected') return null
      const xmlData = this.decryptCallbackMessage(
        account.credentials.encodingAesKey || '',
        body as string,
        query.msg_signature || '',
        query.timestamp || '',
        query.nonce || ''
      )
      if (!xmlData) return null

      const fromUser = this.extractXmlValue((xmlData as any).xml || '', 'FromUserName') || ''
      if (fromUser && !this.userNameCache.has(fromUser)) {
        await this.resolveSenderName(accountId, fromUser)
      }

      const message = this.normalizeInboundMessage(accountId, xmlData)
      if (message) {
        for (const cb of this.messageCallbacks) cb(message)
      }
      return message
    } catch (err) {
      logger.channel.error(`WeCom webhook event error: ${err}`)
      return null
    }
  }

  verifyCallbackSignature(token: string, timestamp: string, nonce: string, encryptedMsg: string, signature: string): boolean {
    const parts = [token, timestamp, nonce, encryptedMsg].sort()
    const hash = crypto.createHash('sha1').update(parts.join('')).digest('hex')
    return hash === signature
  }

  private async getAccessToken(corpId: string, secret: string): Promise<string> {
    const cacheKey = `${corpId}`
    const cached = this.tokenCaches.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken
    }
    const response = await fetch(`${WECOM_API_BASE}/gettoken?corpid=${corpId}&corpsecret=${secret}`)
    const result = await response.json() as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }
    if (result.errcode !== undefined && result.errcode !== 0) {
      throw new Error(`WeCom auth failed: ${result.errmsg || result.errcode}`)
    }
    if (!result.access_token) {
      throw new Error('WeCom auth failed: no token returned')
    }
    const expiresIn = (result.expires_in || 7200) - 300
    this.tokenCaches.set(cacheKey, {
      accessToken: result.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    })
    return result.access_token
  }

  private decryptCallbackMessage(encodingAesKey: string, encryptedMsg: string, _signature: string, _timestamp: string, _nonce: string): Record<string, unknown> | null {
    if (!encodingAesKey || !encryptedMsg) return null
    try {
      const aesKey = Buffer.from(encodingAesKey + '=', 'base64')
      const iv = aesKey.subarray(0, 16)
      const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv)
      decipher.setAutoPadding(false)
      let decrypted = decipher.update(encryptedMsg, 'base64', 'utf8')
      decrypted += decipher.final('utf8')
      const pad = decrypted.charCodeAt(decrypted.length - 1)
      decrypted = decrypted.substring(0, decrypted.length - pad)
      const contentLen = decrypted.charCodeAt(16) << 24 | decrypted.charCodeAt(17) << 16 | decrypted.charCodeAt(18) << 8 | decrypted.charCodeAt(19)
      const xmlContent = decrypted.substring(20, 20 + contentLen)
      return { xml: xmlContent }
    } catch (err) {
      logger.channel.error(`WeCom message decryption failed: ${err}`)
      return null
    }
  }

  private normalizeInboundMessage(accountId: string, data: Record<string, unknown>): InboundMessage | null {
    const xml = data.xml as string | undefined
    if (!xml) return null
    const fromUser = this.extractXmlValue(xml, 'FromUserName') || ''
    const toUser = this.extractXmlValue(xml, 'ToUserName') || ''
    const content = this.extractXmlValue(xml, 'Content') || ''
    const msgType = this.extractXmlValue(xml, 'MsgType') || 'text'
    const msgId = this.extractXmlValue(xml, 'MsgId') || crypto.randomUUID()
    const chatType: ChatType = fromUser.includes('@') ? 'group' : 'direct'
    const senderName = this.userNameCache.get(fromUser)
    const media: InboundMedia[] = []
    if (msgType === 'image') {
      media.push({ type: 'image', url: this.extractXmlValue(xml, 'PicUrl') || undefined })
    } else if (msgType === 'voice') {
      media.push({ type: 'audio' })
    } else if (msgType === 'video') {
      media.push({ type: 'video' })
    } else if (msgType === 'file') {
      media.push({ type: 'file' })
    }
    return {
      id: msgId,
      channelId: 'wechat',
      accountId,
      chatType,
      from: fromUser,
      fromName: senderName,
      to: toUser,
      text: content || `[${msgType}]`,
      media: media.length > 0 ? media : undefined,
      timestamp: Date.now(),
    }
  }

  private extractXmlValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}><!\[CDATA\[(.*?)\]\]></${tag}>|<${tag}>(.*?)</${tag}>`)
    const match = xml.match(regex)
    return match ? (match[1] || match[2]) : null
  }

  async resolveSenderName(accountId: string, userId: string): Promise<string | null> {
    const cached = this.userNameCache.get(userId)
    if (cached) return cached
    const account = this.accounts.get(accountId)
    if (!account) return null
    try {
      const token = await this.getAccessToken(account.credentials.corpId, account.credentials.secret)
      const response = await fetch(`${WECOM_API_BASE}/user/get?access_token=${token}&userid=${userId}`)
      const result = await response.json() as { name?: string; errcode?: number }
      if (result.name) {
        this.userNameCache.set(userId, result.name)
        return result.name
      }
    } catch (err) {
      logger.channel.warn(`[WeCom] resolveSenderName failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return null
  }

  private emitStatusChange(accountId: string): void {
    const snapshot = this.getStatus(accountId)
    for (const cb of this.statusCallbacks) cb(snapshot)
  }
}

export const wechatChannelPlugin = new WechatChannelPlugin()
