/**
 * 窗口管理器
 *
 * 集中管理 BrowserWindow 的：
 * 1. 创建（含 CSP、图标、屏幕尺寸自适应）
 * 2. 生命周期事件（focus / close / closed）
 * 3. 关闭流程协调（拦截 → 渲染进程保存 → 清理 → 关闭界面 → 真正关闭）
 * 4. 外部链接拦截（统一走 safeOpenExternal）
 * 5. 内容加载（生产 loadFile / 开发 loadURL）
 *
 * 暴露的状态（authorizedCloseWindows / appQuitInProgress / isCleanupDone）
 * 由 appBootstrap 通过 setter 注入，避免双向依赖。
 */
import { app, BrowserWindow, screen } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { safeOpenExternal } from '../guard/safeExternalUrl'
import { cleanupFileWatcher } from '../guard/fileSystemObserver'
import {
  shutdownWindowController,
  type ShutdownWindowPresentation,
} from '../modules/lifecycle/GracefulShutdownController'
import { getThemeBackgroundColor, getShutdownFallbackPresentation, normalizeRgbColor } from './themeColors'
import { registerWindowDiagnostics } from './windowDiagnostics'
import { requestRendererShutdown, type ShutdownReason } from './shutdownCoordinator'
import { withTimeout, performGlobalCleanup } from './globalCleanup'

// ==========================================
// 常量
// ==========================================

const WINDOW_CONFIG = {
  WIDTH: 1600,
  HEIGHT: 1000,
  MIN_WIDTH: 960,
  MIN_HEIGHT: 640,
  EMPTY_MIN_WIDTH: 720,
  EMPTY_MIN_HEIGHT: 480,
} as const

// ==========================================
// 全局状态
// ==========================================

const windows = new Map<number, BrowserWindow>()
const windowWorkspaces = new Map<number, string[]>()
let lastActiveWindow: BrowserWindow | null = null

/**
 * 首个窗口 ID（应用级服务的宿主窗口）
 *
 * 应用启动时创建的第一个窗口标记为 primary；新建窗口（window:new）只会成为
 * 普通窗口。渲染进程通过 window:isPrimary 查询该标记，用于避免每个窗口都启动
 * 一遍只应存在一份的应用级后台任务（渠道连接、长时记忆调度、云会话恢复等），
 * 否则多开窗口会让定时器与后台负载成倍增长。
 *
 * 首个窗口关闭后，标记移交给剩余窗口中最早创建的一个，保证应用级任务不断档。
 */
let primaryWindowId: number | null = null

/** 已授权关闭的窗口集合（无需再次拦截） */
const authorizedCloseWindows = new Set<number>()

/**
 * 主窗口「关闭即隐藏」开关（hide-on-close）
 *
 * 启用后：用户点击主窗口关闭按钮时，仅隐藏窗口（保留 warm renderer），
 * 不触发 shutdown 流程、不退出应用。悬浮头像激活时由 FloatingAvatarManager 开启，
 * 使主窗口关闭后仍能持续 push 语音上下文/刷新 token 到头像窗口。
 *
 * 退出流程（appQuitInProgress）时自动失效，走原 handleWindowCloseFlow。
 */
let hideOnCloseEnabled = false

/** 设置主窗口「关闭即隐藏」开关（由 FloatingAvatarManager 按头像开关联动） */
export function setHideOnCloseEnabled(enabled: boolean): void {
  hideOnCloseEnabled = enabled
}

/** IPC 模块句柄，用于 closed 时清理 LLM 服务 */
let ipcModule: { cleanupLLMService: (webContentsId: number) => void } | null = null

/** 注入 IPC 模块 */
export function setIpcModuleForWindow(module: { cleanupLLMService: (id: number) => void } | null): void {
  ipcModule = module
}

/**
 * 退出流程状态控制器，由 appBootstrap 注入。
 *
 * windowManager 在 close 拦截流程中需要读取 / 修改这两个全局状态，
 * 但状态本身属于应用生命周期管理（appBootstrap），故通过回调注入避免循环依赖。
 */
