/**
 * 场景安装工具
 *
 * 负责将已安装的场景注册到 scenarioRegistry 和 scenarioLoader。
 *
 * 两种场景类型分发逻辑：
 * - declarative（声明式）：JSON 配置 + Markdown 提示词 + 沙箱 JS
 *   → 创建 DeclarativeScenarioModule，直接注册
 * - programmatic（编程式）：预编译 ESM bundle
 *   → 调用 loadProgrammaticScenario 加载 bundle，再注册插件配置
 */

import { scenarioRegistry } from '@shared/configuration/scenarios'
import { logger } from '@shared/toolkit/LogEngine'
import { scenarioLoader } from '@scenario-system/core/ScenarioLoader'
import { DeclarativeScenarioModule } from '@scenario-system/core/DeclarativeScenarioModule'
import {
  loadProgrammaticScenario,
  unloadProgrammaticScenario,
} from '@scenario-system/core/ProgrammaticScenarioLoader'
import { api } from '../../adapters/electronBridge'
import { linkMarketplaceScenario } from '../../adapters/scenarioMarketplaceMap'
import type { ScenarioPlugin } from '@shared/protocols/scenario'
import { useStore } from '@store'

interface ScenarioConfigData {
  id?: string
  name?: string
  nameZh?: string
  icon?: string
  description?: string
  descriptionZh?: string
  version?: string
  author?: string
  category?: string
  tags?: string[]
  hasSettings?: boolean
  requiresWorkspace?: boolean
  identity?: Record<string, unknown>
  capabilities?: Record<string, unknown>
  ui?: Record<string, unknown>
  dataSources?: Record<string, unknown>
  installScripts?: Array<{ id: string; description?: string; sql: string }>
  /** 场景包类型：declarative（声明式）或 programmatic（编程式） */
  packageType?: string
  /** 编程式场景的入口文件路径（如 dist/index.js） */
  entryPoint?: string
  /** 编程式场景的样式文件路径（如 dist/styles.css） */
  styleFile?: string
  /** 编程式场景的共享依赖声明 */
  sharedDeps?: Record<string, string>
  /** 编程式场景所需的权限列表 */
  permissions?: string[]
  /** 最小应用版本 */
  minAppVersion?: string
  homepage?: string
  license?: string
  /** 会话边界：随清单一起落盘，bundle 未就绪时也不至于退化成「无边界」 */
  sessionScope?: Record<string, unknown>
}

/**
 * 构建基础 ScenarioPlugin（用于 fallback 或 programmatic 加载前的占位）
 */
function buildBasePlugin(
  config: ScenarioConfigData,
  scenarioId: string,
  source: 'local' | 'marketplace',
  version?: string,
): ScenarioPlugin {
  return {
    id: scenarioId,
    name: config.name || scenarioId,
    nameZh: config.nameZh || config.name || scenarioId,
    icon: config.icon || 'Package',
    description: config.description || '',
    descriptionZh: config.descriptionZh || config.description || '',
    version: config.version || version || '1.0.0',
    author: config.author || 'unknown',
    category: (config.category as ScenarioPlugin['category']) || 'custom',
    tags: config.tags || [],
    source,
    hasSettings: config.hasSettings || false,
    requiresWorkspace: config.requiresWorkspace || false,
    isBuiltin: false,
    identity: (config.identity as unknown as ScenarioPlugin['identity']) || {
      systemPrompt: '',
      securityRules: '',
      conventions: '',
      workflow: '',
    },
    capabilities: (config.capabilities as unknown as ScenarioPlugin['capabilities']) || {
      toolPacks: [],
      modes: [],
      contextTypes: [],
      outputFormats: [],
    },
    ui: (config.ui as unknown as ScenarioPlugin['ui']) || {
      layout: 'chat-centric',
      panels: [],
      sidebarItems: [],
      statusBarItems: [],
    },
    dataSources: (config.dataSources as unknown as ScenarioPlugin['dataSources']) || {
      workspace: false,
    },
    // 会话边界随清单一起落盘：bundle 未就绪时不至于退化成「无边界」，
    // 后续 bundle 加载成功再由 ExternalScenarioLoader 以最新声明覆盖
    sessionScope: config.sessionScope as unknown as ScenarioPlugin['sessionScope'],
  }
}

/**
 * 卸载进程内已注册的旧场景模块
 *
 * 场景更新只替换磁盘文件，进程内的模块不会自动失效。不卸载就直接注册，
 * ScenarioLoader.register 在场景处于激活态时会直接 return，用户看到的是
 * 「更新成功、版本号也变了，功能还是旧的」，只有重启才恢复。
 *
 * 首次安装时 loader 里没有该条目，这里直接返回，不影响正常流程。
 */
