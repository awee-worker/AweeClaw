import { logger } from '@shared/toolkit/LogEngine'

/** Telegram Bot API 默认基础地址 */
const DEFAULT_API_BASE = 'https://api.telegram.org'

/** Telegram 消息最大长度 */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096

/** Long polling 超时（秒） */
const POLL_TIMEOUT_SECONDS = 30

// ─── Telegram Bot API 类型 ──────────────────────────────────────

/** Telegram User */
export interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name: string
  last_name?: string
  username?: string
}

/** Telegram Chat */
export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

/** Telegram Message */
export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  date: number
  text?: string
  caption?: string
  reply_to_message?: TelegramMessage
  forward_from?: TelegramUser
  forward_date?: number
  document?: TelegramDocument
  photo?: TelegramPhotoSize[]
  sticker?: unknown
  voice?: unknown
  video?: unknown
  animation?: unknown
  entities?: TelegramMessageEntity[]
  caption_entities?: TelegramMessageEntity[]
  media_group_id?: string
}

/** Telegram Document */
export interface TelegramDocument {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

/** Telegram PhotoSize */
export interface TelegramPhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

/** Telegram MessageEntity */
export interface TelegramMessageEntity {
  type: string
  offset: number
  length: number
  user?: TelegramUser
}

/** Telegram Update */
export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

/** Telegram CallbackQuery */
export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: TelegramMessage
  data?: string
}

// ─── API 响应 ───────────────────────────────────────────────────

/** 通用 API 响应 */
interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

/** getMe 响应 */
type GetMeResponse = TelegramApiResponse<TelegramUser>

/** sendMessage 响应 */
type SendMessageResponse = TelegramApiResponse<TelegramMessage>

/** getUpdates 响应 */
type GetUpdatesResponse = TelegramApiResponse<TelegramUpdate[]>

// ─── TelegramClient ─────────────────────────────────────────────

/**
 * Telegram Bot API 客户端
 *
 * 职责：
 * - REST API 调用（getMe、sendMessage、getUpdates）
 * - Long Polling 消息接收
 * - 消息去重
 * - 支持自定义 API Base URL（反代场景）
 */
export class TelegramClient {
  private botToken: string
  private apiBase: string
  private selfUser: TelegramUser | null = null

  // 消息去重
  private seenUpdates = new Map<string, number>()
  private static readonly DEDUP_TTL = 10 * 60 * 1000 // 10 分钟

  // Polling 状态
  private lastUpdateId = 0
  private pollingAbortController: AbortController | null = null

  constructor(botToken: string, apiBase?: string) {
    this.botToken = botToken
    this.apiBase = (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '')
  }

  // ─── 认证 ─────────────────────────────────────────────────────

  /** 获取 bot 自身信息 */
  async getMe(): Promise<TelegramUser> {
    const url = `${this.apiBase}/bot${this.botToken}/getMe`
    const response = await fetch(url)
    const result = await response.json() as GetMeResponse
    if (!result.ok || !result.result) {
      throw new Error(result.description || `Telegram getMe failed: ${response.status}`)
    }
    this.selfUser = result.result
    return result.result
  }

  /** 获取缓存的 bot 用户 ID */
  getSelfUserId(): number | null {
    return this.selfUser?.id ?? null
  }

  // ─── 消息发送 ─────────────────────────────────────────────────

  /** 发送文本消息 */
  async sendMessage(chatId: number | string, text: string, replyToMessageId?: number): Promise<TelegramMessage> {
    const url = `${this.apiBase}/bot${this.botToken}/sendMessage`
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: TelegramClient.truncateMessage(text),
      parse_mode: 'Markdown',
    }
    if (replyToMessageId) {
      body.reply_to_message_id = replyToMessageId
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json() as SendMessageResponse
    if (!result.ok || !result.result) {
      // Markdown 解析失败时降级为纯文本
      if (result.error_code === 400 && result.description?.includes('parse')) {
        return this.sendPlainText(chatId, text, replyToMessageId)
      }
      throw new Error(result.description || `Telegram sendMessage failed: ${response.status}`)
    }
    return result.result
  }

  /** 发送纯文本消息（无 Markdown 解析） */
  private async sendPlainText(chatId: number | string, text: string, replyToMessageId?: number): Promise<TelegramMessage> {
    const url = `${this.apiBase}/bot${this.botToken}/sendMessage`
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: TelegramClient.truncateMessage(text),
    }
    if (replyToMessageId) {
      body.reply_to_message_id = replyToMessageId
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json() as SendMessageResponse
    if (!result.ok || !result.result) {
      throw new Error(result.description || `Telegram sendMessage failed: ${response.status}`)
    }
    return result.result
  }

