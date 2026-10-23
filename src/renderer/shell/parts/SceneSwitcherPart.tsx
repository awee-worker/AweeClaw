/**
 * 场景切换部件（scene-switcher）
 *
 * 标题栏左侧第一组内容：导航栏折叠、自绘菜单栏、当前场景、当前工作空间、
 * 快速搜索。它们共同回答同一个问题 ——「我现在在哪个场景、哪个工作空间」，
 * 因此放在一个部件里，不做更细的切分。
 *
 * 平台差异：macOS 空出左侧红绿灯位置并使用系统菜单栏；Linux 把菜单栏放在
 * 场景选择器之前，Windows 放在搜索按钮之后（见各分支注释）。
 */

import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Search } from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { t, type Language } from '@renderer/i18n'
import AppMenuBar from '@components/layout/AppMenuBar'
import ProjectSelector from '@components/layout/ProjectSelector'
import ScenarioSelector from '@components/layout/ScenarioSelector'
import { PanelLeftIcon } from '@components/foundation/PanelLeftIcon'
import { HintOverlay } from '@components/ui/HintOverlay'
import type { HostPartComponentProps } from '../HostPartRegistry'


const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('MAC') ?? -1) >= 0
)

/** Windows 平台判定：用于决定自绘菜单栏的摆放位置（Windows 排在搜索按钮之后） */
const isWindows = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('WIN') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('WIN') ?? -1) >= 0
)


export function SceneSwitcherPart(_props: HostPartComponentProps) {
  const {
    language,
    navRailExpanded,
    setNavRailExpanded,
    setShowQuickOpen,
    setShowScenarioPage,
    setShowWorkflow,
    closeAllFullPages,
    activeScenarioId,
  } = useStore(
    useShallow((s) => ({
      language: s.language,
      navRailExpanded: s.navRailExpanded,
      setNavRailExpanded: s.setNavRailExpanded,
      setShowQuickOpen: s.setShowQuickOpen,
      setShowScenarioPage: s.setShowScenarioPage,
      setShowWorkflow: s.setShowWorkflow,
      closeAllFullPages: s.closeAllFullPages,
      activeScenarioId: s.activeScenarioId,
    })),
  )

  /**
   * 场景声明要隐藏的外壳入口
   *
   * 场景自己已经在工作区里提供了对应操作时（如短剧工坊的导航栏与制作台），
   * 顶部再摆一套通用入口只会造成重复与误操作，因此按场景收起。
   */
  const scenarioChrome = scenarioRegistry.get(activeScenarioId)?.ui?.chrome
  const hideWorkspaceSelector = scenarioChrome?.hideWorkspaceSelector === true
  const hideSearch = scenarioChrome?.hideSearch === true

  const handleOpenMarketplace = useCallback(() => {
    closeAllFullPages()
    setShowWorkflow(false)
    setShowScenarioPage(true)
  }, [closeAllFullPages, setShowWorkflow, setShowScenarioPage])

  return (
    <div className={`flex items-center gap-3 h-full ${isMac && !navRailExpanded ? 'pl-[40px]' : 'pl-3'}`}>
      {/* 导航栏收起时在这里提供展开入口；展开态由导航栏顶部右侧的按钮负责收起 */}
      {!navRailExpanded && (
        <HintOverlay content={t('layout.expandmenu', language as Language)} side="bottom" delay={300}>
          <button
            onClick={() => setNavRailExpanded(true)}
            className="no-drag w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all duration-200"
          >
            <PanelLeftIcon className="w-4 h-4" />
          </button>
        </HintOverlay>
      )}


      {/* Linux：自绘顶部菜单栏保持在场景/工作空间选择器之前（macOS 使用系统菜单栏） */}
      {!isMac && !isWindows && <AppMenuBar />}

      <ScenarioSelector onOpenMarketplace={handleOpenMarketplace} />

      {!hideWorkspaceSelector && (
        <>
          <div className="w-[1px] h-4 bg-border/50" />

          <div className="no-drag">
            <ProjectSelector />
          </div>

          <div className="w-[1px] h-4 bg-border/50" />
        </>
      )}

      {!hideSearch && (
        <div
          onClick={() => setShowQuickOpen(true)}
          className="no-drag flex items-center gap-1.5 px-2 h-[28px] rounded-md hover:bg-text-primary/[0.06] transition-all duration-200 cursor-pointer group"
        >
          <Search className="w-3.5 h-3.5 text-text-muted opacity-70 group-hover:text-accent transition-colors" />
          <span className="text-xs text-text-muted opacity-70 group-hover:text-text-primary transition-colors">
            {t('layout.search', language as Language)}
          </span>
        </div>
      )}

      {/* Windows：自绘顶部菜单栏紧跟在搜索按钮之后 */}
      {isWindows && <AppMenuBar />}
    </div>
  )
}

export default SceneSwitcherPart