export interface QuitStateController {
  /** 读取 appQuitInProgress */
  isAppQuitting(): boolean
  /** 标记 appQuitInProgress */
  markAppQuitting(): void
  /** 标记清理已完成（最后窗口关闭时） */
  markCleanupDone(): void
}

let quitStateController: QuitStateController = {
  isAppQuitting: () => false,
  markAppQuitting: () => {},
  markCleanupDone: () => {},
}

/** 注入退出状态控制器 */
export function setQuitStateController(controller: QuitStateController): void {
  quitStateController = controller
}

// ==========================================
// 窗口查询
// ==========================================

/** 根据 ID 获取窗口，未指定 ID 时返回最后一个活跃窗口 */
export function getMainWindow(windowId?: number): BrowserWindow | null {
  if (windowId !== undefined) {
    return windows.get(windowId) || null
  }
  return lastActiveWindow || Array.from(windows.values())[0] || null
}

/** 根据工作区根路径查找已存在的窗口 */
export function findWindowByWorkspace(roots: string[]): BrowserWindow | null {
  const normalized = roots.map((r) => r.toLowerCase().replace(/\\/g, '/'))
  for (const [id, workspaceRoots] of windowWorkspaces) {
    const normalizedWs = workspaceRoots.map((r) => r.toLowerCase().replace(/\\/g, '/'))
    if (normalized.some((root) => normalizedWs.includes(root))) {
      const win = windows.get(id)
      if (win && !win.isDestroyed()) return win
    }
  }
  return null
}

/** 设置窗口关联的工作区 */
export function setWindowWorkspace(id: number, roots: string[]): void {
  windowWorkspaces.set(id, roots)
}

/** 获取窗口关联的工作区 */
export function getWindowWorkspace(id: number): string[] | null {
  return windowWorkspaces.get(id) || null
}

/** 获取应用级服务宿主窗口 ID（首个窗口，可能为 null） */
export function getPrimaryWindowId(): number | null {
  return primaryWindowId
}

/**
 * 判断指定窗口是否为应用级服务宿主窗口
 *
 * 渲染进程据此决定是否启动「只应存在一份」的后台任务。
 */
export function isPrimaryWindow(id: number): boolean {
  return primaryWindowId === id
}

/** 获取所有窗口数量 */
export function getWindowCount(): number {
  return windows.size
}

/** 获取所有未销毁的窗口 */
export function getOpenWindows(): BrowserWindow[] {
  return [...windows.values()].filter((win) => !win.isDestroyed())
}

/** 获取关闭流程状态（供 appBootstrap 判断是否在退出中） */
export function isAppQuitInProgress(): boolean {
  return quitStateController.isAppQuitting()
}

/** 标记窗口已授权关闭，下次 close 事件不再拦截 */
export function authorizeWindowClose(windowId: number): void {
  authorizedCloseWindows.add(windowId)
}

// ==========================================
// URL 工具
// ==========================================

