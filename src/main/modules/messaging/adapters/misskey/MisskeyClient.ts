import { logger } from '@shared/toolkit/LogEngine'

/** Misskey Note 最大长度 */
const MISSKEY_MAX_NOTE_LENGTH = 3000

/** WebSocket Ping 间隔 */
const PING_INTERVAL_MS = 30000

// ─── Misskey API 类型 ───────────────────────────────────────────

/** Misskey 用户 */
export interface MisskeyUser {
  id: string
  username: string
  name?: string
  host?: string
  avatarUrl?: string
}

/** Misskey Note */
export interface MisskeyNote {
  id: string
  text?: string
  cw?: string
  userId: string
  user: MisskeyUser
  replyId?: string
  renoteId?: string
  createdAt: string
  mentions?: string[]
  visibility: string
  reply?: MisskeyNote
  renote?: MisskeyNote
}

/** Misskey 自身用户信息 */
export interface MisskeyMe {
  id: string
  username: string
  name?: string
  avatarUrl?: string
}

/** WebSocket 流消息 */
interface StreamMessage {
  type: string
  body?: unknown
}

/** 频道事件体 */
interface ChannelBody {
  id: string
  type: string
  body?: unknown
}

/** 创建 Note 响应 */
interface CreateNoteResponse {
  createdNote: {
    id: string
    text?: string
    user: MisskeyUser
  }
}

// ─── MisskeyClient ──────────────────────────────────────────────

/**
 * Misskey API 客户端
 *
 * 职责：
 * - REST API 调用（i、notes/create、notes/reactions/create）
 * - WebSocket Streaming 连接（mention/reply 事件接收）
 * - 消息去重
 */
export class MisskeyClient {
  private instanceURL: string
  private accessToken: string
  private selfUser: MisskeyMe | null = null

  // 消息去重
  private seenNotes = new Map<string, number>()
  private static readonly DEDUP_TTL = 60 * 1000 // 1 分钟

  // WebSocket 连接
  private ws: WebSocket | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  constructor(instanceURL: string, accessToken: string) {
    this.instanceURL = instanceURL.replace(/\/+$/, '')
    this.accessToken = accessToken
  }

  // ─── 认证 ─────────────────────────────────────────────────────

