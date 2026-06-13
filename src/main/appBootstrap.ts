/**
 * AweeClaw Main Process
 * 简化的启动逻辑，参考 VSCode 的快速启动模式
 * 
 * 优化说明：
 * - 启用 TypeScript 增量编译以提升构建速度
 */

import { app, BrowserWindow, Menu, ipcMain, protocol, net, screen } from 'electron'
import { safeOpenExternal } from './guard/safeExternalUrl'
export type Language = 'zh' | 'en'
import { randomUUID } from 'crypto'
import * as path from 'path'
import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import { SECURITY_DEFAULTS } from '@shared/appConstants'
import { BRAND } from '@shared/brand'
import type Store from 'electron-store'
import { destroyIndexService } from './search-engine/indexOrchestrator'
import { setCustomLspBinDir } from './language-server/serverInstaller'
import { lspManager as mainLspManager } from './language-server/languageServerManager'
import { cleanupFileWatcher } from './guard/fileSystemObserver'
import { createScopedStore, getBootstrapStore, getUserConfigDir } from './modules/configPath'
import {
  shutdownWindowController,
  type ShutdownWindowPresentation,
} from './modules/lifecycle/GracefulShutdownController'

// ==========================================
// 常量定义
// ==========================================

const WINDOW_CONFIG = {
  WIDTH: 1600,
  HEIGHT: 1000,
  MIN_WIDTH: 1200,
  MIN_HEIGHT: 700,
  // 空窗口（欢迎页）尺寸
  EMPTY_WIDTH: 1000,
  EMPTY_HEIGHT: 680,
  EMPTY_MIN_WIDTH: 800,
  EMPTY_MIN_HEIGHT: 500,
  BG_COLOR: '#f5faff',
} as const

// ==========================================
// Store（延迟初始化）
// ==========================================
let bootstrapStore: Store<Record<string, unknown>>
let configStore: Store<Record<string, unknown>>

/**
 * 辅助函数：统一返回 configStore
 */
function resolveStore(_key: string): Store<Record<string, unknown>> {
  return configStore
}

async function initStores() {
  bootstrapStore = getBootstrapStore()
  configStore = createScopedStore('config', bootstrapStore)
}

/**
 * 确保应用配置文件存在，首次启动时自动创建
 * 配置文件路径: {userData}/.aweeclaw/aweeclaw-config.json
 */
function ensureAppConfig() {
  try {
    const configDir = path.join(getUserConfigDir(), '.aweeclaw')
    const configPath = path.join(configDir, 'aweeclaw-config.json')

    if (fs.existsSync(configPath)) return

    fs.mkdirSync(configDir, { recursive: true })
    const defaultConfig = {
      serverUrl: 'https://gateway.aweeclaw.com',
    }
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
    logger.system.info('[Main] App config created:', configPath)
  } catch (err) {
    logger.system.warn('[Main] Failed to create app config:', err)
  }
}

// ==========================================
// 全局状态
// ==========================================

const windows = new Map<number, BrowserWindow>()
const windowWorkspaces = new Map<number, string[]>()
let lastActiveWindow: BrowserWindow | null = null
const pendingShutdownRequests = new Map<string, (success: boolean) => void>()
const authorizedCloseWindows = new Set<number>()
let appQuitInProgress = false


// 延迟加载的模块
let ipcModule: typeof import('./bridge') | null = null
let lspManager = mainLspManager
let securityManager: typeof import('./guard').securityManager | null = null

ipcMain.handle('app:shutdown-response', (_event, requestId: string, success: boolean) => {
  const resolver = pendingShutdownRequests.get(requestId)
  if (!resolver) {
    return false
  }

  pendingShutdownRequests.delete(requestId)
  resolver(success)
  return true
})

