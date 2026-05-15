import { Settings, Workflow, Compass } from 'lucide-react'
import { HintOverlay } from '../ui/HintOverlay'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '@renderer/i18n'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getLucideIcon } from '../foundation/IconMap'
import { UserAccountPopover } from './UserAccountPopover'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'
import type { SidePanel } from '@store/slices'
import { BRAND } from '@shared/brand'

const DEFAULT_ITEMS: SidebarItemDescriptor[] = [
  { id: 'explorer', icon: 'Files', label: 'Explorer', labelZh: '资源管理器', component: 'ExplorerView', position: 0 },
  { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 1 },
  { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 2 },
]

function NavPill({ active }: { active: boolean }) {
  return (
    <div
      className={`
        absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full
        transition-all duration-300 ease-out
        ${active ? 'h-5 bg-accent shadow-[0_0_8px_rgba(var(--accent-rgb),0.5)]' : 'h-0 bg-transparent'}
      `}
    />
  )
}

export default function NavigationRail() {
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

  const p = BRAND.cssPrefix

  return (
    <div className={`${p}-nav-rail`}>
      <style>{`
        .${p}-nav-rail {
          width: 48px;
          background: rgb(var(--background-secondary));
          border-right: 1px solid rgba(var(--border), 0.2);
          display: flex;
          flex-direction: column;
          z-index: 30;
          user-select: none;
          align-items: center;
          padding: 12px 0;
        }
        .${p}-nav-rail-item {
          position: relative;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          cursor: pointer;
          border: none;
          background: transparent;
          color: rgb(var(--text-muted));
        }
        .${p}-nav-rail-item:hover {
          color: rgb(var(--text-primary));
          background: rgba(var(--surface-hover), 0.5);
        }
        .${p}-nav-rail-item[data-active="true"] {
          color: rgb(var(--accent));
          background: rgba(var(--accent), 0.08);
        }
        .${p}-nav-rail-divider {
          width: 20px;
          height: 1px;
          background: rgba(var(--border), 0.3);
          margin: 6px 0;
        }
      `}</style>

      <div className="flex-1 flex flex-col w-full items-center gap-1">
        {sidebarItems.map((item) => {
          const IconComponent = getLucideIcon(item.icon)
          const label = language === 'zh' ? item.labelZh : item.label
          const isActive = activeSidePanel === item.id
          return (
            <HintOverlay key={item.id} content={label} side="right" delay={400}>
              <button
                onClick={() => setActiveSidePanel(isActive ? null : (item.id as SidePanel))}
                className={`${p}-nav-rail-item`}
                data-active={isActive}
              >
                <NavPill active={isActive} />
                <IconComponent
                  className={`w-[18px] h-[18px] transition-all duration-200 ${isActive ? 'scale-105' : 'opacity-60'}`}
                  strokeWidth={isActive ? 2 : 1.5}
                />
              </button>
            </HintOverlay>
          )
        })}
      </div>

      <div className="flex flex-col w-full items-center gap-1 pb-1">
        <UserAccountPopover language={language} />

        <div className={`${p}-nav-rail-divider`} />

        <HintOverlay content={language === 'zh' ? '探索' : 'Explore'} side="right" delay={400}>
          <button
            onClick={() => setActiveSidePanel(activeSidePanel === 'scenarios' ? null : 'scenarios')}
            className={`${p}-nav-rail-item`}
            data-active={activeSidePanel === 'scenarios'}
          >
            <NavPill active={activeSidePanel === 'scenarios'} />
            <Compass
              className={`w-[18px] h-[18px] transition-all duration-200 ${activeSidePanel === 'scenarios' ? 'scale-105' : 'opacity-60'}`}
              strokeWidth={activeSidePanel === 'scenarios' ? 2 : 1.5}
            />
          </button>
        </HintOverlay>

        <HintOverlay content={language === 'zh' ? '工作流' : 'Workflow'} side="right" delay={400}>
          <button
            onClick={() => setShowWorkflow(true)}
            className={`${p}-nav-rail-item`}
          >
            <Workflow className="w-[18px] h-[18px] opacity-60 hover:opacity-100 transition-opacity" strokeWidth={1.5} />
          </button>
        </HintOverlay>

        <HintOverlay content={t('settings', language)} side="right" delay={400}>
          <button
            onClick={() => setShowSettings(true)}
            className={`${p}-nav-rail-item`}
          >
            <Settings className="w-[18px] h-[18px] opacity-60 hover:opacity-100 transition-all duration-300 hover:rotate-45" strokeWidth={1.5} />
          </button>
        </HintOverlay>
      </div>
    </div>
  )
}
