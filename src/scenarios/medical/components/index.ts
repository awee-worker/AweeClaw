import type { ScenarioComponentRegistry } from '@shared/protocols/scenario-arch'
import { SymptomCheckerPanel } from './SymptomCheckerPanel'
import { DrugInfoPanel } from './DrugInfoPanel'

export const medicalComponents: ScenarioComponentRegistry = {
  SymptomCheckerPanel,
  DrugInfoPanel,
}
