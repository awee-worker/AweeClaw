/**
 * Scenarios - 场景模块系统
 *
 * 每个场景独立目录，包含配置、组件、工具、服务。
 * 场景加载器负责动态注册和激活。
 */

export type { ScenarioModule, ScenarioToolDefinition, ScenarioIpcHandler, ScenarioComponentRegistry, ScenarioModuleContext } from './types'
export { scenarioLoader } from './loader'
export type { ScenarioLoaderEvent } from './loader'

export { default as dataAnalystModule } from './data-analyst'

import { scenarioLoader } from './loader'
import dataAnalystModule from './data-analyst'

export function registerBuiltinScenarios(): void {
  scenarioLoader.register(dataAnalystModule)
}
