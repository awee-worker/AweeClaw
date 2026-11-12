/**
 * 防休眠编排器（主进程）
 *
 * 职责：
 *   1. **引用计数**：多个任务并发要求防休眠时，只有最后一个结束才真正释放
 *      （源项目语义，必须保留 —— 否则并发任务会互相把对方的断言关掉）
 *   2. **去抖**：新持有者在 `minDurationMs` 内不生效，避免为 3 秒的任务起停子进程
 *   3. **顺序化**：所有状态变更走单条 Promise 链，杜绝「stop 与 start 交错」
 *      （子进程的 start/stop 都是异步的，交错会留下跑着的孤儿进程）
 *   4. **残留清理**：启动时按 `guard.json` 定向清理上次被强杀留下的守护进程
 *   5. **如实上报**：平台不支持 / 启动失败 / 守护进程意外退出，三种情况都写进
 *      status 的 `lastError`，不在 UI 上假装「已生效」
 *
 * ── 持有者模型 ──
 *
 * 持有者有两个来源，**互不覆盖**：
 *   · 动态来源：`acquire(reason)` / `release(reason)`（渲染层按 Agent 任务生命周期调用）
 *   · 手动来源：配置项 `manualHold`（设置页的「保持唤醒」开关，跨重启持久化）
 *
 * 之所以不把手动来源也塞进 holders map：`manualHold` 是持久化配置，
 * 需要跨重启恢复；而动态来源是运行时状态，进程重启后必须清零。
 * 两者混在一起会导致「上次崩溃前的 agent-task 计数被恢复」这类脏状态。
 *
 * @module power-guard/PowerGuardManager
 */

import { app, BrowserWindow, type WebContents } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { getMainWindow } from '../../bootstrap/windowManager'
import {
  clearGuardState,
  getConfig,
  readGuardState,
  resetConfig,
  updateConfig,
  validateConfig,
  writeGuardState,
} from './PowerGuardStore'
import {
  createPlatformGuard,
  detectPlatform,
  isProcessAlive,
  killProcess,
  matchesGuardSignature,
} from './PowerGuardPlatform'
import {
  AGENT_TASK_REASON,
  MANUAL_HOLD_REASON,
  POWER_GUARD_STATUS_CHANNEL,
  type PowerGuardConfig,
  type PowerGuardHolder,
  type PowerGuardSource,
  type PowerGuardStatus,
} from './types'

/** 守护子进程的健康检查间隔 */
const HEALTH_CHECK_MS = 30_000

/** 清理残留进程时的等待与升级窗口 */
const STALE_KILL_GRACE_MS = 400

type ActiveMode = 'idle' | 'system'

interface HolderEntry {
  count: number
  since: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 归一化来源标识：空值一律落到 `unknown`，避免同一个空 key 反复被当成新持有者 */
function normalizeReason(reason: unknown): string {
  const raw = typeof reason === 'string' ? reason.trim() : ''
  return raw || 'unknown'
}

export class PowerGuardManager {
  private static instance: PowerGuardManager | null = null

  private readonly platform = createPlatformGuard()

  /** 动态持有者（reason → 计数） */
  private readonly holders = new Map<string, HolderEntry>()

  /**
   * 临时「保持显示器点亮」持有
   *
   * 与上面的动态持有者分开，因为它的语义不同：
   * - 带 TTL，到点自动失效。远程控制是被动收请求的场景，断开、崩溃、手机息屏
   *   都可能让「释放」永远不到来，靠调用方严格配对会留下永久点亮的屏幕
   * - 不参与 minDurationMs 去抖。唤醒后用户马上就要看画面，等一两秒没有意义
   * - 强度直接顶到 `system` 档。`idle` 档只阻止系统休眠、不阻止显示器关闭，
   *   远程操作时屏幕照熄，等于没解决问题
   */
  private displayHold: { reason: string; timer: NodeJS.Timeout | null } | null = null

  /**
   * 防自动锁屏的持有者（reason → 计数）
   *
   * 与 `holders` 分开维护而不是复用：两者语义不同。
   * `holders` 管的是「别让系统睡」，这里管的是「别让屏幕锁」——
   * 远程连接期间需要后者，而 Agent 长任务只需要前者。合并的后果是
   * 「跑任务时电脑永不锁屏」，那是个没人要求过的副作用。
   */
  private readonly screenLockHolders = new Map<string, HolderEntry>()

