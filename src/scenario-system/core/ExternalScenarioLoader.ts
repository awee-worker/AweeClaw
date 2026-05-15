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

import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from './ScenarioLoader'
import { DeclarativeScenarioModule } from './DeclarativeScenarioModule'
import type { DeclarativeScenarioConfig } from '@shared/protocols/scenario-declarative'
import { logger } from '@shared/toolkit/LogEngine'

interface LoadScenarioResult {
  success: boolean
  error?: string
  files: Record<string, string>
  config: Record<string, unknown> | null
}

let loadFn: ((scenarioId: string) => Promise<LoadScenarioResult>) | null = null

export function setExternalScenarioLoadFunctions(
  loader: (scenarioId: string) => Promise<LoadScenarioResult>,
): void {
  loadFn = loader
}

export async function loadExternalScenarios(): Promise<number> {
  if (!loadFn) {
    logger.agent.warn('[ExternalScenarioLoader] Load function not set, skipping external scenario loading')
    return 0
  }

  const customScenarios = scenarioRegistry.getAll().filter(s => !s.isBuiltin)
  let loaded = 0

  for (const scenario of customScenarios) {
    if (scenarioLoader.has(scenario.id)) {
      continue
    }

    try {
      const result = await loadFn(scenario.id)
      if (!result.success || !result.config) {
        logger.agent.warn(`[ExternalScenarioLoader] No config found for scenario "${scenario.id}", skipping`)
        continue
      }

      const config = result.config as unknown as DeclarativeScenarioConfig
      const files = result.files || {}
      const module = new DeclarativeScenarioModule(config, files)
      scenarioLoader.register(module)
      loaded++

      logger.agent.info(`[ExternalScenarioLoader] Loaded external scenario: ${scenario.id}`)
    } catch (err) {
      logger.agent.error(`[ExternalScenarioLoader] Failed to load scenario "${scenario.id}":`, err)
    }
  }

  return loaded
}
