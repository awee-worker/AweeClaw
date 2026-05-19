import type { ComponentType } from 'react'
import { scenarioRegistry } from '@shared/configuration/scenarios'

type PanelComponent = ComponentType<unknown>

const panelComponentRegistry = new Map<string, PanelComponent>()

export function registerPanelComponent(panelId: string, component: PanelComponent): void {
  panelComponentRegistry.set(panelId, component)
}

export function getPanelComponent(panelId: string): PanelComponent | undefined {
  return panelComponentRegistry.get(panelId)
}

export function hasPanelComponent(panelId: string): boolean {
  return panelComponentRegistry.has(panelId)
}

export function unregisterPanelComponent(panelId: string): boolean {
  return panelComponentRegistry.delete(panelId)
}

export function registerScenarioPanelComponents(scenarioId: string): void {
  const scenario = scenarioRegistry.get(scenarioId)
  if (!scenario?.ui?.sidebarItems) return

  try {
    const module = getScenarioModule(scenarioId)
    if (!module?.getComponents) return

    const components = module.getComponents()
    for (const item of scenario.ui.sidebarItems) {
      const comp = components[item.component]
      if (comp) {
        registerPanelComponent(item.id, comp)
      }
    }

    if (scenario.ui.welcomeComponent) {
      const welcomeComp = components[scenario.ui.welcomeComponent]
      if (welcomeComp) {
        registerPanelComponent(`welcome-${scenarioId}`, welcomeComp)
      }
    }
  } catch {}
}

export function unregisterScenarioPanelComponents(scenarioId: string): void {
  const scenario = scenarioRegistry.get(scenarioId)
  if (!scenario?.ui?.sidebarItems) return

  for (const item of scenario.ui.sidebarItems) {
    unregisterPanelComponent(item.id)
  }

  if (scenario.ui.welcomeComponent) {
    unregisterPanelComponent(`welcome-${scenarioId}`)
  }
}

function getScenarioModule(scenarioId: string) {
  try {
    const entries = import.meta.glob('/src/scenarios/*/index.ts', { eager: true }) as Record<string, { default: { id: string; getComponents?: () => Record<string, PanelComponent> } }>
    for (const path in entries) {
      const mod = entries[path]?.default
      if (mod?.id === scenarioId) return mod
    }
  } catch {}
  return null
}
