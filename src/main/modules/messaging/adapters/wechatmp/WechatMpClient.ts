import * as crypto from 'crypto'

/** 微信公众号 API 基础地址 */
const WECHAT_MP_API_BASE = 'https://api.weixin.qq.com/cgi-bin'

/** access_token 缓存 */
interface TokenCache {
  accessToken: string
  expiresAt: number
}

/** 微信公众号消息加解密相关类型 */
export interface WechatMpSecurityConfig {
  token: string
  encodingAesKey: string
  appId: string
}

/** 微信公众号 XML 消息结构 */
export interface WechatMpXmlMessage {
  toUserName: string
  fromUserName: string
  createTime: number
  msgType: string
  msgId?: string
  content?: string
  picUrl?: string
  mediaId?: string
  format?: string
  thumbMediaId?: string
  locationX?: string
  locationY?: string
  scale?: string
  label?: string
  title?: string
  description?: string
  url?: string
  event?: string
  eventKey?: string
  ticket?: string
}

/** API 响应基础结构 */
interface ApiResponse {
  errcode?: number
  errmsg?: string
}

/** 发送消息响应 */
interface SendMessageResponse extends ApiResponse {
  msgid?: number
}

/**
 * 微信公众号 API 客户端
 *
 * 职责：
 * - access_token 获取与缓存
 * - 客服消息发送
 * - 消息加解密（AES-256-CBC）
 * - 签名验证
 */
export class WechatMpClient {
  private appId: string
  private appSecret: string
  private tokenCache: TokenCache | null = null

  constructor(appId: string, appSecret: string) {
    this.appId = appId
    this.appSecret = appSecret
  }

  // ─── access_token ─────────────────────────────────────────────

