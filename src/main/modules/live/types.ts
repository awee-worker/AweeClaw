/**
 * 直播互动（B站 / YouTube / Twitch）协议类型
 *
 * 归一化事件契约来自 super-ai-browser 的 `py/live_router.py`，字段名保持一致
 * （便于行为对齐、文案模板可逐字对照测试）：
 *   { id, type: 'message', content, danmu_type }
 *
 * AweeClaw 扩展字段（均为可选语义，不破坏既有消费方）：
 *   platform  来源平台
 *   raw       原始事件体（排障 / 二次开发）
 *   ts        事件时间戳
 *
 * @module live/types
 */

import type { DanmuType } from '../overlay/types'

/** 直播平台标识 */
export type LivePlatform = 'bilibili' | 'youtube' | 'twitch'

/**
 * 弹幕类型（与 overlay 的 `DanmuType` 同构）。
 *
 * 直接复用 overlay 的字面量联合，避免两处定义漂移 ——
 * 直播事件最终要喂给 overlay，类型必须严格一致。
 */
export type LiveDanmuType = DanmuType

/** 归一化后的直播事件（核心契约，勿改字段名） */
export interface LiveEvent {
  /** uuid（去重键） */
  id: string
  type: 'message'
  /** 已渲染好的人类可读文本（各平台文案模板见 README 5.2） */
  content: string
  danmu_type: LiveDanmuType
  /** AweeClaw 扩展：来源平台 */
  platform: LivePlatform
  /** AweeClaw 扩展：原始事件体（便于扩展与排障） */
  raw?: unknown
  /** AweeClaw 扩展：事件时间戳（ms） */
  ts: number
}

/** 适配器连接状态 */
export type LiveConnectionState =
  /** 未启动 */
  | 'idle'
  /** 首次连接中 */
  | 'connecting'
  /** 已连接（正常收事件） */
  | 'connected'
  /** 断线重连中 */
  | 'reconnecting'
  /** 出错（连续失败达上限后停留在该状态） */
  | 'error'
  /** 已停止 */
  | 'stopped'

/** 单个平台适配器的运行状态 */
export interface LiveAdapterStatus {
  platform: LivePlatform
  /** 是否处于运行中（start 后未 stop） */
  running: boolean
  state: LiveConnectionState
  /** 状态说明（错误原因 / 直播间号等） */
  message: string
  /** 累计收到的事件数 */
  eventCount: number
  /** 最近一次收到事件的时间（ms） */
  lastEventAt: number | null
  /** 连续失败次数 */
  retryCount: number
}

/** B站接入方式：开放平台（合规优先）/ 网页模式（非公开接口） */
export type BilibiliLiveMode = 'open_live' | 'web'

/**
 * 直播模块配置。
 *
 * 安全铁律：所有 `enabled` 默认 false，必须由用户在设置页显式开启；
 * 网页模式额外需要 `bilibiliWebRiskAccepted` 风险确认。
 *
 * 凭证字段在落盘前由 LiveStore 用 safeStorage 加密（禁止明文）。
 */
export interface LiveConfig {
  /** 总开关：关闭时不启动任何适配器 */
  enabled: boolean

  // ---------- B站 ----------
  bilibiliEnabled: boolean
  bilibiliType: BilibiliLiveMode
  /** 网页模式用：直播间号 */
  bilibiliRoomId: string
  /** 开放平台：access_key_id */
  bilibiliAccessKeyId: string
  /** 开放平台：access_key_secret */
  bilibiliAccessKeySecret: string
  /** 开放平台：项目 ID（app_id） */
  bilibiliAppId: string
  /** 开放平台：主播身份码 */
  bilibiliRoomOwnerAuthCode: string
  /** 网页模式：SESSDATA cookie（非公开接口，需风险确认） */
  bilibiliSessdata: string
  /** 网页模式风险确认：未勾选时设置页不展示网页模式选项 */
  bilibiliWebRiskAccepted: boolean

  // ---------- YouTube ----------
  youtubeEnabled: boolean
  /** 含直播的 video id */
  youtubeVideoId: string
  /** Data API v3 key */
  youtubeApiKey: string

  // ---------- Twitch ----------
  twitchEnabled: boolean
  twitchChannel: string
  twitchAccessToken: string
  /**
   * AweeClaw 扩展：Twitch 登录名。
   *
   * IRC 的 `NICK` 必须与 token 归属一致，否则 Twitch 会回 `Login authentication failed`。
   * 留空时回退到匿名只读登录（`justinfanNNNNN`），可正常读取公开频道弹幕。
   */
  twitchUsername: string
}

/** 模块整体运行状态（IPC `live:get-status` 返回） */
export interface LiveStatus {
  /** 配置总开关 */
  enabled: boolean
  /** 是否有任意平台在运行 */
  running: boolean
  /** 各平台明细 */
  platforms: LiveAdapterStatus[]
  /** 累计通过总线投递的事件数 */
  totalEvents: number
  /** 被洪水保护丢弃的事件数 */
  droppedEvents: number
  /** 去重命中的事件数 */
  duplicatedEvents: number
  /** 最近事件（最新在前，便于「有没有数据进来」排障） */
  recentEvents: LiveEvent[]
}

/**
 * 平台适配器接口。
 *
 * 约定：
 * - `start()` resolve 时代表「已建立连接」（不是「已开始重试」）
 * - `connect()` 之后发生的断线由适配器内部处理，通过基类的失败回调走指数退避重连
 * - `stop()` 必须彻底：关闭 socket、清空全部定时器；重复调用安全
 */
export interface LiveAdapter {
  readonly platform: LivePlatform
  start(config: LiveConfig): Promise<void>
  stop(): Promise<void>
  getStatus(): LiveAdapterStatus
}
