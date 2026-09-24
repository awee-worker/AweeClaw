import { useStore } from '@store'
import { ExplorerView } from './panels/FileExplorer'
import { ScenarioManagerView } from '../scenario/ScenarioManagerView'
import { NotesView } from './panels/NotesExplorer'
import { KnowledgeView } from './panels/KnowledgeExplorer'
import { PromptsView } from './panels/PromptLibrary'
import { TasksView } from './panels/TaskExplorer'
import { BookmarksView } from './panels/BookmarkExplorer'
import { ScheduleExplorer } from './panels/ScheduleExplorer'
import { SceneToolsPanel } from '../scene-tools/SceneToolsPanel'
import { DynamicPanelView } from './AdaptivePanelView'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { useMemo } from 'react'

/**
 * 窄侧栏面板兜底映射。
 *
 * 注意 `tasks` 不在这里：任务面板已统一为 PanelRegistry 的 TaskWorkspace（后端任务），
 * 若在此再映射一次，就会出现「同一个 panelId 两套实现、数据源不同」的隐患。
 * 本地待办面板改用独立 id `todo-tasks`，避免与它碰撞。
 */
const BUILTIN_PANELS: Record<string, React.ComponentType> = {
  explorer: ExplorerView,
  scenarios: ScenarioManagerView,
  notes: NotesView,
  knowledge: KnowledgeView,
  prompts: PromptsView,
  'todo-tasks': TasksView,
  bookmarks: BookmarksView,
  schedule: ScheduleExplorer,
  'scene-tools': SceneToolsPanel,
}

function useWideModePanelIds(): string[] {
  const activeScenarioId = useStore(s => s.activeScenarioId)
  return useMemo(() => {
    if (!activeScenarioId) return []
    const scenario = scenarioRegistry.get(activeScenarioId)
    if (!scenario?.ui?.sidebarItems) return []
    return scenario.ui.sidebarItems.filter(item => item.wideMode).map(item => item.id)
  }, [activeScenarioId])
}

export default function Sidebar() {
    const activeSidePanel = useStore(s => s.activeSidePanel)
    const wideModePanelIds = useWideModePanelIds()

    if (!activeSidePanel) return null

    if (wideModePanelIds.includes(activeSidePanel)) return null

    const BuiltinPanel = BUILTIN_PANELS[activeSidePanel]

    return (
        <div className="w-full bg-background border-r border-border/30 shadow-[1px_0_15px_rgba(0,0,0,0.03)] flex flex-col h-full animate-fade-in relative z-10">
            {BuiltinPanel ? <BuiltinPanel /> : <DynamicPanelView panelId={activeSidePanel} />}
        </div>
    )
}
