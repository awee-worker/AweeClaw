/**
 * 后台模块初始化编排
 *
 * 在窗口创建后、内容加载前，按依赖顺序初始化所有主进程模块：
 *
 * 1. 核心服务：IPC / Security / LSP / Window IPC / Updater
 * 2. 系统级：powerMonitor（系统唤醒通知渲染端）
 * 3. 持久化：SettingsDb / ModuleDataStore / AgentRouter
 * 4. 生命周期：SessionLifecycleManager / CronScheduler
 * 5. 后台异步：ChannelService / Python / PluginRegistry / DesktopControlPlugin
 * 6. 菜单与语言同步
 *
 * 关键模块同步等待完成（确保 IPC handler 就绪后再加载页面），
 * 次要模块异步初始化不阻塞启动。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { SECURITY_DEFAULTS } from '@shared/appConstants'
import { setCustomLspBinDir } from '../language-server/serverInstaller'
import { lspManager as mainLspManager } from '../language-server/languageServerManager'
import { createMenuBuilder, type MenuBuilder as MenuBuilderType } from '../menu/menuBuilder'
import { getConfigStore, getBootstrapStoreInstance } from './stores'
import {
  getMainWindow,
  createWindow,
  findWindowByWorkspace,
  setWindowWorkspace,
  getWindowWorkspace,
} from './windowManager'
import { setIpcModuleForWindow } from './windowManager'
import { setIpcModule as setIpcModuleForCleanup } from './globalCleanup'

export type Language = 'zh' | 'en'

/** 从错误中提取消息字符串 */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 初始化所有主进程模块。必须在窗口创建后、内容加载前调用。
 *
 * @param firstWin 应用首个主窗口
 */
export async function initializeModules(firstWin: BrowserWindow): Promise<void> {
  // ==========================================
  // 1. 核心服务（同步等待）
  // ==========================================
  const [ipc, security, windowIpc, updaterService] = await Promise.all([
    import('../bridge/core'),
    import('../guard'),
    import('../bridge/window/windowLifecycle'),
    import('../modules/auto-update'),
  ])

  // IPC 模块句柄同时注入到 windowManager 和 globalCleanup，用于 closed 和退出时清理
  setIpcModuleForWindow(ipc)
  setIpcModuleForCleanup(ipc)

  const securityManager = security.securityManager
  const configStore = getConfigStore()

  // 从配置加载自定义 LSP 安装路径
  const customLspPath = configStore.get('lspSettings.customBinDir') as string | undefined
  if (customLspPath) {
    setCustomLspBinDir(customLspPath)
  }

  // 窗口控制已在创建窗口前注册，此处仅确保 window:new 等依赖 createWindow 的 handler 生效
  windowIpc.registerWindowHandlers(createWindow)

  // 更新服务：IPC 已在创建窗口前注册，此处仅初始化主窗口引用
  updaterService.updateService.initialize(firstWin)

  // ==========================================
  // 2. 安全模块配置
  // ==========================================
  const securityConfig = configStore.get('securitySettings', {
    enablePermissionConfirm: true,
    strictWorkspaceMode: true,
    allowedShellCommands: [...SECURITY_DEFAULTS.SHELL_COMMANDS],
    allowedGitSubcommands: [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS],
  }) as {
    enablePermissionConfirm: boolean
    strictWorkspaceMode: boolean
    allowedShellCommands?: string[]
    allowedGitSubcommands?: string[]
  }

  securityManager.updateConfig(securityConfig)
  security.updateWhitelist(
    securityConfig.allowedShellCommands || [...SECURITY_DEFAULTS.SHELL_COMMANDS],
    securityConfig.allowedGitSubcommands || [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS],
  )

  // ==========================================
  // 3. 注册 IPC 处理器
  // ==========================================
  ipc.registerAllHandlers({
    getMainWindow,
    createWindow,
    resolveStore: (_key: string) => configStore,
    credentialsStore: configStore,
    preferencesStore: configStore,
    workspaceMetaStore: configStore,
    bootstrapStore: getBootstrapStoreInstance(),
    findWindowByWorkspace,
    setWindowWorkspace,
    getWindowWorkspace,
  })

  // ==========================================
  // 4. 系统唤醒通知（非阻塞）
  // ==========================================
  initPowerMonitor()

  // ==========================================
  // 5. 持久化与服务恢复
  // ==========================================
  await initSettingsDb()
  await loadModuleDataStore()
  await restoreAgentRouter()
  await startSessionLifecycleManager()
  await startCronScheduler()

  // ==========================================
  // 6. 后台异步初始化（不阻塞启动）
  // ==========================================
  initChannelService()
  initPythonRuntime()
  initDesktopControlPlugin()

  // ==========================================
  // 7. 应用菜单与语言同步
  // ==========================================
  initLanguageSync()
}