/** 判断 URL 是否为本地开发服务器（localhost / 127.0.0.1） */
function isLocalDevServerUrl(url: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{2,5})?(?:[/?#]|$)/i.test(url)
}

// ==========================================
// 关闭界面配色
// ==========================================

/** 读取关闭界面配色的超时预算：渲染进程无响应时不能拖死整个退出流程 */
const SHUTDOWN_SNAPSHOT_TIMEOUT_MS = 1500

/** 渲染进程回传的配色快照（字段缺失时回退到默认配色） */
interface ShutdownPresentationSnapshot {
  language?: string
  themeType?: string
  background?: string
  surface?: string
  border?: string
  text?: string
  muted?: string
  accent?: string
  success?: string
  warning?: string
}

/**
 * 从渲染进程读取实时主题配色，失败时回退到 Store 配置。
 * 公开导出以便 appBootstrap 在 before-quit 流程中复用，避免重复实现。
 */
export async function getShutdownPresentation(win?: BrowserWindow | null): Promise<ShutdownWindowPresentation> {
  const fallback = getShutdownFallbackPresentation()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return fallback
  }

  try {
    // 渲染进程正忙或已无响应时 executeJavaScript 会一直挂起；退出流程若阻塞在这里，
    // 遮罩界面会永久停留、应用再也关不掉，只能杀进程，因此必须加超时兜底。
    const snapshot = (await withTimeout(
      win.webContents.executeJavaScript(`(() => {
      const root = document.documentElement
      const styles = getComputedStyle(root)
      const store = window.__AWEECLAW_STORE__?.getState?.()
      const asRgb = (value, fallback) => {
        if (typeof value !== 'string') return fallback
        const normalized = value.trim().replace(/\\s+/g, ' ')
        return /^\\d{1,3}( \\d{1,3}){2}$/.test(normalized) ? normalized : fallback
      }

      return {
        language: store?.language === 'en' ? 'en' : 'zh',
        themeType: root.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
        background: asRgb(styles.getPropertyValue('--background'), '${fallback.background}'),
        surface: asRgb(styles.getPropertyValue('--surface'), '${fallback.surface}'),
        border: asRgb(styles.getPropertyValue('--border'), '${fallback.border}'),
        text: asRgb(styles.getPropertyValue('--text-primary'), '${fallback.text}'),
        muted: asRgb(styles.getPropertyValue('--text-muted'), '${fallback.muted}'),
        accent: asRgb(styles.getPropertyValue('--accent'), '${fallback.accent}'),
        success: asRgb(styles.getPropertyValue('--status-success'), '${fallback.success}'),
        warning: asRgb(styles.getPropertyValue('--status-warning'), '${fallback.warning}'),
      }
    })()`),
      SHUTDOWN_SNAPSHOT_TIMEOUT_MS,
      'getShutdownPresentation snapshot',
    )) as ShutdownPresentationSnapshot | void

    // 超时未取到快照时直接使用默认配色，不能让退出流程继续阻塞
    if (!snapshot) return fallback

    return {
      language: snapshot?.language === 'en' ? 'en' : fallback.language,
      themeType: snapshot?.themeType === 'light' ? 'light' : fallback.themeType,
      background: normalizeRgbColor(snapshot?.background, fallback.background),
      surface: normalizeRgbColor(snapshot?.surface, fallback.surface),
      border: normalizeRgbColor(snapshot?.border, fallback.border),
      text: normalizeRgbColor(snapshot?.text, fallback.text),
      muted: normalizeRgbColor(snapshot?.muted, fallback.muted),
      accent: normalizeRgbColor(snapshot?.accent, fallback.accent),
      success: normalizeRgbColor(snapshot?.success, fallback.success),
      warning: normalizeRgbColor(snapshot?.warning, fallback.warning),
    }
  } catch (error) {
    logger.system.warn('[Window] Failed to read shutdown presentation snapshot', { error })
    return fallback
  }
}

// ==========================================
// 窗口创建
// ==========================================

/** 根据平台选择正确的图标格式 */
function getIconPath(): string {
  const platform = process.platform
  const brandIconDir = path.join(app.getAppPath(), 'public/brand/icons')
  if (platform === 'win32') return path.join(brandIconDir, 'app.ico')
  if (platform === 'darwin') return path.join(brandIconDir, 'app.icns')
  return path.join(brandIconDir, 'app.png')
}

/**
 * 创建应用窗口
 *
 * @param isEmpty 是否为空窗口（欢迎页）：影响初始尺寸
 * @param deferLoad 是否推迟加载页面内容（用于模块初始化前先创建窗口）
 */
export function createWindow(isEmpty = false, deferLoad = false): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  // 空窗口按屏幕 80% 显示，普通窗口最大化主屏工作区
  const winWidth = isEmpty ? Math.round(screenWidth * 0.8) : screenWidth
  const winHeight = isEmpty ? Math.round(screenHeight * 0.8) : screenHeight
  const winMinWidth = isEmpty ? WINDOW_CONFIG.EMPTY_MIN_WIDTH : WINDOW_CONFIG.MIN_WIDTH
  const winMinHeight = isEmpty ? WINDOW_CONFIG.EMPTY_MIN_HEIGHT : WINDOW_CONFIG.MIN_HEIGHT

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: winMinWidth,
    minHeight: winMinHeight,
    frame: false,
    titleBarStyle: 'hiddenInset',
    icon: getIconPath(),
    trafficLightPosition: { x: 15, y: 14 },
    backgroundColor: getThemeBackgroundColor(),
    show: false,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      v8CacheOptions: 'bypassHeatCheck',
      backgroundThrottling: false,
      // 启用 <webview> 标签用于内置浏览器（元素检查/原生导航）
      // 安全由 registerWebviewGuard 的 will-attach-webview 守卫保障
      webviewTag: true,
    },
  })

  registerCsp(win)
  registerWindowLifecycle(win)
  registerShortcuts(win)
  registerExternalLinkHandler(win)
  registerWebviewGuard(win)

  const windowId = win.id
  windows.set(windowId, win)
  lastActiveWindow = win
  // 首个窗口承担应用级后台任务；后续新建窗口不重复承担
  if (primaryWindowId === null) primaryWindowId = windowId

  win.on('focus', () => {
    lastActiveWindow = win
  })

  if (!deferLoad) {
    loadWindowContent(win, isEmpty)
  }

  return win
}

