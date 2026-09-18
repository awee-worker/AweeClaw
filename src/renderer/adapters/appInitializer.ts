/**
 * [AweeClaw] 场景感知初始化编排器
 *
 * 与 Adnify 的 appInitializer 差异化：
 * - 新增场景感知的初始化序列（核心模块优先级、后台任务调度）
 * - 法律/医疗场景：严格初始化顺序、合规模块预加载、审计日志
 * - 教育场景：快速启动、延迟加载非核心模块
 * - 新增场景感知的后台初始化策略
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { startupMetrics } from '@shared/toolkit/bootMetrics'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { useStore } from '@store'
import type { SecurityPolicyPanel } from '@shared/configuration/configTypes'
import { initializeAgentStore } from '@intelligence/state/IntelligenceStore'
import { themeManager } from '../config/themeDefinition'
import { keybindingService } from './keybindingAdapter'
import { registerCoreCommands } from '../config/commandRegistry'
import { diagnosticStore } from './diagnosticRepository'

/** 检测系统语言是否为中文 */
function isZh(): boolean {
  return navigator.language.startsWith('zh')
}
import { restoreWorkspaceState } from './workspaceStateAdapter'
import { mcpService } from './toolProtocolAdapter'
import { snippetService } from './snippetAdapter'
import { workspaceStorageRuntime } from './workspaceStorageAdapter'
import { dreamingScheduler } from '@intelligence/runtime/longTermMemoryService/dreamingScheduler'
import { runWithAgentStorageWritesSuspended } from '@intelligence/state/intelligenceStorage'
import {
  bindWorkspaceRootLite,
  commitWorkspaceShell,
  prepareWorkspaceShell,
  restoreWorkspaceAgentStore,
} from './workspaceLoader'
import { initializeHarness } from '@intelligence/harness'
import { setupAgentRuntime } from '@intelligence/engine'

export interface InitResult {
  success: boolean
  shouldShowOnboarding: boolean
  error?: string
}

interface ScenarioInitConfig {
  strictModuleOrder: boolean
  preloadComplianceModules: boolean
  backgroundInitDelayMs: number
  idleTaskTimeout: number
  auditInitSequence: boolean
  skipNonEssentialModules: boolean
}

const SCENARIO_INIT_CONFIGS: Record<string, ScenarioInitConfig> = {
  'dev-assistant': {
    strictModuleOrder: false,
    preloadComplianceModules: false,
    backgroundInitDelayMs: 2000,
    idleTaskTimeout: 2000,
    auditInitSequence: false,
    skipNonEssentialModules: false,
  },
  'legal': {
    strictModuleOrder: true,
    preloadComplianceModules: true,
    backgroundInitDelayMs: 500,
    idleTaskTimeout: 5000,
    auditInitSequence: true,
    skipNonEssentialModules: false,
  },
  'medical': {
    strictModuleOrder: true,
    preloadComplianceModules: true,
    backgroundInitDelayMs: 500,
    idleTaskTimeout: 5000,
    auditInitSequence: true,
    skipNonEssentialModules: false,
  },
  'education': {
    strictModuleOrder: false,
    preloadComplianceModules: false,
    backgroundInitDelayMs: 3000,
    idleTaskTimeout: 1000,
    auditInitSequence: false,
    skipNonEssentialModules: true,
  },
}

function getScenarioInitConfig(): ScenarioInitConfig {
  const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
  return SCENARIO_INIT_CONFIGS[scenarioId] ?? SCENARIO_INIT_CONFIGS['dev-assistant']
}

function scheduleIdleTask(task: () => void | Promise<void>, timeout?: number): void {
  const config = getScenarioInitConfig()
  const taskTimeout = timeout ?? config.idleTaskTimeout
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => { task() }, { timeout: taskTimeout })
  } else {
    setTimeout(task, 100)
  }
}

function schedulePostPaintTask(task: () => void, delay = 0): void {
  requestAnimationFrame(() => {
    if (delay > 0) {
      setTimeout(task, delay)
      return
    }

    task()
  })
}

