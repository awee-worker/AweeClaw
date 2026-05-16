/**
 * 场景 CLI 构建工具
 *
 * 提供场景包的验证、打包和初始化功能。
 * 可在 Electron 主进程中通过 IPC 调用。
 *
 * 功能：
 * - validate: 验证场景包结构和配置
 * - init: 创建场景脚手架
 * - pack: 打包场景为可分发的 .scenario 文件
 */

import type { DeclarativeScenarioConfig } from '@shared/protocols/scenario-declarative'
import { validateScenarioConfig, type ValidationResult } from '../sdk'

export interface ScenarioPackageStructure {
  hasConfig: boolean
  hasPrompts: boolean
  hasScripts: boolean
  hasDatabase: boolean
  hasTools: boolean
  promptFiles: string[]
  scriptFiles: string[]
  dbFiles: string[]
  toolFiles: string[]
}

export function analyzeScenarioStructure(files: Record<string, string>): ScenarioPackageStructure {
  const fileNames = Object.keys(files)

  return {
    hasConfig: fileNames.some(f => f.includes('scenario.json') || f.includes('scenario.ts')),
    hasPrompts: fileNames.some(f => f.startsWith('prompts/')),
    hasScripts: fileNames.some(f => f.startsWith('scripts/')),
    hasDatabase: fileNames.some(f => f.startsWith('db/')),
    hasTools: fileNames.some(f => f.startsWith('tools/')),
    promptFiles: fileNames.filter(f => f.startsWith('prompts/')),
    scriptFiles: fileNames.filter(f => f.startsWith('scripts/')),
    dbFiles: fileNames.filter(f => f.startsWith('db/')),
    toolFiles: fileNames.filter(f => f.startsWith('tools/')),
  }
}

export function validateScenarioPackage(
  config: DeclarativeScenarioConfig,
  files: Record<string, string>,
): ValidationResult & { structure: ScenarioPackageStructure } {
  const configValidation = validateScenarioConfig(config)
  const structure = analyzeScenarioStructure(files)

  const errors = [...configValidation.errors]
  const warnings = [...configValidation.warnings]

  if (!structure.hasConfig) {
    errors.push({ path: 'config', message: 'Scenario config file (scenario.json) is required' })
  }

  if (config.scripts?.onActivateFile && !files[config.scripts.onActivateFile]) {
    warnings.push({ path: 'scripts.onActivateFile', message: `Script file not found: ${config.scripts.onActivateFile}` })
  }

  if (config.scripts?.onDeactivateFile && !files[config.scripts.onDeactivateFile]) {
    warnings.push({ path: 'scripts.onDeactivateFile', message: `Script file not found: ${config.scripts.onDeactivateFile}` })
  }

  if (config.scripts?.tools) {
    for (const tool of config.scripts.tools) {
      if (!files[tool.scriptFile]) {
        errors.push({ path: `scripts.tools[${tool.name}].scriptFile`, message: `Script file not found: ${tool.scriptFile}` })
      }
    }
  }

  if (config.database?.installScriptFiles) {
    for (const file of config.database.installScriptFiles) {
      if (!files[file]) {
        warnings.push({ path: `database.installScriptFiles`, message: `SQL file not found: ${file}` })
      }
    }
  }

  if (config.identity?.systemPromptFile && !files[config.identity.systemPromptFile]) {
    warnings.push({ path: 'identity.systemPromptFile', message: `Prompt file not found: ${config.identity.systemPromptFile}` })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    structure,
  }
}

export function generateScenarioScaffold(scenarioId: string, name: string, nameZh: string): Record<string, string> {
  const config: DeclarativeScenarioConfig = {
    id: scenarioId,
    name,
    nameZh,
    version: '1.0.0',
    author: 'unknown',
    category: 'custom',
    icon: 'Package',
    description: `A custom scenario: ${name}`,
    descriptionZh: `自定义场景：${nameZh}`,
    identity: {
      systemPromptFile: 'prompts/system.md',
    },
    capabilities: {
      builtinTools: ['read_file', 'run_command', 'web_search'],
      modes: [
        {
          id: 'chat',
          label: 'Quick',
          labelZh: '快速',
          icon: 'Zap',
          description: 'Suitable for most situations',
          descriptionZh: '适用于大部分情况',
          toolPolicy: { enabled: true, requireApproval: false },
        },
        {
          id: 'agent',
          label: 'Think',
          labelZh: '思考',
          icon: 'Brain',
          description: 'Excels at harder problems',
          descriptionZh: '擅长解决更难的问题',
          toolPolicy: { enabled: true, requireApproval: true },
        },
      ],
      contextTypes: [
        { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
      ],
      outputFormats: ['text', 'markdown'],
    },
    ui: {
      layout: 'chat-centric',
      panels: ['chat'],
    },
  }

  const files: Record<string, string> = {}

  files['config/scenario.json'] = JSON.stringify(config, null, 2)

  files['prompts/system.md'] = [
    `# ${name} System Prompt`,
    '',
    `You are a professional assistant for the "${name}" scenario.`,
    '',
    '## Core Responsibilities',
    '- Help users accomplish their tasks efficiently',
    '- Follow the established workflow and conventions',
    '',
    '## Guidelines',
    '- Be concise and accurate',
    '- Ask for clarification when needed',
    '',
  ].join('\n')

  files['scripts/onActivate.js'] = [
    '// Scenario activation hook',
    '// This script runs when the scenario is activated',
    '',
    'function onActivate(context) {',
    '  console.log(`Scenario ${context.scenarioId} activated`);',
    '  return { status: "ok" };',
    '}',
    '',
    'onActivate(context);',
  ].join('\n')

  files['scripts/onDeactivate.js'] = [
    '// Scenario deactivation hook',
    '// This script runs when the scenario is deactivated',
    '',
    'function onDeactivate(context) {',
    '  console.log(`Scenario ${context.scenarioId} deactivated`);',
    '  return { status: "ok" };',
    '}',
    '',
    'onDeactivate(context);',
  ].join('\n')

  return files
}
