/**
 * 场景 SDK - 场景开发工具包
 *
 * 提供场景开发所需的类型定义、验证工具和辅助函数。
 * 场景开发者可以引用此 SDK 来确保场景配置的正确性。
 *
 * 使用方式：
 *   import { defineScenario, validateScenarioConfig } from '@/scenarios/sdk'
 */

import type {
  DeclarativeScenarioConfig,
  DeclarativeIdentity,
  DeclarativeCapabilities,
  DeclarativeUI,
  DeclarativeDatabase,
  DeclarativeScripts,
  DeclarativeCustomTool,
  DeclarativeScriptTool,
  DeclarativeToolParam,
} from '@shared/types/scenario-declarative'
import type { ScenarioCategory } from '@shared/types/scenario'

export interface ScenarioDefinitionOptions {
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
  scripts?: DeclarativeScripts
  permissions?: string[]
  dependencies?: Array<{ id: string; versionRange?: string; required?: boolean }>
}

export function defineScenario(options: ScenarioDefinitionOptions): DeclarativeScenarioConfig {
  return {
    ...options,
    version: options.version || '1.0.0',
    author: options.author || 'unknown',
    category: options.category || 'custom',
    icon: options.icon || 'Package',
  }
}

export interface ValidationResult {
  valid: boolean
  errors: Array<{ path: string; message: string }>
  warnings: Array<{ path: string; message: string }>
}

export function validateScenarioConfig(config: DeclarativeScenarioConfig): ValidationResult {
  const errors: Array<{ path: string; message: string }> = []
  const warnings: Array<{ path: string; message: string }> = []

  if (!config.id) {
    errors.push({ path: 'id', message: 'Scenario ID is required' })
  } else if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(config.id)) {
    errors.push({ path: 'id', message: 'Scenario ID must be lowercase alphanumeric with hyphens' })
  }

  if (!config.name) {
    errors.push({ path: 'name', message: 'Scenario name is required' })
  }

  if (!config.nameZh) {
    warnings.push({ path: 'nameZh', message: 'Chinese name is recommended for better localization' })
  }

  if (!config.description) {
    warnings.push({ path: 'description', message: 'Description is recommended' })
  }

  if (config.capabilities?.builtinTools) {
    for (const toolName of config.capabilities.builtinTools) {
      if (!toolName || typeof toolName !== 'string') {
        errors.push({ path: `capabilities.builtinTools[${toolName}]`, message: 'Invalid builtin tool name' })
      }
    }
  }

  if (config.capabilities?.customTools) {
    for (let i = 0; i < config.capabilities.customTools.length; i++) {
      const tool = config.capabilities.customTools[i]
      if (!tool.name) {
        errors.push({ path: `capabilities.customTools[${i}].name`, message: 'Tool name is required' })
      }
      if (!tool.description) {
        warnings.push({ path: `capabilities.customTools[${i}].description`, message: 'Tool description is recommended' })
      }
      if (!tool.executor) {
        errors.push({ path: `capabilities.customTools[${i}].executor`, message: 'Tool executor type is required' })
      }
    }
  }

  if (config.scripts?.tools) {
    for (let i = 0; i < config.scripts.tools.length; i++) {
      const tool = config.scripts.tools[i]
      if (!tool.name) {
        errors.push({ path: `scripts.tools[${i}].name`, message: 'Script tool name is required' })
      }
      if (!tool.scriptFile) {
        errors.push({ path: `scripts.tools[${i}].scriptFile`, message: 'Script file path is required' })
      }
    }
  }

  if (config.database?.installScriptFiles) {
    for (let i = 0; i < config.database.installScriptFiles.length; i++) {
      const file = config.database.installScriptFiles[i]
      if (!file.endsWith('.sql')) {
        warnings.push({ path: `database.installScriptFiles[${i}]`, message: 'Install script files should have .sql extension' })
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

export function createBuiltinToolConfig(toolNames: string[]): Pick<DeclarativeCapabilities, 'builtinTools'> {
  return { builtinTools: toolNames }
}

export function createCustomTool(
  name: string,
  description: string,
  executor: DeclarativeCustomTool['executor'],
  parameters: Record<string, DeclarativeToolParam>,
  template?: string,
): DeclarativeCustomTool {
  return { name, description, parameters, executor, template }
}

export function createScriptTool(
  name: string,
  description: string,
  scriptFile: string,
  parameters: Record<string, DeclarativeToolParam>,
): DeclarativeScriptTool {
  return { name, description, scriptFile, parameters }
}

export function createDatabaseConfig(
  installScriptFiles?: string[],
  uninstallScriptFiles?: string[],
): DeclarativeDatabase {
  return { installScriptFiles, uninstallScriptFiles }
}

export function createScriptsConfig(
  options: {
    onActivateFile?: string
    onDeactivateFile?: string
    onHealthCheckFile?: string
    tools?: DeclarativeScriptTool[]
  } = {},
): DeclarativeScripts {
  return {
    onActivateFile: options.onActivateFile,
    onDeactivateFile: options.onDeactivateFile,
    onHealthCheckFile: options.onHealthCheckFile,
    tools: options.tools,
  }
}

export const BUILTIN_TOOLS = {
  FILE_READ: 'read_file',
  FILE_WRITE: 'write_file',
  FILE_LIST: 'list_directory',
  FILE_SEARCH: 'search_files',
  CODEBASE_SEARCH: 'codebase_search',
  FILE_EDIT: 'edit_file',
  TERMINAL: 'run_command',
  WEB_SEARCH: 'web_search',
  URL_READ: 'read_url',
  SQL_QUERY: 'sql_query',
  DATA_TRANSFORM: 'data_transform',
  CHART: 'chart_generate',
  ASK_USER: 'ask_user',
} as const

export const SCENARIO_CATEGORIES: ScenarioCategory[] = [
  'development',
  'data',
  'creative',
  'productivity',
  'education',
  'automation',
  'research',
  'communication',
  'entertainment',
  'business',
  'health',
  'finance',
  'legal',
  'marketing',
  'energy',
  'custom',
]
