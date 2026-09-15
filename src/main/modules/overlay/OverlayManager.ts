/**
 * 悬浮层编排器（主进程）
 *
 * 职责：把「HTTP 服务（外部/OBS）」「WS 广播（页面）」「透明窗口（应用内）」三个部件
 * 按配置组装起来，并对外提供统一的推送入口：
 *
 *   pushEvent(payload)  → WS 广播 + 窗口 IPC（双通道）
 *   pushSubtitle(text)  → 便捷方法（AI 回复字幕）
 *   clear()             → 清空
 *
 * 事件来源（后续接入）：
 *   - AI 回复文本（渲染层上报）
 *   - P0-2 直播事件（LiveEventBus）
 *   - 外部 HTTP POST /api/overlay/danmaku
 *
 * 推送策略：**双通道同时发**，页面侧按「有 IPC 用 IPC、否则用 WS」二选一消费，
 * 因此不会重复渲染（见渲染层 useOverlayChannel）。
 *
 * @module overlay/OverlayManager
 */

import { randomUUID } from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import { getConfig, updateConfig } from './OverlayStore'
import { getOverlayBroadcaster } from './OverlayBroadcaster'
import { OverlayHttpServer, type InboundDanmakuInput } from './OverlayHttpServer'
import { OverlayWindow } from './OverlayWindow'
import type { DanmuType, OverlayConfig, OverlayEventPayload, OverlayMode } from './types'

/** 最近事件保留条数（状态接口用，便于排查「有没有数据进来」） */
const RECENT_EVENT_LIMIT = 20

export class OverlayManager {
  private static instance: OverlayManager | null = null

  private broadcaster = getOverlayBroadcaster()
  private httpServer: OverlayHttpServer | null = null
  private overlayWindow = new OverlayWindow()

  /** 最近事件（环形，最新在前） */
  private recentEvents: OverlayEventPayload[] = []

  private starting = false

  private constructor() {}

  static getInstance(): OverlayManager {
    if (!OverlayManager.instance) OverlayManager.instance = new OverlayManager()
    return OverlayManager.instance
  }

  // ============================================
  // 生命周期
  // ============================================

  /**
   * 按当前配置启动。
   *
   * 幂等：重复调用只做「补齐缺失部件」，不会重复起服务。
   */
  async start(): Promise<void> {
    if (this.starting) return
    this.starting = true
    try {
      const config = getConfig()
      if (!config.enabled) {
        logger.system.info('[Overlay] disabled by config, skip start')
        return
      }

      if (config.serverEnabled) {
        await this.startServer(config.port)
      }

      if (config.windowEnabled) {
        this.startWindow(config.windowMode)
      }
    } catch (err) {
      logger.system.error('[Overlay] start failed:', err)
    } finally {
      this.starting = false
    }
  }

  /** 停止全部部件并释放资源 */
  async stop(): Promise<void> {
    this.overlayWindow.destroy()
    await this.stopServer()
    logger.system.info('[Overlay] stopped')
  }

  private async startServer(preferredPort: number): Promise<number> {
    if (!this.httpServer) {
      this.httpServer = new OverlayHttpServer({
        onDanmaku: input => this.handleInboundDanmaku(input),
        onClear: () => this.clear(),
        getStatus: () => this.getStatus(),
        onUpgrade: (req, socket, head) => this.broadcaster.handleUpgrade(req, socket, head),
      })
      this.broadcaster.start()
    }

    if (this.httpServer.isRunning()) return this.httpServer.getPort()

    const port = await this.httpServer.start(preferredPort)
    // 端口可能因占用而上浮，回写配置便于 UI 展示真实地址
    if (port !== preferredPort) {
      updateConfig({ port })
    }
    // 端口变化后窗口需要重连 WS（IPC 通道不受影响，但保持一致）
    this.overlayWindow.setPort(port)
    return port
  }

  private async stopServer(): Promise<void> {
    if (this.httpServer) {
      await this.httpServer.stop()
      this.httpServer = null
    }
    this.broadcaster.stop()
  }

  private startWindow(mode: OverlayMode): void {
    const port = this.httpServer?.getPort() ?? getConfig().port
    this.overlayWindow.create(port, mode)
    this.overlayWindow.show()
  }

  // ============================================
  // 配置应用
  // ============================================

