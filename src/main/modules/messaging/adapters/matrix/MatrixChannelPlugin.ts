import { logger } from '@shared/toolkit/LogEngine'
import { MatrixClient, type MatrixEvent, type MatrixSyncResponse, type MatrixJoinedRoom } from './MatrixClient'
import type {
  ChannelId,
  ChannelPlugin,
  ChannelMeta,
  ChannelSecretSchema,
  ChannelAccountConfig,
  ChannelAccountSnapshot,
  InboundMessage,
  OutboundMessage,
  OutboundResult,
  ChannelEvent,
  ChannelStatus,
} from '@shared/protocols/channel'

/** 重连配置 */
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 60000
const RECONNECT_MAX_ATTEMPTS = 20

/** 重连退避序列 */
const BACKOFF_DELAYS = [1000, 2000, 5000, 10000, 20000]

interface MatrixConnection {
  accountId: string
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  client: MatrixClient
  selfUserId: string | null
  abortController: AbortController | null
  reconnectAttempts: number
}

/**
 * Matrix 渠道插件
 *
 * 通过 /sync Long Polling 接入 Matrix Homeserver，支持：
 * - 房间消息和私聊消息接收
 * - 消息发送（文本 + 回复）
 * - 自动接受房间邀请
 * - 私聊房间自动创建
 * - 消息去重
 * - 自动重连（指数退避）
 */
