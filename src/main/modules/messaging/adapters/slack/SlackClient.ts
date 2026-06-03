import { logger } from '@shared/toolkit/LogEngine'

/** Slack API 基础地址 */
const SLACK_API_BASE = 'https://slack.com/api'

/** Slack 消息最大长度 */
const SLACK_MAX_TEXT_LENGTH = 40000

/** Slack API 通用响应 */
interface SlackApiResponse {
  ok: boolean
  error?: string
  warning?: string
}

/** auth.test 响应 */
interface AuthTestResponse extends SlackApiResponse {
  user_id?: string
  user?: string
  team_id?: string
  team?: string
  bot_id?: string
}

/** chat.postMessage 响应 */
interface PostMessageResponse extends SlackApiResponse {
  ts?: string
  channel?: string
  message?: {
    bot_id?: string
    type?: string
    text?: string
    user?: string
    ts?: string
    team?: string
    bot_profile?: Record<string, unknown>
  }
}

/** conversations.open 响应 */
interface OpenConversationResponse extends SlackApiResponse {
  channel?: {
    id: string
    name?: string
    is_im?: boolean
    is_mpim?: boolean
    is_group?: boolean
    is_channel?: boolean
  }
}

/** users.info 响应 */
interface UserInfoResponse extends SlackApiResponse {
  user?: {
    id: string
    name?: string
    real_name?: string
    profile?: {
      display_name?: string
      real_name?: string
    }
  }
}

/** conversations.info 响应 */
interface ConversationInfoResponse extends SlackApiResponse {
  channel?: {
    id: string
    name?: string
    is_im?: boolean
    is_mpim?: boolean
    is_group?: boolean
    is_channel?: boolean
  }
}

/** Socket Mode WebSocket 消息 */
interface SocketModeMessage {
  type?: string
  envelope_id?: string
  payload?: Record<string, unknown>
  retry_attempt?: number
  retry_reason?: string
}

/** Events API 内部事件 */
export interface SlackEvent {
  type?: string
  user?: string
  bot_id?: string
  text?: string
  ts?: string
  channel?: string
  channel_type?: string
  thread_ts?: string
  subtype?: string
  files?: SlackFile[]
}

/** Slack 文件信息 */
export interface SlackFile {
  id?: string
  name?: string
  mimetype?: string
  size?: number
  url_private?: string
  url_private_download?: string
}

/**
 * Slack API 客户端
 *
 * 职责：
 * - REST API 调用（auth.test、chat.postMessage、conversations.open 等）
 * - Socket Mode WebSocket 连接管理
 * - 消息去重
 * - 用户/频道信息缓存
 */
export class SlackClient {
  private botToken: string
  private appToken: string
  private selfUserId: string | null = null

  // 用户名缓存
  private userNameCache = new Map<string, { name: string; cachedAt: number }>()
  // 频道名缓存
  private channelInfoCache = new Map<string, { name: string; type: string; cachedAt: number }>()
  // 消息去重
  private seenMessages = new Map<string, number>()

  private static readonly CACHE_TTL = 5 * 60 * 1000 // 5 分钟
  private static readonly DEDUP_TTL = 60 * 1000 // 1 分钟

  constructor(botToken: string, appToken: string) {
    this.botToken = botToken
    this.appToken = appToken
  }

  // ─── 认证 ─────────────────────────────────────────────────────