/**
 * CSP 响应头拦截是否已注册
 *
 * CSP 作用于 session 而非单个窗口，且 Electron 的 onHeadersReceived 是「追加监听器」
 * 语义：每创建一个窗口就会多挂一份。多份监听器会对同一个请求重复回调，请求处理开销
 * 随窗口数线性增长，同时后一份回调会覆盖前一份写入的响应头。因此用模块级标志保证
 * 整个 session 只注册一次。
 */
let cspRegistered = false

/** 在生产模式下注册 CSP 头，限制远程资源加载范围 */
function registerCsp(win: BrowserWindow): void {
  if (!app.isPackaged || cspRegistered) return
  cspRegistered = true

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // 注意：Monaco Editor 在 Electron 中硬性依赖 unsafe-eval，无法移除
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' local-preview: scenario-bundle: plugin-bundle:",
          "style-src 'self' 'unsafe-inline' local-preview: scenario-bundle: plugin-bundle:",
          "img-src 'self' data: https: blob: local-preview:",
          "connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:*",
          // 支付宝收银台：电脑网站支付用 qr_pay_mode=4 将二维码内嵌到客户端 iframe
          // 收银台涉及 openapi / excashier / mclient 等多个子域，统一放行 *.alipay.com
          "frame-src 'self' http://127.0.0.1:* http://localhost:* https://*.alipay.com",
          "child-src 'self' http://127.0.0.1:* http://localhost:* https://*.alipay.com",
          "font-src 'self' data: local-preview:",
          "media-src 'self' blob: local-preview:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      },
    })
  })
}

/** 注册窗口生命周期事件（close 拦截、closed 清理） */
function registerWindowLifecycle(win: BrowserWindow): void {
  const windowId = win.id

  // close 事件中提前捕获 webContentsId，closed 时 webContents 可能已销毁
  let cachedWebContentsId: number | undefined

  win.on('close', (event) => {
    cachedWebContentsId = win.webContents?.id

    // 已授权关闭或应用正在退出，直接放行
    if (authorizedCloseWindows.delete(windowId) || quitStateController.isAppQuitting()) {
      logger.system.info(`[Window] ${windowId} close event allowed`)
      return
    }

    // hide-on-close：悬浮头像激活时，关闭主窗口仅隐藏（保留 warm renderer + 持续 push 上下文）
    // 满足需求：「关闭主窗口后头像仍在」+ 主窗口 warm 保持 token 刷新
    if (hideOnCloseEnabled) {
      event.preventDefault()
      win.hide()
      logger.system.info(`[Window] ${windowId} hidden on close (hide-on-close enabled)`)
      return
    }

    event.preventDefault()
    logger.system.info(`[Window] ${windowId} close event intercepted for state save`)

    void handleWindowCloseFlow(win, windowId)
  })

  win.on('closed', () => {
    if (cachedWebContentsId) {
      void cleanupFileWatcher(`window-${cachedWebContentsId}`)
    }
    // 清理该窗口关联的 LLM 服务（中止活跃流、释放 AbortController）
    if (cachedWebContentsId && ipcModule) {
      try {
        ipcModule.cleanupLLMService(cachedWebContentsId)
      } catch {
        /* ignore */
      }
    }

    windows.delete(windowId)
    windowWorkspaces.delete(windowId)

    // 应用级任务宿主窗口被关闭：移交给剩余窗口中最早创建的一个，
    // 避免渠道连接 / 记忆调度等后台服务随首个窗口一起消失；
    // 同时通知接管窗口补启动这些任务（渲染进程侧为幂等，重复通知无副作用）
    if (primaryWindowId === windowId) {
      primaryWindowId = windows.keys().next().value ?? null
      if (primaryWindowId !== null) {
        logger.system.info(`[Window] Primary window moved to ${primaryWindowId}`)
        const next = windows.get(primaryWindowId)
        if (next && !next.isDestroyed() && !next.webContents.isDestroyed()) {
          next.webContents.send('window:primary-changed')
        }
      }
    }

    logger.system.info(`[Window] ${windowId} closed. Remaining: ${windows.size}`)

    if (lastActiveWindow === win) {
      lastActiveWindow = Array.from(windows.values())[0] || null
    }
  })

  // 等待 DOM 渲染完成后显示窗口，避免白屏闪烁
  win.webContents.once('dom-ready', () => {
    setTimeout(() => win.show(), 16) // 等待一帧让 CSS 动画启动
  })

  // macOS 上确保 traffic lights 始终显示
  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(true)
  }

  registerWindowDiagnostics(win)
}

