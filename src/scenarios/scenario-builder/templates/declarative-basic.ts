/**
 * 声明式基础模板
 *
 * 最简声明式场景：仅包含系统提示词，无工具/无数据库/无 UI 组件。
 * 适合快速创建对话助手、提示词模板类场景。
 */
import type { ScenarioTemplate } from './types'

export const declarativeBasicTemplate: ScenarioTemplate = {
  id: 'declarative-basic',
  name: 'Declarative Basic',
  nameZh: '声明式基础',
  description: 'Minimal declarative scenario with system prompt only',
  descriptionZh: '最简声明式场景，仅含系统提示词，适合对话助手与提示词模板',
  type: 'declarative',
  category: 'basic',
  icon: 'MessageSquare',
  tags: ['chat', 'minimal', 'basic'],
  scenarioConfigOverride: {
    icon: 'MessageSquare',
    capabilities: {
      builtinTools: ['web_search', 'ask_user', 'remember'],
      modes: [
        {
          id: 'chat',
          label: 'Quick',
          labelZh: '快速',
          icon: 'Zap',
          description: 'Quick mode',
          descriptionZh: '快速模式',
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
      sidebarItems: [
        { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
      ],
      statusBarItems: [],
    },
  },
  // 覆盖默认 system.md，提供更聚焦的提示词
  overrideFiles: {
    'prompts/system.md': `# {{name}} 系统提示词

你是 **{{name}}** 场景的 AI 助手。

## 核心职责
- {{description}}
- 提供准确、专业、高效的服务
- 主动澄清不明确的需求

## 行为准则
- 使用结构化格式输出（标题、列表、代码块）
- 复杂内容分步骤说明
- 遇到不确定的需求时主动询问

## 工具使用
- web_search：搜索网络信息，获取最新资料
- ask_user：向用户提问，澄清需求
- remember：记录重要信息，保持上下文
`,
  },
  variables: [
    {
      key: 'name',
      label: '场景显示名',
      labelEn: 'Display Name',
      defaultValue: 'My Assistant',
      required: true,
      placeholder: '我的助手',
    },
    {
      key: 'description',
      label: '场景描述',
      labelEn: 'Description',
      defaultValue: '帮助用户完成任务',
      required: false,
      placeholder: '说明这个场景能做什么',
    },
  ],
  previewStructure: [
    'config/scenario.json',
    'prompts/system.md',
    'prompts/security.md',
    'prompts/conventions.md',
    'prompts/workflow.md',
    'assets/',
  ],
}
