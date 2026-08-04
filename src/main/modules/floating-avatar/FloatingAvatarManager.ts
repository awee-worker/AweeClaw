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
const AVATAR_WIDTH = 46
const AVATAR_HEIGHT = 46

/** 展开后的窗口尺寸（对话面板：球体 + 迷你聊天/语音面板）
 *  390×580：迷你聊天窗更可用（消息列表 + 输入框 + 附件/模型工具栏），语音面板百分比布局自适应
 *  展开后可拖动调整宽度（340~560），窄时收起工具栏，宽时显示附件/模型选择 */
const EXPANDED_WIDTH = 390
const EXPANDED_HEIGHT = 580
const EXPANDED_MIN_WIDTH = 340
const EXPANDED_MAX_WIDTH = 560

/** 头像窗口距离屏幕右下角的默认偏移 */
const DEFAULT_MARGIN_RIGHT = 12
const DEFAULT_MARGIN_BOTTOM = 12

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
    let dragOrigin: { mouseX: number; mouseY: number; winX: number; winY: number } | null = null
    let dragTimer: ReturnType<typeof setInterval> | null = null

    const applyPosition = (x: number, y: number): void => {
      if (!this.window || this.window.isDestroyed()) return
      const w = this.expanded ? EXPANDED_WIDTH : AVATAR_WIDTH
      const h = this.expanded ? EXPANDED_HEIGHT : AVATAR_HEIGHT
      const display = screen.getDisplayNearestPoint({ x, y })
      const { width: sw, height: sh } = display.workAreaSize
      const { x: dx, y: dy } = display.workArea

      // 边界限制：窗口必须至少 50% 在屏幕内
      const minX = dx - w * 0.5
      const maxX = dx + sw - w * 0.5
      const minY = dy - h * 0.5
      const maxY = dy + sh - h * 0.5
      const clampedX = Math.max(minX, Math.min(maxX, x))
      const clampedY = Math.max(minY, Math.min(maxY, y))

      this.window.setPosition(Math.round(clampedX), Math.round(clampedY), false)
    }

    const snapToEdge = (): void => {
      if (!this.window || this.window.isDestroyed()) return
      const [x, y] = this.window.getPosition()
      const w = this.expanded ? EXPANDED_WIDTH : AVATAR_WIDTH
      const h = this.expanded ? EXPANDED_HEIGHT : AVATAR_HEIGHT
      const display = screen.getDisplayNearestPoint({ x, y })
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
      dragOrigin = { mouseX: cursor.x, mouseY: cursor.y, winX: wx, winY: wy }

      // 用 setInterval 轮询鼠标坐标（不依赖渲染进程 mousemove，避免移出窗口后中断）
      if (dragTimer) clearInterval(dragTimer)
      dragTimer = setInterval(() => {
        if (!dragOrigin || !this.window || this.window.isDestroyed()) return
        const cursor = screen.getCursorScreenPoint()
        const newX = dragOrigin.winX + (cursor.x - dragOrigin.mouseX)
        const newY = dragOrigin.winY + (cursor.y - dragOrigin.mouseY)
        applyPosition(newX, newY)
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
   */
  expand(): void {
    if (!this.window || this.window.isDestroyed() || this.expanded) return

    const [x, y] = this.window.getPosition()
    // 保持右下角不变：新 x = 旧 x + 旧宽 - 新宽；新 y = 旧 y + 旧高 - 新高
    const newX = x + AVATAR_WIDTH - EXPANDED_WIDTH
    const newY = y + AVATAR_HEIGHT - EXPANDED_HEIGHT

    // 确保不超出屏幕左边界
    const clampedX = Math.max(0, newX)
    const clampedY = Math.max(0, newY)

    // 展开后允许拖动调整宽度（340~560）
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

  /** 销毁头像窗口（彻底退出时调用） */
  destroy(): void {
    // 销毁前关闭 hide-on-close，避免影响后续窗口关闭流程
    setHideOnCloseEnabled(false)
    this.expanded = false
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
