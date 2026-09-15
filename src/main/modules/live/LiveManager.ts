/**
 * 直播互动编排器（主进程）
 *
 * 职责：
 *   1. 按配置启停各平台适配器（`bilibiliType` 决定用开放平台还是网页适配器）
 *   2. 把总线事件转发到两个下游：
 *        · 悬浮层（字幕/弹幕，P0-1）—— OBS 与应用内窗口
 *        · 主窗口渲染层（`live:event`）—— 实时弹幕流面板
 *   3. 对外提供 `start/stop/reload/applyConfig/getStatus`
 *
 * 依赖方向刻意保持单向：`live → overlay`（overlay 不需要知道 live 的存在）。
 * 因此重连/广播逻辑全在本模块，OverlayManager 保持零改动。
 *
 * 配置变更策略：**按适配器签名比对**，只重启真正受影响的平台 ——
 * 用户改 Twitch 频道不该把 B站的弹幕连接也抖掉。
 *
 * @module live/LiveManager
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getMainWindow } from '../../bootstrap/windowManager'
import { getOverlayManager } from '../overlay/OverlayManager'
import { getLiveEventBus } from './LiveEventBus'
import { getConfig, updateConfig } from './LiveStore'
import { BilibiliOpenLiveAdapter } from './adapters/BilibiliOpenLiveAdapter'
import { BilibiliWebAdapter } from './adapters/BilibiliWebAdapter'
import { YouTubeAdapter } from './adapters/YouTubeAdapter'
import { TwitchAdapter } from './adapters/TwitchAdapter'
import type { LiveAdapter, LiveConfig, LiveEvent, LiveStatus } from './types'

/** 渲染层事件通道名（preload 侧同名订阅） */
export const LIVE_EVENT_CHANNEL = 'live:event'

export class LiveManager {
  private static instance: LiveManager | null = null

  private readonly bus = getLiveEventBus()

  private readonly openLiveAdapter = new BilibiliOpenLiveAdapter()
  private readonly webAdapter = new BilibiliWebAdapter()
  private readonly youtubeAdapter = new YouTubeAdapter()
  private readonly twitchAdapter = new TwitchAdapter()

  /**
   * 每个适配器「上次生效的配置指纹」。
   *
   * 用它判断是否需要重启：指纹不变就保持现有连接，避免无谓抖动。
   */
  private readonly appliedSignatures = new Map<LiveAdapter, string>()

  /** 影响各适配器连接参数的配置字段（改这些才需要重连） */
  private readonly signatureFields: Map<LiveAdapter, readonly (keyof LiveConfig)[]> = new Map<
    LiveAdapter,
    readonly (keyof LiveConfig)[]
  >([
    [
      this.openLiveAdapter,
      [
        'enabled',
        'bilibiliEnabled',
        'bilibiliType',
        'bilibiliAccessKeyId',
        'bilibiliAccessKeySecret',
        'bilibiliAppId',
        'bilibiliRoomOwnerAuthCode',
      ] as const,
    ],
    [
      this.webAdapter,
      [
        'enabled',
        'bilibiliEnabled',
        'bilibiliType',
        'bilibiliRoomId',
        'bilibiliSessdata',
        'bilibiliWebRiskAccepted',
      ] as const,
    ],
    [
      this.youtubeAdapter,
      ['enabled', 'youtubeEnabled', 'youtubeVideoId', 'youtubeApiKey'] as const,
    ],
    [
      this.twitchAdapter,
      [
        'enabled',
        'twitchEnabled',
        'twitchChannel',
        'twitchAccessToken',
        'twitchUsername',
      ] as const,
    ],
  ])

  private unsubscribe: (() => void) | null = null
  private started = false

  private constructor() {
    // 总线 → 下游（进程内长期有效；dispose 后可由 start 重新挂载）
    this.ensureSubscribed()
  }

  static getInstance(): LiveManager {
    if (!LiveManager.instance) LiveManager.instance = new LiveManager()
    return LiveManager.instance
  }

  /** 挂载总线订阅（幂等），保证热重启后事件转发不会永久失效 */
  private ensureSubscribed(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.bus.onEvent(event => this.forward(event))
  }

  // ============================================
  // 生命周期
  // ============================================

