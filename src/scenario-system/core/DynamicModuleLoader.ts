/**
 * 运行时动态模块加载器
 *
 * 支持从多种来源动态加载场景模块：
 * - 本地文件系统（已安装的场景）
 * - URL 下载（远程场景包）
 * - 市场安装（在线市场）
 *
 * 所有外部来源的场景都在沙箱中验证后才加载。
 */

import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from './ScenarioLoader'
import { DeclarativeScenarioModule } from './DeclarativeScenarioModule'
import { validateScenarioPackage } from '../cli'
import { validateScript } from './SandboxEngine'
import type { DeclarativeScenarioConfig } from '@shared/protocols/scenario-declarative'
import { logger } from '@shared/toolkit/LogEngine'

export interface DynamicLoadSource {
  type: 'local' | 'url' | 'marketplace'
  path?: string
  url?: string
  marketplaceId?: string
}

export interface DynamicLoadResult {
  success: boolean
  scenarioId?: string
  error?: string
  warnings?: string[]
}

interface LoadScenarioFilesFn {
  (scenarioId: string): Promise<{
    success: boolean
    error?: string
    files: Record<string, string>
    config: Record<string, unknown> | null
  }>
}

let loadFilesFn: LoadScenarioFilesFn | null = null

export function setDynamicLoadFunction(fn: LoadScenarioFilesFn): void {
  loadFilesFn = fn
}

export async function loadScenarioFromInstalled(scenarioId: string): Promise<DynamicLoadResult> {
  if (!loadFilesFn) {
    return { success: false, error: 'Load function not initialized' }
  }

  if (scenarioLoader.has(scenarioId)) {
    return { success: true, scenarioId }
  }

  try {
    const result = await loadFilesFn(scenarioId)
    if (!result.success || !result.config) {
      return { success: false, error: result.error || 'Failed to load scenario files' }
    }

    const config = result.config as unknown as DeclarativeScenarioConfig
    const files = result.files || {}

    const validation = validateScenarioPackage(config, files)
    if (!validation.valid) {
      const errorMessages = validation.errors.map(e => `${e.path}: ${e.message}`).join('; ')
      return { success: false, error: `Validation failed: ${errorMessages}` }
    }

    if (config.scripts) {
      const scriptFiles = Object.keys(files).filter(f => f.startsWith('scripts/') && f.endsWith('.js'))
      for (const scriptFile of scriptFiles) {
        const code = files[scriptFile]
        if (code) {
          const scriptValidation = await validateScript(code)
          if (!scriptValidation.valid) {
            return { success: false, error: `Script validation failed (${scriptFile}): ${scriptValidation.error}` }
          }
        }
      }
    }

    const module = new DeclarativeScenarioModule(config, files)
    scenarioLoader.register(module)

    logger.agent.info(`[DynamicLoader] Loaded scenario: ${scenarioId}`)

    return {
      success: true,
      scenarioId,
      warnings: validation.warnings.map(w => `${w.path}: ${w.message}`),
    }
  } catch (err) {
    logger.agent.error(`[DynamicLoader] Failed to load scenario "${scenarioId}":`, err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function loadAllInstalledScenarios(): Promise<{
  loaded: string[]
  failed: Array<{ scenarioId: string; error: string }>
}> {
  const customScenarios = scenarioRegistry.getAll().filter(s => !s.isBuiltin)
  const loaded: string[] = []
  const failed: Array<{ scenarioId: string; error: string }> = []

  for (const scenario of customScenarios) {
    if (scenarioLoader.has(scenario.id)) {
      loaded.push(scenario.id)
      continue
    }

    const result = await loadScenarioFromInstalled(scenario.id)
    if (result.success) {
      loaded.push(scenario.id)
    } else {
      failed.push({ scenarioId: scenario.id, error: result.error || 'Unknown error' })
    }
  }

  return { loaded, failed }
}

export async function downloadAndInstallFromUrl(
  url: string,
  _onProgress?: (percent: number) => void,
): Promise<DynamicLoadResult> {
  logger.agent.info(`[DynamicLoader] Download scenario from URL: ${url}`)

  return {
    success: false,
    error: 'URL download is not yet implemented. Please install scenarios from local directory.',
  }
}

export async function installFromMarketplace(
  marketplaceId: string,
): Promise<DynamicLoadResult> {
  logger.agent.info(`[DynamicLoader] Install scenario from marketplace: ${marketplaceId}`)

  return {
    success: false,
    error: 'Marketplace installation is not yet implemented. Please install scenarios from local directory.',
  }
}
