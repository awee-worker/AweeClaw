/**
 * 声明式场景模块适配器
 *
 * 将 DeclarativeScenarioConfig（JSON 配置 + 文件资源）转换为 ScenarioModule，
 * 使外部安装场景具备与内置场景对等的运行时能力。
 *
 * 支持的能力：
 * - 引用内置工具（tools.builtin）
 * - 声明式自定义工具（tools.custom，基于模板）
 * - 数据库安装/卸载脚本
 * - 文件引用的提示词（system.md 等）
 * - 生命周期钩子（onActivate/onDeactivate/onHealthCheck）
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
} from '@shared/protocols/scenario-arch'
import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
  UILayout,
} from '@shared/protocols/scenario'
import type {
  DeclarativeScenarioConfig,
  DeclarativeCustomTool,
} from '@shared/protocols/scenario-declarative'
import { builtinToolRegistry } from './BuiltinToolRegistry'
import { ScenarioScriptExecutor } from './ScenarioScriptExecutor'
import { PermissionGuard } from './PermissionGuard'
import type { ToolDefinition, ToolExecutionResult, ToolExecutionContext, ToolExecutor, ToolPropertySchema } from '../providerTypes'

function resolveFileContent(files: Record<string, string>, filePath: string, inlineContent?: string): string {
  if (inlineContent) return inlineContent
  if (files[filePath]) return files[filePath]
  return ''
}

function buildCustomToolExecutor(tool: DeclarativeCustomTool): ToolExecutor {
  return async (args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { template, executor: executorType, postProcess } = tool

    let result: ToolExecutionResult

    if (template) {
      let rendered = template
      for (const [key, value] of Object.entries(args)) {
        rendered = rendered.replaceAll(`{{${key}}}`, String(value ?? ''))
      }

      const executorArgs: Record<string, unknown> = {}

      switch (executorType) {
        case 'sql_query':
          executorArgs.query = rendered
          executorArgs.connection_id = args.connection_id ?? 'default'
          executorArgs.limit = args.limit ?? 100
          break
        case 'run_command':
          executorArgs.command = rendered
          break
        case 'read_file':
          executorArgs.path = rendered
          break
        case 'write_file':
          executorArgs.path = args.path ?? ''
          executorArgs.content = rendered
          break
        case 'web_search':
          executorArgs.query = rendered
          break
        case 'read_url':
          executorArgs.url = rendered
          break
        default:
          return { success: false, result: '', error: `Unknown executor type: ${executorType}` }
      }

      const { toolRegistry } = await import('@intelligence/toolkit/toolRegistry')
      result = await toolRegistry.execute(executorType, executorArgs, context)
    } else {
      const { toolRegistry } = await import('@intelligence/toolkit/toolRegistry')
      result = await toolRegistry.execute(executorType, args, context)
    }

    if (result.success && postProcess && result.result) {
      switch (postProcess) {
        case 'json':
          try {
            const parsed = JSON.parse(result.result)
            result.result = JSON.stringify(parsed, null, 2)
          } catch {}
          break
        case 'table':
        case 'markdown':
        case 'text':
          break
      }
    }

    return result
  }
}

function buildCustomToolDefinition(tool: DeclarativeCustomTool): ToolDefinition {
  const parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {},
    required: [],
  }

  for (const [key, param] of Object.entries(tool.parameters)) {
    const prop: ToolPropertySchema = {
      type: param.type,
      description: param.description,
    }
    if (param.enum) prop.enum = param.enum
    if (param.items) prop.items = { type: param.items.type, description: param.items.description }
    if (param.properties) {
      prop.properties = {}
      for (const [pk, pv] of Object.entries(param.properties)) {
        prop.properties[pk] = { type: pv.type, description: pv.description }
      }
    }
    parameters.properties![key] = prop
    if (param.required) {
      (parameters.required as string[]).push(key)
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters,
  }
}

export class DeclarativeScenarioModule implements ScenarioModule {
  private config: DeclarativeScenarioConfig
  private files: Record<string, string>
  private scriptExecutor: ScenarioScriptExecutor | null = null
  private permissionGuard: PermissionGuard

  constructor(config: DeclarativeScenarioConfig, files: Record<string, string>) {
    this.config = config
    this.files = files
    this.permissionGuard = new PermissionGuard(config.id, (config.permissions || []) as import('@shared/protocols/scenario-arch').ScenarioPermission[])

    if (config.scripts) {
      this.scriptExecutor = new ScenarioScriptExecutor(
        config.id,
        config.version || '1.0.0',
        files,
        config.scripts,
      )
    }
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
      category: this.config.category || 'custom',
      tags: this.config.tags || [],
      minAppVersion: this.config.minAppVersion,
      entryPoint: './config/scenario.json',
      dependencies: this.config.dependencies || [],
      permissions: (this.config.permissions || []) as ScenarioManifest['permissions'],
      homepage: this.config.homepage,
      license: this.config.license,
    }
  }

  getPlugin(): ScenarioPlugin {
    const identity = this.config.identity
    const capabilities = this.config.capabilities
    const ui = this.config.ui

    const scenarioIdentity: ScenarioIdentity = {
      systemPrompt: resolveFileContent(this.files, 'prompts/system.md', identity?.systemPrompt),
      securityRules: resolveFileContent(this.files, 'prompts/security.md', identity?.securityRules),
      conventions: resolveFileContent(this.files, 'prompts/conventions.md', identity?.conventions),
      workflow: resolveFileContent(this.files, 'prompts/workflow.md', identity?.workflow),
      outputFormat: identity?.outputFormat,
      toolGuidelines: identity?.toolGuidelines,
    }

    const toolNames = [
      ...(capabilities?.builtinTools || []),
      ...(capabilities?.customTools?.map(t => t.name) || []),
    ]

    const scenarioCapabilities: ScenarioCapabilities = {
      toolPacks: toolNames.length > 0 ? ['custom'] : [],
      modes: capabilities?.modes || [
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
      contextTypes: capabilities?.contextTypes || [
        { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
      ],
      outputFormats: capabilities?.outputFormats || ['text', 'markdown'],
    }

    const scenarioUI: ScenarioUI = {
      layout: (ui?.layout || 'chat-centric') as UILayout,
      panels: ui?.panels?.map(p => {
        const knownPanels: Record<string, { id: string; component: string; region: 'primary' | 'secondary' | 'auxiliary' | 'floating'; defaultVisible: boolean; resizable: boolean }> = {
          chat: { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: false },
          terminal: { id: 'terminal', component: 'TerminalPanel', region: 'floating', defaultVisible: false, resizable: true },
        }
        return knownPanels[p] || { id: p, component: p, region: 'primary' as const, defaultVisible: true, resizable: true }
      }) || [
        { id: 'chat', component: 'ChatPanel', region: 'primary' as const, defaultVisible: true, resizable: false },
      ],
      sidebarItems: ui?.sidebarItems || [],
      statusBarItems: [],
      welcomeComponent: ui?.welcomeComponent,
    }

    const scenarioDataSources: ScenarioDataSources = {
      workspace: this.config.requiresWorkspace || false,
    }

    return {
      id: this.config.id,
      name: this.config.name,
      nameZh: this.config.nameZh,
      icon: this.config.icon || 'Package',
      description: this.config.description || '',
      descriptionZh: this.config.descriptionZh || '',
      version: this.version,
      author: this.config.author || 'unknown',
      category: this.config.category || 'custom',
      tags: this.config.tags || [],
      source: (this.config.source || 'local') as ScenarioPlugin['source'],
      hasSettings: this.config.hasSettings || false,
      requiresWorkspace: this.config.requiresWorkspace || false,
      isBuiltin: false,
      identity: scenarioIdentity,
      capabilities: scenarioCapabilities,
      ui: scenarioUI,
      dataSources: scenarioDataSources,
    }
  }

  getTools(): ScenarioToolDefinition[] {
    const tools: ScenarioToolDefinition[] = []

    if (this.config.capabilities?.builtinTools) {
      const builtinDefs = builtinToolRegistry.getToolDefinitions(this.config.capabilities.builtinTools)
      // 为每个内置工具包装权限检查
      const checkedDefs = builtinDefs.map(def => ({
        ...def,
        executor: this.wrapWithPermissionCheck(def.name, def.executor),
      }))
      tools.push(...checkedDefs)
    }

    if (this.config.capabilities?.customTools) {
      for (const customTool of this.config.capabilities.customTools) {
        const executor = buildCustomToolExecutor(customTool)
        tools.push({
          name: customTool.name,
          definition: buildCustomToolDefinition(customTool),
          executor: this.wrapWithPermissionCheck(customTool.name, executor),
        })
      }
    }

    if (this.scriptExecutor) {
      const scriptTools = this.scriptExecutor.getScriptToolDefinitions()
      const checkedScriptTools = scriptTools.map(def => ({
        ...def,
        executor: this.wrapWithPermissionCheck(def.name, def.executor),
      }))
      tools.push(...checkedScriptTools)
    }

    return tools
  }

  /**
   * 用权限检查包装工具执行器
   */
  private wrapWithPermissionCheck(toolName: string, executor: ToolExecutor): ToolExecutor {
    return async (args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
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

  getComponents(): ScenarioComponentRegistry {
    return {}
  }

  getInstallScripts(): ScenarioDbScript[] {
    const db = this.config.database
    if (!db) return []

    const scripts: ScenarioDbScript[] = []

    if (db.installScripts) {
      scripts.push(...db.installScripts)
    }

    if (db.installScriptFiles) {
      for (const filePath of db.installScriptFiles) {
        const content = this.files[filePath]
        if (content) {
          const statements = content
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0)

          for (const sql of statements) {
            scripts.push({
              id: `${this.config.id}:install:${filePath}:${sql.substring(0, 20).replace(/\s/g, '_')}`,
              description: `Install script from ${filePath}`,
              sql: sql.endsWith(';') ? sql : sql + ';',
            })
          }
        }
      }
    }

    return scripts
  }

  getUninstallScripts(): ScenarioDbScript[] {
    const db = this.config.database
    if (!db) return []

    const scripts: ScenarioDbScript[] = []

    if (db.uninstallScripts) {
      scripts.push(...db.uninstallScripts)
    }

    if (db.uninstallScriptFiles) {
      for (const filePath of db.uninstallScriptFiles) {
        const content = this.files[filePath]
        if (content) {
          const statements = content
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0)

          for (const sql of statements) {
            scripts.push({
              id: `${this.config.id}:uninstall:${filePath}:${sql.substring(0, 20).replace(/\s/g, '_')}`,
              description: `Uninstall script from ${filePath}`,
              sql: sql.endsWith(';') ? sql : sql + ';',
            })
          }
        }
      }
    }

    return scripts
  }

  async onInstall(context: ScenarioModuleContext): Promise<void> {
    const log = context.getLogger()
    log.info(`Installing declarative scenario: ${context.scenarioId} v${context.version}`)
  }

  async onActivate(context: ScenarioModuleContext): Promise<void> {
    const log = context.getLogger()
    const health = context.getHealthReporter()
    log.info(`Activating declarative scenario: ${context.scenarioId} v${context.version}`)

    if (this.config.database) {
      health.reportCheck('database', 'healthy', 'Database scripts configured')
    }

    if (this.scriptExecutor) {
      await this.scriptExecutor.executeOnActivate(context)
    }

    context.publishData('scenario:activated', {
      scenarioId: context.scenarioId,
      version: context.version,
      type: 'declarative',
    })
  }

  async onDeactivate(context: ScenarioModuleContext): Promise<void> {
    const log = context.getLogger()
    log.info(`Deactivating declarative scenario: ${context.scenarioId}`)

    if (this.scriptExecutor) {
      await this.scriptExecutor.executeOnDeactivate(context)
    }

    context.publishData('scenario:deactivated', { scenarioId: context.scenarioId })
  }

  async onUninstall(context: ScenarioModuleContext): Promise<void> {
    const log = context.getLogger()
    log.info(`Uninstalling declarative scenario: ${context.scenarioId}`)
  }

  async onHealthCheck(): Promise<ScenarioHealthCheck[]> {
    const checks: ScenarioHealthCheck[] = [
      { name: 'module', status: 'healthy', message: 'Declarative scenario module is running' },
    ]

    const toolCount = this.getTools().length
    checks.push({
      name: 'tools',
      status: toolCount > 0 ? 'healthy' : 'degraded',
      message: toolCount > 0 ? `${toolCount} tools available` : 'No tools configured',
    })

    if (this.scriptExecutor) {
      const scriptChecks = await this.scriptExecutor.executeOnHealthCheck()
      checks.push(...scriptChecks)
    }

    return checks
  }

  getDependencies(): ScenarioDependency[] {
    return (this.config.dependencies || []).map(d => ({
      id: d.id,
      versionRange: d.versionRange,
      required: d.required ?? true,
    }))
  }
}
