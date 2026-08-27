/**
 * 截图提问管理器（透明覆盖窗口方案）
 *
 * 核心设计：覆盖窗口本身透明，用户直接看到真实桌面并在其上框选，
 * 确认时才截图，彻底避免"截图展示在窗口上"导致的像素对齐/重影问题。
 *
 * 流程：
 * 1. 右键菜单「截图提问」触发 start()
 * 2. 创建全屏 frameless **透明**覆盖窗口（transparent:true），用户透过窗口看到真实桌面
 * 3. 渲染层在透明窗口上画半透明遮罩 + 选区高亮（类似微信截图），用户拖拽框选
 * 4. 用户确认 → 渲染层把选区坐标（CSS 像素）回传主进程
 * 5. 主进程**先隐藏覆盖窗口**（避免截到自身），再调用 desktopCapturer 截取整屏
 * 6. 用 nativeImage.crop 按选区裁剪 → PNG buffer → 落盘 + base64 → 推送头像窗口
 *
 * 为什么不再"先截图再展示"：截图（物理像素）展示在窗口（CSS 像素）上，
 * 经 objectFit 缩放极易产生像素级偏移（如 macOS 菜单栏高度差），用户感知为"重影"。
 * 透明窗口方案让用户在框选阶段看到的就是真实桌面，无截图展示，无对齐问题。
 */

import { app, BrowserWindow, desktopCapturer, screen, ipcMain, nativeImage } from 'electron'
import * as path from 'path'
import { promises as fsPromises } from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import { ensureDirectory } from '../../guard/fileAccessControl'
import { BRAND } from '@shared/brand'
import {
  createPermissionDeniedError,
  isScreenPermissionGranted,
} from '../screenshot/screenPermission'

/** 选区坐标（CSS 像素，覆盖窗口坐标系） */
export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

/** 截图完成回调的 payload（推送给头像窗口） */
export interface ScreenshotResultPayload {
  /** 裁剪后的截图 base64（不含 data: 前缀，用于头像窗口附件预览与发送） */
  base64: string
  /** 图片 MIME 类型 */
  mediaType: string
  /** 截图宽度（像素） */
  width: number
  /** 截图高度（像素） */
  height: number
  /** 截图保存到工作区的绝对路径（.aweeclaw/screenshot/xxx.png） */
  filePath: string
  /** 截图文件名（含扩展名） */
  fileName: string
}

/** 工作区路径获取函数（由外部注入，避免直接依赖 windowManager 造成循环依赖） */
export type WorkspacePathGetter = () => string | null

export class ScreenshotAskManager {
  private overlayWindow: BrowserWindow | null = null
  /** 主屏缩放因子 */
  private scaleFactor: number = 1
  /** 工作区路径获取函数（用于截图落盘到 .aweeclaw/screenshot） */
  private readonly getWorkspacePath: WorkspacePathGetter
  /** 当前截图流程的窗口可见性回调（start 时隐藏迷你助手，end 时恢复） */
  private onVisibilityChange: ((phase: 'start' | 'end') => void) | null = null

  constructor(getWorkspacePath: WorkspacePathGetter) {
    this.getWorkspacePath = getWorkspacePath
  }

