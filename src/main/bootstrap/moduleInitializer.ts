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
import { initHostServices } from '../modules/plugin-sdk/hostServices'
import { registerPerceptionIpc } from '../modules/perception/PerceptionIpc'
import { registerPerceptionFusionIpc } from '../modules/perception/PerceptionFusionIpc'
import { registerMonitoringIpc } from '../modules/monitoring/MonitoringIpc'
import { MonitoringService } from '../modules/monitoring/MonitoringService'
import { registerCausalReasoningIpc } from '../modules/causal-reasoning/CausalReasoningIpc'
import { CausalReasoningService } from '../modules/causal-reasoning/CausalReasoningService'
import { registerIoTIpc } from '../modules/iot/IoTIpc'
import { registerSensorFusionIpc } from '../modules/iot/SensorFusionIpc'
import { SensorFusionService } from '../modules/iot/SensorFusionService'
import { registerProactiveIpc } from '../modules/proactive/ProactiveIpc'
import { proactiveStore } from '../modules/proactive/ProactiveStore'
import { proactiveActionTrigger } from '../modules/proactive/ProactiveActionTrigger'
import { proactivePermission } from '../modules/proactive/ProactivePermission'
import { initFloatingAvatar, syncWakeWordEnabledToAvatar } from '../modules/floating-avatar'
import { initVrmCompanion } from '../modules/vrm-companion'
import { initOverlayModule } from '../modules/overlay'
import { initLiveModule } from '../modules/live'
import { initVtsModule } from '../modules/vts'
import { initA2aModule } from '../modules/a2a'
import { initOpenApiModule } from '../modules/openapi'
import { initPowerGuardModule } from '../modules/power-guard'
import { initSandboxModule } from '../modules/security/sandbox'
import { GroupMemoryManager } from '../modules/memory-db/GroupMemoryManager'
import { registerGroupMemoryIpcHandlers } from '../modules/memory-db/GroupMemoryIpc'
import { initializeLocalVoiceModule } from '../modules/local-voice'
import { initializeCharacterCardModule } from '../modules/character-card'
import { initializeEmotionModule } from '../modules/emotion'
import { SettingsDb } from '../modules/settings-db/SettingsDb'
import { initCapabilityGuardModule } from '../modules/capability-guard'
import { registerVideoTranscodeIpc } from '../modules/video-transcode/VideoTranscodeIpc'

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
    deniedShellCommands: [...SECURITY_DEFAULTS.DENIED_SHELL_COMMANDS],
    allowedGitSubcommands: [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS],
  }) as {
    enablePermissionConfirm: boolean
    strictWorkspaceMode: boolean
    allowedShellCommands?: string[]
    deniedShellCommands?: string[]
    allowedGitSubcommands?: string[]
    allowedExternalDirectories?: string[]
  }

  securityManager.updateConfig(securityConfig)
  // 旧版白名单（保留以兼容已安装版本；shell 部分不再用于校验，仅 git 部分仍生效）
  security.updateWhitelist(
    securityConfig.allowedShellCommands || [...SECURITY_DEFAULTS.SHELL_COMMANDS],
    securityConfig.allowedGitSubcommands || [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS],
  )

  // 工作区外允许访问目录：必须在此同步给主进程安全模块。
  // 若只在 settings:set('securitySettings') 时同步，冷启动（重启应用）后主进程侧
  // 的放行列表为空，file:read / file:write / 终端 cwd 等校验会拒绝这些目录，
  // 表现为「设置里配了外部目录，重启后依然访问不了」。
  securityManager.setAllowedExternalDirectories(
    Array.isArray(securityConfig.allowedExternalDirectories)
      ? securityConfig.allowedExternalDirectories
      : [],
  )
  // Shell 命令黑名单（AI 执行 Shell 命令时实际生效的拦截策略）
  security.updateBlacklist(
    securityConfig.deniedShellCommands || [...SECURITY_DEFAULTS.DENIED_SHELL_COMMANDS],
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
  //
  // 每个模块通过 safeInit 独立隔离异常：单个模块初始化失败只记录日志，
  // 不会中断后续模块。历史故障：某模块内 `require('./Xxx')` 打包后抛
  // MODULE_NOT_FOUND 并冒泡中断本函数，导致其后所有模块的 IPC 均未注册
  // （表现为设置页「加载配置失败 / No handler registered」）。
  // ==========================================
  await safeInit('ChannelService', initChannelService)
  await safeInit('PythonRuntime', initPythonRuntime)
  await safeInit('NodeRuntime', initNodeRuntime)
  await safeInit('DesktopControlPlugin', initDesktopControlPlugin)
  // 初始化 Host 服务桥（供外部插件访问 native 能力 + MCP SDK）
  await safeInit('HostServicesBridge', initHostServicesBridge)
  // 注册感知层 IPC 处理器（暴露 PerceptionStore 给渲染进程）
  await safeInit('PerceptionIpc', initPerceptionIpc)
  // 注册监控层 IPC 处理器（暴露 MonitoringService 给渲染进程）
  await safeInit('MonitoringIpc', initMonitoringIpc)
  // 注册因果推理 IPC 处理器（暴露 CausalReasoningService 给渲染进程）
  await safeInit('CausalReasoningIpc', initCausalReasoningIpc)
  // 注册 IoT Bridge IPC 处理器（暴露 IoTBridge 给渲染进程）
  await safeInit('IoTIpc', () => initIoTIpc(firstWin))
  // 注册 SensorFusion IPC 处理器（暴露 SensorFusionService 给渲染进程）
  await safeInit('SensorFusionIpc', () => initSensorFusionIpc(firstWin))
  // 注册主动式助手 IPC 处理器（暴露 ProactiveStore 给渲染进程，阶段10 s10-02）
  await safeInit('ProactiveIpc', initProactiveIpc)
  // 初始化悬浮头像模块（语音唤醒 + 系统级悬浮头像 + 托盘，不阻塞启动）
  await safeInit('FloatingAvatarModule', () => initFloatingAvatarModule(firstWin))
  // 初始化 PPT 预览模块（窗口懒创建，仅预注册 IPC，不阻塞启动）
  await safeInit('PptPreviewModule', initPptPreviewModule)
  // 初始化项目执行窗口模块（单例创建 + IPC 注册，不阻塞启动）
  await safeInit('ProjectExecutionModule', initProjectExecutionModule)
  // 初始化 ONLYOFFICE 在线编辑模块（IPC 注册 + 会话管理，不阻塞启动）
  await safeInit('OoEditModule', initOoEditModule)
  // 注册视频转码 IPC 处理器（用 ffmpeg-static 转码不支持的视频编码，如 H.265 → H.264）
  await safeInit('VideoTranscodeIpc', registerVideoTranscodeIpc)
  // 初始化设备联动模块（WebSocket 长连接 + RPC 处理器 + 事件桥接）
  // 不阻塞启动：WebSocket 连接在 renderer 推送 token 后才发起
  await safeInit('DeviceLinkModule', initDeviceLinkModule)
  // 初始化 VRM 桌面伴侣模块（独立悬浮窗口 + 模型资源协议 + 好感度系统）
  // 资源协议（vrm-asset://）已在 appBootstrap 的 ready 前注册
  await safeInit('VrmCompanion', initVrmCompanion)
  // 初始化字幕/弹幕悬浮层模块（HTTP+WS 供 OBS 使用 + 应用内透明窗口）
  await safeInit('OverlayModule', initOverlayModule)
  // 初始化直播互动模块（B站/YouTube/Twitch 弹幕 → 悬浮层 + 渲染层）
  // 默认全关：适配器只在配置 enabled 后才真正建连
  await safeInit('LiveModule', initLiveModule)
  // 初始化 VTS（VTube Studio）联动模块（口型同步 + 表情/热键触发）
  // 默认全关：只在配置 enabled 后才连接本机 VTS
  await safeInit('VtsModule', initVtsModule)
  // 初始化 A2A（Agent2Agent）协议模块（出站工具调用 + 入站 A2A server）
  // 默认全关：出站不发请求；入站不监听端口
  await safeInit('A2aModule', initA2aModule)
  // 初始化对外 API 网关（OpenAI 兼容 + MCP + 托管 A2A）
  // ⚠️ 必须紧跟 A2A 之后：网关要订阅 A2A 的入站变化并接管监听权
  // 默认全关：不监听端口
  await safeInit('OpenApiModule', initOpenApiModule)
  // 初始化防休眠模块（Agent 长任务期间阻止系统睡眠，任务结束自动恢复）
  // 唯一「默认开启」的新增能力：空闲时不 spawn 任何进程，只在任务持有时才起守护
  await safeInit('PowerGuardModule', initPowerGuardModule)
  // 初始化代码解释器沙箱（run_command 的可选隔离执行层）
  // 默认策略 off：此时 run_command 完全走宿主终端路径，行为与改造前一致。
  // 刻意不在启动时探测后端（docker 探测要 spawn 进程），改为首次执行时惰性探测。
  await safeInit('SandboxModule', initSandboxModule)

  // 初始化群组记忆模块（P1-3 群聊长期记忆）
  // 默认关闭：需要在设置中显式开启
  await safeInit('GroupMemory', () => {
    GroupMemoryManager.getInstance().init()
    registerGroupMemoryIpcHandlers()
  })

  // 初始化本地语音引擎模块（P1-5 离线 ASR/TTS）
  // 默认关闭：需要在设置中显式开启
  await safeInit('LocalVoice', initializeLocalVoiceModule)

  // 初始化角色卡模块（P2-2 酒馆角色卡导入导出）
  // 支持酒馆角色卡 V2/V3 格式解析和导出
  await safeInit('CharacterCard', initializeCharacterCardModule)

  // 初始化表情包模块（P2-2 表情包管理）
  // 支持全局表情包和角色卡资产中的表情包
  await safeInit('Emotion', initializeEmotionModule)

  // 初始化有声书模块（P1-7 长文播报）
  // 默认关闭：需要在设置中显式开启
  await safeInit('Audiobook', async () => {
    const { registerAudiobookIpcHandlers } = await import('../modules/audiobook/AudiobookIpc')
    registerAudiobookIpcHandlers()
  })

  // 初始化双向 VMC 协议模块（P1-8 双向 VMC）
  // 默认关闭：需要在设置中显式开启
  await safeInit('Vmc', async () => {
    const { initVmcModule } = await import('../modules/vmc')
    initVmcModule()
  })

  // 初始化套餐能力一致性收敛（降级后自动关闭无权限的客户端能力）
  // ⚠️ 必须排在 live / vts / vmc / a2a / openapi / iot / perception / proactive 之后：
  // 收敛要读它们的配置，模块没起来时读到的都是默认值。
  // 仅在渲染层拿到后端权威授权快照后才会真正执行（见 capability-guard/index.ts）。
  await safeInit('CapabilityGuard', initCapabilityGuardModule)

  // ==========================================
  // 7. 应用菜单与语言同步
  // ==========================================
  initLanguageSync()
}