  /** 获取 access_token（带缓存，提前5分钟刷新） */
  async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.accessToken
    }

    const body = JSON.stringify({
      grant_type: 'client_credential',
      appid: this.appId,
      secret: this.appSecret,
    })

    const response = await fetch(`${WECHAT_MP_API_BASE}/stable_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    const result = await response.json() as {
      access_token?: string
      expires_in?: number
      errcode?: number
      errmsg?: string
    }

    if (result.errcode !== undefined && result.errcode !== 0) {
      throw new Error(`WeChat MP auth failed: ${result.errmsg || result.errcode}`)
    }

    if (!result.access_token) {
      throw new Error('WeChat MP auth failed: no token returned')
    }

    const expiresIn = (result.expires_in || 7200) - 300
    this.tokenCache = {
      accessToken: result.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    }

    return result.access_token
  }

  // ─── 消息发送 ─────────────────────────────────────────────────

  /** 发送文本消息 */
  async sendTextMessage(openId: string, text: string): Promise<SendMessageResponse> {
    const token = await this.getAccessToken()
    const body = {
      touser: openId,
      msgtype: 'text',
      text: { content: text },
    }

    const response = await fetch(
      `${WECHAT_MP_API_BASE}/message/custom/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    const result = await response.json() as SendMessageResponse
    if (result.errcode && result.errcode !== 0) {
      throw new Error(`WeChat MP send failed: ${result.errmsg || result.errcode}`)
    }
    return result
  }

  /** 发送图片消息 */
  async sendImageMessage(openId: string, mediaId: string): Promise<SendMessageResponse> {
    const token = await this.getAccessToken()
    const body = {
      touser: openId,
      msgtype: 'image',
      image: { media_id: mediaId },
    }

    const response = await fetch(
      `${WECHAT_MP_API_BASE}/message/custom/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    const result = await response.json() as SendMessageResponse
    if (result.errcode && result.errcode !== 0) {
      throw new Error(`WeChat MP send image failed: ${result.errmsg || result.errcode}`)
    }
    return result
  }

  // ─── 签名验证 ─────────────────────────────────────────────────

  /** 验证 URL 签名（GET 验证请求） */
  static verifySignature(token: string, signature: string, timestamp: string, nonce: string): boolean {
    const parts = [token, timestamp, nonce].sort()
    const hash = crypto.createHash('sha1').update(parts.join('')).digest('hex')
    return hash === signature
  }

  /** 验证消息签名（POST 消息，含加密内容） */
  static verifyMessageSignature(
    token: string,
    signature: string,
    timestamp: string,
    nonce: string,
    encrypt: string
  ): boolean {
    const parts = [token, timestamp, nonce, encrypt].sort()
    const hash = crypto.createHash('sha1').update(parts.join('')).digest('hex')
    return hash === signature
  }

  // ─── 消息加解密 ───────────────────────────────────────────────

  /** 解密消息 */
  static decryptMessage(encodingAesKey: string, encrypted: string): string {
    const aesKey = Buffer.from(encodingAesKey + '=', 'base64')
    const iv = aesKey.subarray(0, 16)

    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv)
    decipher.setAutoPadding(false)

    let decrypted = decipher.update(encrypted, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    // PKCS7 去填充
    const pad = decrypted.charCodeAt(decrypted.length - 1)
    decrypted = decrypted.substring(0, decrypted.length - pad)

    // 解析：random(16) + msgLen(4) + msg + appId
    const msgLen =
      (decrypted.charCodeAt(16) << 24) |
      (decrypted.charCodeAt(17) << 16) |
      (decrypted.charCodeAt(18) << 8) |
      decrypted.charCodeAt(19)

    return decrypted.substring(20, 20 + msgLen)
  }

  /** 加密消息（用于被动回复） */
  static encryptMessage(encodingAesKey: string, appId: string, replyMsg: string): string {
    const aesKey = Buffer.from(encodingAesKey + '=', 'base64')
    const iv = aesKey.subarray(0, 16)

    const random = crypto.randomBytes(16)
    const msgBuf = Buffer.from(replyMsg, 'utf8')
    const msgLenBuf = Buffer.alloc(4)
    msgLenBuf.writeUInt32BE(msgBuf.length, 0)
    const appIdBuf = Buffer.from(appId, 'utf8')

    let data = Buffer.concat([random, msgLenBuf, msgBuf, appIdBuf])

    // PKCS7 填充到 32 字节对齐
    const blockSize = 32
    const padLen = blockSize - (data.length % blockSize)
    const padBuf = Buffer.alloc(padLen, padLen)
    data = Buffer.concat([data, padBuf])

    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv)
    cipher.setAutoPadding(false)
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()])

    return encrypted.toString('base64')
  }

  // ─── XML 解析 ─────────────────────────────────────────────────

  /** 从 XML 字符串提取字段值 */
  static extractXmlValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>|<${tag}>(.*?)</${tag}>`)
    const match = xml.match(regex)
    return match ? (match[1] || match[2]) : null
  }

  /** 解析完整的 XML 消息为结构化对象 */
  static parseXmlMessage(xml: string): WechatMpXmlMessage {
    const extract = (tag: string) => WechatMpClient.extractXmlValue(xml, tag)
    return {
      toUserName: extract('ToUserName') || '',
      fromUserName: extract('FromUserName') || '',
      createTime: parseInt(extract('CreateTime') || '0', 10),
      msgType: (extract('MsgType') || 'text').toLowerCase(),
      msgId: extract('MsgId') || undefined,
      content: extract('Content') || undefined,
      picUrl: extract('PicUrl') || undefined,
      mediaId: extract('MediaId') || undefined,
      format: extract('Format') || undefined,
      thumbMediaId: extract('ThumbMediaId') || undefined,
      locationX: extract('Location_X') || undefined,
      locationY: extract('Location_Y') || undefined,
      scale: extract('Scale') || undefined,
      label: extract('Label') || undefined,
      title: extract('Title') || undefined,
      description: extract('Description') || undefined,
      url: extract('Url') || undefined,
      event: extract('Event') || undefined,
      eventKey: extract('EventKey') || undefined,
      ticket: extract('Ticket') || undefined,
    }
  }

  /** 生成被动回复的 XML */
  static buildTextReplyXml(toUser: string, fromUser: string, content: string): string {
    return `<xml>
  <ToUserName><![CDATA[${toUser}]]></ToUserName>
  <FromUserName><![CDATA[${fromUser}]]></FromUserName>
  <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
</xml>`
  }

  /** 生成合成 ID（用于无 MsgId 的消息） */
  static syntheticId(...parts: string[]): string {
    const hash = crypto.createHash('sha1')
    for (const p of parts) {
      hash.update(p)
      hash.update('\0')
    }
    return 'wechatmp_' + hash.digest('hex')
  }
}
