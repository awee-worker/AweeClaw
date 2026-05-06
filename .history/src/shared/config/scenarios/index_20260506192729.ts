/**
 * 场景注册表初始化（桥接层）
 *
 * 使用 import.meta.glob 动态发现 src/scenarios/*/config/scenario.ts 中的场景配置，
 * 自动注册到 ScenarioRegistry，无需手动维护导入列表。
 *
 * 卸载场景时：
 * - 内置场景：加入黑名单（localStorage），重启后跳过注册
 * - 自定义场景：从 localStorage 中移除持久化数据
 */

import { scenarioRegistry } from '../../types/scenario'
import type { ScenarioPlugin } from '../../types/scenario'

const scenarioConfigModules = import.meta.glob<{ default: ScenarioPlugin }>(
  '/src/scenarios/*/config/scenario.ts',
  { eager: true }
)

let initialized = false

export function initializeScenarios(activeScenarioId?: string): void {
  if (initialized) return

  for (const path in scenarioConfigModules) {
    const mod = scenarioConfigModules[path]
    const scenario = mod?.default
    if (scenario && scenario.id) {
      if (!scenarioRegistry.isUninstalledBuiltin(scenario.id)) {
        scenarioRegistry.register(scenario)
      }
    }
  }

  scenarioRegistry.loadCustomScenarios()

  if (activeScenarioId) {
    scenarioRegistry.setActive(activeScenarioId)
  }

  initialized = true
}

export { scenarioRegistry }
