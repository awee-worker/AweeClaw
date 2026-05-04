/**
 * 低电压治理场景模块入口
 *
 * 实现增强版 ScenarioModule 接口，集成：
 * - ScenarioManifest: 场景清单
 * - 数据库脚本: getInstallScripts/getUninstallScripts
 * - 生命周期钩子: onInstall/onActivate/onDeactivate/onUninstall
 * - 数据总线: 通过 context 使用
 * - 监控日志: 通过 context.getLogger/getHealthReporter 使用
 *
 * 数据库生命周期：
 * - 注册场景 → 自动执行 install scripts → 创建业务表
 * - 卸载场景 → 自动执行 uninstall scripts → 删除业务表 + 数据库文件
 */

import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/types/scenario-arch'
import { lowVoltageScenario } from './config/scenario'
import { INSTALL_SCRIPTS, UNINSTALL_SCRIPTS } from './db/scripts'
import DATA_ANALYST_TOOLS from '@/scenarios/data-analyst/tools/definitions'

const LOW_VOLTAGE_MANIFEST: ScenarioManifest = {
  id: 'low-voltage',
  version: '1.0.0',
  name: 'Low Voltage Treatment',
  nameZh: '低电压治理',
  description: 'Low voltage user management, district management, and treatment tracking',
  descriptionZh: '低电压用户管理、台区管理和治理跟踪',
  author: 'awee',
  icon: 'Zap',
  category: 'energy',
  tags: ['low-voltage', 'power-grid', 'energy', 'treatment', 'monitoring'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: [
    'filesystem:read',
    'filesystem:write',
    'database:connect',
    'database:query',
    'network:request',
  ],
  homepage: 'https://github.com/jweelee/aweeclaw',
  license: 'SEE LICENSE IN LICENSE',
}

const lowVoltageModule: ScenarioModule = {
  id: 'low-voltage',
  version: '1.0.0',

  getManifest: () => LOW_VOLTAGE_MANIFEST,

  getPlugin: () => lowVoltageScenario,

  getInstallScripts: () => INSTALL_SCRIPTS,

  getUninstallScripts: () => UNINSTALL_SCRIPTS,

  getTools: () => DATA_ANALYST_TOOLS,

  getComponents: () => ({}),

  onInstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Installing low-voltage scenario v${context.version}`)
    log.info('Database tables will be created by install scripts automatically')
  },

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    const health = context.getHealthReporter()
    log.info(`Activating low-voltage scenario v${context.version}`)

    try {
      const dbPath = await context.getDatabasePath()
      log.info(`Scenario database path: ${dbPath}`)
      health.reportCheck('database', 'healthy', `Database ready at ${dbPath}`)
    } catch (err) {
      health.reportCheck('database', 'degraded', 'Database path unavailable')
    }

    context.publishData('scenario:activated', {
      scenarioId: 'low-voltage',
      capabilities: ['user_management', 'district_management', 'treatment_tracking', 'voltage_monitoring', 'data_analysis'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Deactivating low-voltage scenario')

    context.publishData('scenario:deactivated', { scenarioId: 'low-voltage' })
  },

  onUninstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Uninstalling low-voltage scenario')
    log.info('Database tables will be dropped by uninstall scripts automatically')
  },

  onHealthCheck: async (context: ScenarioModuleContext): Promise<ScenarioHealthCheck[]> => {
    const checks: ScenarioHealthCheck[] = []

    try {
      const result = await context.executeSql('SELECT COUNT(*) as count FROM lv_users')
      checks.push({
        name: 'database',
        status: result.success ? 'healthy' : 'unhealthy',
        message: result.success
          ? `Database OK, ${result.rows?.[0]?.count ?? 0} users`
          : `Database error: ${result.error}`,
      })
    } catch {
      checks.push({ name: 'database', status: 'unhealthy', message: 'Cannot query database' })
    }

    checks.push({
      name: 'tools',
      status: 'healthy',
      message: `${DATA_ANALYST_TOOLS.length} tools available`,
    })

    return checks
  },

  getDependencies: (): ScenarioDependency[] => {
    return []
  },
}

export default lowVoltageModule
