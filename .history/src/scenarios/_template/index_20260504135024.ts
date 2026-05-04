/**
 * 场景扩展开发模板
 *
 * 复制此目录作为新场景的起点：
 * cp -r src/scenarios/_template src/scenarios/your-scenario-id
 *
 * 然后修改以下文件：
 * 1. index.ts      - 场景入口，实现 ScenarioModule 接口
 * 2. manifest.ts   - 场景清单，声明元数据、依赖、权限
 * 3. config/scenario.ts - 场景插件配置（身份、能力、UI、数据源）
 * 4. tools/        - 工具定义和执行器（可选）
 * 5. services/     - 场景特有服务（可选）
 * 6. components/   - 场景特有 UI 组件（可选）
 * 7. types/        - 场景特有类型（可选）
 *
 * 最后在 src/scenarios/index.ts 中注册新场景。
 */

import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/types/scenario-arch'
import type { ScenarioPlugin } from '@shared/types/scenario'

const SCENARIO_ID = 'template'
const SCENARIO_VERSION = '0.1.0'

const TEMPLATE_MANIFEST: ScenarioManifest = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,
  name: 'Template Scenario',
  nameZh: '模板场景',
  description: 'A template scenario for development reference',
  descriptionZh: '用于开发参考的模板场景',
  author: 'awee',
  icon: 'Sparkles',
  category: 'custom',
  tags: ['template', 'example'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: [],
}

const TEMPLATE_PLUGIN: ScenarioPlugin = {
  id: SCENARIO_ID,
  name: 'Template Scenario',
  nameZh: '模板场景',
  icon: 'Sparkles',
  description: 'A template scenario for development reference',
  descriptionZh: '用于开发参考的模板场景',
  version: SCENARIO_VERSION,
  author: 'awee',
  category: 'custom',
  tags: ['template', 'example'],

  identity: {
    systemPrompt: 'You are a template scenario assistant.',
    securityRules: '## Security Rules\n- Follow general security best practices',
    conventions: '## Conventions\n- Follow project conventions',
    workflow: '## Workflow\n1. Understand the task\n2. Execute\n3. Verify',
  },

  capabilities: {
    toolPacks: [],
    modes: [
      {
        id: 'chat',
        label: 'Chat',
        labelZh: '对话',
        icon: 'MessageSquare',
        description: 'Quick Q&A',
        descriptionZh: '快速问答',
        toolPolicy: { enabled: false },
      },
      {
        id: 'agent',
        label: 'Agent',
        labelZh: '智能体',
        icon: 'Sparkles',
        description: 'Autonomous agent with tools',
        descriptionZh: '带工具的自主智能体',
        toolPolicy: { enabled: true, requireApproval: false },
      },
    ],
    contextTypes: [
      { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
    ],
    outputFormats: ['text', 'markdown'],
  },

  ui: {
    layout: 'chat-centric',
    panels: [
      { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: true },
    ],
    sidebarItems: [],
    statusBarItems: [],
  },

  dataSources: {
    workspace: false,
  },
}

const templateModule: ScenarioModule = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,

  getManifest: () => TEMPLATE_MANIFEST,

  getPlugin: () => TEMPLATE_PLUGIN,

  getTools: () => [],

  getComponents: () => ({}),

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Activating scenario: ${context.scenarioId} v${context.version}`)

    context.publishData('scenario:activated', {
      scenarioId: context.scenarioId,
      version: context.version,
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Deactivating scenario: ${context.scenarioId}`)
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    return [
      { name: 'basic', status: 'healthy', message: 'Template scenario is running' },
    ]
  },

  getDependencies: (): ScenarioDependency[] => {
    return []
  },
}

export default templateModule
