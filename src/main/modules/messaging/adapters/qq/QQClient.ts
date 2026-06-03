/**
 * QQ Bot API 客户端
 *
 * 负责与 QQ 开放平台 API 通信：
 * - OAuth 获取 access_token
 * - 获取 WebSocket Gateway URL
 * - 发送消息（C2C / 群 / 频道）
 * - 上传媒体文件
 */

import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 常量
// ============================================

const QQ_API_BASE = 'https://api.sgroup.qq.com'
const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // 提前 5 分钟刷新

// ============================================
// 类型定义
// ============================================

/** QQ OAuth 令牌缓存 */
interface QQTokenCache {
  accessToken: string
  expiresAt: number
}

/** QQ 消息目标类型 */
export type QQTargetKind = 'c2c' | 'group' | 'channel'

/** QQ 消息目标 */
export interface QQTarget {
  kind: QQTargetKind
  id: string
}

/** QQ API 发送消息响应 */
interface QQMessageResponse {
  id: string
  timestamp?: unknown
}

/** QQ API 上传媒体响应 */
interface QQUploadResponse {
  file_uuid?: string
  file_info: string
  ttl?: number
}

/** C2C 消息事件 */
export interface C2CMessageEvent {
  author: {
    user_openid: string
    union_openid?: string
  }
  content: string
  id: string
  timestamp: string
  attachments?: MessageAttachment[]
  message_reference?: { message_id?: string }
}

/** 群 @ 消息事件 */
export interface GroupMessageEvent {
  author: {
    member_openid: string
  }
  content: string
  id: string
  timestamp: string
  group_id?: string
  group_openid: string
  attachments?: MessageAttachment[]
  message_reference?: { message_id?: string }
}

/** 频道消息事件 */
export interface GuildMessageEvent {
  id: string
  channel_id: string
  guild_id?: string
  content: string
  timestamp: string
  author: {
    id: string
    username?: string
    bot?: boolean
  }
  attachments?: MessageAttachment[]
  message_reference?: { message_id?: string }
}

/** 消息附件 */
export interface MessageAttachment {
  content_type?: string
  filename?: string
  height?: number
  width?: number
  size?: number
  url?: string
  voice_wav_url?: string
}

// ============================================
// QQClient 实现
// ============================================

export class QQClient {
  private appId: string
  private clientSecret: string
  private apiBaseURL: string
  private tokenURL: string

  private tokenCache: QQTokenCache | null = null
  /** 消息序号（按 replyTo 分组） */
  private msgSeqMap = new Map<string, number>()

  constructor(appId: string, clientSecret: string, apiBaseURL?: string, tokenURL?: string) {
    this.appId = appId
    this.clientSecret = clientSecret
    this.apiBaseURL = apiBaseURL || QQ_API_BASE
    this.tokenURL = tokenURL || QQ_TOKEN_URL
  }

  /** 检查配置是否匹配（用于复用客户端实例） */
  matches(appId: string, clientSecret: string): boolean {
    return this.appId === appId && this.clientSecret === clientSecret
  }

  /** 清除令牌缓存（401 时强制刷新） */
  clearToken(): void {
    this.tokenCache = null
  }

  // ============================================
  // OAuth
  // ============================================