async function requestRendererShutdown(
  win: BrowserWindow,
  reason: 'window-close' | 'app-quit',
  timeoutMs = 8000
): Promise<boolean> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    return true
  }

  const requestId = randomUUID()

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingShutdownRequests.delete(requestId)
      logger.system.warn('[Main] Renderer shutdown save timed out', { windowId: win.id, reason, requestId, timeoutMs })
      resolve(false)
    }, timeoutMs)

    pendingShutdownRequests.set(requestId, (success) => {
      clearTimeout(timeout)
      resolve(success)
    })

    try {
      win.webContents.send('app:shutdown-requested', { requestId, reason })
    } catch (error) {
      clearTimeout(timeout)
      pendingShutdownRequests.delete(requestId)
      logger.system.warn('[Main] Failed to notify renderer about shutdown request', { windowId: win.id, reason, error })
      resolve(false)
    }
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ==========================================
// 单例锁
// ==========================================

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ==========================================
// 窗口辅助函数
// ==========================================

function getMainWindow(windowId?: number): BrowserWindow | null {
  // 根据窗口 ID 获取窗口
  if (windowId !== undefined) {
    return windows.get(windowId) || null
  }
  // 如果没有指定窗口 ID，则返回最后一个活跃窗口
  return lastActiveWindow || Array.from(windows.values())[0] || null
}

function findWindowByWorkspace(roots: string[]): BrowserWindow | null {
  const normalized = roots.map(r => r.toLowerCase().replace(/\\/g, '/'))
  for (const [id, workspaceRoots] of windowWorkspaces) {
    const normalizedWs = workspaceRoots.map(r => r.toLowerCase().replace(/\\/g, '/'))
    if (normalized.some(root => normalizedWs.includes(root))) {
      const win = windows.get(id)
      if (win && !win.isDestroyed()) return win
    }
  }
  return null
}

// ==========================================
// 窗口创建
// ==========================================

function getThemeBackgroundColor(): string {
  try {
    const themeBg = configStore?.get('themeBg') as string;
    if (themeBg) {
      // If the color format is RGB with spaces like "18 18 21"
      if (themeBg.includes(' ')) {
        const [r, g, b] = themeBg.split(' ').map(Number);
        const toHex = (n: number) => n.toString(16).padStart(2, '0');
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        }
      }
      return themeBg; // Assuming it's already a valid hex color
    }

    // Fallback dictionary for older configurations before migration
    const themeId = configStore?.get('themeId') as string || BRAND.defaultTheme;
    const themes: Record<string, string> = {
      'aweeclaw-light': '#f5faff',
      'purple-light': '#f8f5ff',
      'lobster-red-light': '#fffcf9',
      'forest-green-light': '#f5fcfc',
      'aweeclaw-dark': '#161b22',
      'purple-dark': '#121215',
      'lobster-red-dark': '#140e0c',
      'forest-green-dark': '#0e1614',
    };
    return themes[themeId] || WINDOW_CONFIG.BG_COLOR;
  } catch {
    return WINDOW_CONFIG.BG_COLOR;
  }
}

function normalizeRgbColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim().replace(/\s+/g, ' ')
  if (/^\d{1,3}( \d{1,3}){2}$/.test(normalized)) {
    return normalized
  }

  if (/^#?[0-9a-fA-F]{6}$/.test(normalized)) {
    const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ].join(' ')
  }

  return fallback
}

