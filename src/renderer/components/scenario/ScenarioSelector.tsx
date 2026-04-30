import { useState, useRef, useEffect } from 'react'
import { Code2, BarChart3, PenTool, Sparkles, ChevronDown, Check } from 'lucide-react'
import { scenarioRegistry } from '@shared/config/scenarios'
import { useStore } from '@store'
import type { ScenarioPlugin } from '@shared/types/scenario'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  Code2,
  BarChart3,
  PenTool,
  Sparkles,
}

export function ScenarioSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const activeScenarioId = useStore(s => s.activeScenarioId)
  const language = useStore(s => s.language)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [activeScenario, setActiveScenario] = useState<ScenarioPlugin>(
    () => scenarioRegistry.getActive() || scenarioRegistry.getDefault()
  )

  useEffect(() => {
    const scenario = scenarioRegistry.get(activeScenarioId)
    if (scenario && scenario.id !== activeScenario.id) {
      scenarioRegistry.setActive(activeScenarioId)
      setActiveScenario(scenario)
    }
  }, [activeScenarioId])

  useEffect(() => {
    const unsubscribe = scenarioRegistry.onActiveChange((scenarioId) => {
      const scenario = scenarioRegistry.get(scenarioId)
      if (scenario) setActiveScenario(scenario)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const scenarios = scenarioRegistry.getAll()
  const IconComponent = ICON_MAP[activeScenario.icon] || Sparkles

  function handleSelect(scenario: ScenarioPlugin) {
    scenarioRegistry.setActive(scenario.id)
    useStore.getState().set('activeScenarioId', scenario.id)
    setIsOpen(false)
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all duration-200"
      >
        <IconComponent className="w-3.5 h-3.5" strokeWidth={1.5} />
        <span>{language === 'zh' ? activeScenario.nameZh : activeScenario.name}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-background-secondary/95 backdrop-blur-xl border border-border/40 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="p-1.5">
            <div className="px-2.5 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider">
              {language === 'zh' ? '选择场景' : 'Scenario'}
            </div>
            {scenarios.map(scenario => {
              const ScenarioIcon = ICON_MAP[scenario.icon] || Sparkles
              const isActive = scenario.id === activeScenario.id
              return (
                <button
                  key={scenario.id}
                  onClick={() => handleSelect(scenario)}
                  className={`
                    w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all duration-200
                    ${isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-primary hover:bg-surface-hover'}
                  `}
                >
                  <ScenarioIcon
                    className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-accent' : 'text-text-muted'}`}
                    strokeWidth={1.5}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {language === 'zh' ? scenario.nameZh : scenario.name}
                    </div>
                    <div className="text-[10px] text-text-muted truncate">
                      {language === 'zh' ? scenario.descriptionZh : scenario.description}
                    </div>
                  </div>
                  {isActive && (
                    <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" strokeWidth={2} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