async function initCoreModules(): Promise<void> {
  const config = getScenarioInitConfig()
  startupMetrics.start('init-core')

  if (config.auditInitSequence) {
    logger.system.info('[ScenarioInit] Starting core module initialization with audit trail')
  }

  registerCoreCommands()

  if (config.strictModuleOrder) {
    await keybindingService.init()
    await initializeAgentStore()
    await themeManager.init()
    await snippetService.init()
  } else {
    await Promise.all([
      keybindingService.init(),
      initializeAgentStore(),
      themeManager.init(),
      snippetService.init(),
    ])
  }

  if (config.preloadComplianceModules) {
    try {
      const { scenarioRegistry } = await import('@shared/configuration/scenarios')
      const activeScenario = scenarioRegistry.getActive()
      if (activeScenario) {
        logger.system.info('[ScenarioInit] Preloaded compliance modules for:', activeScenario.id)
      }
    } catch (e) {
      logger.system.warn('[ScenarioInit] Compliance module preload failed:', e)
    }
  }

  startupMetrics.end('init-core')
}

async function loadUserSettings(_isEmptyWindow: boolean): Promise<string | null> {
  startupMetrics.start('load-settings')

  const [, savedTheme] = await Promise.all([
    useStore.getState().load(),
    api.settings.get('themeId'),
  ])

  // 校验持久化的 activeScenarioId 是否仍存在（场景可能已被卸载），
  // 不存在则回退到默认场景，避免重启后进入已失效的场景
  try {
    const { scenarioRegistry } = await import('@shared/configuration/scenarios')
    const { activeScenarioId } = useStore.getState()
    if (activeScenarioId && !scenarioRegistry.has(activeScenarioId)) {
      const defaultScenario = scenarioRegistry.getDefault()
      logger.system.warn(
        `[Init] Persisted scenario "${activeScenarioId}" no longer exists, falling back to "${defaultScenario.id}"`,
      )
      useStore.getState().set('activeScenarioId', defaultScenario.id)
      await useStore.getState().save()
    }
  } catch (e) {
    logger.system.warn('[Init] Scenario validation failed:', e)
  }

  const { webSearchConfig, mcpConfig } = useStore.getState()
  if (webSearchConfig?.searchEngines) {
    api.http.setSearchEngineState({
      searchEngines: webSearchConfig.searchEngines,
      activeSearchEngine: webSearchConfig.activeSearchEngine || 'aweeclaw-searxng',
    }).catch((e) => {
      logger.system.warn('[Init] Failed to set search engine state:', e)
    })
  }

  if (mcpConfig?.autoConnect !== undefined) {
    api.mcp.setAutoConnect(mcpConfig.autoConnect).catch((e) => {
      logger.system.warn('[Init] Failed to set MCP auto-connect config:', e)
    })
  }

  startupMetrics.end('load-settings')
  return savedTheme as string | null
}

async function restoreWorkspace(onWorkspaceReady?: () => void): Promise<boolean> {
  startupMetrics.start('restore-workspace')

  const workspaceConfig = await api.workspace.restore()
  if (!workspaceConfig?.roots?.length) {
    if (workspaceConfig?.restoreError === 'missing-workspace') {
      const missing = workspaceConfig.missingRoots?.[0] || ''
      const { toast } = await import('@components/foundation/NotificationProvider')
      toast.warning('上次打开的工作区已不存在，请重新选择文件夹', missing || undefined)
    }

    startupMetrics.end('restore-workspace')
    return false
  }

  await workspaceStorageRuntime.initializeRoots(workspaceConfig.roots)
  const shellState = await prepareWorkspaceShell(workspaceConfig)

  // 关键路径：绑定根目录（轻量模式 — 仅创建目录，跳过 SQLite 初始化，交给后续 restoreWorkspaceAgentStore 统一处理）
  await runWithAgentStorageWritesSuspended(async () => {
    await bindWorkspaceRootLite(shellState)
  })

  // 立即提交 shell 状态，让 UI 框架先构建
  commitWorkspaceShell(shellState)

  // workspace 已就绪，通知调用方可以移除加载动画
  // 后续的 restoreWorkspaceAgentStore 等耗时操作在后台继续，不阻塞 UI 显示
  onWorkspaceReady?.()

  // 关键路径：恢复会话数据（用户进入应用时必须看到历史会话）
  await runWithAgentStorageWritesSuspended(async () => {
    await restoreWorkspaceAgentStore()
  })

  // 非关键路径：延迟恢复工作区状态（打开的文件、布局等）
  schedulePostPaintTask(async () => {
    try {
      await runWithAgentStorageWritesSuspended(async () => {
        await restoreWorkspaceState()
      })
    } catch (e) {
      logger.system.warn('[Init] Deferred workspace state restore failed:', e)
    }
  }, 0)

  // Harness 初始化也可以延迟
  if (shellState.primaryRoot) {
    scheduleIdleTask(async () => {
      try {
        await initializeHarness(shellState.primaryRoot!)
      } catch (e) {
        logger.system.warn('[Init] Harness initialization failed:', e)
      }
    }, 500)
  }

  schedulePostPaintTask(() => {
    try {
      diagnosticStore.init()
    } catch (e) {
      logger.system.warn('[Init] Diagnostics listener init failed:', e)
    }
  }, 16)

  scheduleIdleTask(() => mcpService.initialize(workspaceConfig.roots), 1000)

  startupMetrics.end('restore-workspace')
  return true
}