  /** 按当前配置启动（幂等） */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    this.ensureSubscribed()
    // 每次冷启动都清空指纹：适配器实例状态已归零，指纹也必须归零
    this.appliedSignatures.clear()
    await this.applyRuntimes(getConfig())
  }

  /** 停止全部适配器并复位（幂等） */
  async stop(): Promise<void> {
    for (const adapter of this.allAdapters()) {
      await adapter.stop()
    }
    this.appliedSignatures.clear()
    this.started = false
  }

  /**
   * 重连：先全停再按新配置全启。
   *
   * 与 `applyConfig` 的区别是**强制重建**，用于适配器已进入
   * `error`（连续失败达上限、已停止重连）时的人工恢复。
   */
  async reload(): Promise<void> {
    await this.stopAdaptersOnly()
    this.appliedSignatures.clear()
    await this.applyRuntimes(getConfig())
  }

  // ============================================
  // 配置
  // ============================================

  /** 写入配置并按需重启受影响的适配器 */
  async applyConfig(patch: unknown): Promise<LiveConfig> {
    const next = updateConfig(patch)
    await this.applyRuntimes(next)
    return next
  }

  /** 总开关 */
  async setEnabled(enabled: boolean): Promise<LiveConfig> {
    return this.applyConfig({ enabled })
  }

  // ============================================
  // 内部：启停编排
  // ============================================

  private allAdapters(): LiveAdapter[] {
    return [this.openLiveAdapter, this.webAdapter, this.youtubeAdapter, this.twitchAdapter]
  }

  /** 当前配置下应当运行的适配器集合 */
  private activeAdapters(config: LiveConfig): LiveAdapter[] {
    if (!config.enabled) return []

    const list: LiveAdapter[] = []
    if (config.bilibiliEnabled) {
      // 两种接入方式互斥：网页模式需要额外解锁，开放平台是默认路径
      list.push(config.bilibiliType === 'web' ? this.webAdapter : this.openLiveAdapter)
    }
    if (config.youtubeEnabled) list.push(this.youtubeAdapter)
    if (config.twitchEnabled) list.push(this.twitchAdapter)
    return list
  }

  private signatureOf(config: LiveConfig, adapter: LiveAdapter): string {
    const fields = this.signatureFields.get(adapter) ?? []
    return JSON.stringify(fields.map(field => config[field]))
  }

  /** 让运行态与配置对齐（只动需要动的适配器） */
  private async applyRuntimes(config: LiveConfig): Promise<void> {
    const wanted = this.activeAdapters(config)

    for (const adapter of this.allAdapters()) {
      const running = adapter.getStatus().running
      const signature = this.signatureOf(config, adapter)

      if (!wanted.includes(adapter)) {
        if (running) await adapter.stop()
        this.appliedSignatures.delete(adapter)
        continue
      }

      // 已在跑且参数没变 → 保持连接不动
      if (running && this.appliedSignatures.get(adapter) === signature) continue

      if (running) await adapter.stop()
      this.appliedSignatures.set(adapter, signature)
      await adapter.start(config)
    }
  }

  private async stopAdaptersOnly(): Promise<void> {
    for (const adapter of this.allAdapters()) {
      await adapter.stop()
    }
  }

  // ============================================
  // 内部：事件转发
  // ============================================

  /**
   * 把一条事件转发到下游。
   *
   * 下游异常必须被吞掉：直播链路是「宿主」，不该被 overlay / 渲染层的
   * 偶发问题拖垮（否则一次渲染层报错就断掉整场直播的弹幕）。
   */
  private forward(event: LiveEvent): void {
    try {
      getOverlayManager().pushEvent({
        id: event.id,
        type: 'message',
        content: event.content,
        danmu_type: event.danmu_type,
        platform: event.platform,
        ts: event.ts,
      })
    } catch (err) {
      logger.system.warn('[Live] 转发到悬浮层失败：', err)
    }

    try {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(LIVE_EVENT_CHANNEL, event)
      }
    } catch (err) {
      logger.system.warn('[Live] 转发到渲染层失败：', err)
    }
  }

  // ============================================
  // 状态
  // ============================================

  getStatus(): LiveStatus {
    const config = getConfig()

    // 只展示当前生效的 B站适配器，避免两条 B站链路同时出现在状态里造成误解
    const bilibiliAdapter =
      config.bilibiliType === 'web' ? this.webAdapter : this.openLiveAdapter
    const platforms = [
      bilibiliAdapter.getStatus(),
      this.youtubeAdapter.getStatus(),
      this.twitchAdapter.getStatus(),
    ]

    const stats = this.bus.getStats()
    return {
      enabled: config.enabled,
      running: platforms.some(item => item.running),
      platforms,
      totalEvents: stats.totalEvents,
      droppedEvents: stats.droppedEvents,
      duplicatedEvents: stats.duplicatedEvents,
      recentEvents: this.bus.getRecentEvents(10),
    }
  }

  /** 停止总线订阅（模块卸载用） */
  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}

/** 单例 */
let instance: LiveManager | null = null

export function getLiveManager(): LiveManager {
  if (!instance) instance = LiveManager.getInstance()
  return instance
}
