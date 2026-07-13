/**
 * 编程式场景加载器
 *
 * 负责从磁盘加载已安装的编程式场景（ESM bundle 类型），
 * 创建 ProgrammaticScenarioModule 并注册到 ScenarioLoader。
 *
 * 加载流程：
 * 1. 读取 scenario.json 获取元数据和包类型
 * 2. 如果 packageType === 'programmatic'，使用此加载器
 * 3. 动态 import ESM bundle（index.js）
 * 4. 创建 ProgrammaticScenarioModule 实例
 * 5. 注册到 scenarioLoader
 *
 * 安全策略：
 * - 仅加载已通过校验的场景包
 * - 共享依赖版本兼容性检查
 * - 样式隔离：场景样式标记 data-scenario-id，卸载时移除
 */

import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from './ScenarioLoader'
import { ProgrammaticScenarioModule } from './ProgrammaticScenarioModule'
import type { ProgrammaticScenarioConfig } from './ProgrammaticScenarioModule'
import { logger } from '@shared/toolkit/LogEngine'

interface LoadScenarioFilesResult {
  success: boolean
  error?: string
  files: Record<string, string>
  config: Record<string, unknown> | null
  scenarioDir?: string
}

let loadFilesFn: ((scenarioId: string) => Promise<LoadScenarioFilesResult>) | null = null

export function setProgrammaticLoadFunction(
  fn: (scenarioId: string) => Promise<LoadScenarioFilesResult>,
): void {
  loadFilesFn = fn
}

export async function loadProgrammaticScenario(scenarioId: string): Promise<{
  success: boolean
  error?: string
}> {
  if (!loadFilesFn) {
    return { success: false, error: 'Programmatic load function not initialized' }
  }

  if (scenarioLoader.has(scenarioId)) {
    return { success: true }
  }

  try {
    const result = await loadFilesFn(scenarioId)
    if (!result.success || !result.config) {
      return { success: false, error: result.error || 'Failed to load scenario files' }
    }

    const config = result.config as unknown as ProgrammaticScenarioConfig

    if (!config.entryPoint) {
      return { success: false, error: 'Programmatic scenario missing entryPoint in scenario.json' }
    }

    const scenarioDir = result.scenarioDir
    if (!scenarioDir) {
      return { success: false, error: 'Scenario directory path not available' }
    }

    const module = new ProgrammaticScenarioModule(config)

    // 使用 scenario-bundle:// 协议加载 ESM bundle
    // 该协议在 Electron 主进程中注册为 standard: true，支持 dynamic import()
    // file:// 协议在 Electron 渲染进程中被 webSecurity 阻止，无法用于 import()
    //
    // URL 构造：
    // - 将 Windows 反斜杠转换为正斜杠
    // - 使用 encodeURI 编码路径中的特殊字符（如空格）
    // - 路径以 / 开头（macOS/Linux）时 URL 为 scenario-bundle:///path...
    // - Windows 路径如 C:/... 时 URL 为 scenario-bundle:///C:/...（handler 会剥离前导 /）
    const normalizedDir = scenarioDir.replace(/\\/g, '/')
    const encodedDir = encodeURI(normalizedDir)
    const encodedEntry = encodeURI(config.entryPoint)
    const bundleUrl = `scenario-bundle://${encodedDir}/${encodedEntry}`

    await module.loadModule(bundleUrl)

    scenarioLoader.register(module)

    logger.agent.info(
      `[ProgrammaticLoader] Loaded programmatic scenario: ${scenarioId} v${config.version}`
    )

    return { success: true }
  } catch (err) {
    logger.agent.error(
      `[ProgrammaticLoader] Failed to load programmatic scenario "${scenarioId}":`,
      err
    )
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function loadAllProgrammaticScenarios(): Promise<{
  loaded: string[]
  failed: Array<{ scenarioId: string; error: string }>
}> {
  if (!loadFilesFn) {
    return { loaded: [], failed: [] }
  }

  const customScenarios = scenarioRegistry.getAll().filter(s => !s.isBuiltin)
  const loaded: string[] = []
  const failed: Array<{ scenarioId: string; error: string }> = []

  for (const scenario of customScenarios) {
    if (scenarioLoader.has(scenario.id)) {
      loaded.push(scenario.id)
      continue
    }

    try {
      const result = await loadFilesFn(scenario.id)
      if (!result.success || !result.config) continue

      const config = result.config as Record<string, unknown>
      if (config.packageType !== 'programmatic') continue

      const loadResult = await loadProgrammaticScenario(scenario.id)
      if (loadResult.success) {
        loaded.push(scenario.id)
      } else {
        failed.push({ scenarioId: scenario.id, error: loadResult.error || 'Unknown error' })
      }
    } catch (err) {
      failed.push({
        scenarioId: scenario.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { loaded, failed }
}
