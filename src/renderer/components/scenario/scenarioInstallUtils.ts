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
import { loadProgrammaticScenario } from '@scenario-system/core/ProgrammaticScenarioLoader'
import { api } from '../../adapters/electronBridge'
import type { ScenarioPlugin } from '@shared/protocols/scenario'

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
  }
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
  },
): Promise<void> {
  const { scenarioId, source, version } = options
  const isProgrammatic = config.packageType === 'programmatic'

  try {
    const filesResult = await api.scenarioInstall.loadScenarioFiles(scenarioId)

    if (isProgrammatic) {
      // ============================================
      // 编程式场景：加载 ESM bundle
      // ============================================
      await registerProgrammaticScenario(config, scenarioId, source, version)
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
        source,
        version: config.version || version || '1.0.0',
      }
      scenarioRegistry.registerAndPersist(plugin)
    } else {
      // 文件加载失败，使用基础配置注册
      const plugin = buildBasePlugin(config, scenarioId, source, version)
      scenarioRegistry.registerAndPersist(plugin)
    }
  } catch (moduleErr) {
    logger.scenario.warn('[ScenarioInstall] Failed to register scenario module:', moduleErr)
    const fallbackPlugin = buildBasePlugin(config, scenarioId, source, version)
    scenarioRegistry.registerAndPersist(fallbackPlugin)
  }

  // 执行安装脚本（初始化数据库表）
  const installScripts = config.installScripts
  if (installScripts && installScripts.length > 0) {
    await api.scenarioDb.initialize({
      scenarioId,
      installScripts,
    })
  }
}

/**
 * 注册编程式场景
 *
 * 流程：
 * 1. 调用 loadProgrammaticScenario 加载 ESM bundle（动态 import）
 * 2. ProgrammaticScenarioModule 在加载时读取 bundle 的 getPlugin() 获取自定义 UI 配置
 * 3. 从 scenarioLoader 获取完整的 plugin 配置（含 bundle 提供的 sidebarItems、systemPrompt 等）
 * 4. 注册到 scenarioRegistry 以供 UI 层消费
 */
async function registerProgrammaticScenario(
  config: ScenarioConfigData,
  scenarioId: string,
  source: 'local' | 'marketplace',
  version: string | undefined,
): Promise<void> {
  // 先注册一个基础 plugin 作为占位（确保 scenarioRegistry 中有记录）
  const basePlugin = buildBasePlugin(config, scenarioId, source, version)
  scenarioRegistry.registerAndPersist(basePlugin)

  // 调用 loadProgrammaticScenario 加载 ESM bundle
  const loadResult = await loadProgrammaticScenario(scenarioId)

  if (!loadResult.success) {
    logger.scenario.warn(
      `[ScenarioInstall] Failed to load programmatic scenario "${scenarioId}": ${loadResult.error}`
    )
    // 加载失败时保留基础 plugin（已在上面注册）
    return
  }

  // 从 scenarioLoader 获取完整的 plugin 配置
  // ProgrammaticScenarioModule.getPlugin() 会合并 bundle 的 getPlugin() 返回值
  const fullPlugin = scenarioLoader.getPlugin(scenarioId)
  if (fullPlugin) {
    // 用 bundle 提供的完整配置覆盖占位 plugin
    const plugin: ScenarioPlugin = {
      ...fullPlugin,
      source,
      version: config.version || version || '1.0.0',
    }
    scenarioRegistry.registerAndPersist(plugin)
    logger.scenario.info(
      `[ScenarioInstall] Registered programmatic scenario "${scenarioId}" with ${plugin.ui?.sidebarItems?.length || 0} sidebar items`
    )
  }
}