function isLocalDevServerUrl(url: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{2,5})?(?:[/?#]|$)/i.test(url)
}

function isDevelopmentRuntime(): boolean {
  return !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL
}


function registerWindowDiagnostics(win: BrowserWindow): void {
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.system.error('[Window] did-fail-load', {
      windowId: win.id,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    })
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.system.error('[Window] render-process-gone', {
      windowId: win.id,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

}

function getShutdownFallbackPresentation(): ShutdownWindowPresentation {
  const themeBg = normalizeRgbColor(configStore?.get('themeBg'), '245 252 255')
  const themeType = (configStore?.get('themeId') as string || '').endsWith('-light') ? 'light' : 'dark'

  return {
    language: configStore?.get('language') === 'en' ? 'en' : 'zh',
    themeType,
    background: themeBg,
    surface: themeType === 'light' ? '248 249 250' : '25 25 29',
    border: themeType === 'light' ? '222 226 230' : '40 40 48',
    text: themeType === 'light' ? '33 37 41' : '242 242 247',
    muted: themeType === 'light' ? '134 142 150' : '161 161 180',
    accent: themeType === 'light' ? '37 99 235' : '139 92 246',
    success: themeType === 'light' ? '22 163 74' : '52 211 153',
    warning: themeType === 'light' ? '217 119 6' : '251 191 36',
  }
}

async function getShutdownPresentation(win?: BrowserWindow | null): Promise<ShutdownWindowPresentation> {
  const fallback = getShutdownFallbackPresentation()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return fallback
  }

  try {
    const snapshot = await win.webContents.executeJavaScript(`(() => {
      const root = document.documentElement
      const styles = getComputedStyle(root)
      const store = window.__ADNIFY_STORE__?.getState?.()
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
    logger.system.warn('[Main] Failed to read shutdown presentation snapshot', { error })
    return fallback
  }
}

function createWindow(isEmpty = false, deferLoad = false): BrowserWindow {
  // 根据平台选择正确的图标格式
  const getIconPath = () => {
    const platform = process.platform
    const brandIconDir = path.join(app.getAppPath(), 'public/brand/icons')
    if (platform === 'win32') return path.join(brandIconDir, 'app.ico')
    if (platform === 'darwin') return path.join(brandIconDir, 'app.icns')
    return path.join(brandIconDir, 'app.png')
  }
  const iconPath = getIconPath()

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  let winWidth: number, winHeight: number, winMinWidth: number, winMinHeight: number
  if (isEmpty) {
    winWidth = Math.round(screenWidth * 0.8)
    winHeight = Math.round(screenHeight * 0.8)
    winMinWidth = WINDOW_CONFIG.EMPTY_MIN_WIDTH
    winMinHeight = WINDOW_CONFIG.EMPTY_MIN_HEIGHT
  } else {
    winWidth = screenWidth
    winHeight = screenHeight
    winMinWidth = WINDOW_CONFIG.MIN_WIDTH
    winMinHeight = WINDOW_CONFIG.MIN_HEIGHT
  }

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: winMinWidth,
    minHeight: winMinHeight,
    frame: false,
    titleBarStyle: 'hiddenInset',
    icon: iconPath,
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

  // 添加 CSP 头以提升安全性
  // 注意：Monaco Editor 在 Electron 中硬性依赖 unsafe-eval，无法移除
  if (app.isPackaged) {
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' local-preview:",  // Monaco 编辑器硬性依赖 unsafe-eval
            "style-src 'self' 'unsafe-inline' local-preview:",
            "img-src 'self' data: https: blob: local-preview:",  // blob: 支持粘贴图片
            "connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:*",  // 自定义 AI Provider baseURL + 本地开发服务器 + WebSocket
            "frame-src 'self' http://127.0.0.1:* http://localhost:*",  // 仅允许本地开发服务器 iframe，禁止远程 iframe
            "child-src 'self' http://127.0.0.1:* http://localhost:*",
            "font-src 'self' data: local-preview:",
            "media-src 'self' local-preview:",
            "object-src 'none'",  // 禁止 <object>/<embed> 加载
            "base-uri 'self'",  // 防止 <base> 标签劫持
            "form-action 'self'",  // 防止表单提交到外部
          ].join('; ')
        }
      })
    })
  }

  // 等待 DOM 渲染完成后显示窗口，避免白屏闪烁
  win.webContents.once('dom-ready', () => {
    // 等待一帧（16ms）让 CSS 动画启动
    setTimeout(() => win.show(), 16)
  })

  // Mac 上确保 traffic lights 始终显示
  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(true)
  }

  registerWindowDiagnostics(win)

  const windowId = win.id
  windows.set(windowId, win)
  lastActiveWindow = win

  // 窗口事件
  win.on('focus', () => {
    lastActiveWindow = win
  })

  win.on('close', (event) => {
    if (authorizedCloseWindows.delete(windowId) || appQuitInProgress) {
      logger.system.info(`[Main] Window ${windowId} close event allowed`)
      return
    }

    event.preventDefault()
    logger.system.info(`[Main] Window ${windowId} close event intercepted for state save`)

    void (async () => {
      const isLastWindowQuit = process.platform !== 'darwin' && windows.size === 1
      const shutdownReason = isLastWindowQuit ? 'app-quit' : 'window-close'
      const presentation = await getShutdownPresentation(win)
      await shutdownWindowController.show(shutdownReason, presentation, win)
      const success = await requestRendererShutdown(win, shutdownReason)
      await shutdownWindowController.update(shutdownReason, success ? 'done' : 'error')

      if (isLastWindowQuit) {
        appQuitInProgress = true
        await withTimeout(performGlobalCleanup(), 5000, 'performGlobalCleanup total')
      }

      if (win.isDestroyed()) return
      authorizedCloseWindows.add(windowId)
      win.close()
      await sleep(success ? 700 : 1100)
      await shutdownWindowController.close()

      if (isLastWindowQuit) {
        isCleanupDone = true
        logger.system.info('[Main] Last window close cleanup done, finalizing app quit')
        app.quit()
      }
    })()
  })

  // 在 close 事件中提前捕获 webContentsId（closed 时 webContents 可能已销毁）
  let cachedWebContentsId: number | undefined
  win.on('close', () => {
    cachedWebContentsId = win.webContents?.id
  })

  win.on('closed', () => {
    if (cachedWebContentsId) {
      void cleanupFileWatcher(`window-${cachedWebContentsId}`)
    }
    // 清理该窗口关联的 LLM 服务（中止活跃流、释放 AbortController）
    if (cachedWebContentsId && ipcModule) {
      try { ipcModule.cleanupLLMService(cachedWebContentsId) } catch { /* ignore */ }
    }

    windows.delete(windowId)
    windowWorkspaces.delete(windowId)
    logger.system.info(`[Main] Window ${windowId} closed and removed from map. Remaining: ${windows.size}`)

    if (lastActiveWindow === win) {
      lastActiveWindow = Array.from(windows.values())[0] || null
    }
  })

  // 快捷键：仅处理需要在主进程层面拦截的场景
  // （Command Palette 需要在 Web 内容区域外也能触发，故保留在此）
  // DevTools 由菜单 role:toggleDevTools 自动处理，无需在此注册
  win.webContents.on('before-input-event', (_, input) => {
    if (input.type !== 'keyDown') return
    if (((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'p') || input.key === 'F1') {
      win.webContents.send('workbench:execute-command', 'workbench.action.showCommands')
    }
  })

  // 外部链接处理（统一走 safeOpenExternal）
  const openUrlSafely = (rawUrl: string) => {
    safeOpenExternal(rawUrl)
  }

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

  // 加载页面（deferLoad 时跳过，由外部调用 loadWindowContent 加载）
  if (!deferLoad) {
    loadWindowContent(win, isEmpty)
  }

  return win
}

/** 加载窗口页面内容 */
function loadWindowContent(win: BrowserWindow, isEmpty: boolean) {
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: isEmpty ? { empty: '1' } : undefined
    })
  } else {
    win.loadURL(`http://localhost:5173${isEmpty ? '?empty=1' : ''}`)
  }
}

/**
 * 集中处理应用退出时的异步清理逻辑
 */
let cleanupStarted = false
/** 带超时的 Promise 包装，防止清理阶段无限挂起 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>(resolve => setTimeout(() => {
      logger.system.warn(`[Main] Cleanup timeout (${ms}ms): ${label}`)
      resolve()
    }, ms))
  ])
}

async function performGlobalCleanup() {
  if (cleanupStarted) return
  cleanupStarted = true

  logger.system.info('[Main] Starting global cleanup...')
  try {
    // 1. 清理 IPC 处理器（包括终端）
    ipcModule?.cleanupAllHandlers()
    // 2. 停止所有 LSP 服务器（超时 3 秒）
    await withTimeout(
      lspManager?.stopAllServers() ?? Promise.resolve(),
      3000, 'LSP stopAllServers'
    )
    // 3. 停止所有调试会话（超时 2 秒）
    await withTimeout(
      import('./modules/dap-adapter').then(m => m.debugService.stopAll()).catch(() => { }),
      2000, 'DebugService stopAll'
    )
    // 4. 销毁所有 IndexService Worker 线程
    try {
      destroyIndexService()
    } catch { /* ignore */ }
    // 5. 停止 Cron 调度器
    try {
      const { cronScheduler } = await import('./modules/automation/CronScheduler')
      cronScheduler.stop()
    } catch { /* ignore */ }
    // 6. 停止 Session 生命周期管理器
    try {
      const { sessionLifecycleManager } = await import('./modules/session/SessionLifecycleManager')
      sessionLifecycleManager.stop()
    } catch { /* ignore */ }
    // 7. 停止 Gateway 客户端
    try {
      const { gatewayClient } = await import('./modules/gateway/GatewayClient')
      await gatewayClient.stop()
    } catch { /* ignore */ }
    // 8. 刷新模块数据持久化存储
    try {
      const { moduleDataStore } = await import('./modules/persistence/ModuleDataStore')
      moduleDataStore.flush()
    } catch { /* ignore */ }
    logger.system.info('[Main] Global cleanup completed successfully')
  } catch (err) {
    logger.system.error('[Main] Global cleanup error:', err)
  }
}


