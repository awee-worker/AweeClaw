import { logger } from '@shared/toolkit/LogEngine'

/** Discord API 基础地址 */
const DISCORD_API_BASE = 'https://discord.com/api/v10'

/** Discord Gateway 版本 */
const GATEWAY_VERSION = 10

/** Discord 消息最大长度 */
const DISCORD_MAX_CONTENT_LENGTH = 2000

/** Discord Gateway Opcode */
const GatewayOp = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
  INVALID_SESSION: 9,
} as const

/** Gateway 事件类型 */
const GatewayEvent = {
  READY: 'READY',
  RESUMED: 'RESUMED',
  MESSAGE_CREATE: 'MESSAGE_CREATE',
  MESSAGE_UPDATE: 'MESSAGE_UPDATE',
  MESSAGE_DELETE: 'MESSAGE_DELETE',
} as const

// ─── Discord API 类型 ────────────────────────────────────────────

/** Discord 用户 */
export interface DiscordUser {
  id: string
  username: string
  discriminator: string
  bot?: boolean
  avatar?: string
}

/** Discord 消息 */
export interface DiscordMessage {
  id: string
  channel_id: string
  author?: DiscordUser
  content: string
  timestamp: string
  guild_id?: string
  mentions?: DiscordUser[]
  mention_everyone?: boolean
  referenced_message?: DiscordMessage
  attachments?: DiscordAttachment[]
  type?: number
}

/** Discord 附件 */
export interface DiscordAttachment {
  id: string
  filename: string
  size: number
  url: string
  content_type?: string
  width?: number
  height?: number
}

/** Gateway Payload */
interface GatewayPayload {
  op: number
  s?: number | null
  t?: string | null
  d?: unknown
}

/** Ready 事件数据 */
interface ReadyEventData {
  user: DiscordUser
  session_id: string
  resume_gateway_url?: string
  guilds?: unknown[]
}

/** Hello 事件数据 */
interface HelloEventData {
  heartbeat_interval: number
}

// ─── Discord REST API 响应 ───────────────────────────────────────

/** GET /gateway/bot 响应 */
interface GatewayBotResponse {
  url: string
  shards?: number
  session_start_limit?: {
    total: number
    remaining: number
    reset_after: number
    max_concurrency: number
  }
}

/** POST /channels/{id}/messages 响应 */
interface CreateMessageResponse extends DiscordMessage {}

/** POST /users/@me/channels 响应 */
interface CreateDMResponse {
  id: string
  type?: number
  recipients?: DiscordUser[]
}

// ─── DiscordClient ──────────────────────────────────────────────

/**
 * Discord API 客户端
 *
 * 职责：
 * - REST API 调用（获取 Gateway URL、发送消息、创建 DM 等）
 * - Gateway WebSocket 连接管理（心跳、恢复、事件分发）
 * - 消息去重
 */
export class DiscordClient {
  private botToken: string
  private selfUser: DiscordUser | null = null

  // 消息去重
  private seenMessages = new Map<string, number>()
  private static readonly DEDUP_TTL = 60 * 1000 // 1 分钟

  // Gateway 连接状态
  private sessionId: string | null = null
  private resumeUrl: string | null = null
  private sequence: number | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private ws: WebSocket | null = null

  constructor(botToken: string) {
    this.botToken = botToken
  }

  // ─── 认证 ─────────────────────────────────────────────────────