// ==========================================
// 子初始化函数
// ==========================================

/**
 * 安全执行单个模块初始化
 *
 * 异常隔离：任一模块初始化失败仅记录日志，不阻断后续模块。
 * 历史故障：模块内 `require('./Xxx')` 在打包后抛 MODULE_NOT_FOUND 并冒泡，
 * 使本函数后续所有模块的 IPC 都未注册（设置页报「No handler registered」）。
 */
async function safeInit(label: string, init: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await init()
  } catch (err) {
    logger.system.error(`[Main] Module init failed: ${label}`, errMsg(err))
  }
}

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

  // 启动插件级 Cron 调度桥（独立于主 CronScheduler，供插件注册本地回调任务）
  try {
    const { getCronSchedulerBridge } = await import('../modules/plugin-sdk/CronSchedulerBridge')
    getCronSchedulerBridge().start()
    logger.system.info('[Main] Plugin cron scheduler bridge started')
  } catch (err) {
    logger.system.warn('[Main] Plugin cron scheduler bridge start skipped:', errMsg(err))
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

/** 初始化 Plugin Registry 与 PluginInstaller */
async function initPluginRegistry(): Promise<void> {
  try {
    const { getPluginRegistry } = await import('../modules/plugin-sdk/PluginRegistry')
    const userDataPath = app.getPath('userData')
    getPluginRegistry(path.join(userDataPath, 'plugins'))

    // 初始化 PluginInstaller（用于插件市场的安装/卸载）
    const { getPluginInstaller } = await import('../modules/plugin-sdk/PluginInstaller')
    const installer = getPluginInstaller(getMainWindow)
    logger.system.info('[Main] PluginInstaller initialized')

    // 恢复已安装插件：注册插件目录映射（pluginDirs）、重新加载插件运行时
    // 必须在 MCP 自动连接之前完成，否则插件型 MCP 服务器会因 pluginDirs 为空而走 fallback 路径
    await installer.restoreInstalled()
    logger.system.info('[Main] Installed plugins restored')
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

/**
 * 初始化 Host 服务桥接（直接调用 hostServices 模块）。
 *
 * 将客户端主进程的 native 能力（DesktopControlManager、MacVisionOcrRouter、nativeImage、
 * McpServer、InMemoryTransport、zod）通过 globalThis.__AWEECLAW_HOST__ 暴露给外部插件代码。
 *
 * 静态 import 确保被 vite 打包进主 chunk，避免运行时 require 路径失效。
 */
function initHostServicesBridge(): void {
  try {
    initHostServices()
  } catch (err) {
    logger.system.warn('[Main] Host services bridge initialization failed:', errMsg(err))
  }
}

/**
 * 注册感知层 IPC 处理器。
 *
 * 将 PerceptionStore 的能力通过 IPC 暴露给渲染进程，
 * 供 IntelligenceCore 注入预测上下文、设置面板读写隐私配置。
 */
function initPerceptionIpc(): void {
  try {
    registerPerceptionIpc()
    registerPerceptionFusionIpc()
  } catch (err) {
    logger.system.warn('[Main] Perception IPC registration failed:', errMsg(err))
  }
}

/**
 * 注册监控层 IPC 处理器并初始化监控服务。
 *
 * 将 MonitoringService 的能力通过 IPC 暴露给渲染进程，
 * 供设置面板读写监控配置、系统监控面板查询指标与异常事件。
 * 监控服务会根据配置自动启动定时采样（默认 30s）。
 */
function initMonitoringIpc(): void {
  try {
    registerMonitoringIpc()
    // 异步初始化监控服务（不阻塞启动）
    const service = MonitoringService.getInstance()
    service.initialize()
      .then(() => {
        const config = service.getConfig()
        if (config.enabled) {
          service.start()
          logger.system.info('[Main] Monitoring service started (enabled in config)')
        } else {
          logger.system.info('[Main] Monitoring service initialized (disabled by default)')
        }
      })
      .catch((err) => {
        logger.system.warn('[Main] Monitoring service init failed:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] Monitoring IPC registration failed:', errMsg(err))
  }
}

/**
 * 注册因果推理 IPC 处理器并初始化因果推理服务。
 *
 * 将 CausalReasoningService 的能力通过 IPC 暴露给渲染进程，
 * 供设置面板读写因果推理配置、因果图管理面板查询节点/边/断言/反事实查询。
 * 服务会根据配置自动启动事件流收集器（默认 5 分钟抽取一次断言）。
 */
function initCausalReasoningIpc(): void {
  try {
    registerCausalReasoningIpc()
    // 异步初始化因果推理服务（不阻塞启动）
    const service = CausalReasoningService.getInstance()
    service.initialize()
      .then(() => {
        const config = service.getConfig()
        if (config.enabled) {
          logger.system.info('[Main] Causal reasoning service initialized (enabled)')
        } else {
          logger.system.info('[Main] Causal reasoning service initialized (disabled by default)')
        }
      })
      .catch((err) => {
        logger.system.warn('[Main] Causal reasoning service init failed:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] Causal reasoning IPC registration failed:', errMsg(err))
  }
}

/**
 * 注册 IoT Bridge IPC 处理器。
 *
 * 将 IoTBridge 的能力通过 IPC 暴露给渲染进程，
 * 供 IoT 设置面板连接/断开 Provider、查询实体快照、订阅实时事件。
 *
 * Bridge 启动需由渲染层主动调用 iot.start() 完成（依赖渲染层注入回调）。
 * 协议适配器（HomeAssistant/MQTT/自定义）由插件或内置模块通过
 * registerIoTAdapter() 注册。
 */
function initIoTIpc(mainWindow: BrowserWindow): void {
  try {
    registerIoTIpc(mainWindow)
    logger.system.info('[Main] IoT Bridge IPC registered')
  } catch (err) {
    logger.system.warn('[Main] IoT Bridge IPC registration failed:', errMsg(err))
  }
}

/**
 * 注册 SensorFusion IPC 处理器并初始化传感器融合服务。
 *
 * SensorFusionService 在初始化阶段懒加载因果推理服务引用（避免循环依赖），
 * 启动需由渲染层主动调用 sensorFusion.start() 或通过 updateConfig({enabled:true}) 触发。
 *
 * 默认配置：未启用。需用户在 IoT 设置面板中显式开启。
 */
function initSensorFusionIpc(mainWindow: BrowserWindow): void {
  try {
    registerSensorFusionIpc(mainWindow)
    // 异步初始化（不阻塞启动）
    const service = SensorFusionService.getInstance()
    service.initialize()
      .then(() => {
        logger.system.info('[Main] SensorFusion service initialized')
      })
      .catch((err) => {
        logger.system.warn('[Main] SensorFusion service init failed:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] SensorFusion IPC registration failed:', errMsg(err))
  }
}

/**
 * 注册主动式助手 IPC 处理器并初始化 ProactiveStore + Permission + ActionTrigger。
 *
 * 启动顺序：
 * 1. 注册 IPC handler（同步）
 * 2. 加载 ProactivePermission 配置（从 ModuleDataStore，同步内存读取）
 * 3. 异步初始化 SQLite（不阻塞启动）
 * 4. 注入权限校验器到 ActionTrigger
 * 5. 启动 ActionTrigger（被动监听 decisionEngine 的 proposal 事件）
 * 6. 若权限配置启用 → 启动决策引擎
 *
 * 注意：
 * - ProactiveStore 仅持久化数据
 * - 决策引擎的启停由 ProactivePermission 配置驱动（updateConfig 触发 syncDecisionEngine）
 * - ActionTrigger 作为被动监听器提前启动，确保决策引擎启动后提案能即时派发
 */
function initProactiveIpc(): void {
  try {
    registerProactiveIpc()

    // 加载权限配置（同步内存读取，无 IO 阻塞）
    proactivePermission.load()

    // 异步初始化 SQLite（不阻塞启动）
    proactiveStore.initialize()
      .then(() => {
        logger.system.info('[Main] Proactive store initialized')
        // s10-10：初始化 ProactiveLearner（注册每日 04:00 校准任务 + 恢复上次快照）
        // 必须在 store 初始化完成后进行，否则首次校准会因 SQLite 未就绪而失败
        return import('../modules/proactive/ProactiveLearner')
      })
      .then(({ proactiveLearner }) => {
        return proactiveLearner.initialize()
      })
      .then(() => {
        logger.system.info('[Main] Proactive learner initialized (daily 04:00 calibration)')
      })
      .catch((err) => {
        logger.system.warn('[Main] Proactive learner init failed:', errMsg(err))
      })

    // 注入权限校验器到 ActionTrigger（每条提案派发前都会校验）
    proactiveActionTrigger.setPermissionChecker((proposal) => {
      const result = proactivePermission.check(proposal)
      return {
        allowed: result.allowed,
        reason: result.reason,
        effectiveSeverity: result.effectiveSeverity,
      }
    })

    // 注入派发回调（用于频率限制记录，s10-05 ProactivePermission 使用）
    proactiveActionTrigger.setDispatchCallback((_proposal, effectiveSeverity) => {
      proactivePermission.recordDispatch(effectiveSeverity)
    })

    // 启动 ActionTrigger（监听 decisionEngine proposal 事件）
    proactiveActionTrigger.start()

    // 若权限配置已启用，启动决策引擎（默认 enabled=false，不启动）
    const permConfig = proactivePermission.getConfig()
    if (permConfig.enabled && permConfig.level !== 'off') {
      try {
        // 延迟导入避免在模块加载阶段触发决策引擎的复杂依赖初始化
        import('../modules/proactive/ProactiveDecisionEngine')
          .then(async ({ proactiveDecisionEngine }) => {
            // ── 预热：在决策引擎首次节拍前完成 LanceDB 加载与工作区 git 预分析 ──
            // 根因：LanceDB native 模块首次 import 阻塞事件循环 2-3s，
            //       git log 全量分析阻塞 >3s，两者都会导致决策引擎 10 路信号
            //       在首个节拍全部超时。预热将阻塞提前到启动阶段，避免污染节拍。
            await warmupProactiveDependencies()

            // 注册编码场景探测器（s10-08）
            registerCodingScenarioDetectors(proactiveDecisionEngine)
            // 注册 IoT + 系统场景探测器（s10-09）
            registerIotSystemScenarioDetectors(proactiveDecisionEngine)
            // 注册随机话题场景探测器（P2-3）
            registerRandomTopicDetector(proactiveDecisionEngine)
            proactiveDecisionEngine.start()
            logger.system.info('[Main] Proactive decision engine started (enabled in config)')
          })
          .catch((err) => {
            logger.system.warn('[Main] Proactive decision engine start failed:', errMsg(err))
          })
      } catch (err) {
        logger.system.warn('[Main] Proactive decision engine start failed:', errMsg(err))
      }
    } else {
      logger.system.info('[Main] Proactive decision engine not started (disabled by default)')
    }
  } catch (err) {
    logger.system.warn('[Main] Proactive IPC registration failed:', errMsg(err))
  }
}

/**
 * 注册编码场景探测器到决策引擎（s10-08）
 *
 * 包含 4 个探测器：
 * - BuildFailureDetector：构建失败模式检测
 * - RepeatCommandDetector：重复命令模式检测
 * - ImpactAnalysisDetector：影响分析提示
 * - DebugStallDetector：调试卡顿检测
 */
function registerCodingScenarioDetectors(
  engine: import('../modules/proactive/ProactiveDecisionEngine').ProactiveDecisionEngine,
): void {
  try {
    // 初始化 ActivityTracker（注册 powerMonitor 监听）
    import('../modules/proactive/scenarios/ActivityTracker')
      .then(({ activityTracker }) => {
        activityTracker.initialize()
        logger.system.info('[Main] ActivityTracker initialized for coding scenario detectors')
      })
      .catch((err) => {
        logger.system.warn('[Main] ActivityTracker init failed:', errMsg(err))
      })

    // 注册 4 个编码场景探测器
    import('../modules/proactive/scenarios/CodingScenario')
      .then(({ codingDetectors }) => {
        for (const detector of codingDetectors) {
          engine.registerScenarioDetector(detector)
        }
        logger.system.info(
          `[Main] Registered ${codingDetectors.length} coding scenario detectors`,
        )
      })
      .catch((err) => {
        logger.system.warn('[Main] Coding scenario detectors registration failed:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] registerCodingScenarioDetectors failed:', errMsg(err))
  }
}

/**
 * 注册 IoT + 系统场景探测器到决策引擎（s10-09）
 *
 * 包含 4 个探测器：
 * - IotAnomalyPersistenceDetector：IoT 异常持续检测
 * - MqttMessageAnomalyDetector：MQTT 消息频率突变检测
 * - SystemResourceAlertDetector：系统资源告警
 * - PredictiveAlertDetector：预测性资源告警
 *
 * 同时初始化 MqttMessageTracker，订阅 IoTBridge 内部事件以记录 MQTT 消息。
 */
function registerIotSystemScenarioDetectors(
  engine: import('../modules/proactive/ProactiveDecisionEngine').ProactiveDecisionEngine,
): void {
  try {
    // 初始化 MqttMessageTracker（订阅 IoTBridge 内部事件）
    import('../modules/proactive/scenarios/MqttMessageTracker')
      .then(({ mqttMessageTracker }) => {
        mqttMessageTracker.subscribeToMqttAdapter()
        logger.system.info('[Main] MqttMessageTracker subscribed to IoTBridge')
      })
      .catch((err) => {
        logger.system.warn('[Main] MqttMessageTracker init failed:', errMsg(err))
      })

    // 注册 2 个 IoT 场景探测器
    import('../modules/proactive/scenarios/IotScenario')
      .then(({ iotDetectors }) => {
        for (const detector of iotDetectors) {
          engine.registerScenarioDetector(detector)
        }
        logger.system.info(
          `[Main] Registered ${iotDetectors.length} IoT scenario detectors`,
        )
      })
      .catch((err) => {
        logger.system.warn('[Main] IoT scenario detectors registration failed:', errMsg(err))
      })

    // 注册 2 个系统场景探测器
    import('../modules/proactive/scenarios/SystemScenario')
      .then(({ systemDetectors }) => {
        for (const detector of systemDetectors) {
          engine.registerScenarioDetector(detector)
        }
        logger.system.info(
          `[Main] Registered ${systemDetectors.length} system scenario detectors`,
        )
      })
      .catch((err) => {
        logger.system.warn('[Main] System scenario detectors registration failed:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] registerIotSystemScenarioDetectors failed:', errMsg(err))
  }
}

/**
 * 注册随机话题场景探测器到决策引擎（P2-3 新增）
 *
 * 包含 1 个探测器：
 * - RandomTopicDetector：随机话题探测器
 *
 * 随机话题功能默认关闭，需要在设置中显式开启。
 */
function registerRandomTopicDetector(
  engine: import('../modules/proactive/ProactiveDecisionEngine').ProactiveDecisionEngine,
): void {
  try {
    import('../modules/proactive/scenarios/RandomTopicScenario')
      .then(({ randomTopicDetector }) => {
        engine.registerScenarioDetector(randomTopicDetector)
        logger.system.info('[Main] Registered random topic detector')
      })
      .catch((err) => {
        logger.system.warn('[Main] Random topic detector registration failed:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] registerRandomTopicDetector failed:', errMsg(err))
  }
}

/**
 * 预热主动决策引擎的重量级依赖。
 *
 * 在 `proactiveDecisionEngine.start()` 之前调用，确保首次节拍（10s 后）采集信号时
 * LanceDB native 模块已加载完毕，避免事件循环阻塞导致 10 路信号集体超时。
 *
 * 预热内容：
 * 1. PerceptionStore.warmup() — 加载 @lancedb/lancedb native 模块 + 预打开常用表
 *
 * 注意：GitCoModificationAnalyzer 的 git log 预分析不在此处触发，因为工作区路径
 * 在启动时尚未确定。改为在 ImpactAnalysisDetector 首次 detect 时通过非阻塞的
 * getCoModifiedFiles → prefetchAnalysis 按需触发（下次节拍命中缓存）。
 */
async function warmupProactiveDependencies(): Promise<void> {
  try {
    const { PerceptionStore } = await import('../modules/perception/PerceptionStore')
    const store = PerceptionStore.getInstance()
    if (!store.isReady()) {
      logger.system.info('[Main] Warming up PerceptionStore (LanceDB preload)...')
      await store.warmup(true)
      logger.system.info('[Main] PerceptionStore warmup complete')
    }
  } catch (err) {
    // 预热失败不阻塞引擎启动，首次节拍会降级返回空信号
    logger.system.warn('[Main] PerceptionStore warmup failed:', errMsg(err))
  }
}

/**
 * 初始化悬浮头像模块（语音唤醒 + 系统级悬浮头像 + 托盘）。
 *
 * 流程：加载配置 → 注册 IPC → 创建头像窗口 → 绑定右键菜单 → 创建托盘。
 * 按 showOnStartup 配置决定是否显示头像。
 *
 * 依赖注入：通过 initFloatingAvatar 的 deps 回调避免直接依赖 windowManager/appBootstrap，
 * 防止循环依赖（floating-avatar 模块 → windowManager → appBootstrap → moduleInitializer）。
 *
 * 主窗口关闭后（hide-on-close 或 platform !== darwin），头像 + 托盘维持应用存活，
 * 由 appBootstrap.window-all-closed 中检查 floatingAvatar.isVisible() 实现。
 */
function initFloatingAvatarModule(_firstWin: BrowserWindow): void {
  try {
    initFloatingAvatar({
      getOrCreateMainWindow: () => {
        const win = getMainWindow()
        if (win && !win.isDestroyed()) return win
        // 主窗口不存在时新建
        return createWindow(false)
      },
      // 主窗口实例：用于监听 dom-ready，延迟显示头像避免启动闪烁
      mainWindow: _firstWin,
      openSettings: () => {
        // 打开/聚焦主窗口，并发送导航事件（导航到外观设置 tab）
        // 兼容两种场景：主窗口 warm（hide-on-close 隐藏中）与新创建窗口。
        const sendNav = (w: BrowserWindow): void => {
          if (w.isDestroyed() || w.webContents.isDestroyed()) return
          w.webContents.send('floating-avatar:open-settings', 'appearance')
        }
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
          // renderer 仍在加载时等 dom-ready 再发；已就绪则立即发
          if (win.webContents.isLoading()) {
            win.webContents.once('dom-ready', () => sendNav(win))
          } else {
            sendNav(win)
          }
        } else {
          const newWin = createWindow(false)
          newWin.webContents.once('dom-ready', () => sendNav(newWin))
        }
      },
      quitApp: () => {
        // 触发完整退出流程（before-quit 会执行清理并销毁头像/托盘）
        app.quit()
      },
      forwardSaveConversation: (payload) => {
        // 转发到主窗口（主窗口写入 IntelligenceStore 聊天历史）
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('floating-avatar:save-conversation', payload)
        }
      },
      forwardVoiceStateChanged: (payload) => {
        // 转发到主窗口（用于主窗口 UI 联动）
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('floating-avatar:voice-state-changed', payload)
        }
      },
      isWakeWordEnabled: () => {
        try {
          const cfg = SettingsDb.getInstance().getWakeWordConfig()
          return !!cfg?.enabled
        } catch {
          return false
        }
      },
      toggleWakeWord: async () => {
        try {
          const db = SettingsDb.getInstance()
          const cfg = db.getWakeWordConfig()
          const next = !cfg?.enabled
          db.setWakeWordEnabled(next)
          // 同步到头像窗口（让唤醒引擎启停）
          syncWakeWordEnabledToAvatar(next)
          return next
        } catch (err) {
          logger.system.warn('[Main] Toggle wake word failed:', errMsg(err))
          return false
        }
      },
      getLanguage: () => {
        const lang = getConfigStore().get('language') as string
        return lang?.toLowerCase().includes('en') ? 'en' : 'zh'
      },
      getWorkspacePath: () => {
        // 优先：当前主窗口已绑定的工作区（运行时切换工作区后即时反映）
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          const roots = getWindowWorkspace(win.id)
          if (roots && roots.length > 0) return roots[0]
        }
        // 兜底：持久化的最近工作区（启动时/无窗口时可用）
        const session = getConfigStore().get('lastWorkspaceSession') as
          | { roots?: string[] }
          | undefined
        if (session?.roots && session.roots.length > 0) return session.roots[0]
        return (getConfigStore().get('lastWorkspacePath') as string | null) ?? null
      },
      forwardRequestModels: (requestId) => {
        // 转发模型列表请求到主窗口（主窗口从 store 构建，通过 models-response 返回）
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('floating-avatar:request-models', requestId)
        }
      },
      forwardSelectModel: (payload) => {
        // 转发模型切换到主窗口（主窗口更新 store + save + 重新 push voiceContext）
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('floating-avatar:select-model', payload)
        }
      },
      forwardSelectAuthorizationMode: (mode) => {
        // 转发授权方式切换到主窗口（主窗口更新 store + save + 重新 push voiceContext）
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('floating-avatar:select-authorization-mode', mode)
        }
      },
      forwardSelectWorkMode: (mode) => {
        // 转发工作模式切换到主窗口（主窗口更新 useModeStore + 重新 push voiceContext）
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('floating-avatar:select-work-mode', mode)
        }
      },
      forwardSelectAgent: (agentId) => {
        // 转发自定义智能体切换到主窗口（主窗口更新 store + save + 重新 push voiceContext）
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('floating-avatar:select-agent', agentId)
        }
      },
    })

    logger.system.info('[Main] Floating avatar module initialized')
  } catch (err) {
    logger.system.warn('[Main] Floating avatar module init skipped:', errMsg(err))
  }
}

/**
 * 初始化 PPT 预览模块。
 *
 * v2.3：从独立窗口改为主窗口内嵌 Tab
 * - 注入主窗口获取函数，让 PptPreviewManager 能向主窗口发 IPC
 * - 主窗口渲染层接收 IPC 后打开 PptPreviewPanel Tab
 * - 降级：主窗口不可用时回退到独立窗口
 *
 * 供 mcp-pptx 插件通过 Host 桥 (host.pptPreview) 推送幻灯片数据，
 * 实现生成过程中的实时预览。
 */
function initPptPreviewModule(): void {
  try {
    import('../modules/ppt-preview/PptPreviewManager')
      .then(({ PptPreviewManager }) => {
        const instance = PptPreviewManager.getInstance()
        // 注入主窗口获取函数（v2.3 内嵌 Tab 模式必需）
        instance.setMainWindowGetter(getMainWindow)
        logger.system.info('[Main] PPT preview module initialized (main-window tab mode)')
      })
      .catch((err) => {
        logger.system.warn('[Main] PPT preview module init skipped:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] PPT preview module init failed:', errMsg(err))
  }
}

/**
 * 初始化 ONLYOFFICE 在线编辑模块。
 *
 * 懒加载 OoEditManager 单例（构造时注册 oo-edit:* IPC 处理器）：
 * - 上传本地文档到 ONLYOFFICE 网关并创建编辑会话
 * - 保存时 force save + 下载回写本地源文件
 * - 服务器地址从 aweeclaw-config.json（onlyOffice 段）读取
 */
function initOoEditModule(): void {
  try {
    import('../modules/onlyoffice/OoEditManager')
      .then(({ OoEditManager }) => {
        OoEditManager.getInstance()
        logger.system.info('[Main] ONLYOFFICE edit module initialized')
      })
      .catch((err) => {
        logger.system.warn('[Main] ONLYOFFICE edit module init skipped:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] ONLYOFFICE edit module init failed:', errMsg(err))
  }
}

/**
 * 项目执行窗口模块初始化
 *
 * 触发 ProjectExecutionWindowManager 单例创建（构造时注册 IPC）。
 * 窗口懒创建（首次 open 时才创建）。
 */
function initProjectExecutionModule(): void {
  try {
    import('../modules/project-execution/ProjectExecutionWindowManager')
      .then(({ projectExecutionWindowManager }) => {
        // 触发单例创建 + IPC 注册（getInstance 在构造时调用 registerIpc）
        void projectExecutionWindowManager
        logger.system.info('[Main] Project execution window module initialized (IPC registered)')
      })
      .catch((err) => {
        logger.system.warn('[Main] Project execution module init skipped:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] Project execution module init failed:', errMsg(err))
  }
}

/**
 * 初始化设备联动模块。
 *
 * 顺序：
 * 1. 创建 DeviceLinkClient（不立即连接，等 renderer 推送凭据）
 * 2. 启动 EventBridge（监听 powerMonitor、文件变更、空闲轮询）
 * 3. 注册 IPC handler（renderer 通过 device-link:set-credentials 推送 token）
 *
 * 工作区根解析器复用 floating-avatar 的逻辑：
 * - 优先取当前主窗口已绑定的工作区
 * - 回退到 lastWorkspaceSession 的 roots[0]
 * - 再回退到 lastWorkspacePath
 *
 * 不阻塞启动：WS 连接由 renderer 在登录后调用 IPC 触发。
 */
function initDeviceLinkModule(): void {
  try {
    import('../modules/device-link/deviceLink.ipc')
      .then(({ initDeviceLinkModule: initMod }) => {
        initMod({
          configStore: getConfigStore(),
          getMainWindow: () => getMainWindow(),
          resolveWorkspaceRoot: () => {
            const win = getMainWindow()
            if (win && !win.isDestroyed()) {
              const roots = getWindowWorkspace(win.id)
              if (roots && roots.length > 0) return roots[0]
            }
            const session = getConfigStore().get('lastWorkspaceSession') as
              | { roots?: string[] }
              | undefined
            if (session?.roots && session.roots.length > 0) return session.roots[0]
            const lastPath = getConfigStore().get('lastWorkspacePath') as string | null
            return lastPath ?? null
          },
        })
        logger.system.info('[Main] Device link module initialized (IPC registered)')
      })
      .catch((err) => {
        logger.system.warn('[Main] Device link module init skipped:', errMsg(err))
      })
  } catch (err) {
    logger.system.warn('[Main] Device link module init failed:', errMsg(err))
  }
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

/**
 * 异步初始化 Node.js 环境（不阻塞启动）
 *
 * 当系统未安装 Node.js 时，自动下载官方便携版到 {userData}/node-env/。
 * 初始化完成后，便携版的 bin 目录会注入到 process.env.PATH，
 * 使后续 MCP 插件启动、AI 终端命令都能找到 node/npx/npm。
 */
function initNodeRuntime(): void {
  import('../modules/node-runtime')
    .then(async ({ nodeManager }) => {
      const status = await nodeManager.ensureReady()
      if (status.ready) {
        logger.system.info('[Main] Node.js environment ready:', {
          nodePath: status.nodePath,
          source: status.source,
          version: status.version,
        })
        // 将便携版 bin 目录注入到主进程 PATH，使后续 spawn 的子进程能找到 node/npx
        if (status.binDir) {
          const augmentedPath = nodeManager.getAugmentedPath()
          if (augmentedPath && augmentedPath !== process.env.PATH) {
            process.env.PATH = augmentedPath
            logger.system.info(`[Main] Injected Node.js bin dir into PATH: ${status.binDir}`)
          }
        }
      } else {
        logger.system.warn('[Main] Node.js environment not available:', status.error)
      }
    })
    .catch((err) => {
      logger.system.warn('[Main] Node.js environment setup failed:', err)
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