  /** 防自动锁屏是否正在生效 */
  private screenLockActive = false
  /** 防自动锁屏的实际手段（平台给的可读文案，未生效时为空串） */
  private screenLockMethod = ''
  /** 防自动锁屏覆盖不到的情况（平台如实上报，未生效时为空串） */
  private screenLockNote = ''

  /** 去抖定时器（最早的持有者跨过 minDurationMs 时触发一次提交） */
  private holdTimer: NodeJS.Timeout | null = null

  /** 守护进程健康检查定时器 */
  private healthTimer: NodeJS.Timeout | null = null

  /** 手动保持唤醒的起始时刻（仅用于 UI 展示） */
  private manualSince = 0

  /** 当前是否有断言在生效 */
  private active = false
  /** **实际**生效的档位（启动失败降级后可能与请求档位不同） */
  private activeMode: ActiveMode | null = null
  /**
   * 上一次**请求**的档位。
   *
   * 与 `activeMode` 分开是为了避免降级引发的 spawn 循环：请求 system、实际降级为 idle 时，
   * 若用 `activeMode === desired` 判断「是否已在跑」，每次 commit 都会认为档位不符而重启。
   */
  private appliedRequest: ActiveMode | null = null
  private guardPid: number | null = null
  private source: PowerGuardSource = 'none'
  private startedAt: number | null = null
  private lastError = ''
  private startCount = 0
  private stopCount = 0

  /** 状态变更串行链：保证 start/stop 不会交错 */
  private chain: Promise<void> = Promise.resolve()

  private started = false

  /** 已挂上重载监听的 webContents → 摘除函数（stop 时精确清理，不留监听残留） */
  private readonly reloadHandlers = new Map<WebContents, () => void>()
  private watchingWindows = false
  private readonly onWindowCreated = (_e: Electron.Event, win: BrowserWindow): void => {
    this.watchWindowForReload(win)
  }

  private constructor() {}

  static getInstance(): PowerGuardManager {
    if (!PowerGuardManager.instance) PowerGuardManager.instance = new PowerGuardManager()
    return PowerGuardManager.instance
  }

  // ============================================
  // 生命周期
  // ============================================

  /**
   * 启动模块：先清理上次残留，再按当前配置与持有者集合决定是否起守护。
   *
   * 初始化失败**不抛错** —— 防休眠是增强能力，任何异常都不该阻断应用启动。
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    try {
      await this.cleanupStaleGuard()
    } catch (err) {
      logger.system.warn('[PowerGuard] 残留清理失败：', err)
    }

    if (getConfig().manualHold) this.manualSince = Date.now()

    this.attachReloadGuards()

    if (!this.platform.supported()) {
      const reason = this.platform.unsupportedReason()
      this.lastError = reason
      logger.system.info(`[PowerGuard] 当前平台不支持防休眠：${reason}`)
    }

    await this.commit()
  }

  /** 停止模块并释放断言（幂等，退出流程调用） */
  async stop(): Promise<void> {
    this.started = false
    this.clearHoldTimer()
    this.clearHealthTimer()
    this.detachReloadGuards()
    this.holders.clear()
    // 定时保持同样要断开：否则退出流程已经释放断言，定时器还会在进程存活期间再 commit 一次
    if (this.displayHold?.timer) clearTimeout(this.displayHold.timer)
    this.displayHold = null
    this.screenLockHolders.clear()
    // 防锁屏心跳是独立进程，必须在这里显式收掉：主断言停了它还在，
    // 就会出现「应用退出了但屏幕依然不锁」的僵尸状态
    await this.enqueue(async () => {
      await this.stopGuard()
      await this.stopScreenLockGuard()
    })
  }

  // ============================================
  // 渲染层重载兜底
  // ============================================

