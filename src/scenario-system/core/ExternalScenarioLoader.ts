/**
 * 外部场景加载器
 *
 * 应用启动时，从磁盘加载已安装的外部场景。
 * 根据场景的 packageType 分发到不同的加载器：
 * - declarative（声明式）：创建 DeclarativeScenarioModule
 * - programmatic（编程式）：调用 loadProgrammaticScenario 加载 ESM bundle
 *
 * 流程：
 * 1. 从 scenarioRegistry 获取所有非内置场景
 * 2. 通过 IPC 读取场景目录中的配置和文件
 * 3. 检查 config.packageType 决定使用哪种模块
 * 4. 注册到 scenarioLoader，并同步 plugin 配置到 scenarioRegistry
 */

import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from './ScenarioLoader'
import { DeclarativeScenarioModule } from './DeclarativeScenarioModule'
import { loadProgrammaticScenario, setProgrammaticLoadFunction } from './ProgrammaticScenarioLoader'
import type { DeclarativeScenarioConfig } from '@shared/protocols/scenario-declarative'
import { logger } from '@shared/toolkit/LogEngine'

interface LoadScenarioResult {
  success: boolean
  error?: string
  files: Record<string, string>
  config: Record<string, unknown> | null
  scenarioDir?: string
}

let loadFn: ((scenarioId: string) => Promise<LoadScenarioResult>) | null = null

export function setExternalScenarioLoadFunctions(
  loader: (scenarioId: string) => Promise<LoadScenarioResult>,
): void {
  loadFn = loader
  // 同时设置 programmatic 加载函数，供 ProgrammaticScenarioLoader 使用
  setProgrammaticLoadFunction(loader)
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

      const config = result.config as unknown as Record<string, unknown>
      const isProgrammatic = config.packageType === 'programmatic'

      if (isProgrammatic) {
        // 编程式场景：通过 ProgrammaticScenarioLoader 加载 ESM bundle
        const loadResult = await loadProgrammaticScenario(scenario.id)
        if (!loadResult.success) {
          logger.agent.warn(
            `[ExternalScenarioLoader] Failed to load programmatic scenario "${scenario.id}": ${loadResult.error}`
          )
          continue
        }

        // 从 scenarioLoader 获取 bundle 提供的完整 plugin 配置
        const fullPlugin = scenarioLoader.getPlugin(scenario.id)
        if (fullPlugin) {
          scenarioRegistry.updateScenario(scenario.id, {
            identity: fullPlugin.identity,
            capabilities: fullPlugin.capabilities,
            ui: fullPlugin.ui,
            dataSources: fullPlugin.dataSources,
          })
        }

        loaded++
        logger.agent.info(`[ExternalScenarioLoader] Loaded programmatic scenario: ${scenario.id}`)
      } else {
        // 声明式场景：创建 DeclarativeScenarioModule
        const declarativeConfig = result.config as unknown as DeclarativeScenarioConfig
        const files = result.files || {}
        const module = new DeclarativeScenarioModule(declarativeConfig, files)
        scenarioLoader.register(module)

        const modulePlugin = module.getPlugin()
        scenarioRegistry.updateScenario(scenario.id, {
          identity: modulePlugin.identity,
          capabilities: modulePlugin.capabilities,
          ui: modulePlugin.ui,
        })

        loaded++
        logger.agent.info(`[ExternalScenarioLoader] Loaded declarative scenario: ${scenario.id}`)
      }
    } catch (err) {
      logger.agent.error(`[ExternalScenarioLoader] Failed to load scenario "${scenario.id}":`, err)
    }
  }

  return loaded
}
