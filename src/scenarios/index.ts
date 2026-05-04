/**
 * Scenarios - 场景模块系统（增强版）
 *
 * 每个场景独立目录，包含配置、组件、工具、服务。
 * 场景加载器负责动态注册和激活。
 *
 * 架构层次：
 * - core/          核心模块（加载器、数据总线、版本管理、监控、测试）
 * - data-analyst/  数据分析师场景
 * - _template/     场景开发模板
 */

// 核心架构导出
export { scenarioLoader, scenarioDataBus, scenarioVersionManager, scenarioMonitor, scenarioTestFramework, compareVersions } from './core'
export type { ScenarioLoaderEvent } from './core'

// 增强版接口类型导出
export type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioLifecycleState,
  ScenarioRegistryEntry,
  ScenarioHealthReport,
  ScenarioHealthCheck,
  ScenarioVersionInfo,
  ScenarioDependency,
  ScenarioPermission,
  ScenarioDataMessage,
  ScenarioDataSubscription,
  ScenarioSharedDataEntry,
  ScenarioToolDefinition,
  ScenarioIpcHandler,
  ScenarioComponentRegistry,
  ScenarioLogger,
  ScenarioHealthReporter,
} from '@shared/types/scenario-arch'

// 兼容旧接口类型导出
export type {
  ScenarioToolDefinition as LegacyScenarioToolDefinition,
  ScenarioIpcHandler as LegacyScenarioIpcHandler,
  ScenarioComponentRegistry as LegacyScenarioComponentRegistry,
  ScenarioModuleContext as LegacyScenarioModuleContext,
} from './types'

// 场景模块导出
export { default as dataAnalystModule } from './data-analyst'

import { scenarioLoader } from './core'
import dataAnalystModule from './data-analyst'

export function registerBuiltinScenarios(): void {
  scenarioLoader.register(dataAnalystModule)
}
