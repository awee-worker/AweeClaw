/**
 * 编程式场景模块适配器
 *
 * 将预编译的 ESM bundle 场景转换为 ScenarioModule 接口。
 * 编程式场景通过 aweeclaw-scenario-cli 编译为 ESM bundle，
 * 运行时通过动态 import 加载，共享依赖通过 __AWEECLAW_SHARED__ 注入。
 *
 * 与 DeclarativeScenarioModule 的区别：
 * - 声明式：JSON 配置 + Markdown + 沙箱 JS，无编译
 * - 编程式：预编译 ESM bundle，支持自定义 React 组件、完整 JS 逻辑
 *
 * 场景包目录结构：
 * scenarios/{scenario-id}/
 * ├── scenario.json          ← 元数据清单
 * ├── index.js               ← ESM bundle 入口
 * ├── styles.css             ← 可选样式
 * └── assets/                ← 可选静态资源
 */

import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
  ScenarioToolDefinition,
  ScenarioDbScript,
  ScenarioComponentRegistry,
  ScenarioIpcHandler,
} from '@shared/protocols/scenario-arch'
import type { ScenarioPlugin } from '@shared/protocols/scenario'
import { sharedDependencyProvider } from './SharedDependencyProvider'
import { PermissionGuard } from './PermissionGuard'
import { logger } from '@shared/toolkit/LogEngine'

export interface ProgrammaticScenarioConfig {
  id: string
  version: string
  name: string
  nameZh: string
  description?: string
  descriptionZh?: string
  author?: string
  icon?: string
  category?: string
  tags?: string[]
  minAppVersion?: string
  homepage?: string
  license?: string
  entryPoint: string
  styleFile?: string
  permissions?: string[]
  dependencies?: Array<{ id: string; versionRange?: string; required?: boolean }>
  sharedDeps?: Record<string, string>
}

export interface ProgrammaticScenarioExports {
  default?: {
    /** 自定义插件配置（identity/capabilities/ui/dataSources），覆盖默认 chat-centric 配置 */
    getPlugin?: () => Partial<ScenarioPlugin>
    getTools?: () => ScenarioToolDefinition[]
    getIpcHandlers?: () => ScenarioIpcHandler[]
    getComponents?: () => ScenarioComponentRegistry
    getInstallScripts?: () => ScenarioDbScript[]
    getUninstallScripts?: () => ScenarioDbScript[]
    onInstall?: (context: ScenarioModuleContext) => Promise<void>
    onActivate?: (context: ScenarioModuleContext) => Promise<void>
    onDeactivate?: (context: ScenarioModuleContext) => Promise<void>
    onUninstall?: (context: ScenarioModuleContext) => Promise<void>
    onHealthCheck?: () => Promise<ScenarioHealthCheck[]>
    getDependencies?: () => ScenarioDependency[]
  }
}

export class ProgrammaticScenarioModule implements ScenarioModule {
  private config: ProgrammaticScenarioConfig
  private moduleExports: ProgrammaticScenarioExports['default'] | null = null
  private styleElement: HTMLStyleElement | null = null
  private permissionGuard: PermissionGuard

  constructor(config: ProgrammaticScenarioConfig) {
    this.config = config
    this.permissionGuard = new PermissionGuard(
      config.id,
      (config.permissions || []) as import('@shared/protocols/scenario-arch').ScenarioPermission[],
    )
  }

  async loadModule(bundleUrl: string): Promise<void> {
    try {
      const compatCheck = sharedDependencyProvider.checkCompatibility(
        this.config.sharedDeps || {}
      )

      if (!compatCheck.compatible) {
        const mismatches = compatCheck.mismatches
          .map(m => `${m.module}: required ${m.required}, actual ${m.actual}`)
          .join('; ')
        logger.agent.warn(
          `[ProgrammaticModule] Dependency version mismatch for "${this.config.id}": ${mismatches}`
        )
      }

      const module = await import(/* @vite-ignore */ bundleUrl)
      this.moduleExports = module.default || module

      // 注入样式文件（使用 scenario-bundle:// 协议避免 webSecurity 限制）
      if (this.config.styleFile) {
        // bundleUrl = scenario-bundle:///path/to/scenario/dist/index.js
        // entryPoint = dist/index.js
        // 移除末尾的 entryPoint，得到场景目录 URL，再拼接 styleFile
        const baseUrl = bundleUrl.substring(0, bundleUrl.length - this.config.entryPoint.length)
        const styleUrl = baseUrl + this.config.styleFile
        this.injectStyles(styleUrl)
      }

      logger.agent.info(
        `[ProgrammaticModule] Loaded ESM bundle for scenario "${this.config.id}" v${this.config.version}`
      )
    } catch (err) {
      logger.agent.error(
        `[ProgrammaticModule] Failed to load ESM bundle for "${this.config.id}":`,
        err
      )
      throw err
    }
  }

