export { scenarioLoader, scenarioDataBus, scenarioVersionManager, scenarioMonitor, scenarioTestFramework, scenarioDatabaseManager, compareVersions } from './core'
export type { ScenarioLoaderEvent } from './core'

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
} from '@shared/protocols/scenario-arch'

export type {
  ScenarioToolDefinition as LegacyScenarioToolDefinition,
  ScenarioIpcHandler as LegacyScenarioIpcHandler,
  ScenarioComponentRegistry as LegacyScenarioComponentRegistry,
  ScenarioModuleContext as LegacyScenarioModuleContext,
} from './providerTypes'

import { scenarioLoader } from './core'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import type { ScenarioModule } from '@shared/protocols/scenario-arch'

type ScenarioModuleEntry = { default: ScenarioModule }

const scenarioModuleEntries = import.meta.glob(
  '/src/scenarios/*/index.ts',
  { eager: true }
) as Record<string, ScenarioModuleEntry>

export function registerBuiltinScenarios(): void {
  for (const path in scenarioModuleEntries) {
    if (path.includes('/_template/')) continue

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
