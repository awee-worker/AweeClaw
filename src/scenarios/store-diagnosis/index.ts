import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/protocols/scenario-arch'
import { storeDiagnosisScenario } from './config/scenario'
import STORE_DIAGNOSIS_TOOLS from './tools/definitions'
import { storeDiagnosisComponents } from './components'
import { INSTALL_SCRIPTS, UNINSTALL_SCRIPTS } from './db/scripts'

const SCENARIO_ID = 'store-diagnosis'
const SCENARIO_VERSION = '1.0.0'

const STORE_DIAGNOSIS_MANIFEST: ScenarioManifest = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,
  name: 'Store Diagnosis',
  nameZh: '门店诊断',
  description: 'AI-powered store operation diagnosis and optimization',
  descriptionZh: 'AI驱动的门店运营诊断与优化',
  author: 'awee',
  icon: 'Stethoscope',
  category: 'business',
  tags: ['store', 'diagnosis', 'retail', 'restaurant', 'optimization', 'business'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: [
    'filesystem:read',
    'filesystem:write',
    'database:connect',
    'database:query',
  ],
  homepage: 'https://github.com/jweelee/aweeclaw',
  license: 'SEE LICENSE IN LICENSE',
}

const storeDiagnosisModule: ScenarioModule = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,

  getManifest: () => STORE_DIAGNOSIS_MANIFEST,

  getPlugin: () => storeDiagnosisScenario,

  getTools: () => STORE_DIAGNOSIS_TOOLS,

  getComponents: () => storeDiagnosisComponents,

  getInstallScripts: () => INSTALL_SCRIPTS,

  getUninstallScripts: () => UNINSTALL_SCRIPTS,

  onInstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Installing store-diagnosis scenario v${context.version}`)
  },

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    const health = context.getHealthReporter()
    log.info(`Activating store-diagnosis scenario v${context.version}`)

    try {
      const dbPath = await context.getDatabasePath()
      health.reportCheck('database', 'healthy', `Database ready at ${dbPath}`)
      log.info(`Store diagnosis database ready at ${dbPath}`)
    } catch (err) {
      health.reportCheck('database', 'degraded', `Database check failed: ${err instanceof Error ? err.message : String(err)}`)
      log.warn(`Failed to verify database: ${err}`)
    }

    const benchResult = await context.executeSql('SELECT COUNT(*) as count FROM industry_benchmarks')
    const benchCount = benchResult.rows?.[0]?.count as number || 0
    if (benchCount > 0) {
      health.reportCheck('benchmarks', 'healthy', `${benchCount} benchmark entries loaded`)
    } else {
      health.reportCheck('benchmarks', 'degraded', 'No benchmark data loaded')
    }

    context.publishData('scenario:activated', {
      scenarioId: SCENARIO_ID,
      capabilities: ['store_manage', 'store_diagnose', 'report_generate', 'optimization_plan', 'benchmark_query'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info('Deactivating store-diagnosis scenario')

    context.publishData('scenario:deactivated', { scenarioId: SCENARIO_ID })
  },

  onUninstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Uninstalling store-diagnosis scenario`)
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    const checks: ScenarioHealthCheck[] = []

    try {
      const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
      const storeCount = await scenarioDatabaseManager.executeSql(SCENARIO_ID, 'SELECT COUNT(*) as count FROM stores')
      const count = storeCount.rows?.[0]?.count as number || 0
      checks.push({
        name: 'database',
        status: storeCount.success ? 'healthy' : 'unhealthy',
        message: storeCount.success ? `${count} stores in database` : storeCount.error || 'Database error',
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
      message: `${STORE_DIAGNOSIS_TOOLS.length} tools available`,
    })

    return checks
  },

  getDependencies: (): ScenarioDependency[] => {
    return []
  },
}

export default storeDiagnosisModule
