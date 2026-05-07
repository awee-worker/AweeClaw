/**
 * 创意写作场景模块入口
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
import { creativeWriterScenario } from './config/scenario'
import { creativeWriterComponents } from './components'

const CREATIVE_WRITER_MANIFEST: ScenarioManifest = {
  id: 'creative-writer',
  version: '1.0.0',
  name: 'Creative Writer',
  nameZh: '创意写作',
  description: 'Fiction, copywriting, content creation, and editorial assistance',
  descriptionZh: '小说、文案、内容创作和编辑辅助',
  author: 'awee',
  icon: 'PenTool',
  category: 'creative',
  tags: ['writing', 'creative', 'fiction', 'copywriting', 'content'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: [
    'filesystem:read',
    'filesystem:write',
    'network:request',
    'clipboard:read',
    'clipboard:write',
  ],
  homepage: 'https://github.com/jweelee/aweeclaw',
  license: 'SEE LICENSE IN LICENSE',
}

const creativeWriterModule: ScenarioModule = {
  id: 'creative-writer',
  version: '1.0.0',

  getManifest: () => CREATIVE_WRITER_MANIFEST,

  getPlugin: () => creativeWriterScenario,

  getTools: () => [],

  getComponents: () => creativeWriterComponents,

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Activating creative-writer scenario v${context.version}`)

    context.publishData('scenario:activated', {
      scenarioId: 'creative-writer',
      capabilities: ['creative_writing', 'editing', 'content_strategy', 'research'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Deactivating creative-writer scenario')

    context.publishData('scenario:deactivated', { scenarioId: 'creative-writer' })
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    return [
      { name: 'writer', status: 'healthy', message: 'Creative writer is running' },
    ]
  },

  getDependencies: (): ScenarioDependency[] => {
    return []
  },
}

export default creativeWriterModule