  /** 获取当前 bot 用户信息 */
  async getSelfUser(): Promise<DiscordUser> {
    const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: { 'Authorization': `Bot ${this.botToken}` },
    })
    if (!response.ok) {
      throw new Error(`Discord getSelfUser failed: ${response.status}`)
    }
    const user = await response.json() as DiscordUser
    this.selfUser = user
    return user
  }

  /** 获取缓存的 bot 用户 */
  getSelfUserId(): string | null {
    return this.selfUser?.id ?? null
  }

  // ─── 消息发送 ─────────────────────────────────────────────────

  /** 发送消息到频道 */
  async createMessage(channelId: string, content: string, messageReference?: { message_id: string }): Promise<CreateMessageResponse> {
    const body: Record<string, unknown> = {
      content: DiscordClient.truncateContent(content),
    }
    if (messageReference) {
      body.message_reference = {
        message_id: messageReference.message_id,
        channel_id: channelId,
      }
    }

    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const errBody = await response.text()
      throw new Error(`Discord createMessage failed: ${response.status} ${errBody}`)
    }
    return response.json() as Promise<CreateMessageResponse>
  }

  /** 触发输入指示器 */
  async triggerTypingIndicator(channelId: string): Promise<void> {
    await fetch(`${DISCORD_API_BASE}/channels/${channelId}/typing`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${this.botToken}` },
    })
  }

  // ─── DM 会话 ──────────────────────────────────────────────────

  /** 创建 DM 频道 */
  async createDM(userId: string): Promise<string | null> {
    const response = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${this.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: userId }),
    })
    if (!response.ok) return null
    const data = await response.json() as CreateDMResponse
    return data.id
  }

  // ─── 消息去重 ─────────────────────────────────────────────────

  /** 检查消息是否重复 */
  isDuplicate(configId: string, messageId: string): boolean {
    const key = `${configId}:${messageId}`
    const seen = this.seenMessages.get(key)
    if (seen && Date.now() - seen < DiscordClient.DEDUP_TTL) {
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
      if (now - ts >= DiscordClient.DEDUP_TTL) {
        this.seenMessages.delete(key)
      }
    }
  }

  // ─── Gateway WebSocket ────────────────────────────────────────

  /** 建立 Gateway WebSocket 连接 */
  async connectGateway(
    onMessage: (message: DiscordMessage) => void,
    onConnected: () => void,
    onError: (error: Error) => void,
    signal: AbortSignal
  ): Promise<void> {
    // 1. 获取 Gateway URL
    const gatewayUrl = await this.getGatewayUrl()
    if (!gatewayUrl) {
      throw new Error('Failed to get Discord Gateway URL')
    }

    // 2. 优先使用 resume URL
    const connectUrl = this.resumeUrl || `${gatewayUrl}?v=${GATEWAY_VERSION}&encoding=json`

    // 3. 建立 WebSocket
    this.ws = new WebSocket(connectUrl)

    return new Promise((_resolve, reject) => {
      let settled = false

      this.ws!.onopen = () => {
        logger.channel.info('[Discord] Gateway WebSocket connected')
      }

      this.ws!.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as GatewayPayload
          this.handleGatewayPayload(this.ws!, payload, onMessage, onConnected)
        } catch (err) {
          logger.channel.warn(`[Discord] Failed to parse Gateway payload: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      this.ws!.onerror = (event) => {
        const error = new Error('Discord Gateway WebSocket error')
        logger.channel.error(`[Discord] Gateway error: ${String(event)}`)
        onError(error)
        if (!settled) {
          settled = true
          reject(error)
        }
      }

      this.ws!.onclose = (event) => {
        this.stopHeartbeat()
        logger.channel.info(`[Discord] Gateway closed: code=${event.code} reason=${event.reason}`)
        if (!settled) {
          settled = true
          reject(new Error(`Discord Gateway closed: ${event.code}`))
        }
      }

      signal.addEventListener('abort', () => {
        this.stopHeartbeat()
        this.ws?.close()
      })
    })
  }

  /** 关闭 Gateway 连接 */
  disconnectGateway(): void {
    this.stopHeartbeat()
    this.ws?.close()
    this.ws = null
  }

  /** 获取 Gateway Bot URL */
  private async getGatewayUrl(): Promise<string | null> {
    try {
      const response = await fetch(`${DISCORD_API_BASE}/gateway/bot`, {
        headers: { 'Authorization': `Bot ${this.botToken}` },
      })
      if (!response.ok) {
        logger.channel.error(`[Discord] getGatewayUrl failed: ${response.status}`)
        return null
      }
      const data = await response.json() as GatewayBotResponse
      return data.url
    } catch (err) {
      logger.channel.error(`[Discord] getGatewayUrl error: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /** 处理 Gateway Payload */
  private handleGatewayPayload(
    ws: WebSocket,
    payload: GatewayPayload,
    onMessage: (message: DiscordMessage) => void,
    onConnected: () => void
  ): void {
    // 更新序列号
    if (payload.s != null) {
      this.sequence = payload.s
    }

    switch (payload.op) {
      // Hello - 开始心跳和认证
      case GatewayOp.HELLO: {
        const helloData = payload.d as HelloEventData
        this.startHeartbeat(ws, helloData.heartbeat_interval)
        // 如果有 session_id，尝试 Resume，否则 Identify
        if (this.sessionId && this.sequence != null) {
          this.sendResume(ws)
        } else {
          this.sendIdentify(ws)
        }
        break
      }

      // Dispatch - 事件分发
      case GatewayOp.DISPATCH: {
        this.handleDispatch(payload, onMessage, onConnected)
        break
      }

      // Heartbeat ACK
      case GatewayOp.HEARTBEAT_ACK: {
        // 心跳确认，无需处理
        break
      }

      // Reconnect - 服务器要求重连
      case GatewayOp.RECONNECT: {
        logger.channel.info('[Discord] Gateway requested reconnect')
        this.stopHeartbeat()
        ws.close(4000)
        break
      }

      // Invalid Session - 需要重新 Identify
      case GatewayOp.INVALID_SESSION: {
        logger.channel.info('[Discord] Gateway invalid session, re-identifying')
        this.sessionId = null
        this.sequence = null
        this.resumeUrl = null
        this.sendIdentify(ws)
        break
      }

      // Heartbeat - 服务器请求心跳
      case GatewayOp.HEARTBEAT: {
        this.sendHeartbeat(ws)
        break
      }

      default:
        break
    }
  }

  /** 处理 Dispatch 事件 */
  private handleDispatch(
    payload: GatewayPayload,
    onMessage: (message: DiscordMessage) => void,
    onConnected: () => void
  ): void {
    const eventType = payload.t

    switch (eventType) {
      case GatewayEvent.READY: {
        const data = payload.d as ReadyEventData
        this.selfUser = data.user
        this.sessionId = data.session_id
        this.resumeUrl = data.resume_gateway_url || null
        logger.channel.info(`[Discord] Gateway ready: ${data.user.username}#${data.user.discriminator}`)
        onConnected()
        break
      }

      case GatewayEvent.RESUMED: {
        logger.channel.info('[Discord] Gateway resumed')
        onConnected()
        break
      }

      case GatewayEvent.MESSAGE_CREATE: {
        const msg = payload.d as DiscordMessage
        onMessage(msg)
        break
      }

      default:
        break
    }
  }

  /** 发送 Identify */
  private sendIdentify(ws: WebSocket): void {
    const identify = {
      op: GatewayOp.IDENTIFY,
      d: {
        token: this.botToken,
        intents: 1536, // GuildMessages + DirectMessages + MessageContent
        properties: {
          os: 'macos',
          browser: 'aweeclaw',
          device: 'aweeclaw',
        },
      },
    }
    ws.send(JSON.stringify(identify))
    logger.channel.info('[Discord] Gateway Identify sent')
  }

  /** 发送 Resume */
  private sendResume(ws: WebSocket): void {
    const resume = {
      op: GatewayOp.RESUME,
      d: {
        token: this.botToken,
        session_id: this.sessionId,
        seq: this.sequence,
      },
    }
    ws.send(JSON.stringify(resume))
    logger.channel.info('[Discord] Gateway Resume sent')
  }

  /** 启动心跳 */
  private startHeartbeat(ws: WebSocket, intervalMs: number): void {
    this.stopHeartbeat()
    // 首次心跳延迟为 interval * 随机抖动
    const jitter = Math.random()
    const initialDelay = intervalMs * jitter

    setTimeout(() => {
      this.sendHeartbeat(ws)
      this.heartbeatInterval = setInterval(() => {
        this.sendHeartbeat(ws)
      }, intervalMs)
    }, initialDelay)
  }

  /** 停止心跳 */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /** 发送心跳 */
  private sendHeartbeat(ws: WebSocket): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        op: GatewayOp.HEARTBEAT,
        d: this.sequence,
      }))
    }
  }

  // ─── 工具方法 ─────────────────────────────────────────────────

  /** 截断超长消息 */
  static truncateContent(text: string): string {
    if (text.length <= DISCORD_MAX_CONTENT_LENGTH) return text
    return text.substring(0, DISCORD_MAX_CONTENT_LENGTH - 3) + '...'
  }

  /** 判断消息是否提及了 bot */
  isBotMentioned(message: DiscordMessage): boolean {
    if (!this.selfUser) return false
    if (message.mention_everyone) return true
    return message.mentions?.some(m => m.id === this.selfUser!.id) ?? false
  }

  /** 判断消息是否回复了 bot */
  isReplyToBot(message: DiscordMessage): boolean {
    if (!this.selfUser) return false
    return message.referenced_message?.author?.id === this.selfUser.id
  }

  /** 判断频道类型（DM vs Guild） */
  static getChatType(guildId?: string): 'direct' | 'group' {
    return guildId ? 'group' : 'direct'
  }
}
