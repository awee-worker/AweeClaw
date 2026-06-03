import { logger } from '@shared/toolkit/LogEngine'

/** 消息去重 TTL（10 分钟） */
const DEDUP_TTL_MS = 10 * 60 * 1000

// ─── Matrix API 类型 ────────────────────────────────────────────

/** Matrix /sync 响应 */
export interface MatrixSyncResponse {
  next_batch: string
  rooms?: {
    join?: Record<string, MatrixJoinedRoom>
    invite?: Record<string, MatrixInvitedRoom>
  }
  account_data?: {
    events?: MatrixSyncEvent[]
  }
}

/** 已加入房间 */
export interface MatrixJoinedRoom {
  timeline?: {
    events?: MatrixEvent[]
  }
  summary?: {
    'm.joined_member_count'?: number
    'm.invited_member_count'?: number
  }
}

/** 被邀请房间 */
interface MatrixInvitedRoom {
  invite_state?: {
    events?: MatrixEvent[]
  }
}

/** sync account_data 事件 */
interface MatrixSyncEvent {
  type: string
  content?: Record<string, unknown>
}

/** Matrix 事件 */
export interface MatrixEvent {
  event_id: string
  sender: string
  type: string
  origin_server_ts: number
  content: Record<string, unknown>
  unsigned?: Record<string, unknown>
  room_id?: string
  state_key?: string
}

/** 发送消息响应 */
interface MatrixSendResponse {
  event_id: string
}

/** whoami 响应 */
interface MatrixWhoAmIResponse {
  user_id: string
  device_id?: string
}

/** 创建房间响应 */
interface MatrixCreateRoomResponse {
  room_id: string
}

/** 房间别名解析响应 */
interface MatrixRoomAliasResponse {
  room_id: string
}

/** 已加入房间列表响应 */
interface MatrixJoinedRoomsResponse {
  joined_rooms: string[]
}

/** 房间成员响应 */
interface MatrixJoinedMembersResponse {
  joined: Record<string, { display_name?: string; avatar_url?: string }>
}

// ─── MatrixClient ───────────────────────────────────────────────

/**
 * Matrix API 客户端
 *
 * 职责：
 * - /sync Long Polling 接收消息
 * - 消息发送（m.room.message）
 * - 房间加入 / 创建 / 解析
 * - 消息去重
 * - 自动接受邀请
 */
export class MatrixClient {
  private homeserverURL: string
  private accessToken: string
  private userID: string
  private syncTimeoutMs: number
  private autoJoinInvites: boolean

  // 同步游标
  private sinceToken: string | null = null

  // 消息去重
  private seenEvents = new Map<string, number>()

  // 事务 ID 计数器
  private txnCounter = 0

  // 私聊房间缓存
  private directRoomCache = new Map<string, string>()

  constructor(
    homeserverURL: string,
    accessToken: string,
    userID: string,
    syncTimeoutSeconds?: number,
    autoJoinInvites?: boolean
  ) {
    this.homeserverURL = homeserverURL.replace(/\/+$/, '')
    this.accessToken = accessToken
    this.userID = userID
    this.syncTimeoutMs = (syncTimeoutSeconds ?? 30) * 1000
    this.autoJoinInvites = autoJoinInvites ?? true
  }

  // ─── 认证 ─────────────────────────────────────────────────────

  /** 验证 Access Token（调用 /account/whoami） */
  async whoAmI(): Promise<MatrixWhoAmIResponse> {
    const data = await this.doGet('/_matrix/client/v3/account/whoami')
    return data as MatrixWhoAmIResponse
  }

  /** 验证 Homeserver 可用性 */
  async validateHomeserver(): Promise<void> {
    const resp = await fetch(`${this.homeserverURL}/_matrix/client/versions`, {
      headers: this.authHeaders(),
    })
    if (!resp.ok) {
      throw new Error(`Matrix homeserver validation failed: ${resp.status}`)
    }
  }

  // ─── /sync Long Polling ───────────────────────────────────────

  /** 执行一次 /sync 请求 */
  async syncOnce(signal?: AbortSignal): Promise<MatrixSyncResponse> {
    const params = new URLSearchParams()
    params.set('timeout', String(this.syncTimeoutMs))
    if (this.sinceToken) {
      params.set('since', this.sinceToken)
    }

    const url = `/_matrix/client/v3/sync?${params.toString()}`
    const data = await this.doGet(url, signal)
    const resp = data as MatrixSyncResponse

    if (resp.next_batch) {
      this.sinceToken = resp.next_batch
    }

    return resp
  }

