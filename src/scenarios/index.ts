/**
 * Scenarios - 场景模块入口（重导出层）
 *
 * 核心架构已迁移至 @/scenario-system，此文件保持向后兼容。
 *
 * 目录结构：
 * - src/scenario-system/   核心架构（加载器、数据总线、数据库管理等）
 * - src/scenarios/         具体场景目录（每个场景一个文件夹）
 *   - _template/           场景开发模板
 *   - general-assistant/   通用助手
 *   - code-editor/         代码编辑器
 *   - data-analyst/        数据分析师
 *   - creative-writer/     创意写作
 *   - store-diagnosis/     门店诊断
 *   - ...                  其他场景
 */

export {
  scenarioLoader,
  scenarioDataBus,
  scenarioVersionManager,
  scenarioMonitor,
  scenarioTestFramework,
  scenarioDatabaseManager,
  compareVersions,
  registerBuiltinScenarios,
} from '@/scenario-system'

export type { ScenarioLoaderEvent } from '@/scenario-system'

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

export type {
  ScenarioToolDefinition as LegacyScenarioToolDefinition,
  ScenarioIpcHandler as LegacyScenarioIpcHandler,
  ScenarioComponentRegistry as LegacyScenarioComponentRegistry,
  ScenarioModuleContext as LegacyScenarioModuleContext,
} from '@/scenario-system/types'
