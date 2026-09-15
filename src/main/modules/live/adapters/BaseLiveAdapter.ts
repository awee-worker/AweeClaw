/**
 * 直播适配器基类
 *
 * 三个平台（B站开放平台 / B站网页 / YouTube / Twitch）在**重连、状态、事件投递**
 * 上完全同构，只有「怎么连」和「怎么解析」不同，因此把公共部分收敛到这里：
 *
 *   1. 状态机与状态文案（UI 直接读 `getStatus()`）
 *   2. 指数退避重连（1s→2s→4s…上限 60s；连续失败 5 次后停止重连，不再刷日志）
 *   3. 事件投递（统一走 LiveEventBus，保证去重 / 洪水保护生效）
 *   4. 连接握手 Promise（`waitForConnect` / `resolveConnect` / `rejectConnect`）
 *
 * 子类只需实现：
 *   - `connect(config)`：完成握手，成功 resolve / 失败 throw
 *   - `disconnect()`：彻底释放 socket 与定时器
 *
 * 断线约定：连接**建立之后**的异常由子类调用 `this.fail(err)` 上报，
 * 基类统一按退避策略重连。
 *
 * 统一守卫：所有异步回调（socket 事件 / 定时器）都要先判断 `this.stopped`，
 * 并核对 socket 身份（`this.ws !== ws` 直接 return），避免 stop→start 之后
 * 旧连接的回调把新连接带崩。
 *
 * @module live/adapters/BaseLiveAdapter
 */

import { logger } from '@shared/toolkit/LogEngine'
import { createLiveEvent, getLiveEventBus } from '../LiveEventBus'
import type {
  LiveAdapter,
  LiveAdapterStatus,
  LiveConfig,
  LiveConnectionState,
  LiveDanmuType,
  LivePlatform,
} from '../types'

/** 重连退避基数（ms） */
const RECONNECT_BASE_MS = 1000
/** 重连退避上限（ms） */
const RECONNECT_MAX_MS = 60_000
/** 连续失败到该次数后停止重连（避免无限重连刷日志） */
const MAX_CONSECUTIVE_FAILURES = 5

export abstract class BaseLiveAdapter implements LiveAdapter {
  /** 子类声明所属平台（在方法中读取，不在构造函数里用） */
  abstract readonly platform: LivePlatform

  protected readonly bus = getLiveEventBus()

  /** 当前配置（start 时注入；重连时复用） */
  protected config: LiveConfig | null = null

  /** 是否已停止（所有异步回调的第一道守卫） */
  protected stopped = true

  private state: LiveConnectionState = 'idle'
  private stateMessage = ''

  private eventCount = 0
  private lastEventAt: number | null = null
  private consecutiveFailures = 0

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private connectResolve: (() => void) | null = null
  private connectReject: ((err: Error) => void) | null = null

  // ============================================
  // 生命周期
  // ============================================

  /**
   * 启动适配器。
   *
   * 语义约定：**不抛错**。首次连接失败只体现在 `getStatus()` 的 state/message 上，
   * 由基类按退避策略继续重试 —— 单个平台连不上不该阻断其它平台或 UI 流程。
   */
  async start(config: LiveConfig): Promise<void> {
    if (!this.stopped) return

    this.stopped = false
    this.config = config
    this.consecutiveFailures = 0
    this.eventCount = 0
    this.lastEventAt = null

    await this.attemptConnect()
  }

  /** 停止适配器并释放全部资源（幂等） */
  async stop(): Promise<void> {
    if (this.stopped) return

    this.stopped = true
    this.clearReconnectTimer()
    // 让可能挂起的 connect() Promise 立即结束，避免 start() 永不返回
    this.rejectConnect(new Error('adapter stopped'))
    await this.disconnectQuietly()
    this.setState('stopped')
  }

  // ============================================
  // 连接 / 重连
  // ============================================

  private async attemptConnect(): Promise<void> {
    if (this.stopped) return

    this.setState(this.consecutiveFailures > 0 ? 'reconnecting' : 'connecting')

    try {
      await this.connect(this.config as LiveConfig)
      if (this.stopped) {
        // 握手期间被 stop：补一次断开，避免残留连接
        await this.disconnectQuietly()
        return
      }
      this.consecutiveFailures = 0
      this.setState('connected')
    } catch (err) {
      if (this.stopped) return
      this.handleFailure(err)
    }
  }