// ==========================================
// 模块加载（后台异步）
// ==========================================

async function initializeModules(firstWin: BrowserWindow) {
  // 并行加载所有模块
  const [ipc, security, windowIpc, updaterService] = await Promise.all([
    import('./bridge'),
    import('./guard'),
    import('./bridge/windowLifecycle'),
    import('./modules/auto-update'),
  ])

  ipcModule = ipc
  securityManager = security.securityManager

  // 从配置加载自定义 LSP 安装路径
  const customLspPath = configStore.get('lspSettings.customBinDir') as string | undefined
  if (customLspPath) {
    setCustomLspBinDir(customLspPath)
  }

  // 窗口控制已在创建窗口前注册，此处仅确保 window:new 等依赖 createWindow 的 handler 生效
  windowIpc.registerWindowHandlers(createWindow)

  // 更新服务：IPC 已在创建窗口前注册，此处仅初始化主窗口引用
  updaterService.updateService.initialize(firstWin)

  // 配置安全模块
  const securityConfig = configStore.get('securitySettings', {
    enablePermissionConfirm: true,
    strictWorkspaceMode: true,
    allowedShellCommands: [...SECURITY_DEFAULTS.SHELL_COMMANDS],
    allowedGitSubcommands: [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS],
  }) as any

  securityManager.updateConfig(securityConfig)
  security.updateWhitelist(
    securityConfig.allowedShellCommands || [...SECURITY_DEFAULTS.SHELL_COMMANDS],
    securityConfig.allowedGitSubcommands || [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS]
  )

  // 注册 IPC 处理器
  ipc.registerAllHandlers({
    getMainWindow,
    createWindow,
    resolveStore,
    credentialsStore: configStore,
    preferencesStore: configStore,
    workspaceMetaStore: configStore,
    bootstrapStore,
    findWindowByWorkspace,
    setWindowWorkspace: (id: number, roots: string[]) => windowWorkspaces.set(id, roots),
    getWindowWorkspace: (id: number) => windowWorkspaces.get(id) || null,
  })

  // 系统唤醒后通知渲染进程刷新 token
  try {
    const { powerMonitor } = await import('electron')
    powerMonitor.on('resume', () => {
      logger.system.info('[Main] System resumed from sleep, notifying renderer to refresh token')
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('system:resume')
      }
    })
  } catch (err) {
    logger.system.warn('[Main] powerMonitor setup skipped:', err instanceof Error ? err.message : String(err))
  }

  // 初始化设置数据库（渠道配置等依赖此数据库）
  try {
    const { SettingsDb } = await import('./modules/settings-db/SettingsDb')
    const db = SettingsDb.getInstance()
    await db.initialize()
    logger.system.info('[Main] Settings DB initialized')
  } catch (err) {
    logger.system.warn('[Main] Settings DB init skipped:', err instanceof Error ? err.message : String(err))
  }

  // 初始化模块数据持久化存储（Agent bindings / Cron tasks / Session contexts）
  try {
    const { moduleDataStore } = await import('./modules/persistence/ModuleDataStore')
    moduleDataStore.load()
    logger.system.info('[Main] Module data store loaded')
  } catch (err) {
    logger.system.warn('[Main] Module data store load skipped:', err instanceof Error ? err.message : String(err))
  }

  // 恢复 Agent 路由器的持久化数据
  try {
    const { agentRouter } = await import('./modules/agent/AgentRouter')
    agentRouter.restoreFromStore()
    logger.system.info('[Main] Agent router restored from store')
  } catch (err) {
    logger.system.warn('[Main] Agent router restore skipped:', err instanceof Error ? err.message : String(err))
  }

  // 启动 Session 生命周期管理器
  try {
    const { sessionLifecycleManager } = await import('./modules/session/SessionLifecycleManager')
    sessionLifecycleManager.start()
    logger.system.info('[Main] Session lifecycle manager started')
  } catch (err) {
    logger.system.warn('[Main] Session lifecycle manager start skipped:', err instanceof Error ? err.message : String(err))
  }

  // 启动 Cron 调度器（恢复持久化任务后启动）
  try {
    const { cronScheduler } = await import('./modules/automation/CronScheduler')
    const { registerAutomationEventListeners } = await import('./bridge/automation')
    cronScheduler.restoreFromStore()
    cronScheduler.start()
    registerAutomationEventListeners()
    logger.system.info('[Main] Cron scheduler started')
  } catch (err) {
    logger.system.warn('[Main] Cron scheduler start skipped:', err instanceof Error ? err.message : String(err))
  }

  // 非阻塞初始化渠道服务（连接在后台异步进行，不阻塞应用启动）
  try {
    // 先初始化 Plugin Registry（ChannelPluginRegistrar 依赖它）
    const { getPluginRegistry } = await import('./modules/plugin-sdk/PluginRegistry')
    const userDataPath = app.getPath('userData')
    getPluginRegistry(path.join(userDataPath, 'plugins'))

    const { channelService } = await import('./modules/messaging')
    channelService.init().then(() => {
      logger.system.info('[Main] Channel service initialized (background)')
    }).catch(err => {
      logger.system.warn('[Main] Channel service init failed:', err instanceof Error ? err.message : String(err))
    })
  } catch (err) {
    logger.system.warn('[Main] Channel service import skipped:', err instanceof Error ? err.message : String(err))
  }

  // 异步初始化 Python 环境（不阻塞启动）
  try {
    const { pythonManager } = await import('./modules/python-runtime')
    pythonManager.ensureReady().then((status) => {
      if (status.ready) {
        logger.system.info('[Main] Python environment ready:', { pythonPath: status.pythonPath, source: status.source, version: status.version })
      } else {
        logger.system.warn('[Main] Python environment not available:', status.error)
      }
    }).catch((err) => {
      logger.system.warn('[Main] Python environment setup failed:', err)
    })
  } catch (err) {
    logger.system.warn('[Main] Python manager import skipped:', err instanceof Error ? err.message : String(err))
  }

  // 全局：当前应用语言
  let currentAppLanguage: Language = 'zh'

  /** 从配置加载并返回当前语言 */
  function getCurrentLanguage(): Language {
    const lang = configStore.get('language') as string
    // 兼容写法：en / zh
    if (lang?.toLowerCase().includes('en')) return 'en'
    return 'zh'
  }

  /** 设置应用菜单（多语言自动适配） */
  function setApplicationMenu(lang?: Language) {
    if (lang) currentAppLanguage = lang;
    const isEn = currentAppLanguage.toLowerCase().includes("en");

    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
      {
        label: isEn ? "File" : "文件",
        submenu: [{ role: "quit", label: isEn ? "Quit" : "退出" }],
      },
      {
        label: isEn ? "Edit" : "编辑",
        submenu: [
          { role: "undo", label: isEn ? "Undo" : "撤销" },
          { role: "redo", label: isEn ? "Redo" : "重做" },
          { type: "separator" },
          { role: "cut", label: isEn ? "Cut" : "剪切" },
          { role: "copy", label: isEn ? "Copy" : "复制" },
          { role: "paste", label: isEn ? "Paste" : "粘贴" },
          { role: "selectAll", label: isEn ? "DropdownSelector All" : "全选" },
        ],
      },
      {
        label: isEn ? "View" : "视图",
        submenu: [
          { role: "reload", label: isEn ? "Reload" : "刷新" },
          { role: "forceReload", label: isEn ? "Force Reload" : "强制刷新" },
          { role: "toggleDevTools", label: isEn ? "DevTools" : "开发者工具" },
          { type: "separator" },
          { role: "resetZoom", label: isEn ? "Reset Zoom" : "重置缩放" },
          { role: "zoomIn", label: isEn ? "Zoom In" : "放大" },
          { role: "zoomOut", label: isEn ? "Zoom Out" : "缩小" },
          { type: "separator" },
          { role: "togglefullscreen", label: isEn ? "Full Screen" : "全屏" },
          {
            label: isEn ? "Command Palette" : "命令面板",
            accelerator: "CmdOrCtrl+Shift+P",
            click: () => {
              const win = getMainWindow();
              win?.webContents.send(
                "workbench:execute-command",
                "workbench.action.showCommands",
              );
            },
          },
        ],
      },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  }
  /** 初始化语言：读取配置 + 设置菜单 + 监听切换 */
  function initLanguageSync() {
    // 1. 启动时从配置读取语言
    currentAppLanguage = getCurrentLanguage()
    setApplicationMenu(currentAppLanguage)

    // 2. 监听渲染进程：语言切换
    ipcMain.on('i18n:changed', (_event, lang: Language) => {
      // 保存到配置
      configStore.set('language', lang)
      // 更新主进程语言
      setApplicationMenu(lang)
      // 可选：通知所有窗口语言已更新
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('i18n:sync', lang)
      })
    })
  }
  // 👇 最后加这一行
  initLanguageSync()
}

