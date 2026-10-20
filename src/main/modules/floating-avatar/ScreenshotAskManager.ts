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

import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  screen,
} from 'electron'
import * as path from 'path'
import { promises as fsPromises } from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import { ensureDirectory } from '../../guard/fileAccessControl'
import { BRAND } from '@shared/brand'
import {
  createPermissionDeniedError,
  logAppIdentity,
  resolveScreenPermission,
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
  /** 截图保存到工作空间的绝对路径（.aweeclaw/screenshot/xxx.png） */
  filePath: string
  /** 截图文件名（含扩展名） */
  fileName: string
}

/** 渲染层标注完成后提交的图片 */
export interface AnnotatedImagePayload {
  /** 合成后的图片 base64（不含 data: 前缀） */
  base64: string
  /** 图片物理像素宽度 */
  width: number
  /** 图片物理像素高度 */
  height: number
}

/**
 * 回传给渲染层的待标注截图
 *
 * 作为 screenshot-overlay:capture 的 invoke 响应返回给覆盖窗口。
 */
export interface EditImagePayload {
  /** 裁剪后的截图 base64（不含 data: 前缀） */
  base64: string
  /** 图片物理像素宽度 */
  width: number
  /** 图片物理像素高度 */
  height: number
  /** 主屏缩放因子 */
  scaleFactor: number
}

/** 工作空间路径获取函数（由外部注入，避免直接依赖 windowManager 造成循环依赖） */
export type WorkspacePathGetter = () => string | null

export class ScreenshotAskManager {
  private overlayWindow: BrowserWindow | null = null
  /** 主屏缩放因子 */
  private scaleFactor: number = 1
  /** 工作空间路径获取函数（用于截图落盘到 .aweeclaw/screenshot） */
  private readonly getWorkspacePath: WorkspacePathGetter
  /** 当前截图流程的窗口可见性回调（start 时隐藏迷你助手，end 时恢复） */
  private onVisibilityChange: ((phase: 'start' | 'end') => void) | null = null
  /** 标注完成后的结果回调（确认选区时保存，收尾动作触发时消费） */
  private onScreenshotComplete: ((payload: ScreenshotResultPayload) => void) | null = null
  /** 已注册的覆盖窗口 IPC 监听器，cleanup 时统一注销 */
  private overlayHandlers: Array<{
    channel: string
    listener: (event: Electron.IpcMainEvent, ...args: any[]) => void
  }> = []
  /** 截图后等待渲染层就绪、再恢复不透明度的窗口 */
  private pendingReveal: BrowserWindow | null = null
  /** 就绪通知的兜底定时器：超时强制恢复，避免渲染层没响应时窗口卡在全透明 */
  private revealTimer: NodeJS.Timeout | null = null
  /**
   * 启动时就抓好的全屏画面
   *
   * 覆盖窗口显示前桌面上没有任何本应用元素，是最干净的抓屏时机。确认选区时
   * 直接从这张图裁剪，窗口不必再切透明重新抓屏——那段透明期在 macOS 上会让
   * 遮罩整体消失再回来，用户感知为「闪一下」，且 alpha=0 的窗口会被暂停提交
   * 新帧，恢复可见时先闪出的仍是切透明前的旧画面。
   */
  private cachedScreenImage: Electron.NativeImage | null = null
  /**
   * 与 cachedScreenImage 对应的显示器
   *
   * 裁剪时必须用「抓这张图时的那块屏」的尺寸反推比例，不能重新取一次主屏：
   * 抓屏与裁剪之间若发生显示器切换（投屏、合盖），重新获取会拿到不同的 bounds，
   * 比例随之失效，选区里的画面会整体位移。
   */
  private cachedDisplay: Electron.Display | null = null

  constructor(getWorkspacePath: WorkspacePathGetter) {
    this.getWorkspacePath = getWorkspacePath
  }

  /**
   * 判断 IPC 是否来自本实例创建的覆盖窗口
   *
   * 悬浮球与主窗口各自持有一个实例、监听同名通道，
   * 只有持有覆盖窗口的一方才应响应，否则会误结束另一方的流程。
   */
  private isOwnOverlay(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return false
    return event.sender.id === this.overlayWindow.webContents.id
  }

