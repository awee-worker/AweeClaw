/**
 * 开发助手场景模块入口
 *
 * 实现增强版 ScenarioModule 接口，集成：
 * - ScenarioManifest: 场景清单
 * - 生命周期钩子: onActivate/onDeactivate/onHealthCheck
 * - 数据总线: 通过 context 使用
 * - 监控日志: 通过 context.getLogger/getHealthReporter 使用
 */

import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/protocols/scenario-arch'
import { codeEditorScenario } from './config/scenario'
import { devAssistantComponents } from './components'

const CODE_EDITOR_MANIFEST: ScenarioManifest = {
  id: 'dev-assistant',
  version: '1.0.0',
  name: 'Dev Assistant',
  nameZh: '开发助手',
  description: 'Full-stack AI dev assistant — code, debug, build, and deploy with deep Agent integration',
  descriptionZh: '全栈 AI 开发助手，覆盖编码、调试、构建、部署全流程，深度 Agent 协同',
  author: 'awee',
  icon: 'Code2',
  category: 'development',
  tags: ['code', 'editor', 'development', 'ide'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: [
    'filesystem:read',
    'filesystem:write',
    'terminal:execute',
    'notification:send',
    'system:info',
  ],
  homepage: 'https://github.com/jweelee/aweeclaw',
  license: 'SEE LICENSE IN LICENSE',
}

const codeEditorModule: ScenarioModule = {
  id: 'dev-assistant',
  version: '1.0.0',

  getManifest: () => CODE_EDITOR_MANIFEST,

  getPlugin: () => codeEditorScenario,

  getTools: () => [],

  getComponents: () => devAssistantComponents,

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Activating dev-assistant scenario v${context.version}`)

    context.publishData('scenario:activated', {
      scenarioId: 'dev-assistant',
      capabilities: ['code_edit', 'file_management', 'terminal', 'git', 'search'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Deactivating dev-assistant scenario')

    context.publishData('scenario:deactivated', { scenarioId: 'dev-assistant' })
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    return [
      { name: 'editor', status: 'healthy', message: 'Code editor is running' },
    ]
  },

  getDependencies: (): ScenarioDependency[] => {
    return []
  },
}

export default codeEditorModule
