/**
 * 场景架构核心模块
 *
 * 统一导出场景系统的核心组件：
 * - ScenarioLoader: 场景注册管理中心与动态加载器
 * - ScenarioDataBus: 场景间数据交互总线
 * - ScenarioVersionManager: 场景版本控制管理器
 * - ScenarioMonitor: 场景监控与日志系统
 * - ScenarioTestFramework: 场景测试验证体系
 * - ScenarioDatabaseManager: 场景数据库管理器
 */

export { scenarioLoader } from './ScenarioLoader'
export { scenarioDataBus } from './ScenarioDataBus'
export { scenarioVersionManager, compareVersions } from './ScenarioVersionManager'
export { scenarioMonitor } from './ScenarioMonitor'
export { scenarioTestFramework } from './ScenarioTestFramework'
export { scenarioDatabaseManager } from './ScenarioDatabaseManager'
export { builtinToolRegistry } from './BuiltinToolRegistry'
export { DeclarativeScenarioModule } from './DeclarativeScenarioModule'
export { loadExternalScenarios, setExternalScenarioLoadFunctions } from './ExternalScenarioLoader'
export { executeInSandbox, validateScript } from './SandboxEngine'
export type { SandboxOptions, SandboxResult, SandboxAPIProvider } from './SandboxEngine'
export { ScenarioScriptExecutor } from './ScenarioScriptExecutor'
export { createContextAPI, createCoreAPI } from './SandboxAPI'
export type { ScenarioSandboxContext } from './SandboxAPI'
export { sharedDependencyProvider, injectSharedDependencies } from './SharedDependencyProvider'
export type { SharedDependencyRegistry, SharedDependencyMap, SharedDependencyMeta } from './SharedDependencyProvider'
export { ProgrammaticScenarioModule } from './ProgrammaticScenarioModule'
export type { ProgrammaticScenarioConfig, ProgrammaticScenarioExports } from './ProgrammaticScenarioModule'
export { loadProgrammaticScenario, loadAllProgrammaticScenarios, setProgrammaticLoadFunction } from './ProgrammaticScenarioLoader'
export { scenarioStyleManager } from './ScenarioStyleManager'
export { createScenarioSDK, injectScenarioSDK, removeScenarioSDK, getScenarioSDK } from './ScenarioSDK'
export type { ScenarioSDK, ScenarioStorageAPI, ScenarioStyleAPI, ScenarioContextAPI, ScenarioDataBusAPI, ScenarioLoggerAPI, ScenarioHealthAPI } from './ScenarioSDK'
export {
  loadScenarioFromInstalled,
  loadAllInstalledScenarios,
  downloadAndInstallFromUrl,
  installFromMarketplace,
  setDynamicLoadFunction,
} from './DynamicModuleLoader'
export type { DynamicLoadSource, DynamicLoadResult } from './DynamicModuleLoader'

export type { ScenarioLoaderEvent } from '@shared/protocols/scenario-arch'