// ==========================================
// 子初始化函数
// ==========================================

/** powerMonitor：系统从睡眠唤醒后通知渲染端刷新 token */
function initPowerMonitor(): void {
  try {
    import('electron').then(({ powerMonitor }) => {
      powerMonitor.on('resume', () => {
        logger.system.info('[Main] System resumed from sleep, notifying renderer to refresh token')
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('system:resume')
        }
      })
    })
  } catch (err) {
    logger.system.warn('[Main] powerMonitor setup skipped:', errMsg(err))
  }
}

/** 初始化设置数据库（渠道配置等依赖此数据库） */
async function initSettingsDb(): Promise<void> {
  try {
    const { SettingsDb } = await import('../modules/settings-db/SettingsDb')
    const db = SettingsDb.getInstance()
    await db.initialize()
    logger.system.info('[Main] Settings DB initialized')
  } catch (err) {
    logger.system.warn('[Main] Settings DB init skipped:', errMsg(err))
  }
}

/** 加载模块数据持久化存储（Agent bindings / Cron tasks / Session contexts） */
async function loadModuleDataStore(): Promise<void> {
  try {
    const { moduleDataStore } = await import('../modules/persistence/ModuleDataStore')
    moduleDataStore.load()
    logger.system.info('[Main] Module data store loaded')
  } catch (err) {
    logger.system.warn('[Main] Module data store load skipped:', errMsg(err))
  }
}

/** 恢复 Agent 路由器的持久化数据 */
async function restoreAgentRouter(): Promise<void> {
  try {
    const { agentRouter } = await import('../modules/agent/AgentRouter')
    agentRouter.restoreFromStore()
    logger.system.info('[Main] Agent router restored from store')
  } catch (err) {
    logger.system.warn('[Main] Agent router restore skipped:', errMsg(err))
  }
}

/** 启动 Session 生命周期管理器 */
async function startSessionLifecycleManager(): Promise<void> {
  try {
    const { sessionLifecycleManager } = await import('../modules/session/SessionLifecycleManager')
    sessionLifecycleManager.start()
    logger.system.info('[Main] Session lifecycle manager started')
  } catch (err) {
    logger.system.warn('[Main] Session lifecycle manager start skipped:', errMsg(err))
  }
}

/** 启动 Cron 调度器（恢复持久化任务后启动） */
async function startCronScheduler(): Promise<void> {
  try {
    const { cronScheduler } = await import('../modules/automation/CronScheduler')
    const { registerAutomationEventListeners } = await import('../bridge/system/automation')
    cronScheduler.restoreFromStore()
    cronScheduler.start()
    registerAutomationEventListeners()
    logger.system.info('[Main] Cron scheduler started')
  } catch (err) {
    logger.system.warn('[Main] Cron scheduler start skipped:', errMsg(err))
  }
}

/** 非阻塞初始化渠道服务（连接在后台异步进行） */
function initChannelService(): void {
  import('../modules/messaging')
    .then(({ channelService }) => {
      // 先初始化 Plugin Registry（ChannelPluginRegistrar 依赖它）
      return initPluginRegistry().then(() => channelService.init())
    })
    .then(() => {
      logger.system.info('[Main] Channel service initialized (background)')
    })
    .catch((err) => {
      logger.system.warn('[Main] Channel service init failed:', errMsg(err))
    })
}