  /** 连接建立**之后**发生异常时由子类调用（例如 socket 掉线） */
  protected fail(err: unknown): void {
    if (this.stopped) return
    this.handleFailure(err)
  }

  private handleFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    this.consecutiveFailures++
    this.setState('error', message)

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.system.warn(
        `[Live][${this.platform}] 连续失败 ${this.consecutiveFailures} 次，已暂停重连：${message}`,
      )
      this.setState('error', `${message}（已连续失败 ${this.consecutiveFailures} 次，暂停重连）`)
      this.clearReconnectTimer()
      return
    }

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.consecutiveFailures - 1), RECONNECT_MAX_MS)
    logger.system.warn(
      `[Live][${this.platform}] 连接失败（第 ${this.consecutiveFailures} 次），${delay}ms 后重连：${message}`,
    )
    this.scheduleReconnect(delay)
  }

  /** 排一次重连（已有待执行的重连时不重复排队） */
  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.attemptConnect()
    }, delayMs)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async disconnectQuietly(): Promise<void> {
    try {
      await this.disconnect()
    } catch (err) {
      logger.system.warn(`[Live][${this.platform}] disconnect failed:`, err)
    }
  }

  // ============================================
  // 握手 Promise 工具（供子类使用）
  // ============================================

  /**
   * 返回一个在「适配器完成鉴权」时 settle 的 Promise。
   *
   * 超时兜底是必要的：子类若因协议异常漏调 settle，`start()` 会永久挂起。
   */
  protected waitForConnect(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      this.connectTimeoutTimer = setTimeout(() => {
        this.connectTimeoutTimer = null
        this.rejectConnect(new Error(`连接超时（${timeoutMs}ms）`))
      }, timeoutMs)
    })
  }

  /** 标记握手成功（幂等） */
  protected resolveConnect(): void {
    const resolve = this.connectResolve
    this.clearConnectSettle()
    resolve?.()
  }

  /** 标记握手失败（幂等；无挂起 Promise 时为空操作） */
  protected rejectConnect(err: Error): void {
    const reject = this.connectReject
    this.clearConnectSettle()
    reject?.(err)
  }

  /**
   * 是否仍在握手阶段。
   *
   * 子类在处理 socket 异常时用它分流：握手期失败 → rejectConnect（走 connect 的 catch），
   * 已连接后掉线 → fail（走退避重连）。两条路径都会计入失败次数，混用会重复计数。
   */
  protected isConnectPending(): boolean {
    return this.connectReject !== null
  }

  private clearConnectSettle(): void {
    this.connectResolve = null
    this.connectReject = null
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer)
      this.connectTimeoutTimer = null
    }
  }

  // ============================================
  // 状态 / 事件
  // ============================================

  protected setState(state: LiveConnectionState, message = ''): void {
    if (this.state === state && this.stateMessage === message) return
    this.state = state
    this.stateMessage = message

    const text = `[Live][${this.platform}] ${state}${message ? `：${message}` : ''}`
    if (state === 'error') logger.system.warn(text)
    else logger.system.info(text)
  }

  /** 投递一条归一化事件（空内容直接丢弃，避免脏数据流到 overlay） */
  protected emitEvent(danmu_type: LiveDanmuType, content: string, raw?: unknown): void {
    if (!content) return
    this.eventCount++
    this.lastEventAt = Date.now()
    this.bus.publish(createLiveEvent(this.platform, danmu_type, content, raw))
  }

  getStatus(): LiveAdapterStatus {
    return {
      platform: this.platform,
      running: !this.stopped,
      state: this.state,
      message: this.stateMessage,
      eventCount: this.eventCount,
      lastEventAt: this.lastEventAt,
      retryCount: this.consecutiveFailures,
    }
  }

  // ============================================
  // 子类实现
  // ============================================

  /** 建立连接（含鉴权）。成功 resolve，失败 throw */
  protected abstract connect(config: LiveConfig): Promise<void>

  /** 释放连接与全部定时器（必须幂等） */
  protected abstract disconnect(): Promise<void>
}
