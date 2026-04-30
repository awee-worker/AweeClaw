import { Settings, Sparkles } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '@renderer/i18n'
import { formatShortcut } from '@services/keybindingService'
import { scenarioRegistry } from '@shared/config/scenarios'
import { getLucideIcon } from '../common/IconMap'
import type { SidebarItemDescriptor } from '@shared/types/scenario'
import type { SidePanel } from '@store/slices'

const DEFAULT_ITEMS: SidebarItemDescriptor[] = [
  { id: 'explorer', icon: 'Files', label: 'Explorer', labelZh: '资源管理器', component: 'ExplorerView', position: 0 },
  { id: 'search', icon: 'Search', label: 'Search', labelZh: '搜索', component: 'SearchView', position: 1 },
  { id: 'git', icon: 'GitBranch', label: 'Git', labelZh: 'Git', component: 'GitView', position: 2 },
  { id: 'emotion', icon: 'Brain', label: 'Mood', labelZh: '情绪感知', component: 'EmotionView', position: 3 },
  { id: 'problems', icon: 'AlertCircle', label: 'Problems', labelZh: '问题', component: 'ProblemsView', position: 4 },
  { id: 'outline', icon: 'ListTree', label: 'Outline', labelZh: '大纲', component: 'OutlineView', position: 5 },
  { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 6 },
  { id: 'shell', icon: 'Terminal', label: 'Shell', labelZh: 'Shell', component: 'ShellView', position: 7 },
]

export default function ActivityBar() {
  const { activeSidePanel, setActiveSidePanel, language, setShowSettings, setShowComposer, activeScenarioId } = useStore(useShallow(s => ({
    activeSidePanel: s.activeSidePanel,
    setActiveSidePanel: s.setActiveSidePanel,
    language: s.language,
    setShowSettings: s.setShowSettings,
    setShowComposer: s.setShowComposer,
    activeScenarioId: s.activeScenarioId,
  })))

  const scenario = scenarioRegistry.get(activeScenarioId)
  const sidebarItems = scenario?.ui?.sidebarItems?.length
    ? [...scenario.ui.sidebarItems].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : DEFAULT_ITEMS

  return (
    <div className="w-[60px] bg-background-secondary/80 backdrop-blur-xl border-r border-border/30 shadow-[1px_0_15px_rgba(0,0,0,0.03)] flex flex-col z-30 select-none items-center py-4">
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
        <Tooltip content={`${t('composer', language)} (${formatShortcut('Ctrl+Shift+I')})`} side="right">
          <button
            onClick={() => setShowComposer(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95 transition-all duration-300 group"
          >
            <Sparkles className="w-[22px] h-[22px] opacity-70 group-hover:opacity-100 group-hover:text-accent transition-all group-hover:drop-shadow-[0_0_8px_rgba(var(--accent)/0.4)] group-hover:scale-105" strokeWidth={1.5} />
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