/**
 * 应用级后台任务是否已启动
 *
 * 这些任务（云会话恢复 / 渠道连接 / 长时记忆梦境调度）在一个应用内只应存在一份：
 * 多开窗口时若每个窗口都跑一遍，定时器和网络请求会成倍增长（新窗口一开就多出
 * 一套 5 分钟梦境定时器与一组渠道连接）。因此只由应用级宿主窗口启动，
 * 宿主窗口关闭后主进程移交标记并通知接管窗口，这里被再次调用时靠该标记保持幂等。
 */
let appScopedTasksStarted = false

function startAppScopedBackgroundTasks(): void {
  if (appScopedTasksStarted) return
  appScopedTasksStarted = true

  const config = getScenarioInitConfig()

  scheduleIdleTask(() => {
    try {
      useStore.getState().restoreSession().catch((e) => {
        logger.system.warn('[Init] Cloud session restore failed:', e)
      })
    } catch (e) {
      logger.system.warn('[Init] Cloud session restore failed:', e)
    }
  })

  if (config.skipNonEssentialModules) return

  // 自动初始化渠道服务，确保飞书等渠道在应用启动时建立连接
  scheduleIdleTask(() => {
    api.channel.initialize().then(() => {
      logger.system.info('[Init] Channel service initialized')
    }).catch((e) => {
      logger.system.warn('[Init] Channel service init failed:', e)
    })
  })

  scheduleIdleTask(() => {
    try {
      dreamingScheduler.start()
    } catch (e) {
      logger.system.warn('[Init] Dreaming scheduler init failed:', e)
    }
  })
}

function scheduleBackgroundInit(isPrimaryWindow: boolean): void {
  // Worker 池改为按需创建（workerService.execute 首次调用时自建）：
  // 此前在启动时无条件预创建，每个窗口都会拉起一组后台线程，
  // 而空窗口（新建窗口）在用户打开工作区前根本用不到。
  if (isPrimaryWindow) {
    startAppScopedBackgroundTasks()
  }
}

