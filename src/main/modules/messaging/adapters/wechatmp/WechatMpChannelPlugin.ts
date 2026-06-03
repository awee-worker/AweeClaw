import { logger } from '@shared/toolkit/LogEngine'
import { WechatMpClient, type WechatMpXmlMessage } from './WechatMpClient'
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

/** 加密模式 */
type EncryptionMode = 'safe' | 'compat' | 'plain'

interface WechatMpConnection {
  accountId: string
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  client: WechatMpClient
  appId: string
  token: string
  encodingAesKey: string
  encryptionMode: EncryptionMode
}

/**
 * 微信公众号（服务号）渠道插件
 *
 * 通过 Webhook 接入微信公众号消息，支持：
 * - 文本、图片、语音、视频、位置、链接消息接收
 * - 文本消息发送（客服接口）
 * - 消息加解密（安全模式 / 兼容模式 / 明文模式）
 * - 签名验证
 */
export class WechatMpChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'wechatmp'
  meta: ChannelMeta = {
    id: 'wechatmp',
    label: 'WeChat Official Account',
    labelZh: '微信服务号',
    description: 'Connect WeChat Official Account via Webhook',
    descriptionZh: '通过 Webhook 接入微信公众号（服务号）消息',
    icon: 'MessageCircle',
    connectionModes: ['webhook'],
    defaultConnectionMode: 'webhook',
    capabilities: {
      chatTypes: ['direct'],
      media: true,
      reactions: false,
      threads: false,
      edit: false,
      streaming: false,
      voice: false,
      files: false,
    },
    order: 7,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'appId',
      label: 'App ID',
      labelZh: '开发者ID (AppID)',
      description: 'WeChat Official Account App ID',
      descriptionZh: '公众号开发者ID',
      required: true,
      secret: false,
      placeholder: 'wx1234567890abcdef',
    },
    {
      key: 'appSecret',
      label: 'App Secret',
      labelZh: '开发者密码 (AppSecret)',
      description: 'WeChat Official Account App Secret',
      descriptionZh: '公众号开发者密码',
      required: true,
      secret: true,
    },
    {
      key: 'token',
      label: 'Token',
      labelZh: '令牌 (Token)',
      description: 'Callback URL verification token',
      descriptionZh: '服务器配置令牌',
      required: true,
      secret: true,
    },
    {
      key: 'encodingAesKey',
      label: 'Encoding AES Key',
      labelZh: '消息加解密密钥',
      description: 'Message encryption key (required in safe/compat mode)',
      descriptionZh: '消息加解密密钥（安全/兼容模式必填）',
      required: false,
      secret: true,
    },
    {
      key: 'encryptionMode',
      label: 'Encryption Mode',
      labelZh: '加解密方式',
      description: 'safe / compat / plain',
      descriptionZh: '安全模式 / 兼容模式 / 明文模式',
      required: false,
      secret: false,
      placeholder: 'safe',
    },
  ]

  private connections = new Map<string, WechatMpConnection>()
  private accounts = new Map<string, ChannelAccountConfig>()
  private appIdIndex = new Map<string, ChannelAccountConfig>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false

  // ─── 生命周期 ─────────────────────────────────────────────────

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { appId, appSecret } = credentials
    if (!appId || !appSecret) {
      return { valid: false, error: 'App ID and App Secret are required' }
    }
    try {
      const client = new WechatMpClient(appId, appSecret)
      await client.getAccessToken()
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return

    const { appId, appSecret, token } = account.credentials
    if (!appId || !appSecret || !token) {
      throw new Error('WeChat MP App ID, App Secret and Token are required')
    }

    const encryptionMode = this.normalizeEncryptionMode(account.credentials.encryptionMode || '')
    const encodingAesKey = account.credentials.encodingAesKey || ''

    // 安全/兼容模式需要 EncodingAESKey
    if ((encryptionMode === 'safe' || encryptionMode === 'compat') && !encodingAesKey) {
      throw new Error('Encoding AES Key is required in safe/compat encryption mode')
    }

    try {
      const client = new WechatMpClient(appId, appSecret)
      await client.getAccessToken()

      this.accounts.set(account.id, account)
      if (appId) {
        this.appIdIndex.set(appId, account)
      }

      this.connections.set(account.id, {
        accountId: account.id,
        status: 'connected',
        lastConnectedAt: Date.now(),
        lastError: null,
        client,
        appId,
        token,
        encodingAesKey,
        encryptionMode,
      })

      this.emitStatusChange(account.id)
      logger.channel.info(`WeChat MP account ${account.id} connected (appId: ${appId})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'error',
        lastConnectedAt: null,
        lastError: errorMsg,
        client: new WechatMpClient(appId, appSecret),
        appId,
        token,
        encodingAesKey,
        encryptionMode,
      })
      this.emitStatusChange(account.id)
      throw err
    }
  }

  async disconnect(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId)
    if (account?.credentials.appId) {
      this.appIdIndex.delete(account.credentials.appId)
    }
    this.connections.delete(accountId)
    this.accounts.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`WeChat MP account ${accountId} disconnected`)
  }

  destroy(): void {
    this.destroyed = true
    this.connections.clear()
    this.accounts.clear()
    this.appIdIndex.clear()
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  // ─── 消息发送 ─────────────────────────────────────────────────

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    if (message.channelId !== 'wechatmp') {
      return { success: false, error: 'Invalid channel ID' }
    }

    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'WeChat MP account not connected' }
    }

    try {
      const text = message.text || ''
      if (!text.trim()) {
        return { success: false, error: 'Empty message content' }
      }

      // 微信公众号 to 字段为用户 openId
      const openId = message.to
      const result = await conn.client.sendTextMessage(openId, text)
      return { success: true, messageId: result.msgid?.toString() }
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

  // ─── Webhook 处理 ─────────────────────────────────────────────

  /** 通过 appId 查找匹配的账户 */
  findAccountByAppId(accounts: ChannelAccountConfig[], appId: string): ChannelAccountConfig | null {
    return accounts.find(a => a.credentials.appId === appId) || null
  }

  /** 通过签名查找匹配的账户 */
  findAccountBySignature(
    accounts: ChannelAccountConfig[],
    timestamp: string,
    nonce: string,
    signature: string
  ): ChannelAccountConfig | null {
    for (const account of accounts) {
      const token = account.credentials.token
      if (!token) continue
      if (WechatMpClient.verifySignature(token, signature, timestamp, nonce)) {
        return account
      }
    }
    return null
  }

  /** 处理 GET 验证请求 */
  handleVerification(
    accountId: string,
    query: Record<string, string>
  ): string | null {
    const conn = this.connections.get(accountId)
    if (!conn) return null

    const { signature, timestamp, nonce, echostr } = query
    if (!timestamp || !nonce || !signature || !echostr) return null

    // 安全/兼容模式：使用 msg_signature 验证
    const msgSignature = query.msg_signature
    if (msgSignature && conn.encodingAesKey) {
      if (!WechatMpClient.verifyMessageSignature(conn.token, msgSignature, timestamp, nonce, echostr)) {
        logger.channel.warn(`[WeChat MP] Verification signature mismatch for account ${accountId}`)
        return null
      }
      try {
        return WechatMpClient.decryptMessage(conn.encodingAesKey, echostr)
      } catch (err) {
        logger.channel.error(`[WeChat MP] Decrypt echostr failed: ${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    }

    // 明文模式 / 兼容模式无 msg_signature
    if (!WechatMpClient.verifySignature(conn.token, signature, timestamp, nonce)) {
      logger.channel.warn(`[WeChat MP] URL signature mismatch for account ${accountId}`)
      return null
    }

    return echostr
  }

  /** 处理 POST 消息回调 */
  async handleWebhookEvent(
    accountId: string,
    body: string,
    query: Record<string, string>
  ): Promise<InboundMessage | null> {
    if (this.destroyed) return null

    try {
      const conn = this.connections.get(accountId)
      if (!conn || conn.status !== 'connected') return null

      // 解密消息
      const xmlContent = this.decryptInbound(conn, body, query)
      if (!xmlContent) return null

      // 解析 XML
      const parsed = WechatMpClient.parseXmlMessage(xmlContent)

      // 构建入站消息
      const message = this.normalizeInboundMessage(accountId, parsed)
      if (message) {
        for (const cb of this.messageCallbacks) cb(message)
      }
      return message
    } catch (err) {
      logger.channel.error(`[WeChat MP] Webhook event error: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  // ─── 内部方法 ─────────────────────────────────────────────────

  /** 解密入站消息 */
  private decryptInbound(
    conn: WechatMpConnection,
    body: string,
    query: Record<string, string>
  ): string | null {
    const { encryptionMode, token, encodingAesKey } = conn

    // 明文模式：直接验证 URL 签名
    if (encryptionMode === 'plain') {
      if (!WechatMpClient.verifySignature(token, query.signature || '', query.timestamp || '', query.nonce || '')) {
        logger.channel.warn('[WeChat MP] Plain mode signature verification failed')
        return null
      }
      return body
    }

    // 安全/兼容模式：提取加密内容
    const encrypt = WechatMpClient.extractXmlValue(body, 'Encrypt')
    if (!encrypt) {
      // 兼容模式下可能没有加密内容，降级为明文
      if (encryptionMode === 'compat') {
        if (!WechatMpClient.verifySignature(token, query.signature || '', query.timestamp || '', query.nonce || '')) {
          return null
        }
        return body
      }
      logger.channel.warn('[WeChat MP] No encrypted content found')
      return null
    }

    // 验证消息签名
    const msgSignature = query.msg_signature || ''
    if (!WechatMpClient.verifyMessageSignature(token, msgSignature, query.timestamp || '', query.nonce || '', encrypt)) {
      logger.channel.warn('[WeChat MP] Message signature verification failed')
      return null
    }

    // 解密
    if (!encodingAesKey) {
      logger.channel.error('[WeChat MP] Encoding AES Key required for decryption')
      return null
    }

    try {
      return WechatMpClient.decryptMessage(encodingAesKey, encrypt)
    } catch (err) {
      logger.channel.error(`[WeChat MP] Decrypt message failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /** 将微信 XML 消息转换为 InboundMessage */
  private normalizeInboundMessage(
    accountId: string,
    parsed: WechatMpXmlMessage
  ): InboundMessage | null {
    const openId = parsed.fromUserName
    if (!openId) return null

    const msgType = parsed.msgType

    // 事件消息
    if (msgType === 'event') {
      const eventType = parsed.event || ''
      if (!eventType) return null

      const eventKey = parsed.eventKey || ''
      const text = eventKey ? `${eventType}:${eventKey}` : eventType

      return {
        id: WechatMpClient.syntheticId(openId, String(parsed.createTime), 'event', eventType, eventKey),
        channelId: 'wechatmp',
        accountId,
        chatType: 'direct',
        from: openId,
        to: parsed.toUserName,
        text,
        timestamp: parsed.createTime ? parsed.createTime * 1000 : Date.now(),
        raw: {
          isEvent: true,
          event: eventType,
          eventKey,
          ticket: parsed.ticket,
        },
      }
    }

    // 普通消息
    const msgId = parsed.msgId || WechatMpClient.syntheticId(openId, String(parsed.createTime), msgType, parsed.content || '')
    const media: InboundMedia[] = []

    switch (msgType) {
      case 'image':
        media.push({ type: 'image', url: parsed.picUrl || undefined })
        break
      case 'voice':
        media.push({ type: 'audio' })
        break
      case 'video':
      case 'shortvideo':
        media.push({ type: 'video' })
        break
    }

    const text = parsed.content || `[${msgType}]`

    return {
      id: msgId,
      channelId: 'wechatmp',
      accountId,
      chatType: 'direct',
      from: openId,
      to: parsed.toUserName,
      text,
      media: media.length > 0 ? media : undefined,
      timestamp: parsed.createTime ? parsed.createTime * 1000 : Date.now(),
      raw: msgType !== 'text' ? { msgType, mediaId: parsed.mediaId } : undefined,
    }
  }

  /** 规范化加密模式 */
  private normalizeEncryptionMode(raw: string): EncryptionMode {
    switch (raw.toLowerCase().trim()) {
      case 'plain':
        return 'plain'
      case 'compat':
      case 'compatible':
        return 'compat'
      case 'safe':
      case 'security':
      case 'secure':
      case '':
        return 'safe'
      default:
        return 'safe'
    }
  }

  private emitStatusChange(accountId: string): void {
    const snapshot = this.getStatus(accountId)
    for (const cb of this.statusCallbacks) cb(snapshot)
  }
}

export const wechatmpChannelPlugin = new WechatMpChannelPlugin()
