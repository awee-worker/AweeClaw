import type { ScenarioComponentRegistry } from '@shared/types/scenario-arch'
import { StoreManagePanel } from './StoreManagePanel'
import { DiagnosisRecordsPanel } from './DiagnosisRecordsPanel'
import { OptimizationPlansPanel } from './OptimizationPlansPanel'
import { IndustryBenchmarkPanel } from './IndustryBenchmarkPanel'
import { StoreDataEntryPanel } from './StoreDataEntryPanel'
import { CompetitorPanel } from './CompetitorPanel'

export const storeDiagnosisComponents: ScenarioComponentRegistry = {
  StoreListView: StoreManagePanel,
  DiagnosisHistoryView: DiagnosisRecordsPanel,
  OptimizationPlanView: OptimizationPlansPanel,
  BenchmarkView: IndustryBenchmarkPanel,
  DataEntryView: StoreDataEntryPanel,
  CompetitorView: CompetitorPanel,
}