  // ─── Long Polling ─────────────────────────────────────────────

  /** 启动 Long Polling 接收循环 */
  startPolling(
    onUpdate: (update: TelegramUpdate) => void,
    onConnected: () => void,
    onError: (error: Error) => void,
    signal: AbortSignal
  ): void {
    this.pollingAbortController = new AbortController()
    const pollSignal = this.pollingAbortController.signal

    // 同时监听外部 signal 和内部 abort
    const onAbort = () => this.pollingAbortController?.abort()
    signal.addEventListener('abort', onAbort, { once: true })

    this.poll(pollSignal, onUpdate, onConnected, onError).catch(err => {
      if (!pollSignal.aborted) {
        onError(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** 停止 Polling */
  stopPolling(): void {
    this.pollingAbortController?.abort()
    this.pollingAbortController = null
  }

  /** Polling 循环 */
  private async poll(
    signal: AbortSignal,
    onUpdate: (update: TelegramUpdate) => void,
    onConnected: () => void,
    onError: (error: Error) => void
  ): Promise<void> {
    let firstPoll = true

    while (!signal.aborted) {
      try {
        const updates = await this.getUpdates(signal)
        if (firstPoll) {
          firstPoll = false
          onConnected()
        }
        for (const update of updates) {
          // 更新 offset
          if (update.update_id >= this.lastUpdateId) {
            this.lastUpdateId = update.update_id + 1
          }
          onUpdate(update)
        }
      } catch (err) {
        if (signal.aborted) break
        const msg = err instanceof Error ? err.message : String(err)
        logger.channel.warn(`[Telegram] Polling error: ${msg}`)
        onError(new Error(msg))
        // 等待后重试
        await this.delay(3000, signal)
      }
    }
  }

  /** 获取 Updates */
  private async getUpdates(signal: AbortSignal): Promise<TelegramUpdate[]> {
    const url = `${this.apiBase}/bot${this.botToken}/getUpdates`
    const body: Record<string, unknown> = {
      offset: this.lastUpdateId,
      timeout: POLL_TIMEOUT_SECONDS,
      allowed_updates: ['message', 'callback_query'],
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    const result = await response.json() as GetUpdatesResponse
    if (!result.ok) {
      throw new Error(result.description || 'Telegram getUpdates failed')
    }
    return result.result || []
  }

  // ─── 消息去重 ─────────────────────────────────────────────────

  /** 检查 Update 是否重复 */
  isDuplicate(configId: string, updateId: number): boolean {
    const key = `${configId}:${updateId}`
    const seen = this.seenUpdates.get(key)
    if (seen && Date.now() - seen < TelegramClient.DEDUP_TTL) {
      return true
    }
    this.seenUpdates.set(key, Date.now())
    this.pruneDedup()
    return false
  }

  /** 清理过期去重记录 */
  private pruneDedup(): void {
    const now = Date.now()
    for (const [key, ts] of this.seenUpdates) {
      if (now - ts >= TelegramClient.DEDUP_TTL) {
        this.seenUpdates.delete(key)
      }
    }
  }

  // ─── 工具方法 ─────────────────────────────────────────────────

  /** 截断超长消息 */
  static truncateMessage(text: string): string {
    if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return text
    return text.substring(0, TELEGRAM_MAX_MESSAGE_LENGTH - 3) + '...'
  }

  /** 判断 Chat 类型 */
  static getChatType(chatType?: string): 'direct' | 'group' {
    switch (chatType) {
      case 'private':
        return 'direct'
      case 'group':
      case 'supergroup':
      case 'channel':
        return 'group'
      default:
        return 'group'
    }
  }

  /** 判断消息是否提及了 bot */
  isBotMentioned(message: TelegramMessage): boolean {
    if (!this.selfUser?.username) return false
    const text = message.text || message.caption || ''
    return text.includes(`@${this.selfUser.username}`)
  }

  /** 判断消息是否回复了 bot */
  isReplyToBot(message: TelegramMessage): boolean {
    if (!this.selfUser) return false
    return message.reply_to_message?.from?.id === this.selfUser.id
  }

  /** 提取消息文本（优先 text，其次 caption） */
  static extractText(message: TelegramMessage): string {
    return (message.text || message.caption || '').trim()
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }
}
