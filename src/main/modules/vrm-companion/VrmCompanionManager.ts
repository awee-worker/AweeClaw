/**
 * VRM 伴侣窗口管理器（单例）
 *
 * 职责：
 * - 创建/显示/隐藏/销毁 VRM 桌面伴侣窗口（独立窗口，与悬浮头像窗口并存）
 * - 窗口属性：frame:false / transparent:true / alwaysOnTop('screen-saver') / skipTaskbar
 * - 位置与尺寸持久化（<userData>/vrm/companion_config.json）
 * - 拖拽支持：渲染进程发送 drag-start/drag-end，主进程轮询鼠标坐标移动窗口
 *   （复用悬浮头像已验证的方案：不依赖渲染层 mousemove，鼠标移出窗口也能继续拖）
 *
 * 关键设计：
 * - 伴侣窗口不注册进 windowManager.windows Map，避免计入 getOpenWindows / window-all-closed，
 *   满足「关闭主窗口后伴侣仍可存在」的需求；由 globalCleanup 统一销毁。
 * - 与悬浮头像窗口（FloatingAvatarManager）完全独立：两者可同时开启。
 * - 开发态从 Vite devServer 加载，生产态 loadFile dist/renderer/vrm-companion.html。
 */

import { BrowserWindow, screen, ipcMain } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import {
  getConfig,
  updateConfig,
  DEFAULT_COMPANION_WIDTH,
  DEFAULT_COMPANION_HEIGHT,
} from './VrmCompanionStore'

// ============================================
// 常量
// ============================================

/** 尺寸限制（防止用户拖成不可用尺寸） */
const MIN_WIDTH = 200
const MAX_WIDTH = 720
const MIN_HEIGHT = 260
const MAX_HEIGHT = 1080

/** 默认边距（右下角） */
const DEFAULT_MARGIN_RIGHT = 24
const DEFAULT_MARGIN_BOTTOM = 24

/**
 * 边缘吸附距离（px）。
 *
 * 必须足够小：窗口默认就停在右下角（距边缘 24px），
 * 早期取 80px 会把「刚拖出去 30~70px 就被吸回角落」当成正常行为，
 * 用户感知为「拖不动 / 拖了又弹回去」。现在只有真正贴上边缘才吸附。
 */
const EDGE_SNAP_DISTANCE = 8

/** 单次拖拽最长时间（ms）：渲染层 drag-end 丢失时的看门狗阈值 */
const MAX_DRAG_DURATION_MS = 60_000

/**
 * 伴侣运行时状态广播频道（主进程 → 所有窗口）。
 *
 * 载荷：{ visible: boolean; clickThrough: boolean }
 * 消费方：主窗口顶部栏「桌面伴侣」开关、设置面板等；
 * 目的是让外部 UI 与伴侣真实状态保持同步（状态只存在于主进程内存）。
 */
const STATE_CHANGED_CHANNEL = 'vrm-companion:state-changed'

/**
 * 指针位置推送频道（主进程 → 伴侣窗口）。
 *
 * 载荷：{ inside: boolean; x: number; y: number }（x/y 为相对窗口中心归一化到 -1~1）
 * 消费方：伴侣窗口渲染层 —— 既用于角色视线跟随，也用于「鼠标是否压在角色/操作栏上」判定。
 *
 * 为什么由主进程下发而不是让渲染层监听 mousemove：
 * 穿透模式下窗口忽略鼠标事件，仅靠 `forward` 转发移动事件在部分平台/场景不可靠
 * （指针移出窗口后可能收不到结束事件，悬停状态会永久卡住、窗口再也让不开点击）。
 * 「轮询屏幕坐标」是唯一与平台无关的真相来源（窗口拖拽已采用同一方案）。
 */
const POINTER_STATE_CHANNEL = 'vrm-companion:pointer-state'

/** 指针位置轮询间隔（ms）：50ms ≈ 20Hz，兼顾响应速度与开销 */
const POINTER_POLL_INTERVAL_MS = 50

