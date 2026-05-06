/**
 * Scenarios - 场景模块系统（增强版）
 *
 * 每个场景独立目录，包含配置、组件、工具、服务。
 * 场景加载器负责动态注册和激活。
 *
 * 动态发现场景模块，新增场景只需在 src/scenarios/ 下创建目录，无需修改此文件。
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

import { scenarioLoader } from './core'
import { scenarioRegistry } from '@shared/config/scenarios'
import type { ScenarioModule } from '@shared/types/scenario-arch'

type ScenarioModuleEntry = { default: ScenarioModule }

const scenarioModuleEntries = import.meta.glob(
  '/src/scenarios/*/index.ts',
  { eager: true }
) as Record<string, ScenarioModuleEntry>

export function registerBuiltinScenarios(): void {
  for (const path in scenarioModuleEntries) {
    if (path.includes('/core/') || path.includes('/_template/')) continue

    const mod = scenarioModuleEntries[path]
    const scenarioModule = mod?.default
    if (scenarioModule && scenarioModule.id) {
      const manifest = scenarioModule.getManifest()
      if (!scenarioRegistry.isUninstalledBuiltin(manifest.id)) {
        scenarioLoader.register(scenarioModule)
      }
    }
  }
}
