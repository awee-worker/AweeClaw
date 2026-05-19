import { useStore } from '@store'
import type { ScenarioPlugin } from '@shared/protocols/scenario'
import type { SidePanel } from '@store/slices/layoutSlice'
import { registerScenarioPanelComponents, unregisterScenarioPanelComponents } from '../explorer/PanelRegistry'

export function activateScenarioPanels(scenario: ScenarioPlugin): void {
  const prevScenarioId = useStore.getState().activeScenarioId
  if (prevScenarioId && prevScenarioId !== scenario.id) {
    unregisterScenarioPanelComponents(prevScenarioId)
  }
  registerScenarioPanelComponents(scenario.id)
}

export function switchToFirstPanel(scenario: ScenarioPlugin): void {
  const store = useStore.getState()
  const sidebarItemIds = (scenario.ui?.sidebarItems || []).map(item => item.id)
  const firstPanel = scenario.ui?.defaultSidePanel || sidebarItemIds[0] || 'explorer'
  store.setActiveSidePanel(firstPanel as SidePanel)
  store.setShowWelcomePage(false)
  store.setShowSettingsPage(false)
  store.setShowUserProfilePage(false)
  store.setShowBillingCenterPage(false)
}
