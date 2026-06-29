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
  MIN_WIDTH: 1200,
  MIN_HEIGHT: 700,
  EMPTY_MIN_WIDTH: 800,
  EMPTY_MIN_HEIGHT: 500,
} as const

// ==========================================
// 全局状态
// ==========================================

const windows = new Map<number, BrowserWindow>()
const windowWorkspaces = new Map<number, string[]>()
let lastActiveWindow: BrowserWindow | null = null

/** 已授权关闭的窗口集合（无需再次拦截） */
const authorizedCloseWindows = new Set<number>()

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
    const snapshot = await win.webContents.executeJavaScript(`(() => {
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
    })()`, true)

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
    },
  })

  registerCsp(win)
  registerWindowLifecycle(win)
  registerShortcuts(win)
  registerExternalLinkHandler(win)

  const windowId = win.id
  windows.set(windowId, win)
  lastActiveWindow = win

  win.on('focus', () => {
    lastActiveWindow = win
  })

  if (!deferLoad) {
    loadWindowContent(win, isEmpty)
  }

  return win
}

/** 在生产模式下注册 CSP 头，限制远程资源加载范围 */
function registerCsp(win: BrowserWindow): void {
  if (!app.isPackaged) return

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // 注意：Monaco Editor 在 Electron 中硬性依赖 unsafe-eval，无法移除
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' local-preview:",
          "style-src 'self' 'unsafe-inline' local-preview:",
          "img-src 'self' data: https: blob: local-preview:",
          "connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:*",
          "frame-src 'self' http://127.0.0.1:* http://localhost:*",
          "child-src 'self' http://127.0.0.1:* http://localhost:*",
          "font-src 'self' data: local-preview:",
          "media-src 'self' local-preview:",
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

/** 处理窗口关闭流程：拦截 → 保存 → 清理 → 真正关闭 */
async function handleWindowCloseFlow(win: BrowserWindow, windowId: number): Promise<void> {
  const isLastWindowQuit = process.platform !== 'darwin' && windows.size === 1
  const shutdownReason: ShutdownReason = isLastWindowQuit ? 'app-quit' : 'window-close'

  const presentation = await getShutdownPresentation(win)
  await shutdownWindowController.show(shutdownReason, presentation, win)

  const success = await requestRendererShutdown(win, shutdownReason)
  await shutdownWindowController.update(shutdownReason, success ? 'done' : 'error')

  // 最后一个窗口关闭时同步执行全局清理
  if (isLastWindowQuit) {
    quitStateController.markAppQuitting()
    await withTimeout(performGlobalCleanup(), 5000, 'performGlobalCleanup total')
  }

  if (win.isDestroyed()) return

  authorizedCloseWindows.add(windowId)
  win.close()
  await sleep(success ? 700 : 1100)
  await shutdownWindowController.close()

  if (isLastWindowQuit) {
    quitStateController.markCleanupDone()
    logger.system.info('[Window] Last window close cleanup done, finalizing app quit')
    app.quit()
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