  /**
   * 监听渲染层重载，清理动态持有者。
   *
   * ── 为什么必须有这一层 ──
   *
   * 持有者计数存在主进程，但**释放动作由渲染层发起**。渲染层一旦重载
   * （开发态 HMR 全量刷新、用户 Ctrl+R、渲染进程崩溃恢复），正在跑的 Agent 任务
   * 连同它登记的状态一起消失，`release` 永远不会到来 —— 计数永久滞留，
   * 结果是「应用完全空闲但系统还是不休眠」。这是本模块最容易被忽视的泄漏路径，
   * 因为它在开发期几乎必然发生。
   *
   * 重载等价于「渲染层重启」：它那边的任务全部不存在了，因此清空动态持有者
   * 就是正确语义。`manualHold` 属于配置（用户显式意图），不受影响。
   */
  private attachReloadGuards(): void {
    if (this.watchingWindows) return
    this.watchingWindows = true

    for (const win of BrowserWindow.getAllWindows()) this.watchWindowForReload(win)
    app.on('browser-window-created', this.onWindowCreated)
  }

  private detachReloadGuards(): void {
    if (!this.watchingWindows) return
    this.watchingWindows = false

    app.off('browser-window-created', this.onWindowCreated)
    for (const undo of this.reloadHandlers.values()) undo()
    this.reloadHandlers.clear()
  }

  /**
   * 给单个窗口挂重载监听。
   *
   * 这里监听**所有**窗口而不是只盯主窗口，原因在主进程侧无法可靠判断「谁才是主窗口」——
   * `browser-window-created` 是在 `new BrowserWindow()` 过程中同步触发的，
   * 此时 `getMainWindow()` 还没更新。改成在**事件触发时**再判断归属，
   * 既不需要猜，也不会因为窗口重建而漏挂。
   */
  private watchWindowForReload(win: BrowserWindow): void {
    const wc = win.webContents
    if (this.reloadHandlers.has(wc)) return

    const handler = (
      _e: Electron.Event,
      _url: string,
      _isInPlace: boolean,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame) return

      // 归属校验放到触发时：只有主窗口的重载才代表「Agent 任务已消失」
      const main = getMainWindow()
      if (!main || main.isDestroyed() || main.webContents !== wc) return

      const orphans = this.holders.size
      if (orphans === 0) return

      logger.system.warn(
        `[PowerGuard] 渲染层已重载，清理 ${orphans} 个滞留的动态持有者：${[...this.holders.keys()].join(', ')}`,
      )
      this.releaseAll()
    }

    wc.on('did-start-navigation', handler)
    // 进程级崩溃不会走 did-start-navigation，单独兜一层
    const onGone = (): void => {
      if (getMainWindow()?.webContents !== wc) return
      if (this.holders.size > 0) this.releaseAll()
    }
    wc.on('render-process-gone', onGone)

    this.reloadHandlers.set(wc, () => {
      if (!wc.isDestroyed()) {
        wc.off('did-start-navigation', handler)
        wc.off('render-process-gone', onGone)
      }
    })

    wc.once('destroyed', () => {
      this.reloadHandlers.delete(wc)
    })
  }

  // ============================================
  // 持有者
  // ============================================

  /** 取得一份防休眠持有（引用计数 +1） */
  acquire(reason: unknown): void {
    const key = normalizeReason(reason)
    const entry = this.holders.get(key)
    if (entry) {
      entry.count += 1
    } else {
      this.holders.set(key, { count: 1, since: Date.now() })
    }
    this.scheduleHoldTimer()
    void this.commit()
  }

  /**
   * 释放一份防休眠持有（引用计数 -1）。
   *
   * 未持有的 reason 直接忽略而不抛错：调用方往往在 `finally` 里释放，
   * 重复释放（例如 abort 与正常收尾都走到）比漏释放更常见，
   * 为此抛错会把异常从 Agent 主流程里炸出来，得不偿失。
   */
  release(reason: unknown): void {
    const key = normalizeReason(reason)
    const entry = this.holders.get(key)
    if (!entry) return

    entry.count -= 1
    if (entry.count <= 0) this.holders.delete(key)

    this.scheduleHoldTimer()
    void this.commit()
  }

  /** 清空全部动态持有者（排障 / 退出前兜底） */
  releaseAll(): void {
    this.holders.clear()
    this.clearHoldTimer()
    void this.commit()
  }

  // ============================================
  // 显示器临时保持（远程控制）
  // ============================================