  private injectStyles(stylePath: string): void {
    if (this.styleElement) return

    try {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = stylePath
      link.setAttribute('data-scenario-id', this.config.id)
      document.head.appendChild(link)
      this.styleElement = null

      logger.agent.info(`[ProgrammaticModule] Injected stylesheet for "${this.config.id}"`)
    } catch (err) {
      logger.agent.warn(`[ProgrammaticModule] Failed to inject stylesheet for "${this.config.id}":`, err)
    }
  }

  removeStyles(): void {
    const elements = document.querySelectorAll(
      `link[data-scenario-id="${this.config.id}"], style[data-scenario-id="${this.config.id}"]`
    )
    elements.forEach(el => el.remove())
    this.styleElement = null
  }

  get id(): string {
    return this.config.id
  }

  get version(): string {
    return this.config.version || '1.0.0'
  }

  getManifest(): ScenarioManifest {
    return {
      id: this.config.id,
      version: this.version,
      name: this.config.name,
      nameZh: this.config.nameZh,
      description: this.config.description || '',
      descriptionZh: this.config.descriptionZh || '',
      author: this.config.author || 'unknown',
      icon: this.config.icon || 'Package',
      category: (this.config.category || 'custom') as ScenarioManifest['category'],
      tags: this.config.tags || [],
      minAppVersion: this.config.minAppVersion,
      entryPoint: this.config.entryPoint,
      dependencies: (this.config.dependencies || []) as ScenarioDependency[],
      permissions: (this.config.permissions || []) as ScenarioManifest['permissions'],
      homepage: this.config.homepage,
      license: this.config.license,
    }
  }

  /**
   * 返回场景插件配置
   *
   * 默认提供 chat-centric 布局的最小可用配置。
   * 若 bundle 通过 getPlugin() 返回自定义配置（identity/capabilities/ui/dataSources），
   * 则与默认配置深度合并，使程序化场景能拥有独立的 systemPrompt、布局与侧边栏。
   */
  getPlugin(): ScenarioPlugin {
    const defaultPlugin: ScenarioPlugin = {
      id: this.config.id,
      name: this.config.name,
      nameZh: this.config.nameZh,
      icon: this.config.icon || 'Package',
      description: this.config.description || '',
      descriptionZh: this.config.descriptionZh || '',
      version: this.version,
      author: this.config.author || 'unknown',
      category: (this.config.category || 'custom') as ScenarioPlugin['category'],
      tags: this.config.tags || [],
      source: 'marketplace',
      hasSettings: false,
      requiresWorkspace: false,
      isBuiltin: false,
      identity: {
        systemPrompt: '',
        securityRules: '',
        conventions: '',
        workflow: '',
      },
      capabilities: {
        toolPacks: [],
        modes: [
          {
            id: 'chat',
            label: 'Quick',
            labelZh: '快速',
            icon: 'Zap',
            description: 'Suitable for most situations',
            descriptionZh: '适用于大部分情况',
            toolPolicy: { enabled: true, requireApproval: false },
          },
          {
            id: 'agent',
            label: 'Think',
            labelZh: '思考',
            icon: 'Brain',
            description: 'Excels at harder problems',
            descriptionZh: '擅长解决更难的问题',
            toolPolicy: { enabled: true, requireApproval: true },
          },
        ],
        contextTypes: [{ type: 'File', label: 'File', labelZh: '文件', priority: 1 }],
        outputFormats: ['text', 'markdown'],
      },
      ui: {
        layout: 'chat-centric',
        panels: [
          { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: false },
        ],
        sidebarItems: [],
        statusBarItems: [],
      },
      dataSources: { workspace: false },
    }

    // 合并 bundle 提供的自定义配置
    const customPlugin = this.moduleExports?.getPlugin?.()
    if (customPlugin) {
      return mergePluginConfig(defaultPlugin, customPlugin)
    }

    return defaultPlugin
  }

