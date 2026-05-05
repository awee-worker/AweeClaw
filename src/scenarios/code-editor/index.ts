/**
 * 代码编辑器场景模块入口
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
} from '@shared/types/scenario-arch'
import { codeEditorScenario } from './config/scenario'

const CODE_EDITOR_MANIFEST: ScenarioManifest = {
  id: 'code-editor',
  version: '1.0.0',
  name: 'Code Editor',
  nameZh: '代码编辑器',
  description: 'AI agent platform with professional code editing and deep Agent integration',
  descriptionZh: 'AI 智能体平台，专业代码编辑与深度智能体集成',
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
  id: 'code-editor',
  version: '1.0.0',

  getManifest: () => CODE_EDITOR_MANIFEST,

  getPlugin: () => codeEditorScenario,

  getTools: () => [],

  getComponents: () => ({}),

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Activating code-editor scenario v${context.version}`)

    context.publishData('scenario:activated', {
      scenarioId: 'code-editor',
      capabilities: ['code_edit', 'file_management', 'terminal', 'git', 'search'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Deactivating code-editor scenario')

    context.publishData('scenario:deactivated', { scenarioId: 'code-editor' })
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
