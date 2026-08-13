/**
 * 悬浮头像窗口管理器（单例）
 *
 * 职责：
 * - 创建/显示/隐藏/销毁头像 BrowserWindow（系统级悬浮、层级最高、类豆包）
 * - 窗口属性：frame:false / transparent:true / alwaysOnTop(level:'screen-saver') / skipTaskbar:true
 * - 位置持久化（存 app_settings.floatingAvatarConfig）
 * - 拖拽支持（CSS -webkit-app-region:drag + 主进程 setPosition 兜底）
 * - 内容加载：生产 loadFile(dist/renderer/avatar.html) / 开发 loadURL(devServer + avatar.html)
 *
 * 关键设计：
 * - 头像窗口不注册进 windowManager.windows Map，避免计入 getOpenWindows/window-all-closed，
 *   从而满足「关闭主窗口后头像仍在、应用不退出」的需求。
 * - 透明窗口在 Linux 下可能黑底，已设置 backgroundColor:'#00000000' + CSS body 透明兜底。
 * - 退出流程（appQuitInProgress）时由 globalCleanup/appBootstrap 销毁头像窗口。
 */

import { app, BrowserWindow, screen, ipcMain } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { SettingsDb } from '../settings-db/SettingsDb'
import { setHideOnCloseEnabled } from '../../bootstrap/windowManager'

// ============================================
// 常量
// ============================================

/** 头像窗口尺寸（正方形，静态头像 / 3D 球体 + 周围光晕） */
const AVATAR_WIDTH = 41
const AVATAR_HEIGHT = 41

/** 展开后的窗口尺寸（对话面板：球体 + 迷你聊天/语音面板）
 *  426×780：默认宽度在 576 基础上再缩小 150px，高度比原来增加 200px。
 *  可拖动调整宽度（360~800），高度固定 780。
 *  内容区复用主窗口聊天组件（ConversationInput / ChatMessage），布局样式一致。 */
const EXPANDED_WIDTH = 426
const EXPANDED_HEIGHT = 780
const EXPANDED_MIN_WIDTH = 360
const EXPANDED_MAX_WIDTH = 800

/** 头像窗口距离屏幕右下角的默认偏移 */
const DEFAULT_MARGIN_RIGHT = 12
const DEFAULT_MARGIN_BOTTOM = 12

/** 执行状态栏高度（idle 模式下，球体上方显示执行状态卡片时扩展的窗口高度） */
const STATUS_BAR_HEIGHT = 28
/** 执行状态栏与球体之间的间距 */
const STATUS_BAR_GAP = 2
/** tooltip 预留高度（悬停时在状态栏上方显示提示文字的空间，透明不可见） */
const TOOLTIP_RESERVE_HEIGHT = 44
/** tooltip 扩展宽度（悬停时窗口宽度扩展到此值，容纳 tooltip 文字） */
const TOOLTIP_EXPAND_WIDTH = 220

/** 边缘吸附距离（px）：距离屏幕边缘 ≤ 此值时自动贴边 */
const EDGE_SNAP_DISTANCE = 100

/** 位置持久化 key（存入 app_settings KV 表） */
const POSITION_KEY = 'floatingAvatarConfig'

/** 持久化的头像配置 */
interface PersistedAvatarConfig {
  enabled: boolean
  showOnStartup: boolean
  size: number
  positionX: number | null
  positionY: number | null
}

/** 默认配置 */
const DEFAULT_CONFIG: PersistedAvatarConfig = {
  enabled: true,
  showOnStartup: true,
  size: AVATAR_WIDTH,
  positionX: null,
  positionY: null,
}

// ============================================
// FloatingAvatarManager
// ============================================

export class FloatingAvatarManager {
  private static instance: FloatingAvatarManager | null = null
  private window: BrowserWindow | null = null
  private config: PersistedAvatarConfig = { ...DEFAULT_CONFIG }

  private constructor() {}

  static getInstance(): FloatingAvatarManager {
    if (!FloatingAvatarManager.instance) {
      FloatingAvatarManager.instance = new FloatingAvatarManager()
    }
    return FloatingAvatarManager.instance
  }