// ==========================================
// 错误处理（捕获原生模块异常）
// ==========================================

// 捕获未处理的异常（包括原生模块异常）
process.on('uncaughtException', (error: Error) => {
  logger.system.error('[Main] Uncaught Exception:', error)

  // 如果是 node-pty 相关的错误，提供更友好的提示
  if (error.message?.includes('Napi::Error') || error.message?.includes('node-pty')) {
    logger.system.error('[Main] node-pty native module error detected. Please run: npm run rebuild')
  }

  // 不退出应用，让用户继续使用其他功能
  // 只在开发模式下显示错误
  if (!app.isPackaged) {
    console.error('Uncaught exception:', error)
  }
})

// 捕获未处理的 Promise 拒绝
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.system.error('[Main] Unhandled Rejection:', reason)

  if (!app.isPackaged) {
    console.error('Unhandled rejection at:', promise, 'reason:', reason)
  }
})

// ==========================================
// 应用生命周期
// ==========================================

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-preview',
    privileges: {
      bypassCSP: true,
      allowServiceWorkers: false,
      supportFetchAPI: true,
      stream: true,
      standard: false,
      secure: true,
      corsEnabled: false,
    },
  },
])

app.whenReady().then(async () => {
  protocol.handle('local-preview', (request) => {
    const url = new URL(request.url)
    let filePath = decodeURIComponent(url.pathname)
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1)
    }
    if (!filePath) {
      return new Response('Bad Request', { status: 400 })
    }
    const normalized = path.resolve(filePath)
    const sensitive = ['/etc', '/proc', '/sys', '/dev', 'C:\\Windows\\System32']
    if (sensitive.some(s => normalized.startsWith(s))) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(`file://${normalized}`)
  })
  // 1. 初始化 Store（必须在模块加载前完成）
  await initStores()

  // 1.1 确保应用配置文件存在（首次启动自动创建）
  ensureAppConfig()

  // 2. 检查是否启用文件日志
  const appSettings = configStore.get('app-settings') as any
  const enableFileLogging = appSettings?.enableFileLogging ?? false
  logger.system.info('[Main] File logging setting loaded:', { enableFileLogging, type: typeof enableFileLogging })

  if (enableFileLogging) {
    const logPath = path.join(getUserConfigDir(), 'logs', 'main.log')
    logger.enableFileLogging(logPath)
    logger.system.info('[Main] File logging enabled', {
      logPath,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
    })
  } else {
    logger.system.info('[Main] File logging is disabled')
  }

  // 3. 先注册窗口与更新 IPC，避免渲染进程加载时 handler 未就绪（setTheme / updater 等）
  const { registerWindowHandlers } = await import('./bridge/windowLifecycle')
  registerWindowHandlers(createWindow)
  const { registerUpdaterHandlers } = await import('./bridge/updateManager')
  registerUpdaterHandlers()

  // 4. 创建窗口（此时不加载页面内容，等模块初始化完成后再加载）
  const firstWin = createWindow(false, true)

  // 5. 初始化模块（等待完成，确保所有 IPC handler 就绪后再加载页面）
  try {
    await initializeModules(firstWin)
  } catch (err) {
    logger.system.error('[Main] Module initialization failed:', err)
  }

  // 6. 模块就绪，加载页面内容
  loadWindowContent(firstWin, false)
})