export async function initializeApp(
  updateStatus: (status: string) => void,
  onWorkspaceReady?: () => void
): Promise<InitResult> {
  const config = getScenarioInitConfig()

  try {
    startupMetrics.start('init-total')

    if (config.auditInitSequence) {
      logger.system.info('[ScenarioInit] Starting scenario-aware initialization')
    }

    updateStatus(isZh() ? '正在初始化...' : 'Initializing...')
    await initCoreModules()

    updateStatus(isZh() ? '加载配置...' : 'Loading settings...')
    const params = new URLSearchParams(window.location.search)
    const isEmptyWindow = params.get('empty') === '1'
    // 应用级单例任务（云会话恢复 / 渠道连接 / 记忆调度）只在宿主窗口启动；
    // 查询失败时按宿主窗口处理，宁可多跑一次也不要让后台服务缺失
    const isPrimaryWindow = await api.window.isPrimary().catch(() => true)
    // 宿主窗口关闭后由主进程移交标记，接管窗口据此补启动应用级任务
    api.window.onPrimaryChanged(() => startAppScopedBackgroundTasks())
    const savedTheme = await loadUserSettings(isEmptyWindow)

    if (savedTheme && isThemeName(savedTheme)) {
      useStore.getState().setTheme(savedTheme)
    }

    // 从 electron-store 恢复 themeMode 和 themeColor（文件存储比 localStorage 更可靠）
    try {
      const [persistedMode, persistedColor] = await Promise.all([
        api.settings.get('themeMode'),
        api.settings.get('themeColor'),
      ])
      if (persistedMode === 'light' || persistedMode === 'dark' || persistedMode === 'system') {
        useStore.getState().setThemeMode(persistedMode)
      }
      if (persistedColor === 'blue' || persistedColor === 'purple' || persistedColor === 'red' || persistedColor === 'green') {
        useStore.getState().setThemeColor(persistedColor)
      }
    } catch (e) {
      logger.system.warn('[Init] Failed to restore themeMode/themeColor from electron-store:', e)
    }

    const { themeMode, themeColor } = useStore.getState()
    const resolvedTheme = themeManager.resolveThemeByModeAndColor(themeMode, themeColor)
    useStore.getState().setTheme(resolvedTheme.id)
    themeManager.setTheme(resolvedTheme.id)

    themeManager.startSystemThemeListener((isDark) => {
      const store = useStore.getState()
      store.setSystemPrefersDark(isDark)
      if (store.themeMode === 'system') {
        const resolved = themeManager.resolveThemeForMode('system')
        store.setTheme(resolved.id)
        themeManager.setTheme(resolved.id)
      }
    })

    const { onboardingCompleted, hasExistingConfig } = useStore.getState()

    if (!isEmptyWindow) {
      updateStatus(isZh() ? '恢复工作区...' : 'Restoring workspace...')
      await restoreWorkspace(onWorkspaceReady)
    }

    // 没有工作区时把欢迎页显式激活为入口页：空窗口（新建窗口 / ?empty=1）不做工作区恢复，
    // 首次启动未选择目录也走这里。欢迎页上的「打开文件夹 / 最近工作 / 新建任务」承担起始导航。
    if (!useStore.getState().workspace?.roots?.length) {
      useStore.getState().setShowWelcomePage(true)
    }

    // 初始化 AgentRuntime（解耦循环依赖）
    updateStatus(isZh() ? '启动智能引擎...' : 'Initializing agent runtime...')
    try {
      setupAgentRuntime()
      logger.system.info('[Init] AgentRuntime initialized')
    } catch (e) {
      logger.system.warn('[Init] AgentRuntime initialization failed:', e)
    }

    scheduleBackgroundInit(isPrimaryWindow)

    updateStatus(isZh() ? '准备就绪' : 'Ready!')
    startupMetrics.end('init-total')

    if (import.meta.env.DEV) {
      startupMetrics.mark('app-ready')
      startupMetrics.printReport()
    }

    const shouldShowOnboarding = onboardingCompleted === false ||
      (onboardingCompleted === undefined && !hasExistingConfig)

    return { success: true, shouldShowOnboarding }
  } catch (error) {
    logger.system.error('[Init] Failed to initialize app:', error)
    registerCoreCommands()

    return {
      success: false,
      shouldShowOnboarding: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function registerSettingsSync(): () => void {
  // ⚠️ 不在注册时捕获 store 快照，而是在回调中实时读取 useStore.getState()
  // 原因：注册时捕获的 store.llmConfig 是陈旧值，当主窗口广播模型变更时，
  //   比较 current.model !== next.model 会使用旧值导致判断错误，更新被跳过。
  //   这在执行窗口等多窗口场景下是模型选择不同步的核心原因。
  return api.settings.onChanged(({ key, value }: { key: string; value: unknown }) => {
    logger.system.debug(`[Init] Setting changed: ${key}`)
    // 每次回调实时获取最新 store（Zustand 的 getState() 返回当前快照）
    const store = useStore.getState()

    switch (key) {
      case 'llmConfig':
        if (isLLMConfig(value)) {
          store.update('llmConfig', value)
        }
        break
      // settingsService.save() 通过 api.settings.set('app-settings', payload) 持久化
      // 此时整个 SettingsState 被写入，需要从中提取 llmConfig 同步到 store
      // 这对执行窗口等多窗口场景至关重要：主窗口修改模型后，执行窗口需实时同步
      case 'app-settings': {
        const payload = value as { llmConfig?: unknown; language?: string } | null
        if (payload?.llmConfig && isLLMConfig(payload.llmConfig)) {
          // 使用实时读取的 store.llmConfig 进行比较（而非注册时的快照）
          const current = store.llmConfig
          const next = payload.llmConfig as typeof current
          if (current.provider !== next.provider || current.model !== next.model) {
            logger.system.info(
              '[Init] llmConfig changed via app-settings, syncing to store',
              `${current.provider}/${current.model} → ${next.provider}/${next.model}`,
            )
            // 合并更新：保留运行时云端字段（cloudMode/serverUrl/accessToken）
            //   payload 中的 llmConfig 来自 serializePersistedLLMConfig，可能缺少这些字段
            store.update('llmConfig', {
              ...current,
              ...next,
              // 保留运行时云端字段（payload 中可能不存在）
              cloudMode: next.cloudMode ?? current.cloudMode,
              serverUrl: next.serverUrl ?? current.serverUrl,
              accessToken: next.accessToken ?? current.accessToken,
              refreshToken: next.refreshToken ?? current.refreshToken,
            })
          }
        }
        if (payload?.language === 'en' || payload?.language === 'zh') {
          store.set('language', payload.language)
        }
        break
      }
      case 'language':
        if (value === 'en' || value === 'zh') {
          store.set('language', value)
        }
        break
      case 'autoApprove':
        if (isAutoApproveSettings(value)) {
          store.update('autoApprove', value)
        }
        break
      case 'promptTemplateId':
        if (typeof value === 'string') {
          store.set('promptTemplateId', value)
        }
        break
      case 'themeId':
        if (isThemeName(value)) {
          store.setTheme(value)
        }
        break
      case 'themeMode':
        if (value === 'light' || value === 'dark' || value === 'system') {
          store.setThemeMode(value)
        }
        break
      case 'themeColor':
        if (value === 'blue' || value === 'purple' || value === 'red' || value === 'green') {
          store.setThemeColor(value)
        }
        break
      case 'enableFileLogging':
        if (typeof value === 'boolean') {
          store.set('enableFileLogging', value)
        }
        break
      // 安全设置（含「工作区外允许访问的目录」）通过独立 key 广播。
      // 工具执行前的路径校验读取 store.securitySettings，必须实时同步，
      // 否则多窗口（主窗口/执行窗口/项目执行窗口）里新增的外部目录不会生效。
      case 'securitySettings':
        if (value && typeof value === 'object') {
          store.update('securitySettings', value as SecurityPolicyPanel)
        }
        break
    }
  })
}

function isLLMConfig(value: unknown): value is Partial<import('@store').LLMConfig> {
  return typeof value === 'object' && value !== null
}

function isAutoApproveSettings(value: unknown): value is Partial<import('@store').AutoApproveSettings> {
  return typeof value === 'object' && value !== null
}

function isThemeName(value: unknown): value is import('@store').ThemeName {
  const validThemes = ['aweeclaw-light', 'purple-light', 'lobster-red-light', 'forest-green-light', 'aweeclaw-dark', 'purple-dark', 'lobster-red-dark', 'forest-green-dark']
  return typeof value === 'string' && validThemes.includes(value)
}

export function registerAppErrorListener(): () => void {
  return api.app.onError(async (error) => {
    await globalConfirm({
      title: error.title,
      message: error.message,
      variant: (error.variant as 'danger' | 'warning' | 'info') || 'danger',
      confirmText: 'OK',
    })
  })
}

export function getActiveInitConfig(): ScenarioInitConfig {
  return getScenarioInitConfig()
}
