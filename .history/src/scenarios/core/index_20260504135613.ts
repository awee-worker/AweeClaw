/**
 * 场景架构核心模块
 *
 * 统一导出场景系统的核心组件：
 * - ScenarioLoader: 场景注册管理中心与动态加载器
 * - ScenarioDataBus: 场景间数据交互总线
 * - ScenarioVersionManager: 场景版本控制管理器
 * - ScenarioMonitor: 场景监控与日志系统
 * - ScenarioTestFramework: 场景测试验证体系
 */

export { scenarioLoader } from './ScenarioLoader'
export { scenarioDataBus } from './ScenarioDataBus'
export { scenarioVersionManager, compareVersions } from './ScenarioVersionManager'
export { scenarioMonitor } from './ScenarioMonitor'
export { scenarioTestFramework } from './ScenarioTestFramework'

export type { ScenarioLoaderEvent } from '@shared/types/scenario-arch'
