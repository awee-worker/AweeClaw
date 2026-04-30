/**
 * 场景注册表初始化
 *
 * 注册所有内置场景插件，并提供统一的访问接口。
 * 第三方场景可以通过 scenarioRegistry.register() 动态注册。
 */

import { scenarioRegistry } from '../../types/scenario'
import { codeEditorScenario } from './codeEditorScenario'

let initialized = false

export function initializeScenarios(): void {
  if (initialized) return

  scenarioRegistry.register(codeEditorScenario)

  initialized = true
}

export { scenarioRegistry }
