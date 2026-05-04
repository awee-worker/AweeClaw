/**
 * 通用助手场景模块入口
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
import { generalAssistantScenario } from './config/scenario'

const GENERAL_ASSISTANT_MANIFEST: ScenarioManifest = {
  id: 'general-assistant',
  version: '1.0.0',
  name: 'General Assistant',
  nameZh: '通用助手',
  description: 'Versatile AI assistant for any task - Q&A, research, planning, and more',
  descriptionZh: '通用 AI 助手，适用于任何任务 - 问答、研究、规划等',
  author: 'awee',
  icon: 'Sparkles',
  category: 'productivity',
  tags: ['general', 'assistant', 'q&a', 'research', 'planning'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: [
    'filesystem:read',
    'filesystem:write',
    'network:request',
    'terminal:execute',
    'clipboard:read',
    'clipboard:write',
    'notification:send',
  ],
  homepage: 'https://github.com/jweelee/aweeclaw',
  license: 'SEE LICENSE IN LICENSE',
}

const generalAssistantModule: ScenarioModule = {
  id: 'general-assistant',
  version: '1.0.0',

  getManifest: () => GENERAL_ASSISTANT_MANIFEST,

  getPlugin: () => generalAssistantScenario,

  getTools: () => [],

  getComponents: () => ({}),

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Activating general-assistant scenario v${context.version}`)

    context.publishData('scenario:activated', {
      scenarioId: 'general-assistant',
      capabilities: ['qa', 'research', 'writing', 'planning', 'analysis'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Deactivating general-assistant scenario')

    context.publishData('scenario:deactivated', { scenarioId: 'general-assistant' })
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    return [
      { name: 'assistant', status: 'healthy', message: 'General assistant is running' },
    ]
  },

  getDependencies: (): ScenarioDependency[] => {
    return []
  },
}

export default generalAssistantModule
