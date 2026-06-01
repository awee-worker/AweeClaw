import { useEffect } from 'react'
import { getPanelComponent, registerScenarioPanelComponents } from './PanelRegistry'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

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
        <p className="text-xs">{t('explorer.panel', language as Language, { scenarioName: scenarioName })}</p>
        <p className="text-[11px] mt-1 opacity-70">{t('explorer.progressindicatorcomponent', language as Language)}</p>
      </div>
    )
  }

  return <PanelComponent />
}
