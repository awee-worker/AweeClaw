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
import { workerService } from './workerAdapter'
import { workspaceStorageRuntime } from './workspaceStorageAdapter'
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
  'workspace-editor': {
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
  const scenarioId = useStore.getState().activeScenarioId ?? 'workspace-editor'
  return SCENARIO_INIT_CONFIGS[scenarioId] ?? SCENARIO_INIT_CONFIGS['workspace-editor']
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

  const { webSearchConfig, mcpConfig } = useStore.getState()
  if (webSearchConfig?.searchEngines) {
    api.http.setSearchEngineState({
      searchEngines: webSearchConfig.searchEngines,
      activeSearchEngine: webSearchConfig.activeSearchEngine || 'duckduckgo',
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

async function restoreWorkspace(): Promise<boolean> {
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

function scheduleBackgroundInit(): void {
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

  if (!config.skipNonEssentialModules) {
    scheduleIdleTask(() => {
      try {
        workerService.init()
        logger.system.debug('[Init] Worker service initialized')
      } catch (e) {
        logger.system.warn('[Init] Worker service init failed:', e)
      }
    })

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
        const { dreamingScheduler } = require('@intelligence/runtime/longTermMemoryService/dreamingScheduler')
        dreamingScheduler.start()
      } catch (e) {
        logger.system.warn('[Init] Dreaming scheduler init failed:', e)
      }
    })
  }
}

export async function initializeApp(
  updateStatus: (status: string) => void
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
    const savedTheme = await loadUserSettings(isEmptyWindow)

    if (savedTheme && isThemeName(savedTheme)) {
      useStore.getState().setTheme(savedTheme)
    }

    const { themeMode } = useStore.getState()
    if (themeMode === 'system') {
      const resolvedTheme = themeManager.resolveThemeForMode('system')
      useStore.getState().setTheme(resolvedTheme.id)
      themeManager.setTheme(resolvedTheme.id)
    }

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
      await restoreWorkspace()
    }

    // 初始化 AgentRuntime（解耦循环依赖）
    updateStatus(isZh() ? '启动智能引擎...' : 'Initializing agent runtime...')
    try {
      setupAgentRuntime()
      logger.system.info('[Init] AgentRuntime initialized')
    } catch (e) {
      logger.system.warn('[Init] AgentRuntime initialization failed:', e)
    }

    scheduleBackgroundInit()

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
  const store = useStore.getState()

  return api.settings.onChanged(({ key, value }: { key: string; value: unknown }) => {
    logger.system.debug(`[Init] Setting changed: ${key}`)

    switch (key) {
      case 'llmConfig':
        if (isLLMConfig(value)) {
          store.update('llmConfig', value)
        }
        break
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
      case 'enableFileLogging':
        if (typeof value === 'boolean') {
          store.set('enableFileLogging', value)
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
