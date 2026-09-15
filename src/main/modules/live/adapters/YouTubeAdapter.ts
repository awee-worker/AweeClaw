/**
 * YouTube 直播适配器
 *
 * 对齐源项目 `py/ytdm.py`。无合规风险，走官方 **Data API v3** 轮询：
 *   1. `videos.list?part=liveStreamingDetails` 取 `activeLiveChatId`（未开播则拿不到）
 *   2. 循环 `liveChatMessages.list?part=snippet,authorDetails`，带 `nextPageToken`
 *   3. 轮询间隔以响应里的 `pollingIntervalMillis` 为准，下限 2s
 *
 * 配额说明：默认配额 10000 单位/天，`liveChatMessages.list` 一次约 5 单位，
 * 因此下限 2s 已是激进值。命中 `quotaExceeded` 时**翻倍退避**（上限 60s）并打日志，
 * 绝不继续按原频率空转把配额烧穿。
 *
 * 文案模板沿用源项目（英文），保证行为可对照。
 *
 * @module live/adapters/YouTubeAdapter
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { LiveConfig, LiveDanmuType, LivePlatform } from '../types'
import { BaseLiveAdapter } from './BaseLiveAdapter'

// ============================================
// 常量
// ============================================

const API_BASE = 'https://www.googleapis.com/youtube/v3'

/** HTTP 超时（ms） */
const HTTP_TIMEOUT_MS = 15_000
/** 轮询间隔下限（ms）—— 再小就是在烧配额 */
const MIN_POLL_INTERVAL_MS = 2_000
/** 默认轮询间隔（ms，对齐源项目 poll_interval=5） */
const DEFAULT_POLL_INTERVAL_MS = 5_000
/** 配额退避上限（ms） */
const MAX_POLL_INTERVAL_MS = 60_000
/** 连续轮询失败多少次后判定连接失效 */
const MAX_POLL_FAILURES = 3

// ============================================
// 响应类型
// ============================================

interface YouTubeErrorBody {
  error?: {
    code?: number
    message?: string
    errors?: Array<{ reason?: string }>
  }
}

interface VideosResponse {
  items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>
}

interface SuperChatDetails {
  userComment?: string
  amountDisplayString?: string
}

interface LiveChatItem {
  snippet?: {
    type?: string
    displayMessage?: string
    superChatDetails?: SuperChatDetails
  }
  authorDetails?: { displayName?: string }
}

interface LiveChatResponse {
  items?: LiveChatItem[]
  nextPageToken?: string
  pollingIntervalMillis?: number
}

/** 带状态码的 API 错误（便于区分 403 配额问题与其它错误） */
class YouTubeApiError extends Error {
  readonly status: number
  readonly reason: string

  constructor(status: number, reason: string, message: string) {
    super(message)
    this.name = 'YouTubeApiError'
    this.status = status
    this.reason = reason
  }

  get isQuotaExceeded(): boolean {
    return this.status === 403 && (this.reason === 'quotaExceeded' || this.reason === 'rateLimitExceeded')
  }
}

// ============================================
// Adapter
// ============================================

export class YouTubeAdapter extends BaseLiveAdapter {
  readonly platform: LivePlatform = 'youtube'

  private apiKey = ''
  private videoId = ''
  private liveChatId = ''
  private pageToken = ''

  /** 当前轮询间隔（会被服务端建议值与配额退避共同调整） */
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS

  /** 可中断的等待（stop 时立即唤醒，避免循环残留） */
  private waitTimer: ReturnType<typeof setTimeout> | null = null
  private waitResolve: (() => void) | null = null

  // ============================================
  // 连接
  // ============================================

  protected async connect(config: LiveConfig): Promise<void> {
    this.apiKey = config.youtubeApiKey
    this.videoId = config.youtubeVideoId
    this.pageToken = ''
    this.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS

    // 取不到 chatId 直接抛错（未开播 / videoId 不是直播），由基类退避重试
    this.liveChatId = await this.fetchLiveChatId()

    // 轮询循环与连接解耦：connect() 只负责「已验证可连」，循环在后台持续推进
    void this.pollLoop()

    logger.system.info(`[Live][youtube] 已连接实时聊天：liveChatId=${this.liveChatId}`)
  }

  protected async disconnect(): Promise<void> {
    // stopped 已由基类置位，循环会在下一轮判断时退出；这里只需唤醒挂起的等待
    this.clearWait()
    this.liveChatId = ''
    this.pageToken = ''
    this.apiKey = ''
    this.videoId = ''
  }

  // ============================================
  // HTTP
  // ============================================