  /** 验证 Bot Token 有效性，获取 bot 自身 user_id */
  async authTest(): Promise<AuthTestResponse> {
    const response = await fetch(`${SLACK_API_BASE}/auth.test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
    })
    const result = await response.json() as AuthTestResponse
    if (result.ok && result.user_id) {
      this.selfUserId = result.user_id
    }
    return result
  }

  /** 获取缓存的 bot user_id */
  getSelfUserId(): string | null {
    return this.selfUserId
  }

  // ─── 消息发送 ─────────────────────────────────────────────────

  /** 发送消息到频道或 DM */
  async postMessage(channel: string, text: string, threadTs?: string): Promise<PostMessageResponse> {
    const body: Record<string, unknown> = {
      channel,
      text: SlackClient.truncateText(text),
    }
    if (threadTs) {
      body.thread_ts = threadTs
    }

    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return response.json() as Promise<PostMessageResponse>
  }

  // ─── 会话管理 ─────────────────────────────────────────────────

  /** 打开 DM 会话 */
  async openConversation(userId: string): Promise<string | null> {
    const response = await fetch(`${SLACK_API_BASE}/conversations.open`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ users: userId }),
    })
    const result = await response.json() as OpenConversationResponse
    if (!result.ok || !result.channel) return null
    return result.channel.id
  }

  // ─── 信息查询 ─────────────────────────────────────────────────

  /** 获取用户显示名 */
  async getUserDisplayName(userId: string): Promise<string> {
    const cached = this.userNameCache.get(userId)
    if (cached && Date.now() - cached.cachedAt < SlackClient.CACHE_TTL) {
      return cached.name
    }

    try {
      const response = await fetch(`${SLACK_API_BASE}/users.info?user=${userId}`, {
        headers: { 'Authorization': `Bearer ${this.botToken}` },
      })
      const result = await response.json() as UserInfoResponse
      if (result.ok && result.user) {
        const name = result.user.profile?.display_name
          || result.user.profile?.real_name
          || result.user.real_name
          || result.user.name
          || userId
        this.userNameCache.set(userId, { name, cachedAt: Date.now() })
        return name
      }
    } catch (err) {
      logger.channel.warn(`[Slack] getUserDisplayName failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return userId
  }

  /** 获取频道信息 */
  async getConversationInfo(channelId: string): Promise<{ name: string; type: string } | null> {
    const cached = this.channelInfoCache.get(channelId)
    if (cached && Date.now() - cached.cachedAt < SlackClient.CACHE_TTL) {
      return cached
    }

    try {
      const response = await fetch(`${SLACK_API_BASE}/conversations.info?channel=${channelId}`, {
        headers: { 'Authorization': `Bearer ${this.botToken}` },
      })
      const result = await response.json() as ConversationInfoResponse
      if (result.ok && result.channel) {
        const ch = result.channel
        let type = 'channel'
        if (ch.is_im) type = 'im'
        else if (ch.is_mpim) type = 'mpim'
        else if (ch.is_group) type = 'group'

        const info = { name: ch.name || channelId, type }
        this.channelInfoCache.set(channelId, { ...info, cachedAt: Date.now() })
        return info
      }
    } catch (err) {
      logger.channel.warn(`[Slack] getConversationInfo failed for ${channelId}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return null
  }

  // ─── 消息去重 ─────────────────────────────────────────────────

  /** 检查消息是否重复 */
  isDuplicate(configId: string, messageTs: string): boolean {
    const key = `${configId}:${messageTs}`
    const seen = this.seenMessages.get(key)
    if (seen && Date.now() - seen < SlackClient.DEDUP_TTL) {
      return true
    }
    this.seenMessages.set(key, Date.now())
    this.pruneDedup()
    return false
  }

  /** 清理过期去重记录 */
  private pruneDedup(): void {
    const now = Date.now()
    for (const [key, ts] of this.seenMessages) {
      if (now - ts >= SlackClient.DEDUP_TTL) {
        this.seenMessages.delete(key)
      }
    }
  }

  // ─── Socket Mode ──────────────────────────────────────────────

  /** 建立 Socket Mode WebSocket 连接 */
  async connectSocketMode(
    onMessage: (event: SlackEvent) => void,
    onConnected: () => void,
    onError: (error: Error) => void,
    signal: AbortSignal
  ): Promise<void> {
    // 1. 获取 Socket Mode 连接 URL
    const connectUrl = await this.getSocketModeUrl()
    if (!connectUrl) {
      throw new Error('Failed to get Slack Socket Mode connection URL')
    }

    // 2. 建立 WebSocket 连接
    const ws = new WebSocket(connectUrl)

    return new Promise((resolve, reject) => {
      let settled = false

      ws.onopen = () => {
        logger.channel.info('[Slack] Socket Mode WebSocket connected')
        onConnected()
        if (!settled) {
          settled = true
          resolve()
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as SocketModeMessage
          this.handleSocketModeMessage(ws, msg, onMessage)
        } catch (err) {
          logger.channel.warn(`[Slack] Failed to parse Socket Mode message: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      ws.onerror = (event) => {
        const error = new Error('Slack Socket Mode WebSocket error')
        logger.channel.error(`[Slack] Socket Mode error: ${String(event)}`)
        onError(error)
        if (!settled) {
          settled = true
          reject(error)
        }
      }

      ws.onclose = (event) => {
        logger.channel.info(`[Slack] Socket Mode WebSocket closed: code=${event.code} reason=${event.reason}`)
        if (!settled) {
          settled = true
          reject(new Error(`Slack Socket Mode closed: ${event.code}`))
        }
      }

      signal.addEventListener('abort', () => {
        ws.close()
      })
    })
  }

  /** 获取 Socket Mode 连接 URL */
  private async getSocketModeUrl(): Promise<string | null> {
    try {
      const response = await fetch(`${SLACK_API_BASE}/apps.connections.open`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.appToken}`,
          'Content-Type': 'application/json',
        },
      })
      const result = await response.json() as { ok: boolean; url?: string; error?: string }
      if (result.ok && result.url) {
        return result.url
      }
      logger.channel.error(`[Slack] Failed to get Socket Mode URL: ${result.error}`)
      return null
    } catch (err) {
      logger.channel.error(`[Slack] getSocketModeUrl failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /** 处理 Socket Mode 消息 */
  private handleSocketModeMessage(
    ws: WebSocket,
    msg: SocketModeMessage,
    onEvent: (event: SlackEvent) => void
  ): void {
    switch (msg.type) {
      // hello 消息
      case 'hello':
        logger.channel.info('[Slack] Socket Mode hello received')
        break

      // Events API 事件
      case 'events_api':
        // ACK 确认
        if (msg.envelope_id) {
          ws.send(JSON.stringify({ envelope_id: msg.envelope_id }))
        }
        // 提取内部事件
        if (msg.payload) {
          const payload = msg.payload as { event?: SlackEvent; type?: string }
          if (payload.event) {
            onEvent(payload.event)
          }
        }
        break

      // 交互事件
      case 'interactive':
        if (msg.envelope_id) {
          ws.send(JSON.stringify({ envelope_id: msg.envelope_id }))
        }
        break

      // Slash 命令
      case 'slash_commands':
        if (msg.envelope_id) {
          ws.send(JSON.stringify({ envelope_id: msg.envelope_id }))
        }
        break

      // 重连提示
      case 'disconnect':
        logger.channel.info('[Slack] Socket Mode disconnect requested, will reconnect')
        ws.close()
        break

      default:
        // 忽略其他类型
        break
    }
  }

  // ─── 工具方法 ─────────────────────────────────────────────────

  /** 截断超长文本 */
  static truncateText(text: string): string {
    if (text.length <= SLACK_MAX_TEXT_LENGTH) return text
    return text.substring(0, SLACK_MAX_TEXT_LENGTH - 3) + '...'
  }

  /** 判断频道类型 */
  static getChatType(channelType?: string): 'direct' | 'group' {
    switch (channelType) {
      case 'im':
        return 'direct'
      case 'mpim':
      case 'group':
      case 'channel':
        return 'group'
      default:
        return 'group'
    }
  }
}