  /** 获取 bot 自身信息 */
  async getMe(): Promise<MisskeyMe> {
    const url = `${this.apiBase}/i`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ i: this.accessToken }),
    })
    if (!response.ok) {
      throw new Error(`Misskey getMe failed: ${response.status}`)
    }
    const me = await response.json() as MisskeyMe
    this.selfUser = me
    return me
  }

  /** 获取缓存的 bot 用户 */
  getSelfUser(): MisskeyMe | null {
    return this.selfUser
  }

  // ─── 消息发送 ─────────────────────────────────────────────────

  /** 创建 Note（发帖/回复） */
  async createNote(text: string, replyId?: string, visibility?: string): Promise<CreateNoteResponse> {
    const url = `${this.apiBase}/notes/create`
    const body: Record<string, unknown> = {
      i: this.accessToken,
      text: MisskeyClient.truncateNote(text),
      visibility: visibility || 'home',
    }
    if (replyId) {
      body.replyId = replyId
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const errBody = await response.text()
      throw new Error(`Misskey createNote failed: ${response.status} ${errBody}`)
    }
    return response.json() as Promise<CreateNoteResponse>
  }

  /** 添加 Reaction */
  async createReaction(noteId: string, reaction: string): Promise<void> {
    const url = `${this.apiBase}/notes/reactions/create`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        i: this.accessToken,
        noteId,
        reaction,
      }),
    })
    if (!response.ok) {
      throw new Error(`Misskey createReaction failed: ${response.status}`)
    }
  }

  // ─── 消息去重 ─────────────────────────────────────────────────

  /** 检查 Note 是否重复 */
  isDuplicate(configId: string, noteId: string): boolean {
    const key = `${configId}:${noteId}`
    const seen = this.seenNotes.get(key)
    if (seen && Date.now() - seen < MisskeyClient.DEDUP_TTL) {
      return true
    }
    this.seenNotes.set(key, Date.now())
    this.pruneDedup()
    return false
  }

  /** 清理过期去重记录 */
  private pruneDedup(): void {
    const now = Date.now()
    for (const [key, ts] of this.seenNotes) {
      if (now - ts >= MisskeyClient.DEDUP_TTL) {
        this.seenNotes.delete(key)
      }
    }
  }

  // ─── WebSocket Streaming ──────────────────────────────────────

  /** 建立 WebSocket Streaming 连接 */
  async connectStream(
    onNote: (note: MisskeyNote, eventType: 'mention' | 'reply') => void,
    onConnected: () => void,
    onError: (error: Error) => void,
    signal: AbortSignal
  ): Promise<void> {
    const streamUrl = this.getStreamURL()

    this.ws = new WebSocket(streamUrl)

    return new Promise((resolve, reject) => {
      let settled = false

      this.ws!.onopen = () => {
        logger.channel.info('[Misskey] Streaming WebSocket connected')

        // 订阅 main 频道以接收 mention/reply
        this.subscribeChannel('main', 'memoh-main')

        // 启动心跳
        this.startPing()

        onConnected()
        if (!settled) {
          settled = true
          resolve()
        }
      }

      this.ws!.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as StreamMessage
          this.handleStreamMessage(msg, onNote)
        } catch (err) {
          logger.channel.warn(`[Misskey] Failed to parse stream message: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      this.ws!.onerror = (event) => {
        const error = new Error('Misskey Streaming WebSocket error')
        logger.channel.error(`[Misskey] Stream error: ${String(event)}`)
        this.stopPing()
        onError(error)
        if (!settled) {
          settled = true
          reject(error)
        }
      }

      this.ws!.onclose = (event) => {
        this.stopPing()
        logger.channel.info(`[Misskey] Stream closed: code=${event.code} reason=${event.reason}`)
        if (!settled) {
          settled = true
          reject(new Error(`Misskey Stream closed: ${event.code}`))
        }
      }

      signal.addEventListener('abort', () => {
        this.stopPing()
        this.ws?.close()
      })
    })
  }

  /** 断开 Streaming 连接 */
  disconnectStream(): void {
    this.stopPing()
    this.ws?.close()
    this.ws = null
  }

  /** 获取 Streaming WebSocket URL */
  private getStreamURL(): string {
    let base = this.instanceURL
    base = base.replace('https://', 'wss://').replace('http://', 'ws://')
    return `${base}/streaming?i=${this.accessToken}`
  }

  /** 订阅频道 */
  private subscribeChannel(channel: string, id: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'connect',
        body: { channel, id },
      }))
      logger.channel.info(`[Misskey] Subscribed to channel: ${channel}`)
    }
  }

  /** 处理流消息 */
  private handleStreamMessage(
    msg: StreamMessage,
    onNote: (note: MisskeyNote, eventType: 'mention' | 'reply') => void
  ): void {
    if (msg.type !== 'channel' || !msg.body) return

    const body = msg.body as ChannelBody

    switch (body.type) {
      case 'mention':
      case 'reply': {
        const note = body.body as MisskeyNote
        // 过滤自身消息
        if (this.selfUser && note.userId === this.selfUser.id) return
        onNote(note, body.type as 'mention' | 'reply')
        break
      }

      default:
        break
    }
  }

  /** 启动心跳 */
  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL_MS)
  }

  /** 停止心跳 */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  // ─── 工具方法 ─────────────────────────────────────────────────

  /** 截断超长 Note */
  static truncateNote(text: string): string {
    if (text.length <= MISSKEY_MAX_NOTE_LENGTH) return text
    return text.substring(0, MISSKEY_MAX_NOTE_LENGTH - 3) + '...'
  }

  /** 获取 API 基础地址 */
  private get apiBase(): string {
    return `${this.instanceURL}/api`
  }

  /** 判断 Chat 类型（specified = DM，其他 = group） */
  static getChatType(visibility?: string): 'direct' | 'group' {
    return visibility === 'specified' ? 'direct' : 'group'
  }

  /** 从 Note 文本中移除 @bot 提及 */
  stripBotMention(text: string): string {
    if (!this.selfUser) return text
    const mention = `@${this.selfUser.username}`
    return text.replace(mention, '').trim()
  }

  /** 判断是否被提及 */
  isMentioned(note: MisskeyNote): boolean {
    if (!this.selfUser) return false
    return note.mentions?.includes(this.selfUser.id) ?? false
  }
}