/**
 * 普通窗口关闭时分配给渲染进程的保存预算
 *
 * 关闭单个窗口是高频操作，渲染进程即使无响应也只能短等；应用整体退出的
 * 长超时（requestRendererShutdown 默认 8s）只适用于「最后一个窗口」场景。
 */
const WINDOW_CLOSE_SAVE_TIMEOUT_MS = 2500

/** 正在执行关闭流程的窗口，用于拦截重复或并发的关闭请求 */
const closingWindows = new Set<number>()

/**
 * 处理窗口关闭流程：拦截 → 保存 → 清理 → 真正关闭
 *
 * 核心约束是「窗口一定会被关闭」：close 事件已在上面被 preventDefault 拦截，
 * 一旦流程中途抛错而缺少兜底，窗口就会彻底关不掉；同时保存遮罩窗口是窗口级单例、
 * 且 alwaysOnTop + closable:false，会残留在最上层挡住整个界面，
 * 表现出来就是「点关闭没反应、最后连应用都退不掉，只能杀进程」。
 * 因此这里用 try/catch/finally 收口，在 finally 中无条件授权关闭并销毁遮罩。
 */
async function handleWindowCloseFlow(win: BrowserWindow, windowId: number): Promise<void> {
  // 用户以为没反应而重复点击时 close 事件会再次触发，并发跑同一套流程会让
  // 单例遮罩窗口的状态错乱，重复进入直接忽略。
  if (closingWindows.has(windowId)) return
  closingWindows.add(windowId)

  const isLastWindowQuit = process.platform !== 'darwin' && windows.size === 1
  const shutdownReason: ShutdownReason = isLastWindowQuit ? 'app-quit' : 'window-close'
  let saveSucceeded = true
  let showedOverlay = false

  try {
    if (isLastWindowQuit) {
      // 应用整体退出：展示保存进度界面，并按应用级预算等待清理
      const presentation = await getShutdownPresentation(win)
      await shutdownWindowController.show(shutdownReason, presentation, win)
      showedOverlay = true

      saveSucceeded = await requestRendererShutdown(win, shutdownReason)
      await shutdownWindowController.update(shutdownReason, saveSucceeded ? 'done' : 'error')

      quitStateController.markAppQuitting()
      await withTimeout(performGlobalCleanup(), 5000, 'performGlobalCleanup total')
    } else {
      // 关闭普通窗口（含新建窗口）：静默保存即可，不弹保存遮罩、也不套用
      // 应用级退出的长超时，否则每关一个窗口都要空等数秒，看起来像卡死。
      saveSucceeded = await requestRendererShutdown(
        win,
        shutdownReason,
        WINDOW_CLOSE_SAVE_TIMEOUT_MS,
      )
    }
  } catch (error) {
    logger.system.warn(`[Window] ${windowId} close flow failed, forcing window close`, { error })
  } finally {
    closingWindows.delete(windowId)

    // 无论保存成功与否都要放行关闭，否则用户永远关不掉这个窗口
    if (!win.isDestroyed()) {
      authorizedCloseWindows.add(windowId)
      win.close()
    }

    // 只有展示过遮罩才需要等待收尾动画
    if (showedOverlay) {
      await sleep(saveSucceeded ? 700 : 1100)
    }

    // 遮罩窗口是窗口级单例，必须无条件销毁，避免残留置顶遮挡界面
    await shutdownWindowController.close()

    if (isLastWindowQuit) {
      quitStateController.markCleanupDone()
      logger.system.info('[Window] Last window close cleanup done, finalizing app quit')
      app.quit()
    }
  }
}