app.on('second-instance', () => {
  const win = getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  } else {
    createWindow(false)
  }
})

app.on('window-all-closed', () => {
  logger.system.info('[Main] All windows closed, platform:', process.platform)
  if (appQuitInProgress && !isCleanupDone) {
    return
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * 应用退出前的生命周期钩子
 * 在该阶段拦截退出信号并执行异步清理
 */
let isCleanupDone = false
app.on('before-quit', async (e) => {
  if (isDevelopmentRuntime() && !isCleanupDone) {
    appQuitInProgress = true
    isCleanupDone = true
    logger.system.info('[Main] Skipping shutdown cleanup during development hot restart')
    return
  }

  if (!isCleanupDone) {
    e.preventDefault()
    logger.system.info('[Main] Intercepting before-quit for cleanup')

    appQuitInProgress = true

    const mainWindow = getMainWindow()
    const presentation = await getShutdownPresentation(mainWindow)
    await shutdownWindowController.show('app-quit', presentation, mainWindow)

    const openWindows = [...windows.values()].filter(win => !win.isDestroyed())
    const results = await Promise.all(openWindows.map(async (win) => {
      const success = await requestRendererShutdown(win, 'app-quit')
      authorizedCloseWindows.add(win.id)
      return success
    }))
    const allSucceeded = results.every(Boolean)
    await shutdownWindowController.update('app-quit', allSucceeded ? 'done' : 'error')

    // 总超时 5 秒，防止清理无限挂起导致应用无法退出
    await withTimeout(performGlobalCleanup(), 5000, 'performGlobalCleanup total')

    openWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.close()
      }
    })

    await sleep(allSucceeded ? 700 : 1100)
    await shutdownWindowController.close()

    isCleanupDone = true
    logger.system.info('[Main] Cleanup done, re-triggering app.quit()')
    app.quit()
  }
})

app.on('activate', () => { if (windows.size === 0) createWindow() })