  // --------------------------------------------
  // 配置读写
  // --------------------------------------------

  /** 从 SettingsDb 加载持久化配置 */
  loadConfig(): PersistedAvatarConfig {
    try {
      const db = SettingsDb.getInstance()
      const stored = db.getAppSetting(POSITION_KEY) as Partial<PersistedAvatarConfig> | null
      if (stored && typeof stored === 'object') {
        this.config = { ...DEFAULT_CONFIG, ...stored }
      }
    } catch (err) {
      logger.system.warn('[FloatingAvatar] Load config failed, using default:', err)
      this.config = { ...DEFAULT_CONFIG }
    }
    return this.getConfig()
  }

  /** 获取当前配置（副本） */
  getConfig(): PersistedAvatarConfig {
    return { ...this.config }
  }

  /** 增量更新配置并持久化 */
  updateConfig(partial: Partial<PersistedAvatarConfig>): PersistedAvatarConfig {
    this.config = { ...this.config, ...partial }
    try {
      const db = SettingsDb.getInstance()
      db.upsertAppSetting(POSITION_KEY, this.config)
    } catch (err) {
      logger.system.warn('[FloatingAvatar] Persist config failed:', err)
    }
    return this.getConfig()
  }

  // --------------------------------------------
  // 窗口生命周期
  // --------------------------------------------

  /**
   * 创建头像窗口（若已存在则返回现有窗口）
   *
   * 注意：创建后不自动显示，由 show() 控制，便于按 showOnStartup 配置决定。
   */
  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    const { x, y } = this.resolvePosition()

    this.window = new BrowserWindow({
      width: AVATAR_WIDTH,
      height: AVATAR_HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      resizable: false, // 收起状态不可调整大小；展开时动态开启
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      // 层级最高：高于所有普通应用窗口（screen-saver 仅低于系统锁屏/通知中心）
      // macOS 上 'screen-saver' 也会高于 Dock；Windows/Linux 上 'screen-saver' 为最高可用层级
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })

    // 设置 alwaysOnTop 级别（create 选项中 alwaysOnTop:true 默认 level 为 'normal'，需显式提升）
    this.window.setAlwaysOnTop(true, 'screen-saver')

    // 拖拽：渲染进程通过 IPC 通知主进程移动窗口（避免 -webkit-app-region:drag 在透明窗口的残影问题）
    this.registerDragHandler()

    // 窗口关闭时清理引用
    this.window.on('closed', () => {
      this.window = null
    })

    // 防止窗口失焦时被自动隐藏（保持悬浮）
    this.window.on('blur', () => {
      // 不做任何处理，保持显示
    })

    this.loadAvatarContent()