  /**
   * 应用新配置（设置页保存后调用）。
   *
   * 只做必要的启停，避免用户改一个字幕字号就把服务重启一遍。
   */
  async applyConfig(patch: unknown): Promise<OverlayConfig> {
    const before = getConfig()
    const next = updateConfig(patch)

    // 1. 服务开关 / 端口变化 → 重启服务
    const portChanged = before.port !== next.port
    const serverToggled = before.serverEnabled !== next.serverEnabled
    if (next.enabled && next.serverEnabled) {
      if (portChanged || (serverToggled && !this.httpServer?.isRunning())) {
        await this.stopServer()
        await this.startServer(next.port)
      }
    } else {
      await this.stopServer()
    }

    // 2. 窗口开关变化 → 建 / 销毁
    if (next.enabled && next.windowEnabled) {
      const port = this.httpServer?.getPort() ?? next.port
      this.overlayWindow.create(port, next.windowMode)
      this.overlayWindow.setMode(next.windowMode)
      this.overlayWindow.setClickThrough(next.window.clickThrough)
      this.overlayWindow.setOpacity(next.window.opacity)
      this.overlayWindow.setAlwaysOnTop(next.window.alwaysOnTop)
    } else {
      this.overlayWindow.destroy()
    }

    return next
  }

  /** 总开关 */
  async setEnabled(enabled: boolean): Promise<OverlayConfig> {
    return this.applyConfig({ enabled })
  }

  // ============================================
  // 推送
  // ============================================

  /**
   * 推送一条事件（双通道）。
   *
   * @returns 实际投递的通道数（WS 连接数 + 窗口是否在线），用于调用方判断是否有人消费
   */
  pushEvent(payload: OverlayEventPayload): number {
    this.rememberEvent(payload)
    const wsSent = this.broadcaster.show(payload)
    this.overlayWindow.send('overlay:event', { action: 'show', data: payload })
    return wsSent + (this.overlayWindow.isCreated() ? 1 : 0)
  }

  /** 便捷：推送一条字幕（AI 回复） */
  pushSubtitle(content: string, extra?: Partial<OverlayEventPayload>): number {
    return this.pushEvent({
      id: extra?.id ?? randomUUID(),
      type: 'message',
      content,
      danmu_type: extra?.danmu_type ?? 'danmaku',
      platform: extra?.platform ?? 'local',
      ts: Date.now(),
    })
  }

  /** 清空悬浮层 */
  clear(): void {
    this.broadcaster.clear()
    this.overlayWindow.send('overlay:event', { action: 'clear' })
  }

  /** 处理来自 HTTP 的外部注入 */
  private handleInboundDanmaku(input: InboundDanmakuInput): void {
    const payload: OverlayEventPayload = {
      id: input.id ?? randomUUID(),
      type: 'message',
      content: input.content,
      danmu_type: (input.danmu_type ?? 'danmaku') as DanmuType,
      platform: input.platform ?? 'local',
      ts: Date.now(),
    }
    this.pushEvent(payload)
  }

  private rememberEvent(payload: OverlayEventPayload): void {
    this.recentEvents.unshift(payload)
    if (this.recentEvents.length > RECENT_EVENT_LIMIT) {
      this.recentEvents.length = RECENT_EVENT_LIMIT
    }
  }

  // ============================================
  // 状态 / 访问器
  // ============================================

  getStatus(): Record<string, unknown> {
    const port = this.httpServer?.getPort() ?? 0
    return {
      serverRunning: !!this.httpServer?.isRunning(),
      port,
      wsClients: this.broadcaster.getClientCount(),
      windowCreated: this.overlayWindow.isCreated(),
      windowVisible: this.overlayWindow.isVisible(),
      windowMode: this.overlayWindow.getMode(),
      // OBS 浏览器源可直接使用的地址
      urls: {
        subtitle: port ? `http://127.0.0.1:${port}/overlay.html?mode=subtitle` : '',
        danmaku: port ? `http://127.0.0.1:${port}/overlay.html?mode=danmaku` : '',
        ws: port ? `ws://127.0.0.1:${port}/ws/overlay` : '',
      },
      recentEvents: this.recentEvents.slice(0, 5),
    }
  }

  getHttpServer(): OverlayHttpServer | null {
    return this.httpServer
  }

  getWindow(): OverlayWindow {
    return this.overlayWindow
  }
}

/** 单例 */
let instance: OverlayManager | null = null

export function getOverlayManager(): OverlayManager {
  if (!instance) instance = OverlayManager.getInstance()
  return instance
}
