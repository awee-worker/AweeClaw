/**
 * 微信个人号渠道插件
 *
 * 通过腾讯 iLink Bot API 接入微信个人号，实现消息收发
 * - 接收消息：Long Polling（ilink/bot/getupdates）
 * - 发送消息：主动推送（ilink/bot/sendmessage），需携带 context_token
 * - 登录方式：QR 码扫码
 */

import * as crypto from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import { WeixinClient, weixinClient, parseConfig, ItemType, MessageType, MessageState, UploadMediaType, TypingStatus } from './WeixinClient'
import { WeixinContextCache } from './WeixinContextCache'
import { encodeAESKeyForSend } from './WeixinCrypto'
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
} from '@shared/protocols/channel'
import type {
  AdapterConfig,
  WeixinMessage,
  MessageItem,
  SendMessageRequest,
  CDNMedia,
  QRCodeResponse,
  QRStatusResponse,
} from './WeixinClient'

// ============================================
// 连接状态
// ============================================

interface WeixinConnection {
  accountId: string
  config: AdapterConfig
  status: ChannelStatus
  lastConnectedAt: number | null
  lastError: string | null
  abortController: AbortController | null
  contextCache: WeixinContextCache
  typingTickets: Map<string, string> // userId -> typingTicket
}

// ============================================
// 插件实现
// ============================================

export class WeixinChannelPlugin implements ChannelPlugin {
  id: ChannelId = 'weixin'
  meta: ChannelMeta = {
    id: 'weixin',
    label: 'WeChat',
    labelZh: '微信',
    description: 'Connect personal WeChat via iLink Bot API',
    descriptionZh: '通过 iLink Bot API 接入微信个人号',
    icon: 'MessageCircle',
    connectionModes: ['websocket'],
    defaultConnectionMode: 'websocket',
    capabilities: {
      chatTypes: ['direct'],
      media: true,
      reactions: false,
      threads: false,
      edit: false,
      streaming: false,
      voice: true,
      files: true,
    },
    order: 1,
  }

  secretSchema: ChannelSecretSchema[] = [
    {
      key: 'token',
      label: 'Bot Token',
      labelZh: 'Bot Token',
      description: 'iLink Bot token (auto-filled after QR login)',
      descriptionZh: 'iLink Bot Token（QR 扫码登录后自动填入）',
      required: true,
      secret: true,
      placeholder: 'Auto-filled after QR login',
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      labelZh: 'API 地址',
      description: 'iLink API base URL (default: https://ilinkai.weixin.qq.com)',
      descriptionZh: 'iLink API 地址（默认: https://ilinkai.weixin.qq.com）',
      required: false,
      secret: false,
      placeholder: 'https://ilinkai.weixin.qq.com',
    },
    {
      key: 'pollTimeoutSeconds',
      label: 'Poll Timeout (s)',
      labelZh: '轮询超时（秒）',
      description: 'Long polling timeout in seconds (default: 35)',
      descriptionZh: '长轮询超时秒数（默认: 35）',
      required: false,
      secret: false,
      placeholder: '35',
    },
    {
      key: 'enableTyping',
      label: 'Enable Typing',
      labelZh: '启用打字指示',
      description: 'Show typing indicator while generating responses',
      descriptionZh: '生成回复时显示打字指示器',
      required: false,
      secret: false,
      placeholder: 'false',
    },
  ]

  private connections = new Map<string, WeixinConnection>()
  private accounts = new Map<string, ChannelAccountConfig>()
  private messageCallbacks: ((message: InboundMessage) => void)[] = []
  private statusCallbacks: ((snapshot: ChannelAccountSnapshot) => void)[] = []
  private eventCallbacks: ((event: ChannelEvent) => void)[] = []
  private destroyed = false
  private client: WeixinClient

  /** 已发送消息的 client_id 集合，用于过滤回显的自身消息 */
  private sentClientIds = new Set<string>()
  /** 最近处理过的消息 ID，防止重复处理（去重窗口 60s） */
  private processedMsgIds = new Map<string, number>()
  private static MSG_DEDUP_TTL_MS = 60_000