// ============================================
// 管理器
// ============================================

export class VrmCompanionManager {
  private static instance: VrmCompanionManager | null = null

  private window: BrowserWindow | null = null

  /**
   * 是否处于「鼠标穿透」模式。
   *
   * 默认开启：桌面伴侣只是桌面一角的存在，默认不该抢走桌面的点击。
   * 穿透并不等于「无法操作」——鼠标移到角色上仍会浮出操作栏，
   * 指针压到操作栏时渲染层会上报，本管理器再临时让窗口接收鼠标事件。
   */
  private clickThrough = true

  /**
   * 临时穿透（自动隐藏悬停时）。
   *
   * 与 clickThrough 分开存放：autoHide 希望在悬停瞬间让开点击，
   * 但它属于「本次悬停的临时行为」，不能覆盖用户手动设置的穿透偏好
   * （否则用户关掉穿透后一碰角色就被改回穿透）。
   */
  private transientPassThrough = false

  /** 指针是否正压在角色 / 操作栏上（渲染层上报），穿透模式下据此按需接管鼠标事件 */
  private pointerOverInteractive = false

  /** 窗口当前是否已被设置为「忽略鼠标事件」，避免重复调用 setIgnoreMouseEvents */
  private mouseIgnored = false

  /** 指针轮询计时器（仅穿透生效期间运行） */
  private pointerPollTimer: ReturnType<typeof setInterval> | null = null

  /** 上一轮轮询时指针是否在窗口内（用于窗口外时停止刷 IPC） */
  private lastPointerInside = false

  private constructor() {}

  /** 获取单例 */
  public static getInstance(): VrmCompanionManager {
    if (!VrmCompanionManager.instance) {
      VrmCompanionManager.instance = new VrmCompanionManager()
    }
    return VrmCompanionManager.instance
  }

  // --------------------------------------------
  // 窗口创建
  // --------------------------------------------

  /**
   * 创建伴侣窗口（幂等：已存在则直接返回）
   */
  public create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window

    const config = getConfig()
    const { x, y } = this.resolvePosition(config.width, config.height)