async function unloadExistingScenarioModule(
  scenarioId: string,
  isProgrammatic: boolean,
): Promise<void> {
  if (!scenarioLoader.has(scenarioId)) return

  if (isProgrammatic) {
    await unloadProgrammaticScenario(scenarioId)
    return
  }

  // 声明式场景没有独立样式文件，卸载只需退出激活态后注销条目；
  // 激活中的条目 unregister 会被拒绝，必须先 deactivate。
  const state = scenarioLoader.getState(scenarioId)
  if (state === 'activated' || state === 'activating') {
    await scenarioLoader.deactivate(scenarioId)
  }
  scenarioLoader.unregister(scenarioId)
}

/**
 * 注册已安装的场景
 *
 * 根据 packageType 分发到不同的注册流程：
 * - programmatic: 通过 ProgrammaticScenarioLoader 加载 ESM bundle
 * - declarative (默认): 创建 DeclarativeScenarioModule
 */
export async function registerInstalledScenario(
  config: ScenarioConfigData,
  options: {
    scenarioId: string
    source: 'local' | 'marketplace'
    version?: string
    /** 来源市场条目 ID（与 config.id 可能不同），用于市场页判断安装状态与查询更新 */
    marketplaceId?: string
    /**
     * 市场条目图标
     *
     * 已安装场景要展示它在场景应用市场里的图标，而场景包自带的 icon 未必一致，
     * 因此安装/更新时把市场图标一并写进注册信息。
     */
    icon?: string
  },
): Promise<void> {
  const { scenarioId, source, version, marketplaceId, icon } = options
  const isProgrammatic = config.packageType === 'programmatic'

  // 注册到 registry/loader 的 key 是 config.id（可能与市场场景 ID/目录名不一致），
  // 因此加载场景文件必须以 config.id 为准；主进程 loadScenarioFiles 已支持
  // 目录名与 config.id 不一致时按 config.id 扫描匹配实际目录。
  const loadScenarioId = config.id || scenarioId
  const resolvedVersion = config.version || version || '1.0.0'
  /** 实际注册进 registry 的场景 ID，用于建立市场 ID 映射 */
  let registeredId = loadScenarioId

  // 卸载旧模块会把场景退回「已注册未激活」，若用户更新时正在使用这个场景，
  // 注册完成后必须把激活态还回去，否则面板与工具都会失效
  const wasActive = scenarioLoader.getState(loadScenarioId) === 'activated'

  try {
    const filesResult = await api.scenarioInstall.loadScenarioFiles(loadScenarioId)

    // 更新场景时进程内的旧模块仍然挂着，先卸载再注册，新版本才会真正生效。
    // 放在读取新文件之后：新文件读不出来时，不该把本来还能用的旧模块摘掉。
    await unloadExistingScenarioModule(loadScenarioId, isProgrammatic)

    if (isProgrammatic) {
      // ============================================
      // 编程式场景：加载 ESM bundle
      // ============================================
      registeredId = await registerProgrammaticScenario(
        config,
        scenarioId,
        source,
        version,
        marketplaceId,
        icon,
      )
    } else if (filesResult.success && filesResult.files) {
      // ============================================
      // 声明式场景：创建 DeclarativeScenarioModule
      // ============================================
      const declarativeModule = new DeclarativeScenarioModule(
        config as any,
        filesResult.files,
      )
      scenarioLoader.register(declarativeModule)

      const modulePlugin = declarativeModule.getPlugin()
      const plugin: ScenarioPlugin = {
        ...modulePlugin,
        icon: icon || modulePlugin.icon,
        source,
        version: resolvedVersion,
        marketplaceId,
      }
      scenarioRegistry.registerAndPersist(plugin)
      registeredId = plugin.id
    } else {
      const plugin: ScenarioPlugin = {
        ...buildBasePlugin(config, scenarioId, source, version),
        icon: icon || config.icon || scenarioId,
        marketplaceId,
      }
      scenarioRegistry.registerAndPersist(plugin)
      registeredId = plugin.id
    }
  } catch (moduleErr) {
    logger.scenario.warn('[ScenarioInstall] Failed to register scenario module:', moduleErr)
    // 对于 programmatic 场景，加载失败时不注册 fallback plugin，
    // 避免空配置（sidebarItems=[]）被持久化导致 NavigationRail 显示默认菜单而非场景菜单。
    // 对于 declarative 场景，保留 fallback 行为（声明式场景的 sidebarItems 可由 UI 默认渲染）。
    if (!isProgrammatic) {
      const fallbackPlugin: ScenarioPlugin = {
        ...buildBasePlugin(config, scenarioId, source, version),
        icon: icon || config.icon || scenarioId,
        marketplaceId,
      }
      scenarioRegistry.registerAndPersist(fallbackPlugin)
    }
    // 重新抛出错误，让调用方知道安装失败并显示错误提示
    throw moduleErr
  }

  // 记录市场条目与本地场景的对应关系：config.id 与市场 ID 不一致时，
  // 市场页只有拿到这条映射才知道该条目已经安装
  if (marketplaceId) {
    linkMarketplaceScenario(marketplaceId, registeredId, resolvedVersion, icon)
  }

  // 执行安装脚本（初始化数据库表）
  const installScripts = config.installScripts
  if (installScripts && installScripts.length > 0) {
    await api.scenarioDb.initialize({
      scenarioId,
      installScripts,
    })
  }

  // 恢复更新前的激活态：用户可能正在使用这个场景，更新完不该把它停在未激活状态
  if (wasActive) {
    const activated = await scenarioLoader.activate(
      loadScenarioId,
      useStore.getState().workspacePath ?? null,
    )
    if (!activated) {
      logger.scenario.warn(`[ScenarioInstall] 恢复场景 "${loadScenarioId}" 激活态失败`)
    }
  }

  // 递增场景配置版本号，触发 AweeApp 重新计算 layoutConfig
  // 这确保场景安装/重装后，ShellComposer 缓存被清除，新的 sidebarItems/wideModePanelIds 立即生效
  useStore.getState().incrementScenarioConfigVersion()
}

