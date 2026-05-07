import { Settings, LayoutGrid, Workflow } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '@renderer/i18n'
import { scenarioRegistry } from '@shared/config/scenarios'
import { getLucideIcon } from '../common/IconMap'
import { Logo } from '../common/Logo'
import type { SidebarItemDescriptor } from '@shared/types/scenario'
import type { SidePanel } from '@store/slices'

const DEFAULT_ITEMS: SidebarItemDescriptor[] = [
  { id: 'explorer', icon: 'Files', label: 'Explorer', labelZh: '资源管理器', component: 'ExplorerView', position: 0 },
  { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 1 },
  { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 2 },
]

export default function ActivityBar() {
  const { activeSidePanel, setActiveSidePanel, language, setShowSettings, setShowWorkflow, activeScenarioId } = useStore(useShallow(s => ({
    activeSidePanel: s.activeSidePanel,
    setActiveSidePanel: s.setActiveSidePanel,
    language: s.language,
    setShowSettings: s.setShowSettings,
    setShowWorkflow: s.setShowWorkflow,
    activeScenarioId: s.activeScenarioId,
  })))

  const scenario = scenarioRegistry.get(activeScenarioId)
  const sidebarItems = scenario?.ui?.sidebarItems?.length
    ? [...scenario.ui.sidebarItems].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : DEFAULT_ITEMS

  return (
    <div className="w-[60px] bg-background-secondary border-r border-border/30 flex flex-col z-30 select-none items-center py-4">
      <div className="flex-1 flex flex-col w-full items-center gap-3">
        {sidebarItems.map((item) => {
          const IconComponent = getLucideIcon(item.icon)
          const label = language === 'zh' ? item.labelZh : item.label
          return (
            <Tooltip key={item.id} content={label} side="right">
              <button
                onClick={() => setActiveSidePanel(activeSidePanel === item.id ? null : (item.id as SidePanel))}
                className={`
                  w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group relative
                  ${activeSidePanel === item.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95'}
                `}
              >
                <IconComponent
                  className={`w-[22px] h-[22px] transition-all duration-300 
                    ${activeSidePanel === item.id ? 'drop-shadow-[0_0_10px_rgba(var(--accent)/0.6)] scale-105' : 'opacity-70 group-hover:opacity-100 group-hover:scale-105'}
                  `}
                  strokeWidth={activeSidePanel === item.id ? 2 : 1.5}
                />
              </button>
            </Tooltip>
          )
        })}
      </div>

      <div className="flex flex-col w-full items-center gap-3 pb-2">
        <Tooltip content={language === 'zh' ? '关于 AweeClaw' : 'About AweeClaw'} side="right">
          <button
            onClick={() => useStore.getState().setShowAbout(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group hover:bg-accent/5 active:scale-95"
          >
            <div className="w-6 h-6 flex items-center justify-center opacity-70 group-hover:opacity-100 transition-all">
              <Logo className="w-full group-hover:drop-shadow-[0_0_8px_rgba(var(--accent)/0.6)]" glow />
            </div>
          </button>
        </Tooltip>
        <Tooltip content={language === 'zh' ? '工作流' : 'Workflow'} side="right">
          <button
            onClick={() => setShowWorkflow(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95 transition-all duration-300 group"
          >
            <Workflow className="w-[22px] h-[22px] opacity-70 group-hover:opacity-100 group-hover:text-accent transition-all group-hover:drop-shadow-[0_0_8px_rgba(var(--accent)/0.4)] group-hover:scale-105" strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content={language === 'zh' ? '场景管理' : 'Scenarios'} side="right">
          <button
            onClick={() => setActiveSidePanel(activeSidePanel === 'scenarios' ? null : 'scenarios')}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group ${activeSidePanel === 'scenarios' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95'}`}
          >
            <LayoutGrid
              className={`w-[22px] h-[22px] transition-all duration-300 ${activeSidePanel === 'scenarios' ? 'drop-shadow-[0_0_10px_rgba(var(--accent)/0.6)] scale-105' : 'opacity-70 group-hover:opacity-100 group-hover:scale-105'}`}
              strokeWidth={activeSidePanel === 'scenarios' ? 2 : 1.5}
            />
          </button>
        </Tooltip>
        <Tooltip content={t('settings', language)} side="right">
          <button
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95 transition-all duration-300 group"
          >
            <Settings className="w-[22px] h-[22px] opacity-70 group-hover:opacity-100 group-hover:rotate-45 transition-all duration-500" strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