/** 注册主进程层级的快捷键（Command Palette 需要 Web 区域外也能触发） */
function registerShortcuts(win: BrowserWindow): void {
  // DevTools 由菜单 role:toggleDevTools 自动处理，无需在此注册
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const isOpenCommandPalette =
      ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'p') ||
      input.key === 'F1'
    if (isOpenCommandPalette) {
      win.webContents.send('workbench:execute-command', 'workbench.action.showCommands')
    }
  })
}

/** 拦截外部链接，统一走 safeOpenExternal，仅允许本地开发服务器与 devtools */
function registerExternalLinkHandler(win: BrowserWindow): void {
  const openUrlSafely = (rawUrl: string) => safeOpenExternal(rawUrl)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('devtools://') || isLocalDevServerUrl(url)) {
      return { action: 'allow' }
    }
    openUrlSafely(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isLocalDevServerUrl(url) && !url.startsWith('file://')) {
      event.preventDefault()
      openUrlSafely(url)
    }
  })
}

/**
 * webview 安全守卫
 *
 * 主窗口启用了 webviewTag 后，必须在此强制覆盖每个 webview 的 webPreferences，
 * 防止页面通过 <webview> 标签属性（如 nodeintegration）提权；同时校验 src 协议，
 * 仅允许 http/https（阻止 file://、javascript:、data: 等危险协议）。
 *
 * did-attach-webview 在 guest webContents 就绪后注册新窗口与导航拦截，
 * 使 webview 内的 target=_blank 外部链接走系统浏览器，与主窗口行为一致。
 */
function registerWebviewGuard(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    // 强制安全 webPreferences，忽略标签属性中的任何提权设置
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false

    // 仅允许 http/https 协议，阻止 file://、javascript:、data: 等
    const src = typeof params.src === 'string' ? params.src.trim() : ''
    if (!/^https?:\/\//i.test(src)) {
      logger.system.warn(`[WebviewGuard] Blocked webview with unsafe src: ${src || '(empty)'}`)
      event.preventDefault()
      return
    }
  })

  win.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    // webview 内新窗口拦截：devtools 与本地 dev server 放行，其余 http/https 走系统浏览器
    guestWebContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('devtools://')) {
        return { action: 'allow' }
      }
      if (/^https?:\/\//i.test(url)) {
        void safeOpenExternal(url)
        return { action: 'deny' }
      }
      return { action: 'deny' }
    })

    // webview 内导航拦截：仅允许 http/https 同窗口跳转，阻止其他协议
    guestWebContents.on('will-navigate', (navEvent, url) => {
      if (!/^https?:\/\//i.test(url)) {
        navEvent.preventDefault()
      }
    })
  })
}

// ==========================================
// 内容加载
// ==========================================

/** 加载窗口页面内容：生产 loadFile / 开发 loadURL / 无 dev server 时回退到构建产物 */
export function loadWindowContent(win: BrowserWindow, isEmpty: boolean): void {
  const query = isEmpty ? { empty: '1' } : undefined
  const rendererPath = path.join(__dirname, '../renderer/index.html')

  if (app.isPackaged) {
    win.loadFile(rendererPath, { query })
    return
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    const devUrl = `${process.env.VITE_DEV_SERVER_URL}${isEmpty ? '?empty=1' : ''}`
    win.loadURL(devUrl)
    return
  }

  // 非打包模式但无开发服务器：回退到构建产物
  win.loadFile(rendererPath, { query })
}

// ==========================================
// 工具
// ==========================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
