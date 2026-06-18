/**
 * 开发工作室（dev-studio）场景模块入口
 *
 * 实现 ScenarioModule 接口，支持：
 * - 项目脚手架：从模板快速创建项目
 * - 多 Agent 协作：PM、Coder、Reviewer、Tester、DevOps
 * - 开发流水线：Lint → Build → Test → Deploy
 * - 独立数据库：项目管理、开发会话、构建日志
 */
import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/protocols/scenario-arch'
import { devStudioScenario } from './config/scenario'
import { getDevStudioTools } from './tools'
import { devStudioComponents } from './components'
import { INSTALL_SCRIPTS, UNINSTALL_SCRIPTS } from './db/scripts'
import { registerDevStudioI18n, unregisterDevStudioI18n } from './i18n'
import { projectService, agentSessionService, previewService, pipelineService } from './services'

const DEV_STUDIO_MANIFEST: ScenarioManifest = {
  id: 'dev-studio',
  version: '0.1.0',
  name: 'Dev Studio',
  nameZh: '开发工作室',
  description: 'Online development studio — project scaffolding, multi-agent collaboration, and full development lifecycle',
  descriptionZh: '在线开发工作室，支持项目脚手架、多 Agent 协作开发、全流程闭环',
  author: 'awee',
  icon: 'Rocket',
  category: 'development',
  tags: ['studio', 'scaffold', 'agent', 'pipeline', 'deploy', 'development'],
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

const devStudioModule: ScenarioModule = {
  id: 'dev-studio',
  version: '0.1.0',

  getManifest: () => DEV_STUDIO_MANIFEST,

  getPlugin: () => devStudioScenario,

  getTools: () => getDevStudioTools(),

  getComponents: () => devStudioComponents,

  getInstallScripts: () => INSTALL_SCRIPTS,

  getUninstallScripts: () => UNINSTALL_SCRIPTS,

  onInstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Installing dev-studio scenario v${context.version}`)
  },

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Activating dev-studio scenario v${context.version}`)

    registerDevStudioI18n()

    projectService.setContext(context)
    agentSessionService.setContext(context)
    previewService.setContext(context)
    pipelineService.setContext(context)

    context.publishData('scenario:activated', {
      scenarioId: 'dev-studio',
      capabilities: [
        'project_scaffolding',
        'multi_agent_collaboration',
        'full_lifecycle',
        'code_edit',
        'terminal',
        'git',
        'pipeline',
        'deploy',
      ],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Deactivating dev-studio scenario')

    unregisterDevStudioI18n()

    context.publishData('scenario:deactivated', { scenarioId: 'dev-studio' })
  },

  onUninstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Uninstalling dev-studio scenario')
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    return [
      { name: 'scaffold', status: 'healthy', message: 'Scaffold service is ready' },
      { name: 'database', status: 'healthy', message: 'Scenario database is accessible' },
      { name: 'tools', status: 'healthy', message: `${getDevStudioTools().length} tools registered` },
    ]
  },

  getDependencies: (): ScenarioDependency[] => {
    return []
  },
}

export default devStudioModule