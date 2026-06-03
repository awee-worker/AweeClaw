/**
 * 钉钉（DingTalk）API 客户端
 *
 * 负责与钉钉开放平台 API 通信：
 * - OAuth 获取 access_token
 * - Stream 模式注册连接凭证（获取 WebSocket endpoint + ticket）
 * - 发送消息（sessionWebhook / REST API）
 * - 上传媒体文件
 */

import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 常量
// ============================================

const DINGTALK_API_BASE = 'https://oapi.dingtalk.com'
const DINGTALK_NEW_API_BASE = 'https://api.dingtalk.com'
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // 提前 5 分钟刷新

// ============================================
// 类型定义
// ============================================

/** 钉钉 OAuth 令牌缓存 */
interface DingTalkTokenCache {
  accessToken: string
  expiresAt: number
}

/** Stream 连接凭证响应 */
export interface StreamCredential {
  endpoint: string
  ticket: string
}

/** 机器人消息回调数据 */
export interface BotMessageData {
  msgtype: string
  text?: { content: string }
  content?: string
  msgId: string
  createAt: string
  conversationType: '1' | '2' // 1=单聊, 2=群聊
  conversationId: string
  conversationTitle?: string
  senderId: string
  senderNick: string
  senderStaffId?: string
  senderCorpId?: string
  sessionWebhook: string
  sessionWebhookExpiredTime: number
  isAdmin?: boolean
  isInAtList?: boolean
  chatbotCorpId?: string
  chatbotUserId?: string
  atUsers?: Array<{ dingtalkId: string; staffId?: string }>
  // 图片消息
  content_downloadCode?: string
  // 富文本
  richText?: Array<Record<string, string>>
}

/** Stream 推送消息信封 */
export interface StreamEnvelope {
  headers: {
    messageId: string
    topic: string
    contentType: string
    createTime: string
  }
  data: string // JSON 字符串
}

/** 发送消息响应 */
interface SendMessageResponse {
  errcode: number
  errmsg: string
  open_message_id?: string
  open_conversation_id?: string
}

// ============================================
// DingTalkClient 实现
// ============================================

export class DingTalkClient {
  private clientId: string
  private clientSecret: string
  private robotCode: string

  private tokenCache: DingTalkTokenCache | null = null

  constructor(clientId: string, clientSecret: string, robotCode?: string) {
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.robotCode = robotCode || clientId // 默认使用 clientId 作为 robotCode
  }

  /** 检查配置是否匹配 */
  matches(clientId: string, clientSecret: string): boolean {
    return this.clientId === clientId && this.clientSecret === clientSecret
  }

  /** 清除令牌缓存 */
  clearToken(): void {
    this.tokenCache = null
  }

  // ============================================
  // OAuth
  // ============================================

  /** 获取企业内部应用 access_token */
  async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
      return this.tokenCache.accessToken
    }

    const url = `${DINGTALK_API_BASE}/gettoken?appkey=${encodeURIComponent(this.clientId)}&appsecret=${encodeURIComponent(this.clientSecret)}`
    const resp = await fetch(url, { method: 'GET' })

    const raw = await resp.json() as Record<string, unknown>
    if (raw.errcode !== 0) {
      throw new Error(`DingTalk token request failed: errcode=${raw.errcode}, errmsg=${raw.errmsg}`)
    }

    const token = raw.access_token as string | undefined
    if (!token || !token.trim()) {
      throw new Error('DingTalk token response missing access_token')
    }

    const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : 7200
    this.tokenCache = {
      accessToken: token,
      expiresAt: Date.now() + expiresIn * 1000,
    }

    logger.channel.debug(`[DingTalk] Access token refreshed, expires in ${expiresIn}s`)
    return token
  }

  // ============================================
  // Stream 模式
  // ============================================

  /** 注册 Stream 连接凭证，获取 WebSocket endpoint 和 ticket */
  async getStreamCredential(): Promise<StreamCredential> {
    const url = `${DINGTALK_NEW_API_BASE}/v1.0/gateway/connections/open`
    const body = {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      subscriptions: [
        { type: 'CALLBACK', topic: '/v1.0/im/bot/messages/get' },
      ],
      ua: 'aweeclaw-dingtalk-stream/1.0.0',
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const raw = await resp.json() as Record<string, unknown>
    if (!raw.endpoint || !raw.ticket) {
      throw new Error(`DingTalk stream credential failed: ${JSON.stringify(raw)}`)
    }

    return {
      endpoint: raw.endpoint as string,
      ticket: raw.ticket as string,
    }
  }

  // ============================================
  // 发送消息
  // ============================================

  /** 通过 sessionWebhook 回复消息（优先使用，35 分钟内有效） */
  async replyViaSessionWebhook(webhookUrl: string, text: string, atUserIds?: string[]): Promise<SendMessageResponse> {
    const body: Record<string, unknown> = {
      msgtype: 'markdown',
      markdown: { title: '回复', text },
    }
    if (atUserIds && atUserIds.length > 0) {
      body.at = { atUserIds, isAtAll: false }
    }

    return this.doPost<SendMessageResponse>(webhookUrl, body, false)
  }

  /** 通过 REST API 发送群聊消息（兜底方式） */
  async sendGroupMessage(conversationId: string, text: string, atUserIds?: string[]): Promise<SendMessageResponse> {
    const token = await this.accessToken()
    const url = `${DINGTALK_NEW_API_BASE}/v1.0/robot/oToMessages/batchSend`

    const body: Record<string, unknown> = {
      robotCode: this.robotCode,
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ title: '回复', text }),
      conversationId,
      userIds: atUserIds || [],
    }

    return this.doPost<SendMessageResponse>(url, body, true, token)
  }

  /** 通过 REST API 发送单聊消息 */
  async sendSingleMessage(userId: string, text: string): Promise<SendMessageResponse> {
    const token = await this.accessToken()
    const url = `${DINGTALK_NEW_API_BASE}/v1.0/robot/oToMessages/batchSend`

    const body: Record<string, unknown> = {
      robotCode: this.robotCode,
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ title: '回复', text }),
      userIds: [userId],
    }

    return this.doPost<SendMessageResponse>(url, body, true, token)
  }

  // ============================================
  // 私有方法
  // ============================================

  /** 发送 POST 请求 */
  private async doPost<T = unknown>(url: string, body: unknown, auth: boolean, token?: string): Promise<T> {
    let lastErr: Error | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const opts: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }

        if (auth) {
          const accessToken = token || await this.accessToken()
          ;(opts.headers as Record<string, string>)['x-acs-dingtalk-access-token'] = accessToken
        }

        const resp = await fetch(url, opts)
        const raw = await resp.json() as Record<string, unknown>

        if (resp.status === 401 && auth) {
          this.clearToken()
          lastErr = new Error(`DingTalk API 401: ${JSON.stringify(raw)}`)
          continue
        }

        if (resp.status < 200 || resp.status >= 300) {
          throw new Error(`DingTalk API error: status=${resp.status}, body=${JSON.stringify(raw)}`)
        }

        return raw as T
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err))
        if (!lastErr.message.includes('401')) throw lastErr
      }
    }

    throw lastErr
  }
}
