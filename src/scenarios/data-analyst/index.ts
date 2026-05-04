/**
 * 数据分析师场景模块入口（增强版）
 *
 * 实现增强版 ScenarioModule 接口，集成：
 * - ScenarioManifest: 场景清单
 * - 生命周期钩子: onActivate/onDeactivate/onHealthCheck
 * - 依赖声明: getDependencies
 * - 数据总线: 通过 context 使用
 * - 监控日志: 通过 context.getLogger/getHealthReporter 使用
 */

import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/types/scenario-arch'
import { dataAnalystScenario } from './config/scenario'
import DATA_ANALYST_TOOLS from './tools/definitions'
import { dataAnalystComponents } from './components'

const DATA_ANALYST_MANIFEST: ScenarioManifest = {
  id: 'data-analyst',
  version: '1.0.0',
  name: 'Data Analyst',
  nameZh: '数据分析师',
  description: 'Data analysis, visualization, and statistical modeling',
  descriptionZh: '数据分析、可视化和统计建模',
  author: 'awee',
  icon: 'BarChart3',
  category: 'data',
  tags: ['data', 'analytics', 'visualization', 'statistics', 'sql'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: [
    'filesystem:read',
    'filesystem:write',
    'database:connect',
    'database:query',
    'network:request',
    'terminal:execute',
  ],
  homepage: 'https://github.com/jweelee/aweeclaw',
  license: 'SEE LICENSE IN LICENSE',
}

const dataAnalystModule: ScenarioModule = {
  id: 'data-analyst',
  version: '1.0.0',

  getManifest: () => DATA_ANALYST_MANIFEST,

  getPlugin: () => dataAnalystScenario,

  getTools: () => DATA_ANALYST_TOOLS,

  getComponents: () => dataAnalystComponents,

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    const health = context.getHealthReporter()
    log.info(`Activating data-analyst scenario v${context.version}`)

    if (context.workspacePath) {
      const dbPath = `${context.workspacePath}/.data/default.db`
      try {
        const { api } = await import('@/renderer/services/electronAPI')
        await api.data.connectDatabase({
          id: 'default',
          driver: 'sqlite',
          filePath: dbPath,
        })
        health.reportCheck('database', 'healthy', 'Default database connected')
        log.info(`Connected default database at ${dbPath}`)
      } catch (err) {
        health.reportCheck('database', 'degraded', `Database connection failed: ${err instanceof Error ? err.message : String(err)}`)
        log.warn(`Failed to connect default database: ${err}`)
      }
    }

    context.publishData('scenario:activated', {
      scenarioId: 'data-analyst',
      capabilities: ['sql_query', 'data_transform', 'csv_analyze', 'chart_generate', 'statistical_test', 'rest_api'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Deactivating data-analyst scenario')

    try {
      const { api } = await import('@/renderer/services/electronAPI')
      await api.data.disconnectDatabase('default')
      log.info('Disconnected default database')
    } catch (err) {
      log.warn(`Failed to disconnect database: ${err}`)
    }

    context.publishData('scenario:deactivated', { scenarioId: 'data-analyst' })
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    const checks: ScenarioHealthCheck[] = []

    try {
      const { api } = await import('@/renderer/services/electronAPI')
      const connections = await api.data.getConnections()
      const defaultConn = (connections as Array<{ id: string }>).find(c => c.id === 'default')
      checks.push({
        name: 'database',
        status: defaultConn ? 'healthy' : 'degraded',
        message: defaultConn ? 'Default database connected' : 'Default database not connected',
      })
    } catch {
      checks.push({
        name: 'database',
        status: 'unhealthy',
        message: 'Cannot check database status',
      })
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

export default dataAnalystModule
