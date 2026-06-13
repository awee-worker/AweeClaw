/**
 * 运行时动态模块加载器
 *
 * 支持从多种来源动态加载场景模块：
 * - 本地文件系统（已安装的场景）
 * - URL 下载（远程场景包）
 * - 市场安装（在线市场）
 *
 * 所有外部来源的场景都在沙箱中验证后才加载。
 *
 * 调用链路：
 *   installFromMarketplace → 注入的 marketplaceApi 函数 → 后端 API + IPC
 *   downloadAndInstallFromUrl → 注入的 urlDownload 函数 → IPC 下载+校验
 *   loadScenarioFromInstalled → 注入的 loadFiles 函数 → IPC 读取本地文件
 */

import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from './ScenarioLoader'
import { DeclarativeScenarioModule } from './DeclarativeScenarioModule'
import { validateScenarioPackage } from '../cli'
import { validateScript } from './SandboxEngine'
import type { DeclarativeScenarioConfig } from '@shared/protocols/scenario-declarative'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================================
// 类型定义
// ============================================================

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

/** 市场安装参数 */
export interface MarketplaceInstallParams {
  scenarioId: string
  downloadUrl: string
  checksum: string
  signature?: string
  version: string
  fileSize: number
  packageType: string
}

/** 市场安装 API 函数签名：调用后端获取下载信息，然后通过 IPC 执行安装 */
export type MarketplaceInstallFn = (
  scenarioId: string,
  targetVersion?: string,
) => Promise<{
  success: boolean
  scenarioId?: string
  version?: string
  targetDir?: string
  config?: Record<string, unknown>
  packageType?: string
  error?: string
}>

/** URL 下载 API 函数签名：通过 IPC 下载并安装 */
export type UrlDownloadInstallFn = (
  url: string,
  onProgress?: (percent: number) => void,
) => Promise<{
  success: boolean
  scenarioId?: string
  version?: string
  targetDir?: string
  config?: Record<string, unknown>
  error?: string
}>

/** 场景文件加载函数签名 */
export type LoadScenarioFilesFn = (
  scenarioId: string,
) => Promise<{
  success: boolean
  error?: string
  files: Record<string, string>
  config: Record<string, unknown> | null
}>

// ============================================================
// 函数注入（渲染进程初始化时注入）
// ============================================================

let loadFilesFn: LoadScenarioFilesFn | null = null
let marketplaceInstallFn: MarketplaceInstallFn | null = null
let urlDownloadFn: UrlDownloadInstallFn | null = null

export function setDynamicLoadFunction(fn: LoadScenarioFilesFn): void {
  loadFilesFn = fn
}

export function setMarketplaceInstallFunction(fn: MarketplaceInstallFn): void {
  marketplaceInstallFn = fn
}

export function setUrlDownloadFunction(fn: UrlDownloadInstallFn): void {
  urlDownloadFn = fn
}

// ============================================================
// 公共 API
// ============================================================

/**
 * 从本地已安装目录加载场景
 */
export async function loadScenarioFromInstalled(scenarioId: string): Promise<DynamicLoadResult> {
  if (!loadFilesFn) {
    return { success: false, error: 'Load function not initialized. Call setDynamicLoadFunction first.' }
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

    // 脚本安全校验
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

/**
 * 加载所有已安装的外部场景
 */
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
    if (result.success && result.scenarioId) {
      loaded.push(result.scenarioId)
    } else {
      failed.push({ scenarioId: scenario.id, error: result.error || 'Unknown error' })
    }
  }

  return { loaded, failed }
}

/**
 * 从市场安装场景
 *
 * 调用链路：
 *   1. 调用注入的 marketplaceInstallFn（→ 后端 API 获取下载 URL）
 *   2. 后端返回下载信息 → marketplaceInstallFn 内部通过 IPC 下载+校验+解压
 *   3. 解压成功后通过 loadScenarioFromInstalled 加载场景
 */
export async function installFromMarketplace(
  marketplaceId: string,
  targetVersion?: string,
): Promise<DynamicLoadResult> {
  logger.agent.info(`[DynamicLoader] Install scenario from marketplace: ${marketplaceId}`)

  if (!marketplaceInstallFn) {
    return {
      success: false,
      error: 'Marketplace install function not initialized. Call setMarketplaceInstallFunction first.',
    }
  }

  try {
    const result = await marketplaceInstallFn(marketplaceId, targetVersion)
    if (!result.success) {
      return { success: false, error: result.error || 'Marketplace installation failed' }
    }

    const scenarioId = result.scenarioId || marketplaceId

    // 安装成功后自动加载场景
    const loadResult = await loadScenarioFromInstalled(scenarioId)
    if (!loadResult.success) {
      return {
        success: true,
        scenarioId,
        warnings: [`Scenario installed to disk but failed to load: ${loadResult.error}`],
      }
    }

    logger.agent.info(`[DynamicLoader] Successfully installed and loaded scenario: ${scenarioId}`)
    return { success: true, scenarioId, warnings: loadResult.warnings }
  } catch (err) {
    logger.agent.error(`[DynamicLoader] Marketplace install failed for "${marketplaceId}":`, err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 从 URL 下载并安装场景
 *
 * 调用链路：
 *   1. 调用注入的 urlDownloadFn（→ IPC 下载+校验+解压）
 *   2. 解压成功后通过 loadScenarioFromInstalled 加载场景
 */
export async function downloadAndInstallFromUrl(
  url: string,
  onProgress?: (percent: number) => void,
): Promise<DynamicLoadResult> {
  logger.agent.info(`[DynamicLoader] Download scenario from URL: ${url}`)

  if (!urlDownloadFn) {
    return {
      success: false,
      error: 'URL download function not initialized. Call setUrlDownloadFunction first.',
    }
  }

  try {
    // 基础 URL 校验
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Unsupported URL protocol. Only HTTP/HTTPS is allowed.' }
      }
    } catch {
      return { success: false, error: 'Invalid URL format.' }
    }

    const result = await urlDownloadFn(url, onProgress)
    if (!result.success) {
      return { success: false, error: result.error || 'URL download failed' }
    }

    const scenarioId = result.scenarioId
    if (!scenarioId) {
      return { success: false, error: 'Download succeeded but no scenarioId returned' }
    }

    // 下载成功后自动加载场景
    const loadResult = await loadScenarioFromInstalled(scenarioId)
    if (!loadResult.success) {
      return {
        success: true,
        scenarioId,
        warnings: [`Scenario downloaded to disk but failed to load: ${loadResult.error}`],
      }
    }

    logger.agent.info(`[DynamicLoader] Successfully downloaded and loaded scenario: ${scenarioId}`)
    return { success: true, scenarioId, warnings: loadResult.warnings }
  } catch (err) {
    logger.agent.error(`[DynamicLoader] URL download failed:`, err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}