/** 初始化 Plugin Registry */
async function initPluginRegistry(): Promise<void> {
  try {
    const { getPluginRegistry } = await import('../modules/plugin-sdk/PluginRegistry')
    const userDataPath = app.getPath('userData')
    getPluginRegistry(path.join(userDataPath, 'plugins'))
  } catch (err) {
    logger.system.warn('[Main] Plugin registry init skipped:', errMsg(err))
  }
}

/** 注册内置桌面控制插件 */
function initDesktopControlPlugin(): void {
  import('../modules/plugin-sdk/PluginRegistry')
    .then(async ({ getPluginRegistry }) => {
      const { builtinDesktopPluginFactory } = await import(
        '../modules/plugin-sdk/builtin/DesktopControlPlugin'
      )
      const userDataPath = app.getPath('userData')
      const pluginRegistry = getPluginRegistry(path.join(userDataPath, 'plugins'))
      pluginRegistry.registerBuiltin(
        builtinDesktopPluginFactory.getManifest(),
        (ctx) => builtinDesktopPluginFactory.create(ctx),
      )
      await pluginRegistry.load('desktop-builtin')
      await pluginRegistry.initialize('desktop-builtin')
      logger.system.info('[Main] Built-in desktop control plugin registered')
    })
    .catch((err) => {
      logger.system.warn('[Main] Desktop control plugin registration failed:', errMsg(err))
    })
}

/** 异步初始化 Python 环境（不阻塞启动） */
function initPythonRuntime(): void {
  import('../modules/python-runtime')
    .then(({ pythonManager }) => pythonManager.ensureReady())
    .then((status) => {
      if (status.ready) {
        logger.system.info('[Main] Python environment ready:', {
          pythonPath: status.pythonPath,
          source: status.source,
          version: status.version,
        })
      } else {
        logger.system.warn('[Main] Python environment not available:', status.error)
      }
    })
    .catch((err) => {
      logger.system.warn('[Main] Python environment setup failed:', err)
    })
}

// ==========================================
// 应用菜单与语言同步
// ==========================================

let currentAppLanguage: Language = 'zh'
let menuBuilder: MenuBuilderType | null = null

/** 从配置读取当前语言 */
function getCurrentLanguage(): Language {
  const lang = getConfigStore().get('language') as string
  if (lang?.toLowerCase().includes('en')) return 'en'
  return 'zh'
}

/** 初始化应用菜单系统 */
async function initApplicationMenu(): Promise<void> {
  currentAppLanguage = getCurrentLanguage()

  menuBuilder = createMenuBuilder({
    getWin: () => getMainWindow(),
    getRecentWorkspaces: async () => {
      const paths = (getConfigStore().get('recentWorkspaces', []) as string[]) || []
      return paths.map((p) => ({
        path: p,
        name: p.split(/[\\/]/).pop() || p,
      }))
    },
    onClearRecentWorkspaces: async () => {
      getConfigStore().set('recentWorkspaces', [])
    },
  })

  await menuBuilder.init(currentAppLanguage)
}

/** 初始化语言：读取配置 + 设置菜单 + 监听切换 */
function initLanguageSync(): void {
  // 1. 启动时初始化菜单（异步，不阻塞启动）
  initApplicationMenu().catch((err) => {
    logger.system.warn('[Main] Menu init failed:', err)
  })

  // 2. 监听渲染进程：语言切换
  ipcMain.on('i18n:changed', (_event, lang: Language) => {
    getConfigStore().set('language', lang)
    currentAppLanguage = lang
    menuBuilder?.rebuild(lang)
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('i18n:sync', lang)
    })
  })
}

// 暴露 lspManager 给 globalCleanup（虽然 globalCleanup 直接 import 也可以，
// 但为保持单一入口，这里不做额外导出）
export { mainLspManager }