  /**
   * 启动截图提问流程
   *
   * @param onScreenshotComplete 截图完成回调（主进程把 base64 推送到头像窗口）
   * @param onVisibilityChange   可选的窗口可见性回调：
   *   - 'start'：截图覆盖窗口即将显示，调用方应隐藏迷你助手窗口避免遮挡桌面
   *   - 'end'：截图流程结束（完成/取消/异常），调用方应恢复迷你助手窗口
   */
  async start(
    onScreenshotComplete: (payload: ScreenshotResultPayload) => void,
    onVisibilityChange?: (phase: 'start' | 'end') => void,
  ): Promise<void> {
    // 防止重复启动
    if (this.overlayWindow) {
      logger.system.warn('[ScreenshotAsk] Overlay already open')
      return
    }

    // 权限前置检查：未授予 macOS 屏幕录制权限时抛错（带 screenPermission 标记），
    // 由调用方返回给渲染层弹出引导弹窗，避免创建覆盖窗口后截图黑屏。
    if (!isScreenPermissionGranted()) {
      throw createPermissionDeniedError()
    }

    try {
      // 保存可见性回调，cleanup 时触发 'end' 恢复迷你助手窗口
      this.onVisibilityChange = onVisibilityChange ?? null
      // 截图覆盖窗口即将全屏显示，先隐藏迷你助手避免遮挡桌面
      this.onVisibilityChange?.('start')

      const primaryDisplay = screen.getPrimaryDisplay()
      this.scaleFactor = primaryDisplay.scaleFactor
      const { width, height } = primaryDisplay.bounds
      // workArea：不含 Dock/任务栏的可用区域，渲染层用其底部定位按钮避免被遮挡
      const workArea = primaryDisplay.workArea

      // 注册渲染层请求屏幕信息的 handler（屏幕尺寸 + workArea + scale）
      ipcMain.handleOnce('screenshot-overlay:request-setup', () => {
        this.overlayWindow?.focus()
        return {
          screenWidth: width,
          screenHeight: height,
          scaleFactor: this.scaleFactor,
          // workArea 相对屏幕原点的偏移 + 尺寸（渲染层用 bottom 定位按钮避开 Dock）
          workAreaX: workArea.x,
          workAreaY: workArea.y,
          workAreaWidth: workArea.width,
          workAreaHeight: workArea.height,
        }
      })

      // 监听取消/确认 IPC
      const handleCancel = () => {
        logger.system.info('[ScreenshotAsk] User cancelled')
        this.cleanup()
      }
      const handleConfirm = async (_event: unknown, rect: SelectionRect): Promise<void> => {
        logger.system.info(`[ScreenshotAsk] User confirmed region: ${JSON.stringify(rect)}`)
        await this.captureAndProcess(rect, onScreenshotComplete)
      }
      ipcMain.once('screenshot-overlay:cancel', handleCancel)
      ipcMain.once('screenshot-overlay:confirm', handleConfirm)

      // 创建透明覆盖窗口：用户透过窗口看到真实桌面，无截图展示，无重影
      this.overlayWindow = new BrowserWindow({
        x: primaryDisplay.bounds.x,
        y: primaryDisplay.bounds.y,
        width,
        height,
        fullscreen: false,
        maximizable: false,
        minimizable: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: path.join(__dirname, '../preload/preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      })

      // 渲染层准备好再显示，避免空白闪烁
      this.overlayWindow.once('ready-to-show', () => {
        this.overlayWindow?.show()
        this.overlayWindow?.focus()
      })

      this.overlayWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
        logger.system.error(`[ScreenshotAsk] Overlay load failed: ${errorCode} ${errorDescription}`)
      })

      this.loadOverlayContent()

      this.overlayWindow.on('closed', () => {
        ipcMain.removeListener('screenshot-overlay:cancel', handleCancel)
        ipcMain.removeListener('screenshot-overlay:confirm', handleConfirm)
        this.overlayWindow = null
      })

      this.overlayWindow.on('blur', () => {})
    } catch (err) {
      logger.system.error('[ScreenshotAsk] Start failed:', err)
      this.cleanup()
    }
  }

  /** 加载覆盖窗口内容：生产 loadFile / 开发 loadURL */
  private loadOverlayContent(): void {
    if (!this.overlayWindow) return

    if (app.isPackaged) {
      const overlayPath = path.join(__dirname, '../renderer/screenshot-overlay.html')
      this.overlayWindow.loadFile(overlayPath)
      return
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      const devUrl = `${process.env.VITE_DEV_SERVER_URL}screenshot-overlay.html`
      this.overlayWindow.loadURL(devUrl)
      return
    }

    const overlayPath = path.join(__dirname, '../renderer/screenshot-overlay.html')
    this.overlayWindow.loadFile(overlayPath)
  }

  /**
   * 截图并处理选区：先隐藏覆盖窗口 → 截图 → 裁剪 → 落盘 → 回调
   *
   * 关键：必须先隐藏覆盖窗口再截图，否则透明窗口的遮罩/选区会被截进去。
   * 隐藏后用一小段延迟确保窗口真正从屏幕移除，再调用 desktopCapturer。
   *
   * @param rect 选区坐标（CSS 像素，覆盖窗口坐标系）
   */
  private async captureAndProcess(
    rect: SelectionRect,
    onScreenshotComplete: (payload: ScreenshotResultPayload) => void,
  ): Promise<void> {
    // 暂存截图结果：等 cleanup 恢复窗口可见后再回调推送
    let pendingPayload: ScreenshotResultPayload | null = null

    try {
      // 1. 校验选区有效性（CSS 像素）
      if (rect.width < 10 || rect.height < 10) {
        logger.system.warn('[ScreenshotAsk] Selection too small, ignoring')
        this.cleanup()
        return
      }

      // 2. 先隐藏覆盖窗口（避免截到自身遮罩/选区）
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.hide()
      }
      // 等待窗口真正从屏幕消失（hide 是异步合成，需让 compositor 刷新一帧）
      await new Promise((resolve) => setTimeout(resolve, 80))

      // 3. 截取整屏
      const display = screen.getPrimaryDisplay()
      const { width: screenW, height: screenH } = display.bounds
      const dataUrl = await this.captureScreen(screenW, screenH)
      if (!dataUrl) {
        logger.system.error('[ScreenshotAsk] Capture failed in captureAndProcess')
        this.cleanup()
        return
      }

      // 4. 选区 CSS 像素 → 物理像素
      const physicalRect = {
        x: Math.round(rect.x * this.scaleFactor),
        y: Math.round(rect.y * this.scaleFactor),
        width: Math.round(rect.width * this.scaleFactor),
        height: Math.round(rect.height * this.scaleFactor),
      }

      // 5. 裁剪
      const fullImage = nativeImage.createFromDataURL(dataUrl)
      const cropped = fullImage.crop(physicalRect)
      const pngBuffer = cropped.toPNG()
      const croppedBase64 = pngBuffer.toString('base64')

      // 6. 落盘
      const saved = await this.saveScreenshotToWorkspace(pngBuffer)

      const payload: ScreenshotResultPayload = {
        base64: croppedBase64,
        mediaType: 'image/png',
        width: physicalRect.width,
        height: physicalRect.height,
        filePath: saved?.filePath ?? '',
        fileName: saved?.fileName ?? '',
      }

      logger.system.info(
        `[ScreenshotAsk] Screenshot ready: ${physicalRect.width}x${physicalRect.height}` +
          (saved ? `, saved=${saved.filePath}` : ', save skipped'),
      )

      // 暂存 payload，等 cleanup 恢复窗口可见后再回调
      // 若先 send 再 show，渲染进程收到消息时 document.visibilityState 可能仍为 hidden，
      // 导致 requestAnimationFrame 不执行、附件注入失败
      pendingPayload = payload
    } catch (err) {
      logger.system.error('[ScreenshotAsk] captureAndProcess failed:', err)
    } finally {
      this.cleanup()
    }

    // cleanup 已恢复头像窗口可见性（onVisibilityChange('end') → manager.show()），
    // 此时再推送截图结果，确保渲染进程的 visibilityState 已恢复 visible
    if (pendingPayload) {
      onScreenshotComplete(pendingPayload)
    }
  }

