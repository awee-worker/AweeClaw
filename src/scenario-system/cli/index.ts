/**
 * 场景 CLI 构建工具
 *
 * 提供场景包的验证、打包、初始化和发布功能。
 * 可在 Electron 主进程中通过 IPC 调用。
 *
 * 功能：
 * - validate: 验证场景包结构和配置
 * - init: 创建场景脚手架
 * - pack: 打包场景为可分发的 .scenario 文件
 * - publish: 一键打包并发布到场景市场
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

// ─── 打包 & 发布 ──────────────────────────────────────────────

export interface PackResult {
  success: boolean
  /** 打包后的 .scenario 文件内容(base64) */
  data?: string
  /** 场景包大小(bytes) */
  size?: number
  /** 场景包 hash */
  hash?: string
  error?: string
}

export interface PublishConfig {
  /** 场景文件映射 */
  files: Record<string, string>
  /** 场景配置 */
  config: DeclarativeScenarioConfig
  /** 后端 API 地址 */
  backendUrl?: string
  /** 认证 token */
  authToken?: string
  /** 发布描述 */
  changelog?: string
  /** 是否标记为稳定版 */
  isStable?: boolean
}

export interface PublishResult {
  success: boolean
  /** 场景 ID */
  scenarioId?: string
  /** 发布版本 */
  version?: string
  /** 错误信息 */
  error?: string
  /** 验证错误 */
  validationErrors?: Array<{ path: string; message: string }>
}

/**
 * 打包场景为 .scenario 文件
 * 将 config + files 序列化为 JSON 格式的包
 */
export function packScenario(
  config: DeclarativeScenarioConfig,
  files: Record<string, string>,
): PackResult {
  try {
    const validation = validateScenarioPackage(config, files)
    if (!validation.valid) {
      return {
        success: false,
        error: `Validation failed: ${validation.errors.map(e => `${e.path}: ${e.message}`).join('; ')}`,
      }
    }

    const pkg = {
      format: 'scenario-v1',
      config,
      files,
      createdAt: new Date().toISOString(),
    }

    const json = JSON.stringify(pkg)
    const data = Buffer.from(json).toString('base64')

    return {
      success: true,
      data,
      size: json.length,
      hash: simpleHash(json),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 一键发布：验证 → 打包 → 上传到市场
 *
 * 如果提供了 backendUrl 和 authToken，会直接上传。
 * 否则返回打包后的数据供外部调用。
 */
export async function publishScenario(publishConfig: PublishConfig): Promise<PublishResult> {
  const { files, config, backendUrl, authToken, changelog, isStable = false } = publishConfig

  // 1. 验证
  const validation = validateScenarioPackage(config, files)
  if (!validation.valid) {
    return {
      success: false,
      error: 'Validation failed',
      validationErrors: validation.errors.map(e => ({ path: e.path, message: e.message })),
    }
  }

  if (validation.warnings.length > 0) {
    console.warn('[ScenarioCLI] Publish warnings:', validation.warnings.map(w => `${w.path}: ${w.message}`).join('; '))
  }

  // 2. 打包
  const packResult = packScenario(config, files)
  if (!packResult.success || !packResult.data) {
    return { success: false, error: packResult.error || 'Pack failed' }
  }

  // 3. 上传到市场
  if (backendUrl && authToken) {
    try {
      const response = await fetch(`${backendUrl}/api/v1/marketplace/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          scenarioId: config.id,
          version: config.version,
          package: packResult.data,
          size: packResult.size,
          hash: packResult.hash,
          changelog: changelog || `Release ${config.version}`,
          isStable,
        }),
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        return { success: false, error: `Upload failed: HTTP ${response.status} ${errBody.slice(0, 200)}` }
      }

      const result = await response.json() as { success: boolean; error?: string }
      if (!result.success) {
        return { success: false, error: result.error || 'Publish rejected by server' }
      }

      return { success: true, scenarioId: config.id, version: config.version }
    } catch (err) {
      return { success: false, error: `Upload error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  // 无后端配置时，仅返回打包成功
  return {
    success: true,
    scenarioId: config.id,
    version: config.version,
  }
}

/** 简单的字符串 hash */
function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}
