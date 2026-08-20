/**
 * 编程式基础模板
 *
 * 最简编程式场景：TypeScript 入口 + 系统提示词，无 UI 组件/无工具。
 * 适合需要编程能力但不需要复杂 UI 的场景（如纯逻辑处理）。
 */
import type { ScenarioTemplate } from './types'

export const programmaticBasicTemplate: ScenarioTemplate = {
  id: 'programmatic-basic',
  name: 'Programmatic Basic',
  nameZh: '编程式基础',
  description: 'Minimal programmatic scenario with TypeScript entry',
  descriptionZh: '最简编程式场景，TypeScript 入口文件 + 系统提示词，无 UI 组件',
  type: 'programmatic',
  category: 'basic',
  icon: 'Code2',
  tags: ['code', 'typescript', 'minimal'],
  scenarioConfigOverride: {
    icon: 'Code2',
    permissions: ['workspace:read', 'web:search'],
    sharedDeps: {
      react: '^18.3.0',
      'react-dom': '^18.3.0',
      'react/jsx-runtime': '^18.3.0',
    },
  },
  // 覆盖默认 src/index.ts，提供最简实现（无工具）
  overrideFiles: {
    'src/index.ts': `/**
 * {{name}} 场景入口
 *
 * 最简编程式场景：仅实现 ScenarioModule 接口，无工具/无 UI 组件。
 */
import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioHealthCheck,
} from '@aweeclaw/scenario-sdk'

export default {
  id: '{{scenarioId}}',
  version: '{{version}}',

  getManifest() {
    return {
      id: '{{scenarioId}}',
      version: '{{version}}',
      name: '{{name}}',
      nameZh: '{{name}}',
      description: {{descriptionJson}},
      descriptionZh: {{descriptionJson}},
      author: '{{author}}',
      icon: 'Code2',
      category: 'custom',
      tags: [],
      minAppVersion: '1.0.0',
      permissions: ['workspace:read', 'web:search'],
      dependencies: [],
    }
  },

  getPlugin() {
    return {
      id: '{{scenarioId}}',
      name: '{{name}}',
      nameZh: '{{name}}',
      icon: 'Code2',
      description: {{descriptionJson}},
      descriptionZh: {{descriptionJson}},
      version: '{{version}}',
      author: '{{author}}',
      category: 'custom',
      tags: [],
      identity: {
        systemPromptFile: 'prompts/system.md',
      },
      capabilities: {
        toolPacks: [],
        modes: [
          {
            id: 'chat',
            label: 'Chat',
            labelZh: '对话',
            icon: 'MessageSquare',
            description: 'Standard chat mode',
            descriptionZh: '标准对话模式',
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
        panels: [],
        sidebarItems: [],
        statusBarItems: [],
      },
      dataSources: { workspace: true },
    }
  },

  getTools() {
    return []
  },

  async onActivate(context: ScenarioModuleContext) {
    context.logger.info('[{{scenarioId}}] 场景已激活')
  },

  async onDeactivate(context: ScenarioModuleContext) {
    context.logger.info('[{{scenarioId}}] 场景已停用')
  },

  async onHealthCheck(): Promise<ScenarioHealthCheck[]> {
    return [{ name: 'module', status: 'healthy', message: 'OK' }]
  },
} satisfies ScenarioModule
`,
    'prompts/system.md': `# {{name}} 系统提示词

你是 **{{name}}** 场景的 AI 助手（编程式场景）。

## 核心职责
- {{description}}
- 通过编程式能力提供更灵活的服务

## 行为准则
- 使用结构化格式输出
- 主动澄清不明确的需求
- 复杂任务分步骤完成
`,
  },
  variables: [
    {
      key: 'name',
      label: '场景显示名',
      labelEn: 'Display Name',
      defaultValue: 'Programmatic Assistant',
      required: true,
      placeholder: '编程式助手',
    },
    {
      key: 'description',
      label: '场景描述',
      labelEn: 'Description',
      defaultValue: '通过 TypeScript 编程能力提供灵活服务',
      required: false,
      placeholder: '说明这个场景能做什么',
    },
  ],
  previewStructure: [
    'config/scenario.json',
    'package.json',
    'tsconfig.json',
    'src/index.ts',
    'prompts/system.md',
    'assets/',
  ],
}
