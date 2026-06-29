/**
 * AweeClaw 主进程入口
 *
 * 仅负责应用生命周期编排与模块间协调，具体职责委托到 bootstrap/ 下的子模块：
 * - stores.ts             Store 初始化
 * - appConfig.ts          应用配置文件首次创建
 * - localPreviewProtocol.ts  local-preview 协议
 * - windowManager.ts      窗口创建与生命周期
 * - shutdownCoordinator.ts   渲染进程关闭协调
 * - globalCleanup.ts      退出时全局清理
 * - moduleInitializer.ts  后台模块初始化
 */
import { app } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { getUserConfigDir } from './modules/configPath'
import {
  shutdownWindowController,
} from './modules/lifecycle/GracefulShutdownController'
import { initStores, getConfigStore } from './bootstrap/stores'
import { ensureAppConfig } from './bootstrap/appConfig'
import {
  registerLocalPreviewScheme,
  registerLocalPreviewHandler,
} from './bootstrap/localPreviewProtocol'
import {
  createWindow,
  loadWindowContent,
  getMainWindow,
  getOpenWindows,
  authorizeWindowClose,
  setQuitStateController,
  getShutdownPresentation,
  type QuitStateController,
} from './bootstrap/windowManager'
import { requestRendererShutdown } from './bootstrap/shutdownCoordinator'
import { performGlobalCleanup, withTimeout } from './bootstrap/globalCleanup'
import { initializeModules } from './bootstrap/moduleInitializer'

// 重新导出 Language 类型，保持向后兼容（menu 模块从 appBootstrap 导入）
export type { Language } from './bootstrap/moduleInitializer'

// ==========================================
// 全局退出状态
// ==========================================

let appQuitInProgress = false
let isCleanupDone = false

/** 注入到 windowManager 的退出状态控制器 */
const quitStateController: QuitStateController = {
  isAppQuitting: () => appQuitInProgress,
  markAppQuitting: () => {
    appQuitInProgress = true
  },
  markCleanupDone: () => {
    isCleanupDone = true
  },
}

// ==========================================
// 开发环境判定
// ==========================================

function isDevelopmentRuntime(): boolean {
  return !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ==========================================
// 单例锁（必须在模块加载时立即执行）
// ==========================================

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// 注入退出状态控制器
setQuitStateController(quitStateController)

// 注册 local-preview 协议为 privileged（必须在 app ready 之前）
registerLocalPreviewScheme()

// ==========================================
// 全局异常处理
// ==========================================

process.on('uncaughtException', (error: Error) => {
  logger.system.error('[Main] Uncaught Exception:', error)

  // node-pty 原生模块异常时给出更友好的提示
  if (error.message?.includes('Napi::Error') || error.message?.includes('node-pty')) {
    logger.system.error('[Main] node-pty native module error detected. Please run: npm run rebuild')
  }

  if (!app.isPackaged) {
    console.error('Uncaught exception:', error)
  }
})

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.system.error('[Main] Unhandled Rejection:', reason)
  if (!app.isPackaged) {
    console.error('Unhandled rejection at:', promise, 'reason:', reason)
  }
})

// ==========================================
// 应用生命周期：whenReady
// ==========================================

app.whenReady().then(async () => {
  // 1. 注册 local-preview 协议处理器
  registerLocalPreviewHandler()

  // 2. 初始化 Store（必须在模块加载前完成）
  await initStores()

  // 3. 确保应用配置文件存在（首次启动自动创建）
  ensureAppConfig()

  // 4. 文件日志（按配置开启）
  setupFileLogging()

  // 5. 先注册窗口与更新 IPC，避免渲染进程加载时 handler 未就绪
  const { registerWindowHandlers } = await import('./bridge/window/windowLifecycle')
  registerWindowHandlers(createWindow)
  const { registerUpdaterHandlers } = await import('./bridge/window/updateManager')
  registerUpdaterHandlers()

  // 6. 创建窗口（此时不加载页面内容，等模块初始化完成后再加载）
  const firstWin = createWindow(false, true)

  // 7. 初始化模块（等待完成，确保所有 IPC handler 就绪后再加载页面）
  try {
    await initializeModules(firstWin)
  } catch (err) {
    logger.system.error('[Main] Module initialization failed:', err)
  }

  // 8. 模块就绪，加载页面内容
  loadWindowContent(firstWin, false)
})

// ==========================================
// 应用生命周期：second-instance
// ==========================================

app.on('second-instance', () => {
  const win = getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  } else {
    createWindow(false)
  }
})

// ==========================================
// 应用生命周期：window-all-closed
// ==========================================

app.on('window-all-closed', () => {
  logger.system.info('[Main] All windows closed, platform:', process.platform)
  // 应用正在退出但清理未完成时，阻止默认退出逻辑（由 before-quit 流程接管）
  if (appQuitInProgress && !isCleanupDone) {
    return
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ==========================================
// 应用生命周期：before-quit
// ==========================================

/**
 * 应用退出前拦截，执行异步清理流程：
 * 1. 显示关闭界面
 * 2. 通知所有渲染进程保存状态
 * 3. 执行全局清理（5s 超时）
 * 4. 关闭所有窗口
 * 5. 再次触发 app.quit() 真正退出
 */
app.on('before-quit', async (e) => {
  // 开发环境热重载时跳过清理流程
  if (isDevelopmentRuntime() && !isCleanupDone) {
    appQuitInProgress = true
    isCleanupDone = true
    logger.system.info('[Main] Skipping shutdown cleanup during development hot restart')
    return
  }

  if (isCleanupDone) return

  e.preventDefault()
  logger.system.info('[Main] Intercepting before-quit for cleanup')

  appQuitInProgress = true

  const mainWindow = getMainWindow()
  const presentation = await getShutdownPresentation(mainWindow)
  await shutdownWindowController.show('app-quit', presentation, mainWindow)

  const openWindows = getOpenWindows()
  const results = await Promise.all(
    openWindows.map(async (win) => {
      const success = await requestRendererShutdown(win, 'app-quit')
      authorizeWindowClose(win.id)
      return success
    }),
  )
  const allSucceeded = results.every(Boolean)
  await shutdownWindowController.update('app-quit', allSucceeded ? 'done' : 'error')

  // 总超时 5 秒，防止清理无限挂起导致应用无法退出
  await withTimeout(performGlobalCleanup(), 5000, 'performGlobalCleanup total')

  openWindows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.close()
    }
  })

  await sleep(allSucceeded ? 700 : 1100)
  await shutdownWindowController.close()

  isCleanupDone = true
  logger.system.info('[Main] Cleanup done, re-triggering app.quit()')
  app.quit()
})

// ==========================================
// 应用生命周期：activate（macOS）
// ==========================================

app.on('activate', () => {
  // macOS 点击 Dock 图标时若无窗口则新建
  if (getOpenWindows().length === 0) {
    createWindow()
  }
})

// ==========================================
// 辅助函数
// ==========================================

/** 配置文件日志输出 */
function setupFileLogging(): void {
  const appSettings = getConfigStore().get('app-settings') as { enableFileLogging?: boolean } | undefined
  const enableFileLogging = appSettings?.enableFileLogging ?? false

  logger.system.info('[Main] File logging setting loaded:', {
    enableFileLogging,
    type: typeof enableFileLogging,
  })

  if (!enableFileLogging) {
    logger.system.info('[Main] File logging is disabled')
    return
  }

  const logPath = path.join(getUserConfigDir(), 'logs', 'main.log')
  logger.enableFileLogging(logPath)
  logger.system.info('[Main] File logging enabled', {
    logPath,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
  })
}