  /**
   * 声明「接下来 ttlMs 内显示器必须保持点亮」，续约式调用
   *
   * 典型调用方是远程控制：拉帧与输入注入都说明有人正在看、正在操作这台机器。
   * 每次调用重置到期时间，因此活动持续时屏幕就持续点亮；活动停止后自然失效，
   * 不会出现「手机早退出了、电脑屏幕却再也不熄」的副作用。
   *
   * 用户显式关掉防休眠（`enabled:false` 或 `mode:'off'`）时不覆盖其选择——
   * 那是明确意图，不该被一次远程连接悄悄推翻。
   */
  holdDisplay(reason: unknown, ttlMs: number): void {
    const config = getConfig()
    if (!config.enabled || config.mode === 'off') return

    const key = normalizeReason(reason)
    if (this.displayHold?.timer) clearTimeout(this.displayHold.timer)

    const timer = setTimeout(() => this.releaseDisplay(key), Math.max(1000, ttlMs))
    // 这个定时器不该独自撑住事件循环：进程退出时断言随之消失，无需等它跑完
    timer.unref()

    const wasActive = this.displayHold !== null
    this.displayHold = { reason: key, timer }
    // 已经因为这条保持在 system 档跑着时，续约不需要重算，省掉一次无谓的 commit
    if (!wasActive) void this.commit()
  }

  /** 撤销显示器保持；传 reason 时只撤销该来源 */
  releaseDisplay(reason?: unknown): void {
    if (!this.displayHold) return
    if (reason !== undefined && this.displayHold.reason !== normalizeReason(reason)) return
    if (this.displayHold.timer) clearTimeout(this.displayHold.timer)
    this.displayHold = null
    void this.commit()
  }

  // ============================================
  // 防自动锁屏
  // ============================================

  /**
   * 取得一份防锁屏持有（引用计数 +1）
   *
   * 调用方是远程连接的生命周期（建立时 acquire、断开时 release）。
   * 实际是否生效仍由配置决定：`screenLockGuard` 为 `off` 时持有不计入生效集合。
   */
  acquireScreenLock(reason: unknown): void {
    const key = normalizeReason(reason)
    const entry = this.screenLockHolders.get(key)
    if (entry) {
      entry.count += 1
    } else {
      this.screenLockHolders.set(key, { count: 1, since: Date.now() })
    }
    void this.commit()
  }

  /** 释放一份防锁屏持有（引用计数 -1；未持有时静默忽略，理由同 release） */
  releaseScreenLock(reason: unknown): void {
    const key = normalizeReason(reason)
    const entry = this.screenLockHolders.get(key)
    if (!entry) return

    entry.count -= 1
    if (entry.count <= 0) this.screenLockHolders.delete(key)

    void this.commit()
  }

  /** 清空全部防锁屏持有者（退出前兜底） */
  releaseAllScreenLock(): void {
    if (this.screenLockHolders.size === 0) return
    this.screenLockHolders.clear()
    void this.commit()
  }

  /**
   * 当前是否应该阻止自动锁屏。
   *
   * 三道闸门，任一不满足就完全不干预：
   * - 模块关闭或强度为 `off`：用户明确表达「别碰电源行为」，不越权覆盖
   * - 策略为 `off`，或当前平台没有可靠手段（Linux）
   * - `session` 模式下没有活跃的远程连接
   */
  private isScreenLockGuardNeeded(): boolean {
    const config = getConfig()
    if (!config.enabled || config.mode === 'off') return false
    if (config.screenLockGuard === 'off') return false
    if (!this.platform.supportsScreenLockGuard()) return false
    if (config.screenLockGuard === 'standby') return true
    return this.screenLockHolders.size > 0
  }

  /**
   * 提交一次防锁屏状态重算。
   *
   * 由 `commit()` 串行驱动，**不单独入队** —— 否则会和 `applyDesiredState`
   * 交错，出现「防锁屏起来了但主断言还没起」的中间态。
   */
  private async applyScreenLockState(): Promise<void> {
    const needed = this.isScreenLockGuardNeeded()

    if (!needed) {
      if (this.screenLockActive) await this.stopScreenLockGuard()
      return
    }

    // 已生效且守护仍活着 → 无事可做（Activity 心跳被外部杀掉由健康检查兜底）
    if (this.screenLockActive && this.platform.isScreenLockGuardAlive()) return

    if (this.screenLockActive) await this.stopScreenLockGuard()
    await this.startScreenLockGuard()
  }

