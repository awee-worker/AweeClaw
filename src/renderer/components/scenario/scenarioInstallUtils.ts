import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from '@scenario-system/core/ScenarioLoader'
import { DeclarativeScenarioModule } from '@scenario-system/core/DeclarativeScenarioModule'
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
}

export async function registerInstalledScenario(
  config: ScenarioConfigData,
  options: {
    scenarioId: string
    source: 'local' | 'marketplace'
    version?: string
  },
): Promise<void> {
  const { scenarioId, source, version } = options

  try {
    const filesResult = await api.scenarioInstall.loadScenarioFiles(scenarioId)

    if (filesResult.success && filesResult.files) {
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
      const plugin: ScenarioPlugin = {
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
      scenarioRegistry.registerAndPersist(plugin)
    }
  } catch (moduleErr) {
    console.warn('[ScenarioInstall] Failed to register DeclarativeScenarioModule:', moduleErr)

    const fallbackPlugin: ScenarioPlugin = {
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
    scenarioRegistry.registerAndPersist(fallbackPlugin)
  }

  const installScripts = config.installScripts
  if (installScripts && installScripts.length > 0) {
    await api.scenarioDb.initialize({
      scenarioId,
      installScripts,
    })
  }
}