  /** 注册覆盖窗口 IPC：取消、确认选区、标注收尾 */
  private registerOverlayHandlers(): void {
    const handlers: Array<{
      channel: string
      listener: (event: Electron.IpcMainEvent, ...args: any[]) => void
    }> = [
      {
        channel: 'screenshot-overlay:cancel',
        listener: (event) => {
          if (!this.isOwnOverlay(event)) return
          this.handleCancel()
        },
      },
      {
        channel: 'screenshot-overlay:annotate-save',
        listener: (event, payload: AnnotatedImagePayload) => {
          if (!this.isOwnOverlay(event)) return
          void this.handleAnnotateSave(payload)
        },
      },
      {
        channel: 'screenshot-overlay:annotate-copy',
        listener: (event, payload: AnnotatedImagePayload) => {
          if (!this.isOwnOverlay(event)) return
          this.handleAnnotateCopy(payload)
        },
      },
      {
        channel: 'screenshot-overlay:annotate-download',
        listener: (event, payload: AnnotatedImagePayload) => {
          if (!this.isOwnOverlay(event)) return
          void this.handleAnnotateDownload(payload)
        },
      },
      {
        // 渲染层把编辑态画好后通知主进程恢复不透明度，让窗口重新可见的第一帧
        // 就是带截图和标注工具的编辑态，避免先闪出一帧「只有选框」的中间态
        channel: 'screenshot-overlay:annotate-ready',
        listener: (event) => {
          if (!this.isOwnOverlay(event)) return
          this.revealOverlay()
        },
      },
    ]

    for (const handler of handlers) {
      ipcMain.on(handler.channel, handler.listener)
      this.overlayHandlers.push(handler)
    }

    // 选区提交用 invoke：主进程要先隐藏窗口才能截图，隐藏/显示期间渲染进程会被
    // 节流，用 send 回填会与渲染层恢复时机竞争。请求-响应模式由 Promise 保证时序。
    ipcMain.handle('screenshot-overlay:capture', (event, rect: SelectionRect) => {
      if (!this.isOwnOverlay(event)) return null
      logger.system.info(`[ScreenshotAsk] User confirmed region: ${JSON.stringify(rect)}`)
      return this.captureForEditing(rect)
    })
  }

  /** 注销覆盖窗口 IPC */
  private unregisterOverlayHandlers(): void {
    for (const handler of this.overlayHandlers) {
      ipcMain.removeListener(handler.channel, handler.listener)
    }
    this.overlayHandlers = []
    ipcMain.removeHandler('screenshot-overlay:capture')
  }