export class MatrixChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'matrix'
  meta: ChannelMeta = {
    id: 'matrix',
    label: 'Matrix',
    labelZh: 'Matrix',
    description: 'Connect Matrix homeserver via /sync Long Polling',
    descriptionZh: '通过 /sync 长轮询接入 Matrix 服务器',
    icon: 'MessageCircle',
    connectionModes: ['websocket'],
    defaultConnectionMode: 'websocket',
    capabilities: {
      chatTypes: ['direct', 'group'],
      media: false,
      reactions: false,
      threads: false,
      edit: false,
      streaming: false,
      voice: false,
      files: false,
    },
    order: 12,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'homeserverURL',
      label: 'Homeserver URL',
      labelZh: '服务器地址',
      description: 'Matrix homeserver URL (e.g. https://matrix.org)',
      descriptionZh: 'Matrix 服务器地址（如 https://matrix.org）',
      required: true,
      secret: false,
      placeholder: 'https://matrix.org',
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      labelZh: '访问令牌',
      description: 'Matrix bot account access token',
      descriptionZh: 'Matrix 机器人账号的访问令牌',
      required: true,
      secret: true,
      placeholder: 'syt_...',
    },
    {
      key: 'userId',
      label: 'User ID',
      labelZh: '用户 ID',
      description: 'Matrix bot user ID (e.g. @mybot:matrix.org)',
      descriptionZh: 'Matrix 机器人用户 ID（如 @mybot:matrix.org）',
      required: true,
      secret: false,
      placeholder: '@mybot:matrix.org',
    },
    {
      key: 'syncTimeoutSeconds',
      label: 'Sync Timeout (s)',
      labelZh: '同步超时（秒）',
      description: 'Long-poll timeout for /sync requests (default: 30)',
      descriptionZh: '/sync 长轮询超时秒数（默认 30）',
      required: false,
      secret: false,
      placeholder: '30',
    },
    {
      key: 'autoJoinInvites',
      label: 'Auto Join Invites',
      labelZh: '自动接受邀请',
      description: 'Automatically accept room invitations (default: enabled)',
      descriptionZh: '自动接受房间邀请（默认开启）',
      required: false,
      secret: false,
      placeholder: 'true',
    },
  ]

  private connections = new Map<string, MatrixConnection>()
  private accounts = new Map<string, ChannelAccountConfig>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false

  // ─── 生命周期 ─────────────────────────────────────────────────

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    const { homeserverURL, accessToken, userId } = credentials
    if (!homeserverURL || !accessToken || !userId) {
      return { valid: false, error: 'Homeserver URL, Access Token and User ID are required' }
    }
    try {
      const client = new MatrixClient(homeserverURL, accessToken, userId)
      await client.validateHomeserver()
      const whoami = await client.whoAmI()
      if (whoami.user_id.toLowerCase() !== userId.toLowerCase()) {
        return { valid: false, error: `Token belongs to ${whoami.user_id}, expected ${userId}` }
      }
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return

    const { homeserverURL, accessToken, userId, syncTimeoutSeconds, autoJoinInvites } = account.credentials
    if (!homeserverURL || !accessToken || !userId) {
      throw new Error('Matrix Homeserver URL, Access Token and User ID are required')
    }

    try {
      const client = new MatrixClient(
        homeserverURL,
        accessToken,
        userId,
        syncTimeoutSeconds ? parseInt(syncTimeoutSeconds, 10) : undefined,
        autoJoinInvites === 'false' ? false : true
      )

      // 验证凭证
      await client.validateHomeserver()
      const whoami = await client.whoAmI()

      this.accounts.set(account.id, account)

      const abortController = new AbortController()
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'connected',
        lastConnectedAt: Date.now(),
        lastError: null,
        client,
        selfUserId: whoami.user_id,
        abortController,
        reconnectAttempts: 0,
      })

      this.emitStatusChange(account.id)

      // 启动 /sync 接收循环
      this.startSyncLoop(account.id)

      logger.channel.info(`Matrix account ${account.id} connected (bot: ${whoami.user_id})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.connections.set(account.id, {
        accountId: account.id,
        status: 'error',
        lastConnectedAt: null,
        lastError: errorMsg,
        client: new MatrixClient(homeserverURL, accessToken, userId),
        selfUserId: null,
        abortController: null,
        reconnectAttempts: 0,
      })
      this.emitStatusChange(account.id)
      throw err
    }
  }

  async disconnect(accountId: string): Promise<void> {
    const conn = this.connections.get(accountId)
    if (conn) {
      conn.abortController?.abort()
    }
    this.connections.delete(accountId)
    this.accounts.delete(accountId)
    this.emitStatusChange(accountId)
    logger.channel.info(`Matrix account ${accountId} disconnected`)
  }

  destroy(): void {
    this.destroyed = true
    for (const conn of this.connections.values()) {
      conn.abortController?.abort()
    }
    this.connections.clear()
    this.accounts.clear()
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  // ─── 消息发送 ─────────────────────────────────────────────────

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    if (message.channelId !== 'matrix') {
      return { success: false, error: 'Invalid channel ID' }
    }

    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Matrix account not connected' }
    }

    try {
      const text = message.text || ''
      if (!text.trim()) {
        return { success: false, error: 'Empty message content' }
      }

      // message.to 是目标（房间 ID / 用户 ID / 房间别名）
      const target = message.to || message.replyToId || ''
      if (!target) {
        return { success: false, error: 'No target specified' }
      }

      // 解析目标为房间 ID
      const roomId = await conn.client.resolveRoomTarget(target)

      // 发送消息
      const replyToId = message.replyToId || undefined
      const eventId = await conn.client.sendTextMessage(roomId, text, replyToId)

      return { success: true, messageId: eventId }
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

  // ─── /sync 接收循环 ───────────────────────────────────────────

  /** 启动 /sync 接收循环 */
  private startSyncLoop(accountId: string): void {
    const conn = this.connections.get(accountId)
    if (!conn) return

    const signal = conn.abortController?.signal
    if (!signal) return

    this.runSyncLoop(accountId, signal).catch(err => {
      if (!this.destroyed && !signal.aborted) {
        logger.channel.error(`[Matrix] Sync loop error for ${accountId}: ${err instanceof Error ? err.message : String(err)}`)
        this.scheduleReconnect(accountId)
      }
    })
  }

  /** 运行 /sync 长轮询循环 */
  private async runSyncLoop(accountId: string, signal: AbortSignal): Promise<void> {
    const conn = this.connections.get(accountId)
    if (!conn) return

    // 初始化同步游标
    try {
      await conn.client.bootstrapSince()
      logger.channel.info(`[Matrix] Sync cursor bootstrapped for ${accountId}`)
    } catch (err) {
      logger.channel.warn(`[Matrix] Bootstrap failed for ${accountId}: ${err instanceof Error ? err.message : String(err)}`)
    }

    let attempt = 0

    while (!signal.aborted && !this.destroyed) {
      const currentConn = this.connections.get(accountId)
      if (!currentConn) break

      try {
        const resp = await currentConn.client.syncOnce(signal)
        attempt = 0

        // 处理邀请
        await this.handleInvites(accountId, currentConn, resp)

        // 处理已加入房间的消息
        this.handleJoinedRooms(accountId, currentConn, resp)

        // 更新连接状态
        if (currentConn.status !== 'connected') {
          currentConn.status = 'connected'
          currentConn.lastConnectedAt = Date.now()
          currentConn.lastError = null
          this.emitStatusChange(accountId)
        }
      } catch (err) {
        if (signal.aborted || this.destroyed) break

        const errMsg = err instanceof Error ? err.message : String(err)
        logger.channel.warn(`[Matrix] Sync error for ${accountId}: ${errMsg}`)

        currentConn.status = 'error'
        currentConn.lastError = errMsg
        this.emitStatusChange(accountId)

        // 退避重连
        const delay = attempt < BACKOFF_DELAYS.length ? BACKOFF_DELAYS[attempt] : BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1]
        attempt++
        logger.channel.info(`[Matrix] Retrying sync for ${accountId} in ${delay}ms (attempt ${attempt})`)

        await this.delay(delay, signal)
      }
    }
  }

  /** 处理房间邀请 */
  private async handleInvites(_accountId: string, conn: MatrixConnection, resp: MatrixSyncResponse): Promise<void> {
    const inviteRooms = resp.rooms?.invite
    if (!inviteRooms) return

    for (const roomId of Object.keys(inviteRooms)) {
      if (!conn.client.isAutoJoinEnabled()) {
        logger.channel.info(`[Matrix] Invite skipped for ${roomId} (auto-join disabled)`)
        continue
      }
      try {
        await conn.client.joinRoom(roomId)
        logger.channel.info(`[Matrix] Auto-joined room ${roomId}`)
      } catch (err) {
        logger.channel.warn(`[Matrix] Failed to join room ${roomId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  /** 处理已加入房间的消息事件 */
  private handleJoinedRooms(accountId: string, conn: MatrixConnection, resp: MatrixSyncResponse): void {
    const joinedRooms = resp.rooms?.join
    if (!joinedRooms) return

    for (const [roomId, roomData] of Object.entries(joinedRooms)) {
      const room = roomData as MatrixJoinedRoom
      const events = room.timeline?.events
      if (!events) continue

      // 推断聊天类型
      const joinedCount = room.summary?.['m.joined_member_count'] ?? 0
      const invitedCount = room.summary?.['m.invited_member_count'] ?? 0
      const memberCount = joinedCount + invitedCount

      for (const evt of events) {
        this.handleMatrixEvent(accountId, conn, evt, roomId, memberCount)
      }
    }
  }

  /** 处理单个 Matrix 事件 */
  private handleMatrixEvent(
    accountId: string,
    conn: MatrixConnection,
    evt: MatrixEvent,
    roomId: string,
    memberCount: number
  ): void {
    // 只处理消息事件
    if (evt.type !== 'm.room.message') return

    // 过滤自身消息
    if (!evt.sender || evt.sender.toLowerCase() === (conn.selfUserId || '').toLowerCase()) return

    // 消息去重
    if (conn.client.isDuplicate(accountId, evt.event_id)) return

    // 过滤编辑事件
    if (MatrixClient.isEditEvent(evt.content)) return

    // 提取消息文本
    let body = MatrixClient.extractBody(evt.content)
    if (!body) return

    // 如果是回复，去除 fallback 引用
    const replyToId = MatrixClient.getReplyToEventId(evt.content)
    if (replyToId) {
      body = MatrixClient.stripReplyFallback(body)
    }
    if (!body) return

    const chatType = MatrixClient.getChatType(memberCount || undefined)
    const isMentioned = conn.client.isBotMentioned(evt.content)

    // 获取显示名
    const displayName = (evt.unsigned?.displayname as string) || evt.sender

    const message: InboundMessage = {
      id: evt.event_id,
      channelId: 'matrix',
      accountId,
      chatType,
      from: evt.sender,
      fromName: displayName,
      to: roomId,
      text: body,
      timestamp: evt.origin_server_ts || Date.now(),
      replyToId: replyToId || undefined,
      raw: {
        roomId,
        isMentioned,
        sender: evt.sender,
        memberCount,
      },
    }

    for (const cb of this.messageCallbacks) cb(message)
  }

  /** 调度重连 */
  private scheduleReconnect(accountId: string): void {
    const conn = this.connections.get(accountId)
    if (!conn || this.destroyed) return

    if (conn.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      logger.channel.error(`[Matrix] Max reconnect attempts reached for ${accountId}`)
      conn.status = 'error'
      conn.lastError = 'Max reconnect attempts reached'
      this.emitStatusChange(accountId)
      return
    }

    conn.reconnectAttempts++
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, conn.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    )

    logger.channel.info(`[Matrix] Reconnecting ${accountId} in ${delay}ms (attempt ${conn.reconnectAttempts})`)

    const signal = conn.abortController?.signal
    if (!signal) return

    this.delay(delay, signal).then(() => {
      if (!signal.aborted && !this.destroyed) {
        this.startSyncLoop(accountId)
      }
    })
  }

  // ─── 工具方法 ─────────────────────────────────────────────────

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }

  private emitStatusChange(accountId: string): void {
    const snapshot = this.getStatus(accountId)
    for (const cb of this.statusCallbacks) cb(snapshot)
  }
}

export const matrixChannelPlugin = new MatrixChannelPlugin()
