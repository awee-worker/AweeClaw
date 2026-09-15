/**
 * 悬浮层应用内透明窗口（主进程）
 *
 * 与「外部模式（HTTP + WS，供 OBS 使用）」并存的第二条腿：
 * 应用内窗口无需起服务、可点击穿透、可拖动，用于用户自己预览 / 桌面常驻字幕。
 *
 * 窗口参数对齐 VrmCompanionManager 的既有约定：
 *   frame:false / transparent:true / skipTaskbar:true / backgroundColor:'#00000000'
 *   setAlwaysOnTop(alwaysOnTop, 'screen-saver')
 *
 * 拖动实现说明：
 *   穿透开启时窗口不接收鼠标事件（这是刻意的 —— 悬浮层不该抢桌面点击），
 *   因此拖动只能在关闭穿透后进行。渲染层在非穿透态显示一个顶部拖拽条
 *   （-webkit-app-region: drag），由系统完成拖动，位置变更在 'moved' 事件里落盘。
 *   这比 vrm-companion 的「主进程轮询鼠标坐标」简单得多，且足够满足字幕/弹幕场景。
 *
 * @module overlay/OverlayWindow
 */

import { BrowserWindow, screen } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { getConfig, updateConfig } from './OverlayStore'
import type { OverlayMode } from './types'

/** 距屏幕边缘的默认间距（默认位置用） */
const EDGE_MARGIN = 48

export class OverlayWindow {
  private window: BrowserWindow | null = null
  private mode: OverlayMode = 'subtitle'
  private port = 0
  private clickThrough = true

  // --------------------------------------------
  // 创建 / 销毁
  // --------------------------------------------

  /** 创建窗口（幂等：已存在则直接返回） */
  create(port: number, mode: OverlayMode): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window

    this.port = port
    this.mode = mode

    const config = getConfig()
    const { width, height } = config.window
    const { x, y } = this.resolvePosition(width, height)

    this.window = new BrowserWindow({
      width,
      height,
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
      backgroundColor: '#00000000',
      minWidth: 320,
      minHeight: 120,
      acceptFirstMouse: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 弹幕是持续动画，禁用后台节流，避免窗口失焦后动画停摆
        backgroundThrottling: false,
      },
    })

    this.window.setAlwaysOnTop(config.window.alwaysOnTop, 'screen-saver')
    this.window.setOpacity(config.window.opacity)

    // 穿透状态初始化（clickThrough 默认 true：悬浮层不该挡住桌面点击）
    this.clickThrough = config.window.clickThrough
    this.applyClickThrough(this.clickThrough)

    if (process.platform === 'darwin') {
      this.window.excludedFromShownWindowsMenu = true
    }

    // 位置变更落盘（拖动结束后触发）
    this.window.on('moved', () => this.persistBounds())

    this.window.on('closed', () => {
      this.window = null
    })

    this.loadContent()

    logger.system.info('[Overlay] window created', { mode, width, height, x, y })
    return this.window
  }

  /** 销毁窗口 */
  destroy(): void {
    if (!this.window) return
    const win = this.window
    this.window = null
    if (!win.isDestroyed()) win.destroy()
  }

  /** 加载页面：开发态 devServer / 生产态 dist */
  private loadContent(): void {
    if (!this.window) return

    const query = { mode: this.mode, port: String(this.port) }
    const devServerUrl = process.env.VITE_DEV_SERVER_URL

    if (devServerUrl) {
      const url = `${devServerUrl.replace(/\/$/, '')}/overlay.html?mode=${query.mode}&port=${query.port}`
      void this.window.loadURL(url)
      return
    }

    void this.window.loadFile(path.join(__dirname, '../renderer/overlay.html'), { query })
  }

  /**
   * 解析窗口位置。
   *
   * 未持久化过位置时，按形态给一个合理默认：
   * - subtitle：屏幕底部居中（字幕条语义）
   * - danmaku ：屏幕上部居中（弹幕自上而下滚落）
   */
  private resolvePosition(width: number, height: number): { x: number; y: number } {
    const config = getConfig()
    if (config.window.positionX !== null && config.window.positionY !== null) {
      return { x: config.window.positionX, y: config.window.positionY }
    }

    const { workArea } = screen.getPrimaryDisplay()
    const x = Math.round(workArea.x + (workArea.width - width) / 2)
    const y =
      this.mode === 'subtitle'
        ? Math.round(workArea.y + workArea.height - height - EDGE_MARGIN)
        : Math.round(workArea.y + EDGE_MARGIN)

    return { x, y }
  }

  /** 持久化当前位置 */
  private persistBounds(): void {
    if (!this.window || this.window.isDestroyed()) return
    const [x, y] = this.window.getPosition()
    updateConfig({ window: { positionX: x, positionY: y } })
  }

  // --------------------------------------------
  // 显隐
  // --------------------------------------------

  show(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.showInactive()
  }

  hide(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.hide()
  }

  toggle(): void {
    if (this.isVisible()) this.hide()
    else this.show()
  }

  isVisible(): boolean {
    return !!this.window && !this.window.isDestroyed() && this.window.isVisible()
  }

  isCreated(): boolean {
    return !!this.window && !this.window.isDestroyed()
  }

  getWindow(): BrowserWindow | null {
    return this.window
  }

  // --------------------------------------------
  // 运行时设置
  // --------------------------------------------

  /** 设置鼠标穿透（并通知页面显隐拖拽条） */
  setClickThrough(clickThrough: boolean): void {
    this.clickThrough = clickThrough
    this.applyClickThrough(clickThrough)
    // 穿透开启后页面收不到鼠标事件，必须由主进程告知，页面才能隐藏拖拽条
    this.send('overlay:click-through-changed', { clickThrough })
  }

  private applyClickThrough(clickThrough: boolean): void {
    if (!this.window || this.window.isDestroyed()) return
    // forward:true 让窗口仍能感知鼠标位置（便于渲染层做 hover 提示）
    this.window.setIgnoreMouseEvents(clickThrough, { forward: true })
  }

  setOpacity(opacity: number): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.setOpacity(Math.min(1, Math.max(0.1, opacity)))
  }

  setAlwaysOnTop(alwaysOnTop: boolean): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.setAlwaysOnTop(alwaysOnTop, 'screen-saver')
  }

  /**
   * 切换形态（subtitle ↔ danmaku）。
   *
   * 直接重新加载页面：两种形态的 DOM 结构差异较大（底部字幕条 vs 顶部滚动轨道），
   * 重载比维护两套挂载逻辑更可靠，代价是一次页面刷新（可接受）。
   */
  setMode(mode: OverlayMode): void {
    if (this.mode === mode) return
    this.mode = mode
    if (!this.window || this.window.isDestroyed()) return
    this.loadContent()
  }

  /** 当前形态 */
  getMode(): OverlayMode {
    return this.mode
  }

  /** 更新服务端口（会触发页面重载以重连 WS） */
  setPort(port: number): void {
    if (this.port === port) return
    this.port = port
    if (!this.window || this.window.isDestroyed()) return
    this.loadContent()
  }

  /** 向页面推送 IPC 消息（应用内模式的低延迟通道） */
  send(channel: string, payload: unknown): void {
    if (!this.window || this.window.isDestroyed()) return
    try {
      this.window.webContents.send(channel, payload)
    } catch (err) {
      logger.system.warn('[Overlay] send to window failed:', err)
    }
  }
}