  getTools(): ScenarioToolDefinition[] {
    const tools = this.moduleExports?.getTools?.() || []
    return tools.map(def => ({
      ...def,
      executor: this.wrapWithPermissionCheck(def.name, def.executor),
    }))
  }

  private wrapWithPermissionCheck(toolName: string, executor: any): any {
    return async (args: Record<string, unknown>, context: any): Promise<any> => {
      const checkResult = this.permissionGuard.checkTool(toolName)
      if (!checkResult.allowed) {
        return {
          success: false,
          result: '',
          error: checkResult.reason || 'Permission denied',
        }
      }
      return executor(args, context)
    }
  }

  getIpcHandlers(): ScenarioIpcHandler[] {
    return this.moduleExports?.getIpcHandlers?.() || []
  }

  getComponents(): ScenarioComponentRegistry {
    return this.moduleExports?.getComponents?.() || {}
  }

  getInstallScripts(): ScenarioDbScript[] {
    return this.moduleExports?.getInstallScripts?.() || []
  }

  getUninstallScripts(): ScenarioDbScript[] {
    return this.moduleExports?.getUninstallScripts?.() || []
  }

  async onInstall(context: ScenarioModuleContext): Promise<void> {
    await this.moduleExports?.onInstall?.(context)
  }

  async onActivate(context: ScenarioModuleContext): Promise<void> {
    await this.moduleExports?.onActivate?.(context)
    context.publishData('scenario:activated', {
      scenarioId: context.scenarioId,
      version: context.version,
      type: 'programmatic',
    })
  }

  async onDeactivate(context: ScenarioModuleContext): Promise<void> {
    await this.moduleExports?.onDeactivate?.(context)
    context.publishData('scenario:deactivated', { scenarioId: context.scenarioId })
  }

  async onUninstall(context: ScenarioModuleContext): Promise<void> {
    await this.moduleExports?.onUninstall?.(context)
    this.removeStyles()
  }

  async onHealthCheck(): Promise<ScenarioHealthCheck[]> {
    if (this.moduleExports?.onHealthCheck) {
      return this.moduleExports.onHealthCheck()
    }

    return [
      {
        name: 'module',
        status: this.moduleExports ? 'healthy' : 'unhealthy',
        message: this.moduleExports
          ? 'Programmatic scenario module is running'
          : 'ESM bundle not loaded',
      },
    ]
  }

  getDependencies(): ScenarioDependency[] {
    return this.moduleExports?.getDependencies?.() ||
      (this.config.dependencies || []).map(d => ({
        id: d.id,
        versionRange: d.versionRange,
        required: d.required ?? true,
      }))
  }
}

// ============================================
// 配置合并工具
// ============================================

/**
 * 深度合并场景插件配置
 *
 * 将 bundle 提供的自定义配置（Partial<ScenarioPlugin>）与默认配置深度合并。
 * 对于对象类型的字段（identity/capabilities/ui/dataSources），逐级合并；
 * 对于数组与基础类型字段，自定义值覆盖默认值。
 */
function mergePluginConfig(
  base: ScenarioPlugin,
  override: Partial<ScenarioPlugin>,
): ScenarioPlugin {
  return {
    ...base,
    ...override,
    identity: { ...base.identity, ...(override.identity || {}) },
    capabilities: {
      ...base.capabilities,
      ...(override.capabilities || {}),
      modes: override.capabilities?.modes ?? base.capabilities.modes,
      contextTypes: override.capabilities?.contextTypes ?? base.capabilities.contextTypes,
      toolPacks: override.capabilities?.toolPacks ?? base.capabilities.toolPacks,
      outputFormats: override.capabilities?.outputFormats ?? base.capabilities.outputFormats,
    },
    ui: {
      ...base.ui,
      ...(override.ui || {}),
      panels: override.ui?.panels ?? base.ui.panels,
      sidebarItems: override.ui?.sidebarItems ?? base.ui.sidebarItems,
      statusBarItems: override.ui?.statusBarItems ?? base.ui.statusBarItems,
    },
    dataSources: {
      ...base.dataSources,
      ...(override.dataSources || {}),
    },
  }
}
