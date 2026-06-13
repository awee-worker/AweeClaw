/**
 * 场景协议统一入口
 *
 * 统一导出所有场景相关类型定义，消除碎片化。
 * 架构设计：
 *   - scenario.ts: 场景插件基础类型（身份、能力、UI、数据源）
 *   - scenario-arch.ts: 场景架构核心接口（清单、模块、上下文、生命周期）
 *   - scenario-declarative.ts: 声明式场景配置（JSON配置 + 文件资源）
 *   - marketplace.ts: 场景市场类型（浏览、搜索、安装、评分）
 *
 * 使用方式：
 *   import type { ScenarioModule, ScenarioManifest, ScenarioPermission } from '@shared/protocols/scenario-protocol'
 */

// ─── 场景插件基础类型 ──────────────────────────────────

export type {
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioModeDescriptor,
  ContextTypeDescriptor,
  ScenarioUI,
  UILayout,
  PanelDescriptor,
  ScenarioDataSources,
  ScenarioPlugin,
  ScenarioCategory,
  ScenarioContext,
} from './scenario'

// ─── 场景架构核心类型 ──────────────────────────────────

export type {
  ScenarioLifecycleState,
  ScenarioDependency,
  ScenarioManifest,
  ScenarioPermission,
  ScenarioVersionInfo,
  ScenarioHealthReport,
  ScenarioHealthCheck,
  ScenarioToolDefinition,
  ScenarioIpcHandler,
  ScenarioComponentRegistry,
  ScenarioDataMessage,
  ScenarioDataSubscription,
  ScenarioSharedDataEntry,
  ScenarioDbScript,
  ScenarioSqlResult,
  ScenarioModuleContext,
  ScenarioLogger,
  ScenarioHealthReporter,
  ScenarioModule,
  ScenarioLoaderEvent,
  ScenarioRegistryEntry,
} from './scenario-arch'

// ─── 声明式场景类型 ────────────────────────────────────

export type {
  DeclarativeToolParam,
  DeclarativeCustomTool,
  DeclarativeIdentity,
  DeclarativeUI,
  DeclarativeDatabase,
  DeclarativeScripts,
  DeclarativeScriptTool,
  DeclarativeScenarioConfig,
} from './scenario-declarative'

// ─── 场景市场类型 ──────────────────────────────────────

export type {
  MarketplaceEntry,
  MarketplaceCategory,
  MarketplaceSource,
  MarketplaceSearchQuery,
  MarketplaceSearchResult,
  InstallStatus,
  InstallProgress,
  MarketplaceSourceConfig,
  InstalledScenario,
} from './marketplace'