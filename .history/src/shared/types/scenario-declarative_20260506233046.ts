/**
 * 声明式场景配置类型
 *
 * 外部安装场景通过 JSON 配置 + 文件资源描述能力，
 * 由 DeclarativeScenarioModule 适配器转换为 ScenarioModule。
 *
 * 场景包结构：
 *   my-scenario/
 *   ├── config/
 *   │   └── scenario.json      # 场景配置（必需）
 *   ├── prompts/
 *   │   ├── system.md           # 系统提示词（可选）
 *   │   ├── security.md         # 安全规则（可选）
 *   │   ├── conventions.md      # 约定（可选）
 *   │   └── workflow.md         # 工作流（可选）
 *   ├── scripts/
 *   │   ├── onActivate.js       # 激活钩子脚本（可选）
 *   │   ├── onDeactivate.js     # 停用钩子脚本（可选）
 *   │   └── tools/              # 脚本化工具（可选）
 *   │       └── *.js
 *   ├── db/
 *   │   ├── install.sql         # 安装脚本（可选）
 *   │   └── uninstall.sql       # 卸载脚本（可选）
 *   └── tools/                  # 自定义工具定义（可选）
 *       └── *.json
 */

import type { ScenarioCategory } from './scenario'

// ============================================
// 声明式工具定义
// ============================================

export interface DeclarativeToolParam {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  required?: boolean
  default?: unknown
  enum?: string[]
  items?: DeclarativeToolParam
  properties?: Record<string, DeclarativeToolParam>
}

export interface DeclarativeCustomTool {
  name: string
  description: string
  parameters: Record<string, DeclarativeToolParam>
  executor: 'sql_query' | 'run_command' | 'read_file' | 'write_file' | 'web_search' | 'read_url'
  template?: string
  postProcess?: 'json' | 'table' | 'text' | 'markdown'
}

// ============================================
// 声明式身份配置
// ============================================

export interface DeclarativeIdentity {
  systemPrompt?: string
  systemPromptFile?: string
  securityRules?: string
  securityRulesFile?: string
  conventions?: string
  conventionsFile?: string
  workflow?: string
  workflowFile?: string
  outputFormat?: string
  toolGuidelines?: string
}

// ============================================
// 声明式 UI 配置
// ============================================

export interface DeclarativeUI {
  layout?: 'chat-centric' | 'split' | 'editor-centric' | 'custom'
  panels?: string[]
  sidebarItems?: Array<{
    id: string
    icon: string
    label: string
    labelZh: string
    component: string
    position?: number
  }>
  welcomeComponent?: string
}

// ============================================
// 声明式数据库配置
// ============================================

export interface DeclarativeDatabase {
  installScriptFiles?: string[]
  uninstallScriptFiles?: string[]
  installScripts?: Array<{ id: string; description?: string; sql: string }>
  uninstallScripts?: Array<{ id: string; description?: string; sql: string }>
}

// ============================================
// 声明式能力配置
// ============================================

export interface DeclarativeCapabilities {
  builtinTools?: string[]
  customTools?: DeclarativeCustomTool[]
  modes?: Array<{
    id: string
    label: string
    labelZh: string
    icon: string
    description: string
    descriptionZh: string
    toolPolicy: { enabled: boolean; requireApproval?: boolean }
  }>
  contextTypes?: Array<{
    type: string
    label: string
    labelZh: string
    priority: number
  }>
  outputFormats?: string[]
}

// ============================================
// 声明式脚本配置
// ============================================

export interface DeclarativeScriptTool {
  name: string
  description: string
  scriptFile: string
  parameters: Record<string, DeclarativeToolParam>
}

export interface DeclarativeScripts {
  onActivate?: string
  onActivateFile?: string
  onDeactivate?: string
  onDeactivateFile?: string
  onHealthCheck?: string
  onHealthCheckFile?: string
  tools?: DeclarativeScriptTool[]
}

// ============================================
// 声明式场景配置（完整）
// ============================================

export interface DeclarativeScenarioConfig {
  id: string
  name: string
  nameZh: string
  icon?: string
  description?: string
  descriptionZh?: string
  version?: string
  author?: string
  category?: ScenarioCategory
  tags?: string[]
  source?: string
  hasSettings?: boolean
  requiresWorkspace?: boolean
  minAppVersion?: string
  homepage?: string
  license?: string

  identity?: DeclarativeIdentity
  capabilities?: DeclarativeCapabilities
  ui?: DeclarativeUI
  database?: DeclarativeDatabase

  permissions?: string[]
  dependencies?: Array<{ id: string; versionRange?: string; required?: boolean }>
}

// ============================================
// 场景加载结果（IPC 传输）
// ============================================

export interface ScenarioLoadResult {
  config: DeclarativeScenarioConfig
  files: Record<string, string>
}