    logger.system.info('[FloatingAvatar] Window created', { x, y })
    return this.window
  }

  /** 加载头像窗口内容：生产 loadFile / 开发 loadURL */
  private loadAvatarContent(): void {
    if (!this.window) return

    if (app.isPackaged) {
      const avatarPath = path.join(__dirname, '../renderer/avatar.html')
      this.window.loadFile(avatarPath)
      return
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      const devUrl = `${process.env.VITE_DEV_SERVER_URL}avatar.html`
      this.window.loadURL(devUrl)
      return
    }

    // 非打包模式但无开发服务器：回退到构建产物
    const avatarPath = path.join(__dirname, '../renderer/avatar.html')
    this.window.loadFile(avatarPath)
  }

  /**
   * 注册拖拽处理器
   *
   * 渲染进程通过 IPC 推送「拖拽开始时的窗口位置 + 鼠标屏幕坐标」，
   * 主进程在拖拽中持续读取鼠标屏幕坐标（screen.getCursorScreenPoint），
   * 计算新窗口位置并应用边界限制 + 边缘吸附。
   *
   * 设计原因（修复拖拽中断 bug）：
   * - 旧方案：渲染进程的 mousemove 事件在鼠标移出窗口后不再触发 → 拖拽中断
   * - 新方案：主进程用 setInterval 轮询鼠标坐标，不依赖渲染进程事件，
   *           鼠标移出窗口也能继续拖拽，直到收到 drag:end
   */
  private registerDragHandler(): void {
    if (!this.window) return
    const winId = this.window.id
    const startChannel = `floating-avatar:drag-start:${winId}`
    const endChannel = `floating-avatar:drag-end:${winId}`

    // 拖拽状态
    // dragDisplay：拖拽起点所在的显示器，整个拖拽过程中以它为参考系，
    // 避免跨显示器时 getDisplayNearestPoint 返回新 display 导致 workArea 突变、位置跳变
    type DragOrigin = { mouseX: number; mouseY: number; winX: number; winY: number; display: Electron.Display }
    let dragOrigin: DragOrigin | null = null
    let dragTimer: ReturnType<typeof setInterval> | null = null

    const applyPosition = (x: number, y: number, display: Electron.Display): void => {
      if (!this.window || this.window.isDestroyed()) return
      const w = this.expanded ? EXPANDED_WIDTH : AVATAR_WIDTH
      const h = this.expanded ? EXPANDED_HEIGHT : AVATAR_HEIGHT
      const { width: sw, height: sh } = display.workAreaSize
      const { x: dx, y: dy } = display.workArea

      // 边界限制：窗口必须完全在屏幕 workArea 内（仅允许 10px 出屏作为视觉余量）
      // 收紧旧方案"50% 出屏"的宽松限制，避免拖到屏幕外找不到
      const margin = 10
      const minX = dx + margin - w + Math.min(w, 40)
      const maxX = dx + sw - margin - Math.min(w, 40)
      const minY = dy + margin - h + Math.min(h, 40)
      const maxY = dy + sh - margin - Math.min(h, 40)
      const clampedX = Math.max(minX, Math.min(maxX, x))
      const clampedY = Math.max(minY, Math.min(maxY, y))

      this.window.setPosition(Math.round(clampedX), Math.round(clampedY), false)
    }

    const snapToEdge = (): void => {
      if (!this.window || this.window.isDestroyed()) return
      const [x, y] = this.window.getPosition()
      const w = this.expanded ? EXPANDED_WIDTH : AVATAR_WIDTH
      const h = this.expanded ? EXPANDED_HEIGHT : AVATAR_HEIGHT
      // 用窗口中心点找显示器，避免窗口跨屏时边缘吸附到错误的屏幕
      const display = screen.getDisplayNearestPoint({ x: x + w / 2, y: y + h / 2 })
      const { width: sw, height: sh } = display.workAreaSize
      const { x: dx, y: dy } = display.workArea

      let snapX = x
      let snapY = y

      // 左右边缘吸附
      if (x - dx <= EDGE_SNAP_DISTANCE) {
        snapX = dx + DEFAULT_MARGIN_RIGHT
      } else if (dx + sw - (x + w) <= EDGE_SNAP_DISTANCE) {
        snapX = dx + sw - w - DEFAULT_MARGIN_RIGHT
      }
      // 上下边缘吸附
      if (y - dy <= EDGE_SNAP_DISTANCE) {
        snapY = dy + DEFAULT_MARGIN_BOTTOM
      } else if (dy + sh - (y + h) <= EDGE_SNAP_DISTANCE) {
        snapY = dy + sh - h - DEFAULT_MARGIN_BOTTOM
      }

      if (snapX !== x || snapY !== y) {
        this.window.setPosition(Math.round(snapX), Math.round(snapY), false)
        // 持久化吸附后的位置
        this.updateConfig({ positionX: Math.round(snapX), positionY: Math.round(snapY) })
      }
    }

    const startHandler = () => {
      if (!this.window || this.window.isDestroyed()) return
      // 主进程自取鼠标 + 窗口坐标，不依赖渲染层 payload（更鲁棒：
      // 渲染层 mousedown 时拿到的是 client 坐标，与 screen 坐标系不一致会导致跳变）
      const cursor = screen.getCursorScreenPoint()
      const [wx, wy] = this.window.getPosition()
      // 锁定拖拽起点所在的显示器，整个拖拽过程都以它为参考系
      // 避免 Windows 多显示器不同 DPI 下跨屏时坐标跳变
      const display = screen.getDisplayNearestPoint({ x: cursor.x, y: cursor.y })
      dragOrigin = { mouseX: cursor.x, mouseY: cursor.y, winX: wx, winY: wy, display }

      // 用 setInterval 轮询鼠标坐标（不依赖渲染进程 mousemove，避免移出窗口后中断）
      if (dragTimer) clearInterval(dragTimer)
      dragTimer = setInterval(() => {
        if (!dragOrigin || !this.window || this.window.isDestroyed()) return
        const cursor = screen.getCursorScreenPoint()
        const newX = dragOrigin.winX + (cursor.x - dragOrigin.mouseX)
        const newY = dragOrigin.winY + (cursor.y - dragOrigin.mouseY)
        // 始终用拖拽起点所在的 display 做边界限制，不随鼠标跨屏切换
        applyPosition(newX, newY, dragOrigin.display)
      }, 16) // ~60fps
    }

    const endHandler = () => {
      if (dragTimer) {
        clearInterval(dragTimer)
        dragTimer = null
      }
      if (dragOrigin && this.window && !this.window.isDestroyed()) {
        // 拖拽结束时执行边缘吸附 + 持久化位置
        snapToEdge()
        const [x, y] = this.window.getPosition()
        this.updateConfig({ positionX: x, positionY: y })
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

  /** 获取拖拽频道名（供渲染进程订阅）
   *  返回 start/end 两个频道，分别对应拖拽开始与结束。
   *  主进程在 startHandler 中自取鼠标+窗口坐标，渲染层无需传递 payload。 */
  getDragChannel(): { start: string; end: string } | null {
    if (!this.window || this.window.isDestroyed()) return null
    const id = this.window.id
    return {
      start: `floating-avatar:drag-start:${id}`,
      end: `floating-avatar:drag-end:${id}`,
    }
  }

  /** 显示头像窗口 */
  show(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.create()
    }
    if (this.window && !this.window.isVisible()) {
      this.window.showInactive()
      logger.system.info('[FloatingAvatar] Shown')
    }
    // 头像可见时启用主窗口 hide-on-close（关闭主窗口仅隐藏，保留 warm renderer）
    setHideOnCloseEnabled(true)
  }

  /** 隐藏头像窗口（不销毁，保留 warm renderer） */
  hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide()
      logger.system.info('[FloatingAvatar] Hidden')
    }
    // 头像隐藏时关闭主窗口 hide-on-close（恢复正常的关闭流程）
    setHideOnCloseEnabled(false)
  }

  /** 切换显示/隐藏 */
  toggle(): void {
    if (this.isVisible()) {
      this.hide()
    } else {
      this.show()
    }
  }

  /** 是否可见 */
  isVisible(): boolean {
    return !!this.window && !this.window.isDestroyed() && this.window.isVisible()
  }

  /** 是否已创建 */
  isCreated(): boolean {
    return !!this.window && !this.window.isDestroyed()
  }

  /** 获取窗口实例（可能为 null） */
  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null
  }

  /** 设置始终置顶（运行时切换） */
  setAlwaysOnTop(onTop: boolean): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.setAlwaysOnTop(onTop, 'screen-saver')
    }
  }

  /** 获取当前位置 */
  getPosition(): { x: number; y: number } | null {
    if (!this.window || this.window.isDestroyed()) return null
    const [x, y] = this.window.getPosition()
    return { x, y }
  }

  /** 设置位置并持久化 */
  setPosition(x: number, y: number): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.setPosition(x, y, false)
    this.updateConfig({ positionX: x, positionY: y })
  }

  // --------------------------------------------
  // 窗口展开/收起（对话面板）
  // --------------------------------------------

  /** 当前是否处于展开状态 */
  private expanded = false

  /**
   * 展开窗口以显示对话面板
   *
   * 展开策略：保持窗口右下角不变（向左上方扩展），避免遮挡右下角内容。
   * 展开后尺寸：EXPANDED_WIDTH × EXPANDED_HEIGHT。
   *
   * ⚠️ 展开前必须重置 statusExpanded 状态：
   *    若状态栏扩展中（窗口已向上扩展高度），直接 setSize 到 EXPANDED 尺寸
   *    会产生跳变。重置后由 collapse() 的收起逻辑保证球体回到正确位置，
   *    AvatarExecutionStatus 的 useEffect 会在回到 idle 后重新 expandForStatus()。
   */
  expand(): void {
    if (!this.window || this.window.isDestroyed() || this.expanded) return

    // 重置状态栏扩展状态（避免收起对话面板后 statusExpanded 残留导致窗口尺寸异常）
    this.statusExpanded = false
    this.tooltipExpanded = false
    this.statusEdge = null

    const [x, y] = this.window.getPosition()
    // 保持右下角不变：新 x = 旧 x + 旧宽 - 新宽；新 y = 旧 y + 旧高 - 新高
    // ⚠️ 此处旧高可能是 AVATAR_HEIGHT（正常）或 AVATAR_HEIGHT + extraHeight（状态栏扩展中）
    //    但因为上面已重置 statusExpanded=false，收起后由 AvatarExecutionStatus 重新扩展
    const [oldW, oldH] = this.window.getSize()
    const newX = x + oldW - EXPANDED_WIDTH
    const newY = y + oldH - EXPANDED_HEIGHT

    // 确保不超出屏幕左边界
    const clampedX = Math.max(0, newX)
    const clampedY = Math.max(0, newY)

    // 展开后允许拖动调整宽度（960~1400），高度固定
    this.window.setMinimumSize(EXPANDED_MIN_WIDTH, EXPANDED_HEIGHT)
    this.window.setMaximumSize(EXPANDED_MAX_WIDTH, EXPANDED_HEIGHT)
    this.window.setResizable(true)

    this.window.setSize(EXPANDED_WIDTH, EXPANDED_HEIGHT)
    this.window.setPosition(clampedX, clampedY, false)
    this.expanded = true
    logger.system.info('[FloatingAvatar] Expanded', { x: clampedX, y: clampedY })
  }

  /**
   * 收起窗口到仅显示球体
   *
   * 收起策略：保持窗口右下角不变（向右下方收缩）。
   */
  collapse(): void {
    if (!this.window || this.window.isDestroyed() || !this.expanded) return

    // 收起前关闭可调整大小 + 重置 min/max size
    // 关键：expand 时设置了 minimumSize(340,480)，如果不重置，
    // setSize(38,38) 会被 minimumSize 限制为 340×480，导致窗口变大变椭圆
    this.window.setResizable(false)
    this.window.setMinimumSize(0, 0)
    this.window.setMaximumSize(0, 0)

    const [x, y] = this.window.getPosition()
    // 获取当前实际宽度（用户可能拖动调整过）
    const [currentW] = this.window.getSize()
    // 保持右下角不变：新 x = 旧 x + 当前宽 - 旧宽；新 y = 旧 y + 新高 - 旧高
    const newX = x + currentW - AVATAR_WIDTH
    const newY = y + EXPANDED_HEIGHT - AVATAR_HEIGHT

    this.window.setSize(AVATAR_WIDTH, AVATAR_HEIGHT)
    this.window.setPosition(newX, newY, false)
    this.expanded = false
    logger.system.info('[FloatingAvatar] Collapsed', { x: newX, y: newY })
  }

  /** 当前是否展开 */
  isExpanded(): boolean {
    return this.expanded
  }

  // --------------------------------------------
  // 执行状态栏扩展（idle 模式下球体上方显示 Pill）
  // --------------------------------------------

  /** 当前是否已为执行状态栏扩展窗口 */
  private statusExpanded = false
  /** 当前是否已为 tooltip 扩展窗口宽度 */
  private tooltipExpanded = false
  /** 状态栏边缘方向（扩展时确定，决定窗口宽度扩展方向 + 渲染进程定位球体） */
  private statusEdge: 'left' | 'right' | null = null

  /**
   * 判断头像当前靠近屏幕的哪一侧
   *
   * 用于决定 tooltip 扩展时窗口向哪个方向扩展宽度：
   * - 靠右 → 窗口右边缘固定，向左扩展宽度（球体在窗口右侧）
   * - 靠左 → 窗口左边缘固定，向右扩展宽度（球体在窗口左侧）
   */
  private getScreenEdge(): 'left' | 'right' {
    if (!this.window || this.window.isDestroyed()) return 'right'
    const [x] = this.window.getPosition()
    const display = screen.getDisplayNearestPoint({ x, y: 0 })
    const { width: sw, x: dx } = display.workArea
    const centerX = x + AVATAR_WIDTH / 2
    const screenCenterX = dx + sw / 2
    return centerX <= screenCenterX ? 'left' : 'right'
  }

  /**
   * 扩展窗口高度以显示执行状态栏（球体上方）
   *
   * 策略：保持球体屏幕位置不变（窗口底部不变），向上扩展高度。
   * 窗口宽度保持 AVATAR_WIDTH 不变（与球体同宽）。
   * 扩展高度包含：tooltip 预留区 + 状态栏 + 间距，为悬停 tooltip 预留空间。
   * 同时确定边缘方向并通知渲染进程，以便球体在窗口内正确定位。
   *
   * 仅在 idle 模式（未展开对话面板）时生效。
   */
  expandForStatus(): void {
    if (!this.window || this.window.isDestroyed()) return
    if (this.expanded) return
    if (this.statusExpanded) return

    const [x, y] = this.window.getPosition()
    const extraHeight = STATUS_BAR_HEIGHT + TOOLTIP_RESERVE_HEIGHT + STATUS_BAR_GAP
    const newY = y - extraHeight

    this.window.setSize(AVATAR_WIDTH, AVATAR_HEIGHT + extraHeight)
    this.window.setPosition(x, newY, false)
    this.statusExpanded = true

    // 确定边缘方向并通知渲染进程
    const edge = this.getScreenEdge()
    this.statusEdge = edge
    this.sendToAvatar('floating-avatar:status-edge', edge)

    logger.system.info('[FloatingAvatar] Expanded for status bar', { y: newY, edge })
  }

  /**
   * 收起执行状态栏（恢复原始球体尺寸）
   *
   * 策略：保持球体位置不变（窗口底部不变），向下收缩高度。
   */
  collapseForStatus(): void {
    if (!this.window || this.window.isDestroyed()) return
    if (this.expanded) return
    if (!this.statusExpanded) return

    const [x, y] = this.window.getPosition()
    const extraHeight = STATUS_BAR_HEIGHT + TOOLTIP_RESERVE_HEIGHT + STATUS_BAR_GAP
    const newY = y + extraHeight

    // 根据边缘方向恢复 X 坐标（tooltip 扩展可能改变了窗口宽度）
    let restoreX = x
    if (this.tooltipExpanded) {
      if (this.statusEdge === 'right') {
        // 右边缘固定：收起后左边缘右移
        restoreX = x + (TOOLTIP_EXPAND_WIDTH - AVATAR_WIDTH)
      }
      // 左边缘固定：X 不变
    }

    this.window.setSize(AVATAR_WIDTH, AVATAR_HEIGHT)
    this.window.setPosition(restoreX, newY, false)
    this.statusExpanded = false
    this.tooltipExpanded = false
    this.statusEdge = null

    // 通知渲染进程清除边缘（球体回到居中）
    this.sendToAvatar('floating-avatar:status-edge', null)

    logger.system.info('[FloatingAvatar] Collapsed status bar', { y: newY })
  }

  /**
   * 扩展窗口宽度以显示 tooltip（鼠标悬停时）
   *
   * 边缘感知策略：根据球体靠近屏幕的哪一侧，决定窗口扩展方向：
   * - 靠右：窗口右边缘固定（= 球体右边缘），向左扩展宽度
   *   球体在窗口右下角（right: 0），tooltip 向左延伸
   * - 靠左：窗口左边缘固定（= 球体左边缘），向右扩展宽度
   *   球体在窗口左下角（left: 0），tooltip 向右延伸
   *
   * 球体屏幕位置始终保持不变。
   */
  expandForTooltip(): void {
    if (!this.window || this.window.isDestroyed()) return
    if (this.expanded) return
    if (!this.statusExpanded) return
    if (this.tooltipExpanded) return

    const [x, y] = this.window.getPosition()
    const [, h] = this.window.getSize()
    const edge = this.statusEdge || this.getScreenEdge()

    let newX: number
    if (edge === 'right') {
      // 右边缘固定：窗口右边缘 = 球体右边缘，向左扩展
      newX = x + AVATAR_WIDTH - TOOLTIP_EXPAND_WIDTH
    } else {
      // 左边缘固定：窗口左边缘 = 球体左边缘，向右扩展
      newX = x
    }

    // 防止超出屏幕对侧边界
    const display = screen.getDisplayNearestPoint({ x: newX, y })
    const { x: dx, width: sw } = display.workArea
    if (newX < dx) newX = dx
    if (newX + TOOLTIP_EXPAND_WIDTH > dx + sw) newX = dx + sw - TOOLTIP_EXPAND_WIDTH

    this.window.setSize(TOOLTIP_EXPAND_WIDTH, h)
    this.window.setPosition(newX, y, false)
    this.tooltipExpanded = true
  }

  /**
   * 收起 tooltip 扩展（鼠标离开时恢复窗口宽度）
   *
   * 边缘感知策略：根据扩展时的边缘方向恢复窗口位置。
   */
  collapseForTooltip(): void {
    if (!this.window || this.window.isDestroyed()) return
    if (!this.tooltipExpanded) return

    const [x, y] = this.window.getPosition()
    const [, h] = this.window.getSize()
    const edge = this.statusEdge || 'right'

    let newX: number
    if (edge === 'right') {
      // 右边缘固定：收起后左边缘右移
      newX = x + (TOOLTIP_EXPAND_WIDTH - AVATAR_WIDTH)
    } else {
      // 左边缘固定：X 不变
      newX = x
    }

    this.window.setSize(AVATAR_WIDTH, h)
    this.window.setPosition(newX, y, false)
    this.tooltipExpanded = false
  }

  /** 当前是否已为执行状态栏扩展 */
  isStatusExpanded(): boolean {
    return this.statusExpanded
  }

  /** 销毁头像窗口（彻底退出时调用） */
  destroy(): void {
    // 销毁前关闭 hide-on-close，避免影响后续窗口关闭流程
    setHideOnCloseEnabled(false)
    this.expanded = false
    this.statusExpanded = false
    this.tooltipExpanded = false
    this.statusEdge = null
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
      logger.system.info('[FloatingAvatar] Destroyed')
    }
    this.window = null
  }

  // --------------------------------------------
  // 消息转发
  // --------------------------------------------

  /** 向头像窗口发送消息（webContents.send） */
  sendToAvatar(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  // --------------------------------------------
  // 内部工具
  // --------------------------------------------

  /** 解析窗口位置：优先持久化值，否则右下角默认偏移 */
  private resolvePosition(): { x: number; y: number } {
    const display = screen.getPrimaryDisplay()
    const { width, height } = display.workAreaSize

    // 校验持久化位置是否在可见范围内（多显示器切换后可能越界）
    if (
      this.config.positionX != null &&
      this.config.positionY != null &&
      this.config.positionX >= 0 &&
      this.config.positionY >= 0 &&
      this.config.positionX < width - 20 &&
      this.config.positionY < height - 20
    ) {
      return { x: this.config.positionX, y: this.config.positionY }
    }

    // 默认右下角
    const x = Math.max(0, width - AVATAR_WIDTH - DEFAULT_MARGIN_RIGHT)
    const y = Math.max(0, height - AVATAR_HEIGHT - DEFAULT_MARGIN_BOTTOM)
    return { x, y }
  }
}
