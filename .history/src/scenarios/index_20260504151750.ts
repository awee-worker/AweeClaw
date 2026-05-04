/**
 * Scenarios - 场景模块系统（增强版）
 *
 * 每个场景独立目录，包含配置、组件、工具、服务。
 * 场景加载器负责动态注册和激活。
 *
 * 架构层次：
 * - core/              核心模块（加载器、数据总线、版本管理、监控、测试、数据库管理）
 * - general-assistant/  通用助手场景
 * - code-editor/        代码编辑器场景
 * - data-analyst/       数据分析师场景
 * - creative-writer/    创意写作场景
 * - low-voltage/        低电压治理场景（含数据库生命周期）
 * - _template/          场景开发模板
 */

// 核心架构导出
export { scenarioLoader, scenarioDataBus, scenarioVersionManager, scenarioMonitor, scenarioTestFramework, scenarioDatabaseManager, compareVersions } from './core'
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
  ScenarioDbScript,
  ScenarioSqlResult,
} from '@shared/types/scenario-arch'

// 兼容旧接口类型导出
export type {
  ScenarioToolDefinition as LegacyScenarioToolDefinition,
  ScenarioIpcHandler as LegacyScenarioIpcHandler,
  ScenarioComponentRegistry as LegacyScenarioComponentRegistry,
  ScenarioModuleContext as LegacyScenarioModuleContext,
} from './types'

// 场景模块导出
export { default as generalAssistantModule } from './general-assistant'
export { default as codeEditorModule } from './code-editor'
export { default as dataAnalystModule } from './data-analyst'
export { default as creativeWriterModule } from './creative-writer'
export { default as lowVoltageModule } from './low-voltage'

import { scenarioLoader } from './core'
import generalAssistantModule from './general-assistant'
import codeEditorModule from './code-editor'
import dataAnalystModule from './data-analyst'
import creativeWriterModule from './creative-writer'
import lowVoltageModule from './low-voltage'

export function registerBuiltinScenarios(): void {
  scenarioLoader.register(generalAssistantModule)
  scenarioLoader.register(codeEditorModule)
  scenarioLoader.register(dataAnalystModule)
  scenarioLoader.register(creativeWriterModule)
  scenarioLoader.register(lowVoltageModule)
}
