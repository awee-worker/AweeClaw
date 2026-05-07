import type { ScenarioComponentRegistry } from '@shared/types/scenario-arch'
import { DataSourceView } from './DataSourceView'
import { ChartsView } from './ChartsView'

export const dataAnalystComponents: ScenarioComponentRegistry = {
  DataSourceView,
  ChartGalleryView: ChartsView,
}