  private async startScreenLockGuard(): Promise<void> {
    try {
      const result = await this.platform.startScreenLockGuard()
      this.screenLockActive = true
      this.screenLockMethod = result.method
      this.screenLockNote = result.note
      logger.system.info(`[PowerGuard] 防自动锁屏已生效：${result.method}`)
    } catch (err) {
      // 挡锁屏是增强能力，失败不向上抛：防休眠主断言仍然有效，
      // 而远程控制页仍会照常提示「需要去电脑前解锁」。
      const message = err instanceof Error ? err.message : String(err)
      this.screenLockActive = false
      this.screenLockMethod = ''
      this.screenLockNote = ''
      this.lastError = `防自动锁屏启动失败：${message}`
      logger.system.warn(`[PowerGuard] 防自动锁屏启动失败：${message}`)
    }
    this.notifyStatus()
  }

  private async stopScreenLockGuard(): Promise<void> {
    try {
      await this.platform.stopScreenLockGuard()
    } catch (err) {
      logger.system.warn('[PowerGuard] 停止防自动锁屏失败：', err)
    }
    this.screenLockActive = false
    this.screenLockMethod = ''
    this.screenLockNote = ''
    this.notifyStatus()
  }

  // ============================================
  // 配置
  // ============================================

  /** 写入配置并立即重算生效状态 */
  async applyConfig(patch: unknown): Promise<PowerGuardConfig> {
    const prev = getConfig()
    const next = updateConfig(patch)

    if (next.manualHold && !prev.manualHold) this.manualSince = Date.now()

    // minDurationMs 调小可能让「原本还在去抖窗口里的持有者」立刻达标，
    // 因此必须重排定时器，否则要等到原定时器到期才生效
    this.scheduleHoldTimer()
    await this.commit()
    return next
  }

  /** 恢复默认配置 */
  async handleResetConfig(): Promise<PowerGuardConfig> {
    resetConfig()
    this.manualSince = 0
    await this.applyConfig({})
    return getConfig()
  }

  /** 配置提示（不阻断保存） */
  validate(): string[] {
    return validateConfig(getConfig())
  }

  // ============================================
  // 状态
  // ============================================

  getStatus(): PowerGuardStatus {
    const config = getConfig()
    return {
      enabled: config.enabled,
      mode: config.mode,
      platform: detectPlatform(),
      supported: this.platform.supported(),
      active: this.active,
      source: this.source,
      activeMode: this.activeMode,
      holders: this.collectHolders(),
      guardPid: this.guardPid,
      startedAt: this.startedAt,
      lastError: this.lastError,
      startCount: this.startCount,
      stopCount: this.stopCount,
      screenLockGuardSupported: this.platform.supportsScreenLockGuard(),
      screenLockGuardActive: this.screenLockActive,
      // 未生效时 method 留空；note 退回「平台能力局限」，让 UI 始终能解释
      // 「为什么现在没挡住」——是没开、没连、还是这台机器根本做不到
      screenLockGuardMethod: this.screenLockActive ? this.screenLockMethod : '',
      screenLockGuardNote: this.screenLockActive
        ? this.screenLockNote
        : this.platform.screenLockGuardLimitation(),
    }
  }

  /**
   * 汇总当前持有者（动态 + 手动）。
   *
   * `effective` 在读取时计算而不是写入时固化 —— 否则跨过 minDurationMs 阈值后
   * 状态会一直停留在旧值（去抖的本意是「等一会儿」，不是「永远不生效」）。
   */
  private collectHolders(): PowerGuardHolder[] {
    const config = getConfig()
    const now = Date.now()
    const list: PowerGuardHolder[] = []

    for (const [reason, entry] of this.holders) {
      // Agent 任务来源受 `autoTriggerAgentTask` 门控：开关关掉后持有者仍保留
      // （引用计数不能丢，否则用户在任务中途打开开关会算错账），但**不计入生效集合**。
      const suppressed = reason === AGENT_TASK_REASON && !config.autoTriggerAgentTask
      list.push({
        reason,
        count: entry.count,
        since: entry.since,
        effective: !suppressed && now - entry.since >= config.minDurationMs,
      })
    }

    if (config.manualHold) {
      // 手动保持是明确意图，不受 minDurationMs 约束（该阈值只为自动触发去抖而设）
      list.push({
        reason: MANUAL_HOLD_REASON,
        count: 1,
        since: this.manualSince || now,
        effective: true,
      })
    }

    return list
  }