/**
 * 注册编程式场景
 *
 * 流程：
 * 1. 调用 loadProgrammaticScenario 加载 ESM bundle（动态 import）
 * 2. ProgrammaticScenarioModule 在加载时读取 bundle 的 getPlugin() 获取自定义 UI 配置
 * 3. 从 scenarioLoader 获取完整的 plugin 配置（含 bundle 提供的 sidebarItems、systemPrompt 等）
 * 4. 注册到 scenarioRegistry 以供 UI 层消费
 *
 * 注意：不预先注册占位 plugin。若预先注册 buildBasePlugin 返回的占位 plugin
 * （ui.sidebarItems=[]），一旦 ESM bundle 加载失败，空配置会被持久化到 localStorage，
 * 导致 NavigationRail 找不到 sidebarItems 而回退到 DEFAULT_ITEMS，场景功能完全失效。
 * 正确做法是加载成功后才注册完整 plugin；加载失败时抛出错误由调用方处理。
 */
async function registerProgrammaticScenario(
  config: ScenarioConfigData,
  scenarioId: string,
  source: 'local' | 'marketplace',
  version: string | undefined,
  marketplaceId?: string,
  icon?: string,
): Promise<string> {
  // loader 的 key 是 config.id（可能与市场场景 ID / 目录名不一致）。加载、卸载、
  // 读取插件配置必须用同一个 key，否则卸载摘不到旧模块、getPlugin 也取不到新配置。
  const loaderKey = config.id || scenarioId

  // force：走到这里就代表「以磁盘上的 bundle 为准」。已存在的旧模块必须先卸载再加载，
  // 否则 loadProgrammaticScenario 会命中 has() 短路，直接返回成功而不读新文件。
  const loadResult = await loadProgrammaticScenario(loaderKey, { force: true })

  if (!loadResult.success) {
    logger.scenario.warn(
      `[ScenarioInstall] Failed to load programmatic scenario "${scenarioId}": ${loadResult.error}`
    )
    // 加载失败时抛出错误，由调用方决定后续处理
    // 不注册空配置占位 plugin，避免误导 UI
    throw new Error(`Failed to load programmatic scenario: ${loadResult.error}`)
  }

  // bundle 加载成功不等于模块已注册：ScenarioLoader.register() 在 minAppVersion
  // 高于当前客户端版本时会直接 return（只打日志，不抛错）。此时后续所有读取都会
  // 拿到 undefined，若继续兜底注册，会把空 ui（sidebarItems=[]）持久化进 localStorage，
  // 左侧导航因此回退到默认菜单，而界面仍显示「安装成功」——用户完全无从判断。
  // 这里必须显式失败，把真实原因交给 UI。
  // 从 scenarioLoader 获取完整的 plugin 配置
  // ProgrammaticScenarioModule.getPlugin() 会合并 bundle 的 getPlugin() 返回值
  const fullPlugin = scenarioLoader.getPlugin(loaderKey)
  if (!fullPlugin) {
    throw new Error(`场景 "${loaderKey}" 已加载但未取到插件配置，安装中止`)
  }

  // 注册完整 plugin（含 bundle 提供的 sidebarItems、systemPrompt 等）
  const plugin: ScenarioPlugin = {
    ...fullPlugin,
    icon: icon || fullPlugin.icon,
    source,
    version: config.version || version || '1.0.0',
    marketplaceId,
  }
  scenarioRegistry.registerAndPersist(plugin)
  logger.scenario.info(
    `[ScenarioInstall] Registered programmatic scenario "${scenarioId}" with ${plugin.ui?.sidebarItems?.length || 0} sidebar items`
  )
  return plugin.id
}
