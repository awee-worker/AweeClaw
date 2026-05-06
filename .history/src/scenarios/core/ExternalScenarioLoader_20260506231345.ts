/**
 * 外部声明式场景加载器
 *
 * 应用启动时，从磁盘加载已安装的外部声明式场景，
 * 创建 DeclarativeScenarioModule 并注册到 scenarioLoader。
 *
 * 流程：
 * 1. 从 scenarioRegistry 获取所有非内置场景
 * 2. 通过 IPC 读取场景目录中的配置和文件
 * 3. 创建 DeclarativeScenarioModule 实例
 * 4. 注册到 scenarioLoader
 */

import { scenarioRegistry } from '@shared/config/scenarios'
import { scenarioLoader } from './ScenarioLoader'
import { DeclarativeScenarioModule } from './DeclarativeScenarioModule'
import type { DeclarativeScenarioConfig } from '@shared/types/scenario-declarative'
import { logger } from '@shared/utils/Logger'

interface LoadScenarioFilesResult {
  success: boolean
  error?: string
  files: Record<string, string>
}

interface LoadScenarioConfigResult {
  success: boolean
  error?: string
  config?: DeclarativeScenarioConfig
}

let loadFn: ((scenarioId: string) => Promise<LoadScenarioFilesResult>) | null = null
let configFn: ((scenarioId: string) => Promise<LoadScenarioConfigResult>) | null = null

export function setExternalScenarioLoadFunctions(
  filesLoader: (scenarioId: string) => Promise<LoadScenarioFilesResult>,
  configLoader: (scenarioId: string) => Promise<LoadScenarioConfigResult>,
): void {
  loadFn = filesLoader
  configFn = configLoader
}

export async function loadExternalScenarios(): Promise<number> {
  if (!loadFn || !configFn) {
    logger.agent.warn('[ExternalScenarioLoader] Load functions not set, skipping external scenario loading')
    return 0
  }

  const customScenarios = scenarioRegistry.getAll().filter(s => !s.isBuiltin)
  let loaded = 0

  for (const scenario of customScenarios) {
    if (scenarioLoader.has(scenario.id)) {
      continue
    }

    try {
      const configResult = await configFn(scenario.id)
      if (!configResult.success || !configResult.config) {
        logger.agent.warn(`[ExternalScenarioLoader] No config found for scenario "${scenario.id}", skipping`)
        continue
      }

      const filesResult = await loadFn(scenario.id)
      if (!filesResult.success) {
        logger.agent.warn(`[ExternalScenarioLoader] Failed to load files for scenario "${scenario.id}": ${filesResult.error}`)
      }

      const files = filesResult.files || {}
      const module = new DeclarativeScenarioModule(configResult.config, files)
      scenarioLoader.register(module)
      loaded++

      logger.agent.info(`[ExternalScenarioLoader] Loaded external scenario: ${scenario.id}`)
    } catch (err) {
      logger.agent.error(`[ExternalScenarioLoader] Failed to load scenario "${scenario.id}":`, err)
    }
  }

  return loaded
}