  /** 用户取消截图 */
  private handleCancel(): void {
    logger.system.info('[ScreenshotAsk] User cancelled')
    this.onScreenshotComplete = null
    this.cleanup()
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
    // 判定以真实抓取为准：TCC 状态可能因缓存或签名变更与真实能力不符。
    const permission = await resolveScreenPermission('floating-avatar screenshot')
    if (!permission.granted) {
      logAppIdentity('floating-avatar screenshot denied')
      throw createPermissionDeniedError(permission.status)
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

      // 预截全屏：此刻迷你助手已隐藏、覆盖窗口尚未显示，屏幕上没有本应用的元素。
      // 确认选区时直接裁剪这张图，窗口无需再切透明重抓，框选到标注的过渡就不会闪。
      // 留一点等待时间让迷你助手真正从屏幕上消失，避免把它截进图里。
      await new Promise((resolve) => setTimeout(resolve, 140))
      this.cachedDisplay = primaryDisplay
      this.cachedScreenImage = await this.captureScreenImage(primaryDisplay)
      if (!this.cachedScreenImage) {
        logger.system.warn('[ScreenshotAsk] Pre-capture failed, will capture when confirming')
      }

      // 注册渲染层请求屏幕信息的 handler（屏幕尺寸 + workArea + scale）
      // 用 handle 而非 handleOnce：开发模式下 HMR 重载覆盖窗口会二次请求，
      // handleOnce 已在首次消费后失效，会让重载后的界面拿不到屏幕信息而空白。
      ipcMain.handle('screenshot-overlay:request-setup', () => {
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
          // workArea 底边换到覆盖窗口坐标系（窗口顶 = bounds.y），渲染层直接用这个值
          // 判断工具条是否会被 Dock 挡住，不必自己做坐标换算
          workAreaBottom: workArea.y - primaryDisplay.bounds.y + workArea.height,
          // Dock/任务栏占用的高度：工具条定位时作为额外安全区
          dockHeight: Math.max(
            0,
            primaryDisplay.bounds.y + height - (workArea.y + workArea.height),
          ),
        }
      })

      // 保存结果回调：确认选区后进入标注编辑态，最终由收尾动作触发推送
      this.onScreenshotComplete = onScreenshotComplete
      // 注册覆盖窗口 IPC（取消 / 确认 / 标注收尾），cleanup 时统一注销
      this.registerOverlayHandlers()

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
        // 监听器统一由 cleanup / unregisterOverlayHandlers 注销
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
   * 截取选区并返回裁剪结果
   *
   * 关键：必须先隐藏覆盖窗口再截图，否则透明窗口的遮罩/选区会被截进去。
   * 隐藏后等一小段确保窗口真正从屏幕移除，再调用 desktopCapturer。
   *
   * 裁剪结果不落盘：渲染层拿到图后可以加标注，最终去向由
   * 「完成 / 复制 / 保存 / 取消」决定，避免产生未标注的中间文件。
   *
   * 返回值直接作为 invoke 的响应送达渲染层，不再走额外的事件回填，
   * 这样渲染层拿到的结果一定是主进程截图并恢复窗口之后才产生的。
   *
   * @param rect 选区坐标（CSS 像素，覆盖窗口坐标系）
   * @returns 裁剪结果；选区无效、截图失败或窗口已销毁时返回 null
   */
  private async captureForEditing(rect: SelectionRect): Promise<EditImagePayload | null> {
    // 1. 校验选区有效性（CSS 像素）
    if (rect.width < 10 || rect.height < 10) {
      logger.system.warn('[ScreenshotAsk] Selection too small, ignoring')
      this.cleanup()
      return null
    }

    const overlay = this.overlayWindow
    if (!overlay || overlay.isDestroyed()) {
      logger.system.warn('[ScreenshotAsk] captureForEditing skipped: overlay window is gone')
      return null
    }

    try {
      // 2. 优先用启动时缓存的全屏图裁剪
      //    窗口全程保持不透明，框选→标注之间没有任何画面空档，也就没有「闪一下」。
      let fullImage = this.cachedScreenImage

      if (!fullImage || fullImage.isEmpty()) {
        // 回退路径：预截失败（权限异常等）时才临时把窗口调透明再抓屏。
        // alpha=0 的窗口不参与屏幕合成，遮罩不会进入截图；恢复交给渲染层，
        // 等它把编辑态画好再显示，避免露出「选框回来但工具没出来」的中间帧。
        overlay.setOpacity(0)
        // 等待合成器刷新一帧，确保透明真正生效（32ms ≈ 两帧）
        await new Promise((resolve) => setTimeout(resolve, 32))
        const display = screen.getPrimaryDisplay()
        this.cachedDisplay = display
        const captured = await this.captureScreenImage(display)
        if (!captured) {
          logger.system.error('[ScreenshotAsk] Capture failed in captureForEditing')
          this.cleanup()
          return null
        }
        fullImage = captured
        if (overlay.isDestroyed()) return null
        this.pendingReveal = overlay
        if (this.revealTimer) clearTimeout(this.revealTimer)
        this.revealTimer = setTimeout(() => this.revealOverlay(), 1200)
      }

      // 3. 换算比例必须以图片真实尺寸为准
      //    desktopCapturer 的 thumbnailSize 只是上限：它会把整屏按宽高比等比缩放到框内，
      //    返回图的宽高常比 width*scaleFactor 略小（Retina 上尤其明显）。若仍按 scaleFactor
      //    裁剪，偏差会随坐标线性累积，框选越靠右/下，标注图与实际桌面错得越远。
      //    用「图片尺寸 ÷ 屏幕逻辑尺寸」反推真实比例，无论 DPI 与缩放怎么变都能自动对齐。
      const display = this.cachedDisplay ?? screen.getPrimaryDisplay()
      const imgSize = fullImage.getSize()

      // 选区坐标是相对覆盖窗口的，而裁剪用坐标必须相对整屏：两者只在
      // 「窗口左上角 == 屏幕左上角」时等价。macOS 会把无边框窗口压进可用区域
      // （顶部让出菜单栏），窗口一旦下移，rect 就比真实屏幕坐标小一截，
      // 裁出来的内容整体偏上——用户看到的就是选区里的画面往下掉。
      // 因此用窗口实际边界与屏幕边界之差做补偿，不假设窗口位置。
      const winBounds = overlay.getBounds()
      const offsetX = winBounds.x - display.bounds.x
      const offsetY = winBounds.y - display.bounds.y
      // 窗口尺寸与屏幕不一致时（被系统缩放或限高），CSS 像素需再换算回屏幕逻辑像素
      const winScaleX = winBounds.width > 0 ? display.bounds.width / winBounds.width : 1
      const winScaleY = winBounds.height > 0 ? display.bounds.height / winBounds.height : 1

      const ratioX =
        display.bounds.width > 0 ? imgSize.width / display.bounds.width : this.scaleFactor
      const ratioY =
        display.bounds.height > 0 ? imgSize.height / display.bounds.height : this.scaleFactor

      // 4. 选区 CSS 像素 → 屏幕逻辑像素 → 图片像素，并夹取到图片范围内
      let cropX = Math.round((rect.x * winScaleX + offsetX) * ratioX)
      let cropY = Math.round((rect.y * winScaleY + offsetY) * ratioY)
      let cropW = Math.round(rect.width * winScaleX * ratioX)
      let cropH = Math.round(rect.height * winScaleY * ratioY)
      cropX = Math.max(0, Math.min(cropX, imgSize.width - 1))
      cropY = Math.max(0, Math.min(cropY, imgSize.height - 1))
      cropW = Math.min(cropW, imgSize.width - cropX)
      cropH = Math.min(cropH, imgSize.height - cropY)
      if (cropW < 1 || cropH < 1) {
        logger.system.warn('[ScreenshotAsk] Empty crop area, ignoring')
        this.cleanup()
        return null
      }
      const physicalRect = { x: cropX, y: cropY, width: cropW, height: cropH }

      // 5. 裁剪
      const cropped = fullImage.crop(physicalRect)
      const croppedBase64 = cropped.toPNG().toString('base64')

      logger.system.info(
        `[ScreenshotAsk] Screen ${display.bounds.width}x${display.bounds.height} -> image ` +
          `${imgSize.width}x${imgSize.height} (ratio ${ratioX.toFixed(4)}/${ratioY.toFixed(4)})`,
      )
      logger.system.info(
        `[ScreenshotAsk] Overlay bounds ${winBounds.x},${winBounds.y} ` +
          `${winBounds.width}x${winBounds.height} (offset ${offsetX},${offsetY})`,
      )
      logger.system.info(
        `[ScreenshotAsk] Screenshot ready for annotation: ${physicalRect.width}x${physicalRect.height}` +
          (this.pendingReveal ? ' (re-captured)' : ' (cached)'),
      )

      // 渲染层用它把 CSS 坐标映射到画布像素，必须等于「图片像素 ÷ 屏幕逻辑像素」，
      // 不能用 display.scaleFactor，否则与 crop 的比例不一致，标注同样会错位
      return {
        base64: croppedBase64,
        width: physicalRect.width,
        height: physicalRect.height,
        scaleFactor: ratioX,
      }
    } catch (err) {
      logger.system.error('[ScreenshotAsk] captureForEditing failed:', err)
      this.cleanup()
      return null
    } finally {
      // 只有走过透明回退路径的窗口才需要恢复，否则覆盖窗口会静默存在却完全透明，
      // 用户像被锁住。缓存路径下窗口从未变透明，这里不会命中。
      if (!this.pendingReveal && !overlay.isDestroyed() && overlay.getOpacity() === 0) {
        overlay.setOpacity(1)
      }
    }
  }

  /**
   * 恢复覆盖窗口不透明度
   *
   * 截图期间窗口 alpha 为 0（不参与屏幕合成，遮罩不会进入截图）。恢复时机由
   * 渲染层决定：它把编辑态画好后才发起通知，这样窗口重新可见的第一帧就是完整
   * 的标注界面。兜底定时器保证渲染层异常时窗口不会一直透明。
   */
  private revealOverlay(): void {
    if (this.revealTimer) {
      clearTimeout(this.revealTimer)
      this.revealTimer = null
    }
    const overlay = this.pendingReveal ?? this.overlayWindow
    this.pendingReveal = null
    if (!overlay || overlay.isDestroyed()) return
    if (overlay.getOpacity() < 1) overlay.setOpacity(1)
    overlay.focus()
  }

  /**
   * 完成标注：合成图落盘后推送给发起截图的窗口
   *
   * 必须先 cleanup 再回调：cleanup 会恢复发起窗口的可见性，
   * 若先推送，渲染进程收到消息时 document.visibilityState 可能仍为 hidden，
   * 导致 requestAnimationFrame 不执行、附件注入失败。
   */
  private async handleAnnotateSave(payload: AnnotatedImagePayload): Promise<void> {
    try {
      const buffer = Buffer.from(payload.base64, 'base64')
      if (buffer.length === 0) {
        logger.system.warn('[ScreenshotAsk] Empty annotated image, ignoring')
        return
      }

      const saved = await this.saveScreenshotToWorkspace(buffer)
      const result: ScreenshotResultPayload = {
        base64: payload.base64,
        mediaType: 'image/png',
        width: payload.width,
        height: payload.height,
        filePath: saved?.filePath ?? '',
        fileName: saved?.fileName ?? '',
      }

      logger.system.info(
        `[ScreenshotAsk] Annotated screenshot ready: ${payload.width}x${payload.height}` +
          (saved ? `, saved=${saved.filePath}` : ', save skipped'),
      )

      const complete = this.onScreenshotComplete
      this.onScreenshotComplete = null
      this.cleanup()
      complete?.(result)
    } catch (err) {
      logger.system.error('[ScreenshotAsk] Save annotated image failed:', err)
      this.cleanup()
    }
  }

  /**
   * 复制合成图到系统剪贴板
   *
   * 不结束编辑态：常见用法是「先复制去别处粘贴，再回来点完成发到聊天」，
   * 关闭窗口会让第二种用法被迫重截一次。
   */
  private handleAnnotateCopy(payload: AnnotatedImagePayload): void {
    try {
      const buffer = Buffer.from(payload.base64, 'base64')
      if (buffer.length === 0) return

      const image = nativeImage.createFromBuffer(buffer)
      if (image.isEmpty()) {
        logger.system.warn('[ScreenshotAsk] Copy skipped: decoded image is empty')
        return
      }

      clipboard.writeImage(image)
      logger.system.info('[ScreenshotAsk] Annotated screenshot copied to clipboard')
    } catch (err) {
      logger.system.error('[ScreenshotAsk] Copy annotated image failed:', err)
    }
  }

  /**
   * 另存合成图到用户指定位置
   *
   * 保存成功后结束流程但不注入附件 —— 用户点「保存」的意图是留一份文件，
   * 而不是发到聊天；取消保存对话框则留在编辑态，不结束流程。
   */
  private async handleAnnotateDownload(payload: AnnotatedImagePayload): Promise<void> {
    try {
      const buffer = Buffer.from(payload.base64, 'base64')
      if (buffer.length === 0) return

      const dialogOptions = {
        title: '保存截图',
        defaultPath: path.join(app.getPath('pictures'), this.formatScreenshotFileName()),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      }
      // 必须带 parent 弹出 modal sheet：覆盖窗口是 alwaysOnTop 全屏窗口，
      // 无 parent 的独立对话框会被它压在下面，用户看不到保存面板
      const parent =
        this.overlayWindow && !this.overlayWindow.isDestroyed() ? this.overlayWindow : null
      const { canceled, filePath } = parent
        ? await dialog.showSaveDialog(parent, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (canceled || !filePath) return

      await fsPromises.writeFile(filePath, buffer)
      logger.system.info('[ScreenshotAsk] Annotated screenshot saved to:', filePath)

      this.onScreenshotComplete = null
      this.cleanup()
    } catch (err) {
      logger.system.error('[ScreenshotAsk] Download annotated image failed:', err)
    }
  }

  /**
   * 捕获指定显示器的画面
   *
   * getSources 返回的顺序不保证与显示器顺序一致，多显示器接驳时 sources[0] 可能
   * 是另一块屏。用它裁剪会让选区里出现别的屏幕的画面（表现为整体位移），因此必须
   * 按 display.id 精确匹配；匹配不到时退化为「宽高比最接近」的源。
   *
   * 直接返回 nativeImage：调用方需要的是裁剪而不是 dataURL，少一次编解码。
   *
   * @param display 目标显示器（覆盖窗口所在的那块）
   * @returns 成功返回整屏图像，失败返回 null
   */
  private async captureScreenImage(
    display: Electron.Display,
  ): Promise<Electron.NativeImage | null> {
    try {
      const { width, height } = display.bounds
      logger.system.info(
        `[ScreenshotAsk] Capturing screen ${width}x${height} ` +
          `(display=${display.id}, scale=${display.scaleFactor})`,
      )
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.floor(width * display.scaleFactor),
          height: Math.floor(height * display.scaleFactor),
        },
      })
      if (sources.length === 0) {
        logger.system.error('[ScreenshotAsk] No screen source available')
        return null
      }

      // 记录全部候选源，出现错位时可直接从日志判断抓到哪块屏
      logger.system.info(
        '[ScreenshotAsk] Screen sources: ' +
          sources
            .map((s) => {
              const size = s.thumbnail.getSize()
              return `${s.name} id=${s.display_id} ${size.width}x${size.height}`
            })
            .join(' | '),
      )

      const source = this.pickScreenSource(sources, display)
      if (!source) {
        logger.system.error('[ScreenshotAsk] No matching screen source')
        return null
      }

      // 空图兜底：macOS 未授予屏幕录制权限时，desktopCapturer 返回空缩略图（黑屏）。
      // 若前置权限检查漏检（如权限状态为 unknown），这里拦截并提示，避免把黑图当截图。
      if (source.thumbnail.isEmpty()) {
        logger.system.error(
          '[ScreenshotAsk] Captured thumbnail is empty (likely missing Screen Recording permission)',
        )
        return null
      }
      return source.thumbnail
    } catch (err) {
      logger.system.error('[ScreenshotAsk] Capture screen failed:', err)
      return null
    }
  }

  /**
   * 从抓屏源里挑出目标显示器的画面
   *
   * 优先按 display_id 精确匹配；该字段缺失或匹配不到时，取宽高比与目标显示器
   * 最接近的源 —— 比例一致才能保证后续裁剪坐标换算成立。
   */
  private pickScreenSource(
    sources: Electron.DesktopCapturerSource[],
    display: Electron.Display,
  ): Electron.DesktopCapturerSource | null {
    const targetId = String(display.id)
    const byId = sources.find((s) => s.display_id && String(s.display_id) === targetId)
    if (byId) return byId

    if (sources.length === 1) return sources[0]

    // 退化路径：比较宽高比，取差值最小者
    const targetRatio = display.bounds.width / Math.max(1, display.bounds.height)
    let best: Electron.DesktopCapturerSource | null = null
    let bestDiff = Number.POSITIVE_INFINITY
    for (const s of sources) {
      const size = s.thumbnail.getSize()
      if (size.width <= 0 || size.height <= 0) continue
      const diff = Math.abs(size.width / size.height - targetRatio)
      if (diff < bestDiff) {
        bestDiff = diff
        best = s
      }
    }
    if (best) {
      logger.system.warn(
        `[ScreenshotAsk] Screen source matched by aspect ratio (diff=${bestDiff.toFixed(4)})`,
      )
    }
    return best
  }

  /**
   * 将截图保存到工作空间 .aweeclaw/screenshot 目录
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
    // 就绪通知的兜底定时器必须清掉：窗口即将关闭，留着只会对空对象做无效操作
    if (this.revealTimer) {
      clearTimeout(this.revealTimer)
      this.revealTimer = null
    }
    this.pendingReveal = null
    // 缓存的整屏图是几十 MB 级别的位图，流程结束必须释放
    this.cachedScreenImage = null
    this.cachedDisplay = null
    ipcMain.removeHandler('screenshot-overlay:request-setup')
    this.unregisterOverlayHandlers()
    this.onScreenshotComplete = null

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