  /** 获取 access_token，自动缓存和刷新 */
  async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
      return this.tokenCache.accessToken
    }

    const payload = { appId: this.appId, clientSecret: this.clientSecret }
    const resp = await fetch(this.tokenURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const raw = await resp.json() as Record<string, unknown>
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`QQ token request failed: status=${resp.status}, body=${JSON.stringify(raw)}`)
    }

    const token = raw.access_token as string | undefined
    if (!token || !token.trim()) {
      throw new Error('QQ token response missing access_token')
    }

    const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : 7200
    this.tokenCache = {
      accessToken: token,
      expiresAt: Date.now() + expiresIn * 1000,
    }

    logger.channel.debug(`[QQ] Access token refreshed, expires in ${expiresIn}s`)
    return token
  }

  // ============================================
  // Gateway
  // ============================================

  /** 获取 WebSocket Gateway URL */
  async gatewayURL(): Promise<string> {
    const result = await this.doJSON<{ url: string }>('GET', '/gateway', null)
    if (!result?.url?.trim()) {
      throw new Error('QQ gateway response missing url')
    }
    return result.url
  }

  // ============================================
  // 发送消息
  // ============================================

  /** 发送文本消息 */
  async sendText(target: QQTarget, text: string, replyTo?: string, markdown = false): Promise<QQMessageResponse> {
    text = text.trim()
    if (!text) {
      throw new Error('QQ send text: empty content')
    }

    switch (target.kind) {
      case 'c2c': {
        const path = `/v2/users/${target.id}/messages`
        if (!replyTo) {
          return this.sendProactive(path, text, markdown)
        }
        const body = this.buildReplyTextBody(text, replyTo, this.nextMsgSeq(replyTo), markdown)
        return this.doJSON('POST', path, body)
      }
      case 'group': {
        const path = `/v2/groups/${target.id}/messages`
        if (!replyTo) {
          return this.sendProactive(path, text, markdown)
        }
        const body = this.buildReplyTextBody(text, replyTo, this.nextMsgSeq(replyTo), markdown)
        return this.doJSON('POST', path, body)
      }
      case 'channel': {
        const body: Record<string, unknown> = { content: text }
        if (replyTo?.trim()) {
          body.msg_id = replyTo.trim()
          body.message_reference = { message_id: replyTo.trim() }
        }
        return this.doJSON('POST', `/channels/${target.id}/messages`, body)
      }
      default:
        throw new Error(`QQ unsupported target kind: ${target.kind}`)
    }
  }

  /** 发送「正在输入」提示（仅 C2C） */
  async sendInputHint(openId: string, replyTo: string): Promise<void> {
    if (!openId.trim() || !replyTo.trim()) return
    const body = {
      msg_type: 6,
      input_notify: { input_type: 1, input_second: 60 },
      msg_seq: this.nextMsgSeq(replyTo),
      msg_id: replyTo.trim(),
    }
    await this.doJSON('POST', `/v2/users/${openId}/messages`, body)
  }

  /** 上传媒体文件 */
  async uploadMedia(target: QQTarget, fileType: number, base64Data: string, fileName?: string): Promise<string> {
    base64Data = base64Data.trim()
    if (!base64Data) {
      throw new Error('QQ upload requires file_data')
    }

    const body: Record<string, unknown> = {
      file_type: fileType,
      srv_send_msg: false,
      file_data: base64Data,
    }
    if (fileType === QQMediaType.FILE && fileName?.trim()) {
      body.file_name = fileName.trim()
    }

    let path: string
    switch (target.kind) {
      case 'c2c':
        path = `/v2/users/${target.id}/files`
        break
      case 'group':
        path = `/v2/groups/${target.id}/files`
        break
      default:
        throw new Error(`QQ upload not supported for target kind: ${target.kind}`)
    }

    const result = await this.doJSON<QQUploadResponse>('POST', path, body)
    if (!result?.file_info?.trim()) {
      throw new Error('QQ upload response missing file_info')
    }
    return result.file_info
  }

  /** 发送媒体消息 */
  async sendMedia(target: QQTarget, fileInfo: string, replyTo?: string, content?: string): Promise<QQMessageResponse> {
    const body: Record<string, unknown> = {
      msg_type: 7,
      media: { file_info: fileInfo },
    }
    if (content?.trim()) {
      body.content = content.trim()
    }
    if (replyTo?.trim()) {
      body.msg_id = replyTo.trim()
      body.msg_seq = this.nextMsgSeq(replyTo)
    } else {
      body.msg_seq = 1
    }

    switch (target.kind) {
      case 'c2c':
        return this.doJSON('POST', `/v2/users/${target.id}/messages`, body)
      case 'group':
        return this.doJSON('POST', `/v2/groups/${target.id}/messages`, body)
      default:
        throw new Error(`QQ media send not supported for target kind: ${target.kind}`)
    }
  }

  // ============================================
  // 私有方法
  // ============================================

  /** 主动发送消息（非回复） */
  private async sendProactive(path: string, text: string, markdown: boolean): Promise<QQMessageResponse> {
    const body: Record<string, unknown> = {}
    if (markdown) {
      body.markdown = { content: text }
      body.msg_type = 2
    } else {
      body.content = text
      body.msg_type = 0
    }
    return this.doJSON('POST', path, body)
  }

  /** 构建回复消息体 */
  private buildReplyTextBody(text: string, replyTo: string, seq: number, markdown: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      msg_id: replyTo.trim(),
      msg_seq: seq,
    }
    if (markdown) {
      body.markdown = { content: text }
      body.msg_type = 2
    } else {
      body.content = text
      body.msg_type = 0
    }
    return body
  }

  /** 获取下一个消息序号 */
  private nextMsgSeq(replyTo: string): number {
    if (!replyTo.trim()) return 1
    const next = (this.msgSeqMap.get(replyTo) || 0) + 1
    this.msgSeqMap.set(replyTo, next)
    // 防止内存泄漏
    if (this.msgSeqMap.size > 1024) {
      const keys = Array.from(this.msgSeqMap.keys())
      for (let i = 0; i < keys.length - 512; i++) {
        this.msgSeqMap.delete(keys[i])
      }
    }
    return next
  }

  /** 发送 JSON API 请求（自动重试 401） */
  private async doJSON<T = unknown>(method: string, path: string, payload: unknown): Promise<T> {
    return this.doJSONWithRetry(method, this.apiBaseURL + path, payload, true)
  }

  /** 带重试的 JSON 请求 */
  private async doJSONWithRetry<T = unknown>(method: string, url: string, payload: unknown, auth: boolean): Promise<T> {
    let lastErr: Error | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.doJSONOnce<T>(method, url, payload, auth)
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err))
        if (!auth || !lastErr.message.includes('status=401')) {
          throw lastErr
        }
        this.clearToken()
      }
    }
    throw lastErr
  }

  /** 单次 JSON 请求 */
  private async doJSONOnce<T = unknown>(method: string, url: string, payload: unknown, auth: boolean): Promise<T> {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    if (payload !== null && payload !== undefined) {
      opts.body = JSON.stringify(payload)
    }
    if (auth) {
      const token = await this.accessToken()
      ;(opts.headers as Record<string, string>)['Authorization'] = `QQBot ${token}`
    }

    const resp = await fetch(url, opts)
    const raw = await resp.text()

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`QQ API request failed: method=${method} url=${url} status=${resp.status} body=${raw.trim()}`)
    }

    if (!raw.trim()) return undefined as T
    try {
      return JSON.parse(raw) as T
    } catch {
      throw new Error(`QQ API decode failed: ${raw.substring(0, 200)}`)
    }
  }
}

// ============================================
// 媒体类型常量
// ============================================

export const QQMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  VOICE: 3,
  FILE: 4,
} as const

// ============================================
// 工具函数
// ============================================

/** 解析目标字符串（c2c:xxx / group:xxx / channel:xxx） */
export function parseTarget(raw: string): QQTarget {
  const normalized = raw.trim().toLowerCase()
  if (normalized.startsWith('c2c:')) {
    const id = normalized.slice(4).trim()
    if (!id) throw new Error('QQ target c2c id is required')
    return { kind: 'c2c', id }
  }
  if (normalized.startsWith('group:')) {
    const id = normalized.slice(6).trim()
    if (!id) throw new Error('QQ target group id is required')
    return { kind: 'group', id }
  }
  if (normalized.startsWith('channel:')) {
    const id = normalized.slice(8).trim()
    if (!id) throw new Error('QQ target channel id is required')
    return { kind: 'channel', id }
  }
  throw new Error(`QQ unsupported target: ${raw}`)
}
