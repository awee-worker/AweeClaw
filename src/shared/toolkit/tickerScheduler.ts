/**
 * 周期任务统一调度器（主进程 / 渲染进程共用）
 *
 * 背景：裸 `setInterval` 散落在两端各模块里，周期各自为政，没有统一入口，
 * 也就没有统一的「什么时候该停」的判断。窗口隐藏、进入伴生模式时，
 * 那些数据已经无人消费的轮询仍在按原周期唤醒 CPU。
 *
 * 本模块只做一件事：把周期任务收拢到一个对象上，由调用方注入可见性来源，
 * 从而让「隐藏即挂起、可见即恢复」成为调度器的固有行为，而不是每个
 * 调用点各自记得处理。
 *
 * 两端接入方式：
 * - 渲染进程：注入基于 `document.visibilitychange` 的 host（见 services/tickerScheduler）
 * - 主进程：不注入 host，由窗口显隐事件驱动 `setVisible()`
 *
 * 调度规则：
 * - `visible-only`：不可见时挂起，恢复可见时立即补跑一次再回到周期计时
 * - `always`：始终运行（真正的后台任务，例如会话保活心跳）
 *
 * 单次 handler 抛错只记日志、不摘除任务，与主进程 safeInit 的隔离语义一致：
 * 一次偶发失败不该让整条轮询永久消失。
 *
 * @module shared/toolkit/tickerScheduler
 */

import { logger } from './LogEngine'

/** 任务的可见性要求 */
export type TickerVisibility = 'visible-only' | 'always'

export interface TickerOptions {
  /** 任务唯一标识，用于去重与排查 */
  id: string
  /** 触发周期（毫秒） */
  intervalMs: number
  /** 可见性要求 */
  visibility: TickerVisibility
  handler: () => void | Promise<void>
}

/** 可见性来源，由调用方按运行环境注入 */
export interface TickerSchedulerHost {
  /** 订阅可见性变化，返回取消订阅函数 */
  onVisibilityChange(handler: (visible: boolean) => void): () => void
  /** 当前是否可见 */
  isVisible(): boolean
}

interface TickerEntry extends TickerOptions {
  timer: ReturnType<typeof setInterval> | null
  suspended: boolean
}

export class TickerScheduler {
  private entries = new Map<string, TickerEntry>()
  private visible: boolean
  private detachHost: (() => void) | null = null

  /**
   * @param host 可见性来源。渲染进程传入基于 document 的实现；
   *             主进程不传，改为调用 `setVisible()` 由窗口事件驱动。
   */
  constructor(host?: TickerSchedulerHost) {
    this.visible = host ? host.isVisible() : true
    if (host) {
      this.detachHost = host.onVisibilityChange((visible) => this.setVisible(visible))
    }
  }

  /** 注册周期任务，返回停止函数 */
  register(options: TickerOptions): () => void {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      logger.system.warn(`[TickerScheduler] ${options.id}: intervalMs 非法，拒绝注册`)
      return () => {}
    }

    // 重复注册（组件热更新 / 快速重挂载）先清掉旧任务，避免同 id 双计时器
    this.unregister(options.id)

    const entry: TickerEntry = {
      ...options,
      timer: null,
      suspended: !this.shouldRun(options),
    }
    this.entries.set(options.id, entry)
    if (!entry.suspended) this.schedule(entry)

    return () => this.unregister(options.id)
  }

  /** 停止并移除任务 */
  unregister(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.timer !== null) clearInterval(entry.timer)
    this.entries.delete(id)
  }

  /** 立即触发一次（不影响周期计时）；挂起中的任务不会被执行 */
  poke(id: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.suspended) return
    void this.invoke(entry)
  }

  /**
   * 更新可见性。渲染进程由 host 回调驱动，主进程由窗口显隐事件驱动。
   * 状态未变化时直接返回，避免重复的挂起/恢复风暴。
   */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (visible) {
      this.resumeVisibleOnly()
    } else {
      this.suspendVisibleOnly()
    }
  }

  /** 当前已注册的任务 id，供诊断与测试使用 */
  listIds(): string[] {
    return [...this.entries.keys()]
  }

  /** 停止全部任务并解绑可见性来源（应用退出时调用） */
  dispose(): void {
    for (const id of [...this.entries.keys()]) this.unregister(id)
    this.detachHost?.()
    this.detachHost = null
  }

  private shouldRun(options: TickerOptions): boolean {
    return options.visibility === 'always' || this.visible
  }

  private schedule(entry: TickerEntry): void {
    if (entry.suspended) return
    entry.timer = setInterval(() => void this.invoke(entry), entry.intervalMs)
  }

  private async invoke(entry: TickerEntry): Promise<void> {
    try {
      await entry.handler()
    } catch (err) {
      logger.system.warn(`[TickerScheduler] ${entry.id} handler failed:`, err)
    }
  }

  private suspendVisibleOnly(): void {
    for (const entry of this.entries.values()) {
      if (entry.visibility !== 'visible-only') continue
      if (entry.timer !== null) clearInterval(entry.timer)
      entry.timer = null
      entry.suspended = true
    }
  }

  private resumeVisibleOnly(): void {
    for (const entry of this.entries.values()) {
      if (entry.visibility !== 'visible-only') continue
      if (!entry.suspended) continue
      entry.suspended = false
      // 恢复可见先补跑一次：面板类任务最关心「刚回来」这份数据，
      // 等一个完整周期再刷新会让用户看到过期值
      void this.invoke(entry)
      this.schedule(entry)
    }
  }
}