  /** 初始化同步游标（首次 /sync with timeout=0） */
  async bootstrapSince(): Promise<string> {
    const params = new URLSearchParams()
    params.set('timeout', '0')
    const data = await this.doGet(`/_matrix/client/v3/sync?${params.toString()}`)
    const resp = data as MatrixSyncResponse
    if (resp.next_batch) {
      this.sinceToken = resp.next_batch
    }
    return this.sinceToken || ''
  }

  /** 获取当前同步游标 */
  getSinceToken(): string | null {
    return this.sinceToken
  }

  /** 设置同步游标（用于恢复） */
  setSinceToken(token: string): void {
    this.sinceToken = token
  }

  // ─── 消息发送 ─────────────────────────────────────────────────

  /** 发送文本消息到房间 */
  async sendTextMessage(roomId: string, text: string, replyToEventId?: string): Promise<string> {
    const content: Record<string, unknown> = {
      msgtype: 'm.notice',
      body: text,
    }

    // HTML 格式支持
    if (text.includes('<') && text.includes('>')) {
      content.format = 'org.matrix.custom.html'
      content.formatted_body = text
    }

    // 回复
    if (replyToEventId) {
      content['m.relates_to'] = {
        'm.in_reply_to': { event_id: replyToEventId },
      }
    }

    return this.sendEvent(roomId, 'm.room.message', content)
  }

  /** 发送事件到房间 */
  async sendEvent(roomId: string, eventType: string, content: Record<string, unknown>): Promise<string> {
    const txnId = this.nextTxnId()
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${encodeURIComponent(txnId)}`
    const data = await this.doPut(path, content)
    const resp = data as MatrixSendResponse
    return resp.event_id
  }

  // ─── 房间操作 ─────────────────────────────────────────────────

  /** 加入房间 */
  async joinRoom(roomIdOrAlias: string): Promise<void> {
    const path = `/_matrix/client/v3/join/${encodeURIComponent(roomIdOrAlias)}`
    await this.doPost(path, {})
  }

  /** 创建私聊房间 */
  async createDirectRoom(targetUserId: string): Promise<string> {
    const body = {
      invite: [targetUserId],
      is_direct: true,
      preset: 'trusted_private_chat',
    }
    const data = await this.doPost('/_matrix/client/v3/createRoom', body)
    const resp = data as MatrixCreateRoomResponse
    return resp.room_id
  }

  /** 解析房间别名为房间 ID */
  async resolveRoomAlias(roomAlias: string): Promise<string> {
    const path = `/_matrix/client/v3/directory/room/${encodeURIComponent(roomAlias)}`
    const data = await this.doGet(path)
    const resp = data as MatrixRoomAliasResponse
    return resp.room_id
  }

  /** 获取已加入房间列表 */
  async getJoinedRooms(): Promise<string[]> {
    const data = await this.doGet('/_matrix/client/v3/joined_rooms')
    const resp = data as MatrixJoinedRoomsResponse
    return resp.joined_rooms || []
  }

  /** 获取房间成员 */
  async getJoinedMembers(roomId: string): Promise<Record<string, { display_name?: string; avatar_url?: string }>> {
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`
    const data = await this.doGet(path)
    const resp = data as MatrixJoinedMembersResponse
    return resp.joined || {}
  }

