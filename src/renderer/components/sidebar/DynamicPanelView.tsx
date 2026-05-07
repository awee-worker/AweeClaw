import { useEffect } from 'react'
import { getPanelComponent, registerScenarioPanelComponents } from './PanelComponentRegistry'
import { scenarioRegistry } from '@shared/config/scenarios'
import { useStore } from '@store'

interface DynamicPanelViewProps {
  panelId: string
}

export function DynamicPanelView({ panelId }: DynamicPanelViewProps) {
  const activeScenarioId = useStore(s => s.activeScenarioId)
  const language = useStore(s => s.language)

  useEffect(() => {
    if (activeScenarioId) {
      registerScenarioPanelComponents(activeScenarioId)
    }
  }, [activeScenarioId])

  const PanelComponent = getPanelComponent(panelId)

  if (!PanelComponent) {
    const scenario = scenarioRegistry.get(activeScenarioId)
    const scenarioName = scenario ? (language === 'zh' ? scenario.nameZh : scenario.name) : activeScenarioId
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-4">
        <p className="text-xs">{language === 'zh' ? `${scenarioName} 场景面板` : `${scenarioName} Panel`}</p>
        <p className="text-[11px] mt-1 opacity-70">{language === 'zh' ? '组件加载中...' : 'Loading component...'}</p>
      </div>
    )
  }

  return <PanelComponent />
}