  constructor(client?: WeixinClient) {
    this.client = client || weixinClient
  }

  // ============================================
  // QR 码登录（供 IPC Bridge 调用）
  // ============================================

  /** 获取 QR 码 */
  async fetchQRCode(): Promise<QRCodeResponse> {
    return this.client.fetchQRCode()
  }

  /** 轮询 QR 码状态 */
  async pollQRStatus(qrcode: string): Promise<QRStatusResponse> {
    const result = await this.client.pollQRStatus('https://ilinkai.weixin.qq.com', qrcode)
    logger.channel.info(`[Weixin] QR poll status: ${result.status}, bot_token: ${result.bot_token ? '***' : '(empty)'}`)
    return result
  }

  // ============================================
  // ChannelPlugin 接口实现
  // ============================================

  async validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }> {
    try {
      const config = parseConfig(credentials)
      // 尝试一次 getupdates 验证 token 有效性
      const result = await this.client.getUpdates(config, '', undefined)
      if (result.ret !== 0 && result.errcode === -14) {
        return { valid: false, error: 'Token expired or invalid (session expired)' }
      }
      return { valid: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { valid: false, error: msg }
    }
  }

  async connect(account: ChannelAccountConfig): Promise<void> {
    if (this.destroyed) return

    const config = parseConfig(account.credentials)
    this.accounts.set(account.id, account)

    const abortController = new AbortController()
    const connection: WeixinConnection = {
      accountId: account.id,
      config,
      status: 'connecting',
      lastConnectedAt: null,
      lastError: null,
      abortController,
      contextCache: new WeixinContextCache(),
      typingTickets: new Map(),
    }
    this.connections.set(account.id, connection)
    this.emitStatusChange(account.id)

    try {
      // 验证连接
      const result = await this.client.getUpdates(config, '', abortController.signal)
      if (result.ret !== 0 && result.errcode === -14) {
        throw new Error('Token expired or invalid (session expired)')
      }

      connection.status = 'connected'
      connection.lastConnectedAt = Date.now()
      this.emitStatusChange(account.id)
      logger.channel.info(`[Weixin] Account ${account.id} connected`)

      // 启动 Long Polling 循环
      this.startPollLoop(account.id, connection)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      connection.status = 'error'
      connection.lastError = errorMsg
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
    logger.channel.info(`[Weixin] Account ${accountId} disconnected`)
  }

  async sendMessage(message: OutboundMessage): Promise<OutboundResult> {
    if (message.channelId !== 'weixin') {
      return { success: false, error: 'Invalid channel ID' }
    }

    const conn = this.connections.get(message.accountId || '')
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'WeChat account not connected' }
    }

    const target = (message.to || '').trim()
    if (!target) {
      return { success: false, error: 'Target user ID is required' }
    }

    const contextToken = conn.contextCache.get(target)
    if (!contextToken) {
      logger.channel.error(`[Weixin] No context_token for target=${target}, cached targets: [${conn.contextCache.keys().join(', ')}]`)
      return { success: false, error: 'No context_token for this target (can only reply after receiving a message)' }
    }

    logger.channel.info(`[Weixin] Sending message to ${target}, contextToken length=${contextToken.length}`)

    try {
      // 发送附件
      if (message.media && message.media.length > 0) {
        return await this.sendWithMedia(conn, target, contextToken, message)
      }

      // 发送纯文本
      const text = (message.text || '').trim()
      if (!text) {
        return { success: false, error: 'Message text is empty' }
      }

      await this.sendText(conn.config, target, text, contextToken)
      logger.channel.info(`[Weixin] Message sent successfully to ${target}`)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`[Weixin] sendMessage failed: ${msg}`)
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
    for (const conn of this.connections.values()) {
      conn.abortController?.abort()
    }
    this.connections.clear()
    this.accounts.clear()
    this.messageCallbacks = []
    this.statusCallbacks = []
    this.eventCallbacks = []
  }

  // ============================================
  // Long Polling 循环
  // ============================================

  private startPollLoop(accountId: string, conn: WeixinConnection): void {
    const poll = async () => {
      let getUpdatesBuf = ''

      while (!this.destroyed && conn.abortController && !conn.abortController.signal.aborted) {
        try {
          const result = await this.client.getUpdates(conn.config, getUpdatesBuf, conn.abortController.signal)

          // 会话过期
          if (result.ret !== 0 && result.errcode === -14) {
            logger.channel.warn(`[Weixin] Session expired for account ${accountId}`)
            conn.status = 'error'
            conn.lastError = 'Session expired, please re-login via QR code'
            this.emitStatusChange(accountId)
            return
          }

          if (result.get_updates_buf) {
            getUpdatesBuf = result.get_updates_buf
          }

          if (result.msgs && result.msgs.length > 0) {
            for (const msg of result.msgs) {
              this.processInboundMessage(accountId, conn, msg)
            }
          }
        } catch (err) {
          if (conn.abortController.signal.aborted || this.destroyed) break

          const msg = err instanceof Error ? err.message : String(err)
          logger.channel.warn(`[Weixin] Poll error for ${accountId}: ${msg}`)

          // 退避等待后重试
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
      }

      logger.channel.info(`[Weixin] Poll loop ended for account ${accountId}`)
    }

    poll()
  }

  // ============================================
  // 消息处理
  // ============================================

  private processInboundMessage(accountId: string, conn: WeixinConnection, msg: WeixinMessage): void {
    logger.channel.info(`[Weixin] processInboundMessage: from=${msg.from_user_id}, to=${msg.to_user_id}, type=${msg.message_type}, client_id=${msg.client_id}, has_context_token=${!!msg.context_token}`)

    // 过滤自身发送的消息回显：通过 client_id 识别
    const clientId = (msg.client_id || '').trim()
    if (clientId && this.sentClientIds.has(clientId)) {
      logger.channel.info(`[Weixin] Skipping self-sent message echo: client_id=${clientId}`)
      this.sentClientIds.delete(clientId)
      // 自身消息回显仍可更新 context_token
      const echoFromUserId = (msg.from_user_id || '').trim()
      if (echoFromUserId && msg.context_token) {
        conn.contextCache.put(echoFromUserId, msg.context_token)
      }
      return
    }

    // 过滤非用户消息（BOT、NONE 等）
    if (msg.message_type !== MessageType.USER) {
      // 非 USER 消息仍可更新 context_token，但不触发 AI 回复
      const fromUserId = (msg.from_user_id || '').trim()
      if (fromUserId && msg.context_token) {
        conn.contextCache.put(fromUserId, msg.context_token)
      }
      return
    }

    // 消息去重：同一消息 ID 在窗口期内不重复处理
    const dedupId = msg.message_id
      ? (msg.seq ? `${msg.message_id}:${msg.seq}` : String(msg.message_id))
      : null
    if (dedupId) {
      const now = Date.now()
      const lastSeen = this.processedMsgIds.get(dedupId)
      if (lastSeen && now - lastSeen < WeixinChannelPlugin.MSG_DEDUP_TTL_MS) {
        logger.channel.debug(`[Weixin] Skipping duplicate message: msgId=${dedupId}`)
        return
      }
      this.processedMsgIds.set(dedupId, now)
      // 清理过期的去重记录
      if (this.processedMsgIds.size > 1000) {
        for (const [id, ts] of this.processedMsgIds) {
          if (now - ts > WeixinChannelPlugin.MSG_DEDUP_TTL_MS) {
            this.processedMsgIds.delete(id)
          }
        }
      }
    }

    // 缓存 context_token（仅 USER 消息，避免 BOT 消息覆盖 token）
    const fromUserId = (msg.from_user_id || '').trim()
    if (fromUserId && msg.context_token) {
      conn.contextCache.put(fromUserId, msg.context_token)
    }

    const { text, media } = this.extractContent(msg)
    if (!text && media.length === 0) return

    if (!fromUserId) return

    const msgId = dedupId || crypto.randomUUID()

    const chatType: ChatType = msg.group_id ? 'group' : 'direct'

    const inbound: InboundMessage = {
      id: msgId,
      channelId: 'weixin',
      accountId,
      chatType,
      from: fromUserId,
      to: (msg.to_user_id || '').trim(),
      text: text || `[media]`,
      media: media.length > 0 ? media : undefined,
      timestamp: msg.create_time_ms ? msg.create_time_ms : Date.now(),
      raw: msg,
    }

    // 打字指示器
    if (conn.config.enableTyping && msg.context_token) {
      this.sendTypingIndicator(conn, fromUserId, msg.context_token).catch(err => {
        logger.channel.debug(`[Weixin] Typing indicator failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }

    for (const cb of this.messageCallbacks) {
      try { cb(inbound) } catch (e) { logger.channel.warn('Message callback error:', e) }
    }
  }

  /** 从 WeixinMessage 提取文本和媒体 */
  private extractContent(msg: WeixinMessage): { text: string; media: InboundMedia[] } {
    if (!msg.item_list || msg.item_list.length === 0) {
      return { text: '', media: [] }
    }

    const textParts: string[] = []
    const media: InboundMedia[] = []

    for (const item of msg.item_list) {
      switch (item.type) {
        case ItemType.TEXT:
          if (item.text_item?.text?.trim()) {
            textParts.push(item.text_item.text.trim())
          }
          break
        case ItemType.IMAGE:
          if (item.image_item?.media?.encrypt_query_param) {
            media.push({
              type: 'image',
              url: item.image_item.url || undefined,
            })
          }
          break
        case ItemType.VOICE:
          // 语音转文字优先
          if (item.voice_item?.text?.trim() && !item.voice_item?.media?.encrypt_query_param) {
            textParts.push(item.voice_item.text.trim())
          } else if (item.voice_item?.media?.encrypt_query_param) {
            media.push({ type: 'audio' })
          }
          break
        case ItemType.FILE:
          if (item.file_item?.media?.encrypt_query_param) {
            media.push({
              type: 'file',
              fileName: item.file_item.file_name || undefined,
            })
          }
          break
        case ItemType.VIDEO:
          if (item.video_item?.media?.encrypt_query_param) {
            media.push({ type: 'video' })
          }
          break
      }
    }

    return { text: textParts.join('\n'), media }
  }

  // ============================================
  // 发送消息
  // ============================================

  /** 发送纯文本消息 */
  private async sendText(cfg: AdapterConfig, target: string, text: string, contextToken: string): Promise<void> {
    const clientId = this.generateClientID()
    this.sentClientIds.add(clientId)
    // 清理过期的 client_id 记录（保留最近 200 条）
    if (this.sentClientIds.size > 200) {
      const iter = this.sentClientIds.values()
      for (let i = 0; i < 50; i++) {
        iter.next()
      }
      // 删除最早的 50 条
      const toDelete: string[] = []
      let count = 0
      for (const id of this.sentClientIds) {
        toDelete.push(id)
        count++
        if (count >= 50) break
      }
      toDelete.forEach(id => this.sentClientIds.delete(id))
    }
    const req: SendMessageRequest = {
      msg: {
        to_user_id: target,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: ItemType.TEXT, text_item: { text } }],
        context_token: contextToken,
      },
    }
    logger.channel.info(`[Weixin] sendText: to=${target}, clientId=${clientId}, textLen=${text.length}, contextTokenLen=${contextToken.length}`)
    await this.client.sendMessage(cfg, req)
  }

  /** 发送带媒体的消息 */
  private async sendWithMedia(
    conn: WeixinConnection,
    target: string,
    contextToken: string,
    message: OutboundMessage
  ): Promise<OutboundResult> {
    try {
      // 先发送文本
      if (message.text?.trim()) {
        await this.sendText(conn.config, target, message.text.trim(), contextToken)
      }

      // 逐个发送媒体
      for (const media of message.media || []) {
        if (media.buffer) {
          await this.sendMediaBuffer(conn, target, contextToken, media.buffer, media.type, media.fileName)
        } else if (media.localPath) {
          // 从本地路径读取文件
          const fs = await import('fs/promises')
          const data = await fs.readFile(media.localPath)
          await this.sendMediaBuffer(conn, target, contextToken, data, media.type, media.fileName)
        }
      }

      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  /** 发送媒体 Buffer */
  private async sendMediaBuffer(
    conn: WeixinConnection,
    target: string,
    contextToken: string,
    data: Buffer,
    mediaType: 'image' | 'video' | 'audio' | 'file',
    fileName?: string
  ): Promise<void> {
    const uploadType = mediaType === 'image' ? UploadMediaType.IMAGE
      : mediaType === 'video' ? UploadMediaType.VIDEO
      : mediaType === 'audio' ? UploadMediaType.VOICE
      : UploadMediaType.FILE

    const itemType = mediaType === 'image' ? ItemType.IMAGE
      : mediaType === 'video' ? ItemType.VIDEO
      : mediaType === 'audio' ? ItemType.VOICE
      : ItemType.FILE

    const downloadParam = await this.client.uploadMedia(
      conn.config, target, data, uploadType
    )

    // 构建媒体消息项
    const aesKey = crypto.randomBytes(16)
    const cdnMedia: CDNMedia = {
      encrypt_query_param: downloadParam,
      aes_key: encodeAESKeyForSend(aesKey),
      encrypt_type: 1,
    }

    let messageItem: MessageItem
    switch (itemType) {
      case ItemType.IMAGE:
        messageItem = { type: ItemType.IMAGE, image_item: { media: cdnMedia, mid_size: data.length } }
        break
      case ItemType.VIDEO:
        messageItem = { type: ItemType.VIDEO, video_item: { media: cdnMedia, video_size: data.length } }
        break
      case ItemType.VOICE:
        messageItem = { type: ItemType.VOICE, voice_item: { media: cdnMedia } }
        break
      default:
        messageItem = {
          type: ItemType.FILE,
          file_item: { media: cdnMedia, file_name: fileName || 'file', len: String(data.length) },
        }
    }

    const req: SendMessageRequest = {
      msg: {
        to_user_id: target,
        client_id: (() => { const id = this.generateClientID(); this.sentClientIds.add(id); return id })(),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [messageItem],
        context_token: contextToken,
      },
    }

    await this.client.sendMessage(conn.config, req)
  }

  /** 发送打字指示器 */
  private async sendTypingIndicator(conn: WeixinConnection, userId: string, contextToken: string): Promise<void> {
    try {
      // 获取 typing_ticket
      let ticket = conn.typingTickets.get(userId)
      if (!ticket) {
        const configResp = await this.client.getConfig(conn.config, userId, contextToken)
        if (configResp.typing_ticket) {
          ticket = configResp.typing_ticket
          conn.typingTickets.set(userId, ticket)
        }
      }

      if (ticket) {
        await this.client.sendTyping(conn.config, userId, ticket, TypingStatus.TYPING)
      }
    } catch {
      // 打字指示器失败不影响主流程
    }
  }

  /** 生成 client_id */
  private generateClientID(): string {
    const bytes = crypto.randomBytes(8)
    return `aweeclaw-weixin-${bytes.toString('hex')}`
  }

  private emitStatusChange(accountId: string): void {
    const snapshot = this.getStatus(accountId)
    for (const cb of this.statusCallbacks) {
      try { cb(snapshot) } catch (e) { logger.channel.warn('Status callback error:', e) }
    }
  }
}

export const weixinChannelPlugin = new WeixinChannelPlugin()
