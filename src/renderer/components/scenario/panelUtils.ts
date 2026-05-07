import { useStore } from '@store'
import type { ScenarioPlugin } from '@shared/types/scenario'
import type { SidePanel } from '@store/slices/layoutSlice'
import { registerScenarioPanelComponents, unregisterScenarioPanelComponents } from '../sidebar/PanelComponentRegistry'

export function activateScenarioPanels(scenario: ScenarioPlugin): void {
  const prevScenarioId = useStore.getState().activeScenarioId
  if (prevScenarioId && prevScenarioId !== scenario.id) {
    unregisterScenarioPanelComponents(prevScenarioId)
  }
  registerScenarioPanelComponents(scenario.id)
}

export function switchToFirstPanel(scenario: ScenarioPlugin): void {
  const sidebarItemIds = (scenario.ui?.sidebarItems || []).map(item => item.id)
  const firstPanel = scenario.ui?.defaultSidePanel || sidebarItemIds[0] || 'explorer'
  useStore.getState().setActiveSidePanel(firstPanel as SidePanel)
}