    this.window = new BrowserWindow({
      width: config.width,
      height: config.height,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      // 透明窗口在 Windows/Linux 下可能有黑底，显式设置全透明背景色兜底
      backgroundColor: '#00000000',
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      // 点击窗口任意位置即激活（伴侣窗口无输入框焦点需求）
      acceptFirstMouse: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 3D 渲染需要持续绘制，禁用后台节流避免隐藏时停止动画
        backgroundThrottling: false,
        webgl: true,
        // TTS 语音播放无需用户手势（Electron 39 该选项位于 webPreferences 层）
        autoplayPolicy: 'no-user-gesture-required',
      },
    })

    // 置顶级别：screen-saver 高于普通应用窗口（macOS 下亦高于 Dock）
    this.window.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver')

    // 穿透状态从配置恢复（默认开启）；新窗口初始不忽略鼠标事件，
    // 因此必须把 mouseIgnored 归零，否则 applyMouseIgnoring 会误判为「已是穿透态」而跳过设置
    this.clickThrough = config.clickThrough
    this.pointerOverInteractive = false
    this.transientPassThrough = false
    this.mouseIgnored = false

    // 不透明度（0.3 ~ 1，低于 1 时角色呈半透明浮在桌面上）
    this.window.setOpacity(config.opacity)

    // macOS：不出现在 Dock 右键窗口列表
    if (process.platform === 'darwin') {
      this.window.excludedFromShownWindowsMenu = true
    }

    // 尺寸变化时持久化
    this.window.on('resized', () => {
      this.persistBounds()
    })

    // 失焦保持显示
    this.window.on('blur', () => {})

    /**
     * 显隐与穿透/轮询联动。
     *
     * 用窗口事件而不是只在 show()/hide() 里处理：窗口还可能因
     * 创建后自动显示、异常销毁等路径改变可见性，挂在事件上才不会漏。
     * 隐藏时必须停止轮询并清掉穿透态 —— 否则「上次悬停在操作栏上」的
     * 状态会残留，下次显示时窗口会莫名其妙地挡住桌面点击。
     */
    this.window.on('show', () => {
      this.applyMouseIgnoring()
      this.syncPointerPoll()
    })

    this.window.on('hide', () => {
      this.pointerOverInteractive = false
      this.transientPassThrough = false
      this.mouseIgnored = false
      this.stopPointerPoll()
    })

    this.window.on('closed', () => {
      this.window = null
      this.stopPointerPoll()
    })

    this.registerDragHandler()
    this.loadCompanionContent()

    logger.system.info('[VrmCompanion] Window created', { x, y, ...config })
    return this.window
  }

  /** 加载渲染内容：开发态 devServer / 生产态 dist */
  private loadCompanionContent(): void {
    if (!this.window) return

    const devServerUrl = process.env.VITE_DEV_SERVER_URL
    if (devServerUrl) {
      void this.window.loadURL(`${devServerUrl}vrm-companion.html`)
      return
    }

    this.window.loadFile(path.join(__dirname, '../renderer/vrm-companion.html'))
  }

  // --------------------------------------------
  // 拖拽（主进程轮询鼠标坐标）
  // --------------------------------------------

  /**
   * 注册拖拽处理器。
   *
   * 渲染层在 mousedown 时发送 drag-start，mouseup 时发送 drag-end；
   * 主进程用 setInterval 轮询鼠标屏幕坐标计算窗口位置，
   * 避免依赖渲染层 mousemove（鼠标移出窗口后事件中断导致拖拽卡住）。
   */
  private registerDragHandler(): void {
    if (!this.window) return
    const winId = this.window.id
    const startChannel = `vrm-companion:drag-start:${winId}`
    const endChannel = `vrm-companion:drag-end:${winId}`

    type DragOrigin = {
      mouseX: number
      mouseY: number
      winX: number
      winY: number
      display: Electron.Display
    }
    let dragOrigin: DragOrigin | null = null
    let dragTimer: ReturnType<typeof setInterval> | null = null
    /** 兜底：渲染层异常导致 drag-end 丢失时，最长拖拽时长（ms）后自动结束 */
    let dragDeadline = 0

    const stopDragTimer = (): void => {
      if (dragTimer) {
        clearInterval(dragTimer)
        dragTimer = null
      }
      dragDeadline = 0
    }

    const startHandler = (): void => {
      if (!this.window || this.window.isDestroyed()) return
      // 锁定位置：直接忽略拖拽请求（双保险，渲染层也会提前拦截）
      if (getConfig().locked) return
      const cursor = screen.getCursorScreenPoint()
      const [wx, wy] = this.window.getPosition()
      // 锁定拖拽起点所在显示器，避免跨屏（多显示器不同 DPI）坐标跳变
      const display = screen.getDisplayNearestPoint({ x: cursor.x, y: cursor.y })
      dragOrigin = { mouseX: cursor.x, mouseY: cursor.y, winX: wx, winY: wy, display }

      // 顺序敏感：stopDragTimer() 会把 dragDeadline 归零，
      // 因此必须先清理上一轮计时器、再设置本轮看门狗阈值。
      // 若顺序反过来，首个 tick 就会命中 `Date.now() > 0` 的兜底分支，
      // 拖拽在 16ms 内被强制结束 —— 表现为「按住拖动完全没反应」。
      stopDragTimer()
      dragDeadline = Date.now() + MAX_DRAG_DURATION_MS
      dragTimer = setInterval(() => {
        if (!dragOrigin || !this.window || this.window.isDestroyed()) {
          stopDragTimer()
          return
        }
        // 兜底：渲染层未发送 drag-end（窗口/渲染进程异常）时自动收尾，
        // 否则窗口会一直粘着鼠标，用户无法恢复操作
        if (dragDeadline > 0 && Date.now() > dragDeadline) {
          logger.system.warn('[VrmCompanion] Drag watchdog fired, force end')
          endHandler()
          return
        }
        const cursor = screen.getCursorScreenPoint()
        const newX = dragOrigin.winX + (cursor.x - dragOrigin.mouseX)
        const newY = dragOrigin.winY + (cursor.y - dragOrigin.mouseY)
        // 约束在拖拽起点显示器的 workArea 内（允许少量出屏作为视觉余量）
        const { workArea } = dragOrigin.display
        const [w, h] = this.window.getSize()
        const clampedX = Math.max(workArea.x - w + 40, Math.min(workArea.x + workArea.width - 40, newX))
        const clampedY = Math.max(workArea.y - h + 40, Math.min(workArea.y + workArea.height - 40, newY))
        this.window.setPosition(Math.round(clampedX), Math.round(clampedY), false)
      }, 16)
    }

    const endHandler = (): void => {
      stopDragTimer()
      if (dragOrigin && this.window && !this.window.isDestroyed()) {
        this.snapToEdge()
        this.persistBounds()
      }
      dragOrigin = null
    }

    ipcMain.on(startChannel, startHandler)
    ipcMain.on(endChannel, endHandler)

    this.window.once('closed', () => {
      if (dragTimer) clearInterval(dragTimer)
      ipcMain.removeListener(startChannel, startHandler)
      ipcMain.removeListener(endChannel, endHandler)
    })
  }

  /** 获取拖拽频道名（渲染进程启动时获取一次） */
  public getDragChannel(): { start: string; end: string } | null {
    if (!this.window || this.window.isDestroyed()) return null
    const id = this.window.id
    return {
      start: `vrm-companion:drag-start:${id}`,
      end: `vrm-companion:drag-end:${id}`,
    }
  }

  /** 靠近屏幕边缘时自动吸附 */
  private snapToEdge(): void {
    if (!this.window || this.window.isDestroyed()) return
    const [x, y] = this.window.getPosition()
    const [w, h] = this.window.getSize()
    const display = screen.getDisplayNearestPoint({ x: x + w / 2, y: y + h / 2 })
    const { workArea } = display

    let snapX = x
    let snapY = y

    if (x - workArea.x <= EDGE_SNAP_DISTANCE) {
      snapX = workArea.x + DEFAULT_MARGIN_RIGHT
    } else if (workArea.x + workArea.width - (x + w) <= EDGE_SNAP_DISTANCE) {
      snapX = workArea.x + workArea.width - w - DEFAULT_MARGIN_RIGHT
    }
    if (y - workArea.y <= EDGE_SNAP_DISTANCE) {
      snapY = workArea.y + DEFAULT_MARGIN_BOTTOM
    } else if (workArea.y + workArea.height - (y + h) <= EDGE_SNAP_DISTANCE) {
      snapY = workArea.y + workArea.height - h - DEFAULT_MARGIN_BOTTOM
    }

    if (snapX !== x || snapY !== y) {
      this.window.setPosition(Math.round(snapX), Math.round(snapY), false)
    }
  }

  // --------------------------------------------
  // 显隐控制
  // --------------------------------------------

  /** 显示伴侣窗口（不存在则先创建） */
  public show(): void {
    if (!this.window || this.window.isDestroyed()) this.create()
    if (this.window && !this.window.isVisible()) {
      this.window.showInactive()
      logger.system.info('[VrmCompanion] Shown')
    }
    // 显示后立刻按当前穿透配置接管/放行鼠标事件，并启动指针轮询
    this.applyMouseIgnoring()
    this.syncPointerPoll()
    updateConfig({ enabled: true })
    this.broadcastState()
  }

  /** 隐藏（保留 warm renderer，不销毁） */
  public hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide()
      logger.system.info('[VrmCompanion] Hidden')
    }
    this.resetPointerState()
    updateConfig({ enabled: false })
    this.broadcastState()
  }

  /** 切换显隐 */
  public toggle(): void {
    if (this.isVisible()) this.hide()
    else this.show()
  }

  public isVisible(): boolean {
    return !!this.window && !this.window.isDestroyed() && this.window.isVisible()
  }

  public isCreated(): boolean {
    return !!this.window && !this.window.isDestroyed()
  }

  public getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null
  }

  // --------------------------------------------
  // 尺寸 / 位置 / 穿透
  // --------------------------------------------

  /**
   * 设置窗口尺寸并持久化。
   *
   * 上限同时受「当前显示器可用区域」约束：伴侣窗口默认贴右下角，
   * 高度超过屏幕时窗口下半部分永远在屏幕外，用户看到的角色就是被裁的。
   * 尺寸变化后还会重新贴合可见区域（保持右下角锚点），放大不会跑出屏幕。
   */
  public setSize(width: number, height: number): void {
    if (!this.window || this.window.isDestroyed()) return

    const [prevW, prevH] = this.window.getSize()
    const [x, y] = this.window.getPosition()
    const display = screen.getDisplayNearestPoint({ x: x + prevW / 2, y: y + prevH / 2 })
    const { workArea } = display

    let w = Math.max(MIN_WIDTH, Math.min(Math.min(MAX_WIDTH, workArea.width), Math.round(width)))
    let h = Math.max(MIN_HEIGHT, Math.min(Math.min(MAX_HEIGHT, workArea.height), Math.round(height)))

    // 高度被屏幕限制时按同一比例回收宽度，避免调用方传入的宽高比被破坏（等比缩放语义）
    const wantedW = Math.round(width)
    const wantedH = Math.round(height)
    if (wantedW > 0 && wantedH > 0 && h < wantedH) {
      w = Math.max(MIN_WIDTH, Math.min(w, Math.round(wantedW * (h / wantedH))))
    }

    this.window.setSize(w, h, false)
    // 仅在尺寸真的变化时校正位置：尺寸未变就不动窗口，
    // 否则用户把窗口压到屏幕边缘之外后，改个不透明度也会被“拉”回屏内
    if (w !== prevW || h !== prevH) {
      this.reanchorToWorkArea(x, y, prevW, prevH, w, h, display)
    }
    updateConfig({ width: w, height: h })
  }

  /**
   * 尺寸变化后校正窗口位置（保持右下角锚点 + 夹取到当前显示器可用区域内）。
   *
   * 为什么必须做：伴侣窗口默认停在右下角，一放大就向右下越出屏幕，
   * 角色被屏幕边缘切掉 —— 用户感知为「放大后被裁剪」。
   */
  private reanchorToWorkArea(
    x: number,
    y: number,
    prevW: number,
    prevH: number,
    w: number,
    h: number,
    display: Electron.Display,
  ): void {
    if (!this.window || this.window.isDestroyed()) return
    const { workArea } = display

    const maxX = workArea.x + Math.max(0, workArea.width - w)
    const maxY = workArea.y + Math.max(0, workArea.height - h)
    const nextX = Math.round(Math.min(Math.max(x + prevW - w, workArea.x), maxX))
    const nextY = Math.round(Math.min(Math.max(y + prevH - h, workArea.y), maxY))

    if (nextX !== x || nextY !== y) {
      this.window.setPosition(nextX, nextY, false)
      updateConfig({ positionX: nextX, positionY: nextY })
    }
  }

  /** 设置位置并持久化 */
  public setPosition(x: number, y: number): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.setPosition(Math.round(x), Math.round(y), false)
    updateConfig({ positionX: Math.round(x), positionY: Math.round(y) })
  }

  public getPosition(): { x: number; y: number } | null {
    if (!this.window || this.window.isDestroyed()) return null
    const [x, y] = this.window.getPosition()
    return { x, y }
  }

  public getSize(): { width: number; height: number } | null {
    if (!this.window || this.window.isDestroyed()) return null
    const [width, height] = this.window.getSize()
    return { width, height }
  }

  /**
   * 设置鼠标穿透（用户偏好，落盘持久化）。
   *
   * 开启后窗口整体忽略鼠标事件（不遮挡桌面操作）；
   * 即便如此，鼠标移到角色上仍会浮出操作栏 —— 指针压到操作栏时由
   * `setPointerInteractive` 临时接管鼠标事件，用完立即交还穿透。
   */
  public setClickThrough(enabled: boolean): void {
    this.clickThrough = enabled
    updateConfig({ clickThrough: enabled })
    this.applyMouseIgnoring()
    this.syncPointerPoll()
    logger.system.info('[VrmCompanion] Click-through:', enabled)
    // 同步给伴侣窗口：穿透开关既存在于设置面板，也存在于伴侣窗口自身操作栏
    this.send('vrm-companion:config-updated', getConfig())
    this.broadcastState()
  }

  public isClickThrough(): boolean {
    return this.clickThrough
  }

  /**
   * 渲染层上报「指针是否压在角色 / 操作栏上」。
   *
   * 穿透模式下窗口忽略鼠标事件，若指针压到操作栏仍不放行事件，按钮就点不动；
   * 因此这里做「按需临时接管」：压住操作栏时接收事件，离开后立刻恢复穿透。
   * 注意只影响「是否忽略鼠标事件」，不改变用户的穿透偏好。
   */
  public setPointerInteractive(inside: boolean): void {
    if (this.pointerOverInteractive === inside) return
    this.pointerOverInteractive = inside
    this.applyMouseIgnoring()
  }

  /**
   * 设置「临时穿透」（自动隐藏悬停时使用）。
   *
   * 与用户偏好 clickThrough 取并集：任一为真即忽略鼠标事件。
   */
  public setTransientPassThrough(enabled: boolean): void {
    if (this.transientPassThrough === enabled) return
    this.transientPassThrough = enabled
    this.applyMouseIgnoring()
  }

  // --------------------------------------------
  // 鼠标事件接管（穿透 ↔ 临时交互）
  // --------------------------------------------

  /** 当前窗口是否应当忽略鼠标事件 */
  private shouldIgnoreMouse(): boolean {
    if (!this.isVisible()) return false
    // 用户手动穿透 或 自动隐藏临时穿透：忽略鼠标事件
    if (this.clickThrough || this.transientPassThrough) {
      // 例外：指针压在操作栏上时放行，否则按钮点不动
      return !this.pointerOverInteractive
    }
    return false
  }

  /** 把「是否忽略鼠标事件」同步到窗口（仅在状态变化时调用，避免无谓切换） */
  private applyMouseIgnoring(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const ignore = this.shouldIgnoreMouse()
    if (ignore === this.mouseIgnored) return
    this.mouseIgnored = ignore
    if (ignore) {
      // forward:true 让渲染进程仍能收到 mousemove（用于角色视线跟随的兜底）
      win.setIgnoreMouseEvents(true, { forward: true })
    } else {
      win.setIgnoreMouseEvents(false)
    }
    logger.system.debug('[VrmCompanion] Ignore mouse events:', ignore)
  }

  /** 清理指针相关的临时状态（隐藏/销毁时调用） */
  private resetPointerState(): void {
    this.pointerOverInteractive = false
    this.transientPassThrough = false
    this.mouseIgnored = false
    this.stopPointerPoll()
    // 通知渲染层收起悬停 UI（否则下次显示时操作栏仍是展开态）
    this.send(POINTER_STATE_CHANNEL, { inside: false, x: 0, y: 0 })
  }

  // --------------------------------------------
  // 指针位置轮询
  // --------------------------------------------

  /** 按当前穿透状态决定是否轮询指针位置 */
  private syncPointerPoll(): void {
    const need = this.isVisible() && (this.clickThrough || this.transientPassThrough)
    if (need) this.startPointerPoll()
    else this.stopPointerPoll()
  }

  private startPointerPoll(): void {
    if (this.pointerPollTimer) return
    this.pointerPollTimer = setInterval(() => this.pollPointer(), POINTER_POLL_INTERVAL_MS)
  }

  private stopPointerPoll(): void {
    if (this.pointerPollTimer) {
      clearInterval(this.pointerPollTimer)
      this.pointerPollTimer = null
    }
    this.lastPointerInside = false
  }

  /**
   * 轮询鼠标屏幕坐标并推送给渲染层。
   *
   * 附带安全兜底：一旦指针已经离开窗口，而渲染层还没上报「不再压住操作栏」，
   * 这里强制解除接管 —— 否则窗口会永久挡住桌面点击（用户感知为「鼠标穿透失效」）。
   * 触发场景：渲染层卡顿 / 窗口被拖走 / 系统吞掉了 mouseup。
   */
  private pollPointer(): void {
    const win = this.window
    if (!win || win.isDestroyed() || !win.isVisible()) {
      this.stopPointerPoll()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    const [x, y] = win.getPosition()
    const [w, h] = win.getSize()
    const inside = cursor.x >= x && cursor.x < x + w && cursor.y >= y && cursor.y < y + h

    if (!inside && this.pointerOverInteractive) {
      this.setPointerInteractive(false)
    }

    // 指针在窗口外时只在「刚离开」的那一次下发，避免空转刷 IPC
    if (!inside && !this.lastPointerInside) return
    this.lastPointerInside = inside

    this.send(POINTER_STATE_CHANNEL, {
      inside,
      x: inside ? ((cursor.x - x) / w) * 2 - 1 : 0,
      y: inside ? ((cursor.y - y) / h) * 2 - 1 : 0,
    })
  }

  /** 设置置顶 */
  public setAlwaysOnTop(onTop: boolean): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.setAlwaysOnTop(onTop, 'screen-saver')
    }
  }

  /** 设置窗口整体不透明度（0.3 ~ 1） */
  public setOpacity(opacity: number): void {
    if (!this.window || this.window.isDestroyed()) return
    const v = Math.max(0.3, Math.min(1, opacity))
    try {
      this.window.setOpacity(v)
    } catch (err) {
      logger.system.warn('[VrmCompanion] setOpacity failed:', err)
    }
  }

  /**
   * 把配置中的「窗口级外观项」即时应用到已存在的窗口。
   *
   * 供 IPC `update-config` 调用：配置落盘后立刻见效，
   * 无需等窗口重建（否则用户改了置顶/不透明度却看不到变化）。
   */
  public applyConfig(config: { alwaysOnTop: boolean; opacity: number; clickThrough?: boolean }): void {
    if (!this.window || this.window.isDestroyed()) return
    this.setAlwaysOnTop(config.alwaysOnTop)
    this.setOpacity(config.opacity)
    // 穿透可能在设置面板被改（走 update-config），这里同步到内存并立即生效。
    // 直接赋值而不是调 setClickThrough：后者会再写一次配置，形成递归落盘。
    if (typeof config.clickThrough === 'boolean' && config.clickThrough !== this.clickThrough) {
      this.clickThrough = config.clickThrough
      this.applyMouseIgnoring()
      this.syncPointerPoll()
    }
  }

  /**
   * 复位到默认位置（右下角），并持久化。
   *
   * 场景：用户把窗口拖到屏幕外 / 多显示器拔插后坐标失效。
   */
  public resetPosition(): { x: number; y: number } | null {
    if (!this.window || this.window.isDestroyed()) return null
    const [w, h] = this.window.getSize()
    const { x, y } = this.resolveDefaultPosition(w, h)
    this.window.setPosition(Math.round(x), Math.round(y), false)
    updateConfig({ positionX: Math.round(x), positionY: Math.round(y) })
    return { x: Math.round(x), y: Math.round(y) }
  }

  // --------------------------------------------
  // 消息转发
  // --------------------------------------------

  /** 向伴侣窗口发送消息（webContents.send） */
  public send(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  /**
   * 把伴侣窗口的消息转发给所有其他窗口（主窗口）。
   *
   * 用途：伴侣窗口内发起的语音对话需要让主窗口知道（语音状态联动、对话落库），
   * 但伴侣窗口不持有主窗口引用。反向广播比注入回调更简单，
   * 也不会引入 vrm-companion → floating-avatar 之类的模块耦合。
   */
  public broadcastToOthers(channel: string, ...args: unknown[]): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win === this.window || win.isDestroyed() || win.webContents.isDestroyed()) continue
      win.webContents.send(channel, ...args)
    }
  }

  /**
   * 广播伴侣运行时状态（显隐 / 鼠标穿透）到所有其他窗口。
   *
   * 这些状态只存在于主进程内存，外部 UI（顶部栏开关、设置面板）无法自行感知，
   * 因此每次状态变化由主进程主动推送，避免各处轮询或状态分歧。
   */
  public broadcastState(): void {
    const payload = { visible: this.isVisible(), clickThrough: this.clickThrough }
    for (const win of BrowserWindow.getAllWindows()) {
      if (win === this.window || win.isDestroyed() || win.webContents.isDestroyed()) continue
      win.webContents.send(STATE_CHANGED_CHANNEL, payload)
    }
  }

  // --------------------------------------------
  // 销毁
  // --------------------------------------------

  /** 销毁窗口（完整退出时调用） */
  public destroy(): void {
    this.resetPointerState()
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
      logger.system.info('[VrmCompanion] Destroyed')
    }
    this.window = null
  }

  // --------------------------------------------
  // 内部工具
  // --------------------------------------------

  /** 持久化当前窗口位置与尺寸 */
  private persistBounds(): void {
    const pos = this.getPosition()
    const size = this.getSize()
    if (!pos || !size) return
    updateConfig({
      positionX: pos.x,
      positionY: pos.y,
      width: size.width,
      height: size.height,
    })
  }

  /** 右下角默认位置（主显示器 workArea 内） */
  private resolveDefaultPosition(width: number, height: number): { x: number; y: number } {
    const display = screen.getPrimaryDisplay()
    const { width: sw, height: sh } = display.workAreaSize
    return {
      x: Math.max(0, sw - width - DEFAULT_MARGIN_RIGHT),
      y: Math.max(0, sh - height - DEFAULT_MARGIN_BOTTOM),
    }
  }

  /**
   * 解析初始位置：优先持久化值（必须仍落在某块显示器内），否则右下角默认。
   *
   * 校验用 `screen.getAllDisplays()` 而不是只看主屏：
   * 多显示器场景下窗口可能被保存在副屏坐标，只看主屏会误判为「不可见」而重置位置。
   */
  private resolvePosition(width: number, height: number): { x: number; y: number } {
    const config = getConfig()

    if (config.positionX != null && config.positionY != null) {
      const point = { x: config.positionX + width / 2, y: config.positionY + height / 2 }
      const display = screen.getDisplayNearestPoint(point)
      const { x: dx, y: dy, width: dw, height: dh } = display.workArea
      const visible =
        point.x >= dx - width * 0.5 &&
        point.x <= dx + dw + width * 0.5 &&
        point.y >= dy - height * 0.5 &&
        point.y <= dy + dh + height * 0.5
      if (visible) {
        return { x: config.positionX, y: config.positionY }
      }
      logger.system.info('[VrmCompanion] Persisted position off-screen, falling back to default')
    }

    return this.resolveDefaultPosition(width, height)
  }
}

/** 便捷访问器 */
export function getVrmCompanionManager(): VrmCompanionManager {
  return VrmCompanionManager.getInstance()
}

// 默认尺寸导出给 IPC 层做参数校验
export { DEFAULT_COMPANION_WIDTH, DEFAULT_COMPANION_HEIGHT }