  /**
   * 捕获主屏截图
   *
   * @param width 屏幕宽度（CSS 像素）
   * @param height 屏幕高度（CSS 像素）
   * @returns 成功返回 dataURL，失败返回 null
   */
  private async captureScreen(width: number, height: number): Promise<string | null> {
    try {
      logger.system.info(
        `[ScreenshotAsk] Capturing screen ${width}x${height} (scale=${this.scaleFactor})`,
      )
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.floor(width * this.scaleFactor),
          height: Math.floor(height * this.scaleFactor),
        },
      })
      if (sources.length === 0) {
        logger.system.error('[ScreenshotAsk] No screen source available')
        return null
      }
      // 空图兜底：macOS 未授予屏幕录制权限时，desktopCapturer 返回空缩略图（黑屏）。
      // 若前置权限检查漏检（如权限状态为 unknown），这里拦截并提示，避免把黑图当截图。
      if (sources[0].thumbnail.isEmpty()) {
        logger.system.error(
          '[ScreenshotAsk] Captured thumbnail is empty (likely missing Screen Recording permission)',
        )
        return null
      }
      return sources[0].thumbnail.toDataURL()
    } catch (err) {
      logger.system.error('[ScreenshotAsk] Capture screen failed:', err)
      return null
    }
  }

  /**
   * 将截图保存到工作区 .aweeclaw/screenshot 目录
   *
   * 文件名格式：screenshot_YYYYMMDD_HHmmss.png
   * 落盘失败时返回 null（不阻断截图流程，base64 仍会推送给头像窗口）
   */
  private async saveScreenshotToWorkspace(
    pngBuffer: Buffer,
  ): Promise<{ filePath: string; fileName: string } | null> {
    const workspacePath = this.getWorkspacePath()
    if (!workspacePath) {
      logger.system.warn('[ScreenshotAsk] No workspace path, skip saving screenshot file')
      return null
    }

    try {
      const dir = path.join(workspacePath, BRAND.dirName, 'screenshot')
      const ok = await ensureDirectory(dir)
      if (!ok) {
        logger.system.warn('[ScreenshotAsk] Failed to create screenshot dir:', dir)
        return null
      }

      const fileName = this.formatScreenshotFileName()
      const filePath = path.join(dir, fileName)
      await fsPromises.writeFile(filePath, pngBuffer)

      return { filePath, fileName }
    } catch (err) {
      logger.system.error('[ScreenshotAsk] Save screenshot to workspace failed:', err)
      return null
    }
  }

  /** 生成截图文件名：screenshot_YYYYMMDD_HHmmss.png */
  private formatScreenshotFileName(): string {
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp =
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    return `screenshot_${stamp}.png`
  }

  /** 清理覆盖窗口和状态 */
  private cleanup(): void {
    ipcMain.removeHandler('screenshot-overlay:request-setup')

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.close()
    }
    this.overlayWindow = null

    // 截图流程结束，恢复迷你助手窗口可见性
    if (this.onVisibilityChange) {
      try {
        this.onVisibilityChange('end')
      } catch (err) {
        logger.system.warn('[ScreenshotAsk] onVisibilityChange end failed:', err)
      }
      this.onVisibilityChange = null
    }
  }
}