  private async requestJson<T>(url: string): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        let body: YouTubeErrorBody = {}
        try {
          body = (await res.json()) as YouTubeErrorBody
        } catch {
          /* 错误体可能不是 JSON，忽略 */
        }
        const reason = body.error?.errors?.[0]?.reason ?? ''
        const message = body.error?.message ?? `HTTP ${res.status}`
        throw new YouTubeApiError(res.status, reason, message)
      }
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchLiveChatId(): Promise<string> {
    const url =
      `${API_BASE}/videos?part=liveStreamingDetails&id=${encodeURIComponent(this.videoId)}` +
      `&key=${encodeURIComponent(this.apiKey)}`

    const data = await this.requestJson<VideosResponse>(url)
    const chatId = data.items?.[0]?.liveStreamingDetails?.activeLiveChatId
    if (!chatId) {
      throw new Error('未找到直播聊天（视频未开播或不是直播）')
    }
    return chatId
  }

  /** 拉取一批消息并分发 */
  private async pollOnce(): Promise<void> {
    const params = new URLSearchParams({
      liveChatId: this.liveChatId,
      part: 'snippet,authorDetails',
      maxResults: '2000',
      key: this.apiKey,
    })
    if (this.pageToken) params.set('pageToken', this.pageToken)

    const data = await this.requestJson<LiveChatResponse>(
      `${API_BASE}/liveChatMessages?${params.toString()}`,
    )

    for (const item of data.items ?? []) this.dispatchItem(item)

    this.pageToken = data.nextPageToken ?? ''

    // 服务端建议的间隔优先，但不低于下限（防止服务端给出 0 导致空转）
    const suggested = data.pollingIntervalMillis ?? DEFAULT_POLL_INTERVAL_MS
    this.pollIntervalMs = Math.max(suggested, MIN_POLL_INTERVAL_MS)
  }

  // ============================================
  // 轮询循环
  // ============================================

  private async pollLoop(): Promise<void> {
    let consecutiveFailures = 0

    while (!this.stopped) {
      try {
        await this.pollOnce()
        consecutiveFailures = 0
      } catch (err) {
        if (this.stopped) return

        if (err instanceof YouTubeApiError && err.isQuotaExceeded) {
          // 配额耗尽：翻倍退避，绝不按原频率继续空转
          this.pollIntervalMs = Math.min(this.pollIntervalMs * 2, MAX_POLL_INTERVAL_MS)
          logger.system.warn(
            `[Live][youtube] 触发配额限制，轮询间隔退避至 ${this.pollIntervalMs}ms：${err.message}`,
          )
        } else {
          consecutiveFailures++
          const message = err instanceof Error ? err.message : String(err)
          logger.system.warn(
            `[Live][youtube] 轮询失败（${consecutiveFailures}/${MAX_POLL_FAILURES}）：${message}`,
          )
          if (consecutiveFailures >= MAX_POLL_FAILURES) {
            // 交给基类走退避重连（会重新解析 chatId，直播重启后能自愈）
            this.fail(new Error(`轮询连续失败：${message}`))
            return
          }
        }
      }

      await this.wait(this.pollIntervalMs)
    }
  }

  // ============================================
  // 消息分发（文案对齐源项目）
  // ============================================

  private dispatchItem(item: LiveChatItem): void {
    const author = item.authorDetails?.displayName ?? ''
    const snippet = item.snippet ?? {}
    const type = snippet.type ?? ''

    let danmuType: LiveDanmuType = 'danmaku'
    let content = ''

    if (type === 'textMessageEvent') {
      danmuType = 'danmaku'
      content = `${author}: ${snippet.displayMessage ?? ''}`
    } else if (type === 'superChatEvent') {
      danmuType = 'super_chat'
      const details = snippet.superChatDetails ?? {}
      const amount = details.amountDisplayString ?? 'Price Hidden'
      const userComment = details.userComment ?? ''
      content = userComment
        ? `${author} sent a Super Chat (${amount}): ${userComment}`
        : `${author} sent a Super Chat (${amount})`
    } else if (type === 'fanFundingEvent') {
      // 频道会员 / 赞助 → 映射为「礼物」
      danmuType = 'gift'
      content = `${author} sponsored the channel!`
    } else {
      // 兜底：其它类型按普通文本展示
      danmuType = 'danmaku'
      content = `${author}: ${snippet.displayMessage ?? ''}`
    }

    this.emitEvent(danmuType, content, item)
  }

  // ============================================
  // 可中断等待
  // ============================================

  private wait(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      this.waitResolve = resolve
      this.waitTimer = setTimeout(() => {
        this.waitTimer = null
        this.waitResolve = null
        resolve()
      }, ms)
    })
  }

  private clearWait(): void {
    if (this.waitTimer) {
      clearTimeout(this.waitTimer)
      this.waitTimer = null
    }
    const resolve = this.waitResolve
    this.waitResolve = null
    resolve?.()
  }
}