  /** 是否存在已跨过去抖窗口的持有者 */
  private hasEffectiveHolder(): boolean {
    return this.collectHolders().some(h => h.effective)
  }

  // ============================================
  // 状态机
  // ============================================

  /**
   * 解析「当前应该处于什么强度」。
   *
   * @returns 需要生效的强度；`null` 表示不应有任何断言
   */
  private resolveDesiredMode(): ActiveMode | null {
    const config = getConfig()
    if (!config.enabled) return null
    if (config.mode === 'off') return null
    if (!this.platform.supported()) return null

    // 远程控制活动期间、或正在阻止自动锁屏时，临时顶到 system 档（阻止显示器休眠）。
    //
    // 放在上面三个判断之后是有意的：用户把防休眠关掉或设成 off 时已经返回 null，
    // 这里不会越权改写用户选择。但 mode 只是 `idle` 时要顶上去——`idle` 允许
    // 显示器按时关闭，远程操作的人正看着那块画面，熄掉就等于断了眼睛。
    //
    // 防锁屏必须配套阻止息屏：显示器一关，系统按「唤醒需密码」把屏幕推进登录
    // 界面，防锁屏做得再多也没有意义。两条路径共用同一个断言，不重复起进程。
    if (this.displayHold || this.isScreenLockGuardNeeded()) return 'system'

    if (!this.hasEffectiveHolder()) return null
    return config.mode
  }

  /**
   * 提交一次状态重算（走串行链）
   *
   * 主断言与防锁屏在同一轮里先后计算，顺序不能反过来：防锁屏依赖
   * `resolveDesiredMode` 把档位顶到 `system`，先起防锁屏会有一段
   * 「屏幕可能被息屏」的空窗。
   */
  private commit(): Promise<void> {
    return this.enqueue(async () => {
      await this.applyDesiredState()
      await this.applyScreenLockState()
    })
  }