  /** 确保与目标用户的私聊房间存在 */
  async ensureDirectRoom(targetUserId: string): Promise<string> {
    // 检查缓存
    const cached = this.directRoomCache.get(targetUserId)
    if (cached) return cached

    // 查找已有私聊房间
    try {
      const rooms = await this.getJoinedRooms()
      for (const roomId of rooms) {
        const members = await this.getJoinedMembers(roomId)
        const memberIds = Object.keys(members)
        if (
          memberIds.length === 2 &&
          memberIds.includes(targetUserId) &&
          memberIds.includes(this.userID)
        ) {
          this.directRoomCache.set(targetUserId, roomId)
          return roomId
        }
      }
    } catch (err) {
      logger.channel.warn(`[Matrix] Failed to find existing direct room: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 创建新私聊房间
    const roomId = await this.createDirectRoom(targetUserId)
    this.directRoomCache.set(targetUserId, roomId)
    return roomId
  }

  /** 解析发送目标为房间 ID */
  async resolveRoomTarget(target: string): Promise<string> {
    const normalized = target.trim()
    if (normalized.startsWith('!')) return normalized
    if (normalized.startsWith('#')) return this.resolveRoomAlias(normalized)
    if (normalized.startsWith('@')) return this.ensureDirectRoom(normalized)
    throw new Error(`Invalid Matrix target: ${target}`)
  }

  // ─── 消息去重 ─────────────────────────────────────────────────

  /** 检查事件是否重复 */
  isDuplicate(configId: string, eventId: string): boolean {
    const key = `${configId}:${eventId}`
    const seen = this.seenEvents.get(key)
    if (seen && Date.now() - seen < DEDUP_TTL_MS) return true
    this.seenEvents.set(key, Date.now())
    this.pruneDedup()
    return false
  }

  /** 清理过期去重记录 */
  private pruneDedup(): void {
    const now = Date.now()
    for (const [key, ts] of this.seenEvents) {
      if (now - ts >= DEDUP_TTL_MS) this.seenEvents.delete(key)
    }
  }

  // ─── 消息解析 ─────────────────────────────────────────────────

  /** 判断事件是否为编辑事件 */
  static isEditEvent(content: Record<string, unknown>): boolean {
    if (content['m.new_content']) return true
    const relatesTo = content['m.relates_to'] as Record<string, unknown> | undefined
    if (relatesTo?.rel_type === 'm.replace') return true
    return false
  }

  /** 获取回复的事件 ID */
  static getReplyToEventId(content: Record<string, unknown>): string | undefined {
    const relatesTo = content['m.relates_to'] as Record<string, unknown> | undefined
    if (!relatesTo) return undefined
    const inReplyTo = relatesTo['m.in_reply_to'] as Record<string, unknown> | undefined
    if (!inReplyTo) return undefined
    return (inReplyTo.event_id as string) || undefined
  }

  /** 提取消息文本 */
  static extractBody(content: Record<string, unknown>): string {
    return String(content.body || '').trim()
  }

  /** 去除回复引用的 fallback 文本 */
  static stripReplyFallback(body: string): string {
    const lines = body.split('\n')
    let idx = 0
    let sawQuote = false
    while (idx < lines.length) {
      if (lines[idx].startsWith('>')) {
        sawQuote = true
        idx++
        continue
      }
      if (sawQuote && lines[idx].trim() === '') {
        idx++
        continue
      }
      break
    }
    return sawQuote ? lines.slice(idx).join('\n').trim() : body.trim()
  }

  /** 判断 Bot 是否被提及 */
  isBotMentioned(content: Record<string, unknown>): boolean {
    // 检查 m.mentions
    const mentions = content['m.mentions'] as Record<string, unknown> | undefined
    if (mentions?.user_ids) {
      const userIds = mentions.user_ids as string[]
      if (userIds.some(id => id.toLowerCase() === this.userID.toLowerCase())) return true
    }

    // 检查 formatted_body 中的 matrix.to 链接
    const formattedBody = String(content.formatted_body || content.formattedBody || '')
    if (formattedBody) {
      const hrefPattern = /https:\/\/matrix\.to\/#\/(@[^"'<\s]+)/g
      let match: RegExpExecArray | null
      while ((match = hrefPattern.exec(formattedBody)) !== null) {
        if (match[1].toLowerCase() === this.userID.toLowerCase()) return true
      }
    }

    // 检查 body 中的文本提及
    const body = String(content.body || '')
    if (body) {
      const localpart = this.userID.includes(':') ? this.userID.substring(0, this.userID.indexOf(':')) : this.userID
      if (body.toLowerCase().includes(this.userID.toLowerCase()) || body.toLowerCase().includes(localpart.toLowerCase())) {
        return true
      }
    }

    return false
  }

  /** 判断聊天类型（2 人 = direct，其他 = group） */
  static getChatType(memberCount?: number): 'direct' | 'group' {
    return memberCount === 2 ? 'direct' : 'group'
  }

  /** 是否自动接受邀请 */
  isAutoJoinEnabled(): boolean {
    return this.autoJoinInvites
  }

  // ─── HTTP 请求 ────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
    }
  }

  private async doGet(path: string, signal?: AbortSignal): Promise<unknown> {
    const resp = await fetch(`${this.homeserverURL}${path}`, {
      method: 'GET',
      headers: { ...this.authHeaders() },
      signal,
    })
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '')
      throw new Error(`Matrix GET ${path} failed: ${resp.status} ${errBody}`)
    }
    return resp.json()
  }

  private async doPost(path: string, body: unknown): Promise<unknown> {
    const resp = await fetch(`${this.homeserverURL}${path}`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '')
      throw new Error(`Matrix POST ${path} failed: ${resp.status} ${errBody}`)
    }
    return resp.json()
  }

  private async doPut(path: string, body: unknown): Promise<unknown> {
    const resp = await fetch(`${this.homeserverURL}${path}`, {
      method: 'PUT',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '')
      throw new Error(`Matrix PUT ${path} failed: ${resp.status} ${errBody}`)
    }
    return resp.json()
  }

  private nextTxnId(): string {
    this.txnCounter++
    return `aweeclaw-${Date.now()}-${this.txnCounter}`
  }
}
