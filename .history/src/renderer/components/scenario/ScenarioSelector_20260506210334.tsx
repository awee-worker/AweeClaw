import { useState, useRef, useEffect } from 'react'
import {
  Code2, BarChart3, PenTool, Sparkles, ChevronDown, Check,
  Shield, Package, HardDrive, Globe, Download,
  BookOpen, Brain, Briefcase, Calculator, Calendar,
  Cpu, Database, FileText, FlaskConical,
  GraduationCap, Heart, Lightbulb, MessageSquare,
  Music, Palette, Rocket, Scale, Search,
  ShieldCheck, Stethoscope, TrendingUp, Users, Zap,
} from 'lucide-react'
import { scenarioRegistry } from '@shared/config/scenarios'
import { useStore } from '@store'
import type { ScenarioPlugin } from '@shared/types/scenario'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  Code2, BarChart3, PenTool, Sparkles,
  BookOpen, Brain, Briefcase, Calculator, Calendar,
  Cpu, Database, FileText, FlaskConical, Globe,
  GraduationCap, Heart, Lightbulb, MessageSquare,
  Music, Palette, Rocket, Scale, Search,
  ShieldCheck, Stethoscope, TrendingUp, Users, Zap,
  Package, HardDrive,
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

  const scenarios = scenarioRegistry.getInstalled()
  const builtinScenarios = scenarios.filter(s => s.isBuiltin).sort((a, b) => {
    if (a.id === 'general-assistant') return -1
    if (b.id === 'general-assistant') return 1
    return 0
  })
  const installedScenarios = scenarios.filter(s => !s.isBuiltin)
  const IconComponent = ICON_MAP[activeScenario.icon] || Sparkles

  function handleSelect(scenario: ScenarioPlugin) {
    scenarioRegistry.setActive(scenario.id)
    useStore.getState().set('activeScenarioId', scenario.id)
    setIsOpen(false)
  }

  function getSourceIcon(scenario: ScenarioPlugin): LucideIcon {
    if (scenario.isBuiltin) return Shield
    switch (scenario.source) {
      case 'marketplace': return Download
      case 'url': return Globe
      case 'local': return HardDrive
      default: return Package
    }
  }

  const renderScenarioItem = (scenario: ScenarioPlugin) => {
    const ScenarioIcon = ICON_MAP[scenario.icon] || Sparkles
    const isActive = scenario.id === activeScenario.id
    const SourceIcon = getSourceIcon(scenario)

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
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">
              {language === 'zh' ? scenario.nameZh : scenario.name}
            </span>
            {!scenario.isBuiltin && (
              <SourceIcon className="w-2.5 h-2.5 text-text-muted/60 flex-shrink-0" strokeWidth={1.5} />
            )}
          </div>
          <div className="text-[11px] text-text-muted truncate">
            {language === 'zh' ? scenario.descriptionZh : scenario.description}
          </div>
        </div>
        {isActive && (
          <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" strokeWidth={2} />
        )}
      </button>
    )
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
        <div className="absolute top-full left-0 mt-1 w-72 bg-background-secondary/95 backdrop-blur-xl border border-border/40 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="p-1.5 max-h-[70vh] overflow-y-auto">
            {builtinScenarios.length > 0 && (
              <>
                <div className="px-2.5 py-1.5 text-[11px] font-medium text-text-muted uppercase tracking-wider flex items-center gap-1">
                  <Shield className="w-2.5 h-2.5" strokeWidth={1.5} />
                  {language === 'zh' ? '内置场景' : 'Built-in'}
                </div>
                {builtinScenarios.map(renderScenarioItem)}
              </>
            )}

            {installedScenarios.length > 0 && (
              <>
                <div className="px-2.5 py-1.5 mt-1 text-[11px] font-medium text-text-muted uppercase tracking-wider flex items-center gap-1">
                  <Package className="w-2.5 h-2.5" strokeWidth={1.5} />
                  {language === 'zh' ? '已安装场景' : 'Installed'}
                </div>
                {installedScenarios.map(renderScenarioItem)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
