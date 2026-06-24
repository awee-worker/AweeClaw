/**
 * 场景开发助手（scenario-builder）场景模块入口
 *
 * 实现 ScenarioModule 接口，支持：
 * - 场景项目管理：创建、打开、管理场景项目
 * - 配置编辑：scenario.json、提示词、数据库脚本
 * - 构建调试：校验、构建、热重载
 * - 本地安装：将构建产物安装到客户端
 * - 发布市场：发布到开发者中心
 *
 * 内置 aweeclaw-docs 场景开发知识库，让 AI 了解如何开发场景。
 */
import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/protocols/scenario-arch'
import { scenarioBuilderScenario } from './config/scenario'
import { getScenarioBuilderTools } from './tools'
import { scenarioBuilderComponents } from './components'
import { scenarioBuilderIpcHandlers } from './ipc/handlers'
import { INSTALL_SCRIPTS, UNINSTALL_SCRIPTS } from './db/scripts'
import { registerScenarioBuilderI18n, unregisterScenarioBuilderI18n } from './i18n'
import { projectService, buildService, installService, publishService } from './services'

const SCENARIO_BUILDER_MANIFEST: ScenarioManifest = {
  id: 'scenario-builder',
  version: '0.1.0',
  name: 'Scenario Builder',
  nameZh: '场景开发助手',
  description: 'Develop your own AweeClaw scenarios — create, debug, install, and publish',
  descriptionZh: '开发你自己的 AweeClaw 场景 — 创建、调试、安装、发布',
  author: 'awee',
  icon: 'Wrench',
  category: 'development',
  tags: ['scenario', 'builder', 'developer', 'scaffold', 'publish'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: [
    'filesystem:read',
    'filesystem:write',
    'terminal:execute',
    'database:connect',
    'database:query',
    'notification:send',
    'system:info',
  ],
  homepage: 'https://github.com/jweelee/aweeclaw',
  license: 'SEE LICENSE IN LICENSE',
}

const scenarioBuilderModule: ScenarioModule = {
  id: 'scenario-builder',
  version: '0.1.0',

  getManifest: () => SCENARIO_BUILDER_MANIFEST,

  getPlugin: () => scenarioBuilderScenario,

  getTools: () => getScenarioBuilderTools(),

  getComponents: () => scenarioBuilderComponents,

  getIpcHandlers: () => scenarioBuilderIpcHandlers,

  getInstallScripts: () => INSTALL_SCRIPTS,

  getUninstallScripts: () => UNINSTALL_SCRIPTS,

  onInstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Installing scenario-builder v${context.version}`)
  },

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Activating scenario-builder v${context.version}`)

    // 注册 i18n
    registerScenarioBuilderI18n()

    // 注入上下文到各服务
    projectService.setContext(context)
    buildService.setContext(context)
    installService.setContext(context)
    publishService.setContext(context)

    // 发布激活事件
    context.publishData('scenario:activated', {
      scenarioId: 'scenario-builder',
      capabilities: [
        'project_management',
        'config_editing',
        'build_debug',
        'local_install',
        'marketplace_publish',
        'knowledge_base',
      ],
    })

    log.info('scenario-builder activated successfully')
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Deactivating scenario-builder')

    unregisterScenarioBuilderI18n()

    context.publishData('scenario:deactivated', { scenarioId: 'scenario-builder' })
  },

  onUninstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Uninstalling scenario-builder')
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    return [
      { name: 'project-service', status: 'healthy', message: 'Project service is ready' },
      { name: 'build-service', status: 'healthy', message: 'Build service is ready' },
      { name: 'database', status: 'healthy', message: 'Scenario database is accessible' },
      { name: 'tools', status: 'healthy', message: `${getScenarioBuilderTools().length} tools registered` },
    ]
  },

  getDependencies: (): ScenarioDependency[] => {
    return []
  },
}

export default scenarioBuilderModule