  /** 把异步状态变更排入串行链，保证 start/stop 不交错 */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task)
    // 链本身不能因单次失败而断裂（否则后续所有变更都不会执行）
    this.chain = next.catch(() => undefined)
    return next
  }

  private async applyDesiredState(): Promise<void> {
    const desired = this.resolveDesiredMode()

    if (!desired) {
      await this.stopGuard()
      return
    }

    // 已为同一档位跑着 → 无事可做。
    //
    // 比较的是 `appliedRequest`（上一次**请求**的档位）而不是 `activeMode`
    // （实际生效的档位）：启动失败降级后两者会不一致（请求 system、实际 idle），
    // 若拿 activeMode 比较，每次 commit 都会认为「档位不符」而重启子进程，
    // 降级失败时直接变成 spawn 循环。
    if (this.active && this.appliedRequest === desired && this.platform.isAlive()) return

    if (this.active) await this.stopGuard()

    await this.startGuard(desired)
  }

  /**
   * 启动守护，失败时降级重试一次。
   *
   * 降级链：**请求档位 → idle 档 → 无保护**。
   * 理由：`system` 档比 `idle` 多一个「阻止显示器休眠」的断言，它的失败概率
   * 明显更高（平台策略 / 无图形会话 / 外接屏管理软件干预）。
   * 此时退回 `idle` 仍能保证「系统不睡」——这是本功能的核心价值——
   * 比直接放弃保护要好得多。降级不是静默的：`lastError` 会写明原因，UI 如实展示。
   */
  private async startGuard(mode: ActiveMode): Promise<void> {
    let effective: 
      | { pid: number | null; kind: PowerGuardSource; effectiveMode: ActiveMode; downgraded: string }
      | null = null
    let failure = ''

    try {
      effective = await this.platform.start(mode)
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err)

      if (mode === 'system') {
        try {
          const fallback = await this.platform.start('idle')
          effective = {
            ...fallback,
            downgraded:
              fallback.downgraded ||
              `完整档（阻止屏幕关闭）启动失败，已降级为「空闲防休眠」：${failure}`,
          }
          logger.system.warn(`[PowerGuard] system 档启动失败，已降级为 idle 档：${failure}`)
        } catch (err2) {
          failure = `${failure}；降级到 idle 档也失败：${err2 instanceof Error ? err2.message : String(err2)}`
        }
      }
    }

    if (!effective) {
      this.active = false
      this.activeMode = null
      this.appliedRequest = null
      this.guardPid = null
      this.source = 'none'
      this.startedAt = null
      this.lastError = failure

      // 启动失败是「系统环境问题」（缺 caffeinate / 缺 systemd / PowerShell 被策略禁），
      // 不是代码缺陷，因此 warn 而非 error，且不向上抛
      logger.system.warn(`[PowerGuard] 防休眠启动失败：${failure}`)
      this.notifyStatus()
      return
    }

    this.active = true
    this.activeMode = effective.effectiveMode
    this.appliedRequest = mode
    this.guardPid = effective.pid
    this.source = effective.kind
    this.startedAt = Date.now()
    this.startCount += 1
    this.lastError = effective.downgraded

    // 先写盘再起健康检查：万一写完盘立刻崩溃，下次启动仍能定向清理。
    // 记录 effectiveMode —— 清理逻辑只需知道「该不该杀」，不关心档位，
    // 但写实际值能让事后排查看懂当时的真实状态。
    writeGuardState({
      guardPid: effective.pid ?? 0,
      kind: effective.kind,
      mode: effective.effectiveMode,
      startedAt: this.startedAt,
    })
    this.ensureHealthTimer()

    logger.system.info(
      `[PowerGuard] 防休眠已生效：requested=${mode} effective=${effective.effectiveMode} ` +
        `mechanism=${effective.kind} pid=${effective.pid ?? 'n/a'}`,
    )

    this.notifyStatus()
  }

  /**
   * 停止守护（幂等）。
   *
   * 无论 `active` 为何都调用一次 `platform.stop()`：平台守卫内部的 stop 是幂等的，
   * 而多调用一次的成本远低于「因为状态标志不准而漏杀一个进程」的代价。
   */
  private async stopGuard(): Promise<void> {
    const wasActive = this.active

    this.clearHealthTimer()

    try {
      await this.platform.stop()
    } catch (err) {
      logger.system.warn('[PowerGuard] 停止守护失败：', err)
    }

    this.active = false
    this.activeMode = null
    this.appliedRequest = null
    this.guardPid = null
    this.source = 'none'
    this.startedAt = null
    if (wasActive) this.stopCount += 1

    clearGuardState()
    if (wasActive) this.notifyStatus()
  }


  // ============================================
  // 定时器
  // ============================================

  /**
   * 重排去抖定时器。
   *
   * 只需盯住**最早持有者**：它是第一个跨过阈值的，一旦达标即长期有效，
   * 后面的持有者不影响「是否生效」这个布尔判断。
   */
  private scheduleHoldTimer(): void {
    const min = getConfig().minDurationMs

    if (min <= 0 || this.holders.size === 0) {
      this.clearHoldTimer()
      return
    }

    let earliest = Number.POSITIVE_INFINITY
    for (const entry of this.holders.values()) {
      if (entry.since < earliest) earliest = entry.since
    }
    if (!Number.isFinite(earliest)) {
      this.clearHoldTimer()
      return
    }

    const due = earliest + min - Date.now()
    if (due <= 0) {
      this.clearHoldTimer()
      return
    }

    this.clearHoldTimer()
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null
      void this.commit()
    }, due)
    // 不阻止进程退出
    this.holdTimer.unref?.()
  }

  private clearHoldTimer(): void {
    if (!this.holdTimer) return
    clearTimeout(this.holdTimer)
    this.holdTimer = null
  }

  /**
   * 守护进程健康检查。
   *
   * 覆盖「子进程被外部干掉」的场景（用户手动 kill、系统策略、caffeinate 因参数被拒后
   * 静默退出）。没有这个检查，status 会一直显示「生效中」而实际早已失效 ——
   * 那是最糟的一种错误：用户以为有保护，其实没有。
   */
  private ensureHealthTimer(): void {
    if (this.healthTimer) return

    this.healthTimer = setInterval(() => {
      if (!this.active) {
        this.clearHealthTimer()
        return
      }
      // 防锁屏心跳是独立进程，可能先于主断言退出（shell 循环因 caffeinate
      // 异常而 exit 是典型情况）。它挂了不影响主断言，所以单独判定、单独重启，
      // 不在这里把整个守卫判死。
      if (this.screenLockActive && !this.platform.isScreenLockGuardAlive()) {
        logger.system.warn('[PowerGuard] 防锁屏心跳已退出，重新启动')
        this.screenLockActive = false
        this.screenLockMethod = ''
        this.screenLockNote = ''
        void this.commit()
      }

      if (this.platform.isAlive()) return

      logger.system.warn('[PowerGuard] 守护进程已意外退出，重新尝试启动')
      this.active = false
      this.activeMode = null
      this.guardPid = null
      this.source = 'none'
      this.startedAt = null
      clearGuardState()
      this.notifyStatus()

      // 重新走一次状态机：持有者仍在，会再次尝试启动。
      // 若平台持续失败，下个检查周期（30s）才会再试，不会形成 spawn 风暴。
      void this.commit()
    }, HEALTH_CHECK_MS)

    this.healthTimer.unref?.()
  }

  private clearHealthTimer(): void {
    if (!this.healthTimer) return
    clearInterval(this.healthTimer)
    this.healthTimer = null
  }

  // ============================================
  // 残留清理
  // ============================================

  /**
   * 清理上次会话留下的守护进程。
   *
   * 触发条件严格限定为「记录中的 owner 进程已经不存在」：
   *   · owner 还活着 → 说明另一个 AweeClaw 实例仍在运行（单实例锁之外的开发态场景），
   *     此时清理会破坏那个实例的断言，因此只告警不动手
   *   · owner 已死 → 典型僵尸状态（应用被 SIGKILL / 断电），必须清理
   *
   * 动手前还要二次确认目标进程的身份（`matchesGuardSignature`），
   * 因为 pid 会被系统复用，只凭 pid 杀进程有可能误杀用户自己的程序。
   */
  private async cleanupStaleGuard(): Promise<void> {
    const state = readGuardState()
    if (!state) return

    if (isProcessAlive(state.ownerPid)) {
      logger.system.warn(
        `[PowerGuard] 检测到另一个实例（pid=${state.ownerPid}）仍在运行，跳过残留清理`,
      )
      return
    }

    const { guardPid, kind } = state

    if (!guardPid || !isProcessAlive(guardPid)) {
      // 最常见的情况：macOS 靠 `-w` 已自愈，或上次本来就正常退出
      clearGuardState()
      return
    }

    if (!matchesGuardSignature(guardPid, kind)) {
      logger.system.warn(
        `[PowerGuard] pid=${guardPid} 存活但不是预期的 ${kind} 守护进程，跳过清理以免误杀`,
      )
      clearGuardState()
      return
    }

    logger.system.warn(`[PowerGuard] 清理上次残留的守护进程：pid=${guardPid} kind=${kind}`)
    killProcess(guardPid)
    await sleep(STALE_KILL_GRACE_MS)

    if (isProcessAlive(guardPid)) {
      logger.system.warn(`[PowerGuard] pid=${guardPid} 未响应 SIGTERM，升级为强制终止`)
      killProcess(guardPid, true)
    }

    clearGuardState()
  }

  // ============================================
  // 推送
  // ============================================

  /** 把状态推给渲染层（窗口不在/已销毁时静默跳过） */
  private notifyStatus(): void {
    try {
      const win = getMainWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(POWER_GUARD_STATUS_CHANNEL, this.getStatus())
    } catch (err) {
      logger.system.debug('[PowerGuard] 状态推送失败：', err)
    }
  }
}

/** 单例 */
let instance: PowerGuardManager | null = null

export function getPowerGuardManager(): PowerGuardManager {
  if (!instance) instance = PowerGuardManager.getInstance()
  return instance
}
