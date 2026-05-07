import type { ScenarioComponentRegistry } from '@shared/types/scenario-arch'
import { StoreManagePanel } from './StoreManagePanel'
import { DiagnosisRecordsPanel } from './DiagnosisRecordsPanel'
import { OptimizationPlansPanel } from './OptimizationPlansPanel'
import { IndustryBenchmarkPanel } from './IndustryBenchmarkPanel'

export const storeDiagnosisComponents: ScenarioComponentRegistry = {
  StoreListView: StoreManagePanel,
  DiagnosisHistoryView: DiagnosisRecordsPanel,
  OptimizationPlanView: OptimizationPlansPanel,
  BenchmarkView: IndustryBenchmarkPanel,
}
