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
import {
  validateScenarioPackageManifest,
  type ScenarioPackageManifest,
  type ScenarioPackageValidation,
} from '@shared/protocols/scenarioPackage'
import { logger } from '@shared/toolkit/LogEngine'

/** 场景包清单文件名 */
export const SCENARIO_PACKAGE_MANIFEST_FILE = 'scenario-package.json'

/**
 * 从场景目录文件中解析场景包清单
 *
 * 兼容没有清单的旧场景：返回 manifest 为 null，由调用方按原有路径继续加载。
 * 清单存在但格式错误时标记为不合法，避免半个包被装上。
 */
export function parseScenarioPackageManifest(files: Record<string, string>): {
  manifest: ScenarioPackageManifest | null
  validation: ScenarioPackageValidation
} {
  const raw = files?.[SCENARIO_PACKAGE_MANIFEST_FILE]
  if (!raw) {
    return { manifest: null, validation: { valid: true, errors: [], warnings: [] } }
  }

  let parsed: ScenarioPackageManifest
  try {
    parsed = JSON.parse(raw) as ScenarioPackageManifest
  } catch {
    return {
      manifest: null,
      validation: { valid: false, errors: [`${SCENARIO_PACKAGE_MANIFEST_FILE} 不是合法 JSON`], warnings: [] },
    }
  }

  return { manifest: parsed, validation: validateScenarioPackageManifest(parsed) }
}

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

      // 场景包清单校验：清单不合法时整包跳过，不加载半个场景
      const { manifest, validation } = parseScenarioPackageManifest(result.files || {})
      if (manifest && !validation.valid) {
        logger.agent.warn(
          `[ExternalScenarioLoader] 场景包清单不合法，跳过加载 "${scenario.id}"：${validation.errors.join('；')}`
        )
        continue
      }
      if (manifest && validation.warnings.length > 0) {
        logger.agent.info(
          `[ExternalScenarioLoader] 场景包清单提示 "${scenario.id}"：${validation.warnings.join('；')}`
        )
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
          // 加载失败时是否移除注册记录，取决于记录本身是否有有效 UI 配置：
          //
          // - 空配置（sidebarItems=[]）必须移除。NavigationRail 对空配置会回退到
          //   DEFAULT_ITEMS，用户看到的是「工作空间 / 知识库」这类默认菜单，
          //   会误以为装的场景坏了；移除后至少状态一致。
          // - 有完整配置时保留。此时菜单能正常渲染，只是 bundle 里的组件未加载，
          //   点进去 DynamicPanelView 会给出明确的未注册提示。保留记录的同时
          //   也保留了用户的安装信息，重启后还会自动重试加载 —— 直接 unregister
          //   会把整条记录从 localStorage 抹掉，用户下次连入口都找不到，只能
          //   重新本地安装。
          const hasUsableUi = (scenario.ui?.sidebarItems?.length ?? 0) > 0
          if (hasUsableUi) {
            logger.agent.warn(
              `[ExternalScenarioLoader] 保留场景 "${scenario.id}" 的注册记录（UI 配置完整），仅 bundle 未加载`
            )
          } else {
            scenarioRegistry.unregister(scenario.id)
          }
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
            // 会话边界随 bundle 一起下发：场景升级了边界声明，重载后立即生效，
            // 与 ui / capabilities 的刷新节奏保持一致
            sessionScope: fullPlugin.sessionScope,
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
