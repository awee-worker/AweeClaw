import { useStore } from '@store'
import { ExplorerView } from './panels/FileExplorer'
import { ScenarioManagerView } from '../scenario/ScenarioManagerView'
import { NotesView } from './panels/NotesExplorer'
import { KnowledgeView } from './panels/KnowledgeExplorer'
import { PromptsView } from './panels/PromptLibrary'
import { TasksView } from './panels/TaskExplorer'
import { BookmarksView } from './panels/BookmarkExplorer'
import { ScheduleExplorer } from './panels/ScheduleExplorer'
import { LedgerExplorer } from './panels/ledger/LedgerExplorer'
import { SceneToolsPanel } from '../scene-tools/SceneToolsPanel'
import { DynamicPanelView } from './AdaptivePanelView'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { pluginUiRegistry } from '@renderer/plugins/PluginUiRegistry'
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
  ledger: LedgerExplorer,
  'scene-tools': SceneToolsPanel,
}

function useWideModePanelIds(): string[] {
  const activeScenarioId = useStore(s => s.activeScenarioId)
  return useMemo(() => {
    const scenarioIds = (() => {
      if (!activeScenarioId) return []
      const scenario = scenarioRegistry.get(activeScenarioId)
      if (!scenario?.ui?.sidebarItems) return []
      return scenario.ui.sidebarItems.filter(item => item.wideMode).map(item => item.id)
    })()
    // 插件面板的宽模式来自 manifest，不在场景配置里；这里合并进来，
    // 宽模式的插件面板才不会被侧栏重复渲染
    return [...new Set([...scenarioIds, ...pluginUiRegistry.getWideModePanelIds()])]
  }, [activeScenarioId])
}

/** 该面板是否是当前场景声明的侧栏入口 */
function belongsToScenario(scenarioId: string | null, panelId: string): boolean {
  if (!scenarioId) return false
  const items = scenarioRegistry.get(scenarioId)?.ui?.sidebarItems
  return Boolean(items?.some(item => item.id === panelId))
}

export default function Sidebar() {
    const activeScenarioId = useStore(s => s.activeScenarioId)
    const activeSidePanel = useStore(s => s.activeSidePanel)
    const wideModePanelIds = useWideModePanelIds()

    if (!activeSidePanel) return null

    if (wideModePanelIds.includes(activeSidePanel)) return null

    const BuiltinPanel = BUILTIN_PANELS[activeSidePanel]

    /**
     * 内置面板优先，其次才看场景面板
     *
     * activeSidePanel 是跨场景共享的一个字段：从场景 A 切到场景 B 时它可能还停在 A 的
     * 某个面板上，而 A 的面板组件仍留在全局 PanelRegistry 里（注册表按 id 共享、切换时
     * 未必注销）。若不加归属校验，DynamicPanelView 会照着这个 id 把 A 的界面渲染到 B 的
     * 工作空间位置 —— 表现为切回默认工作台后，左侧出现上一个场景的侧栏。
     */
    // 场景面板与插件面板共用 DynamicPanelView；插件面板不属于任何场景，
    // 需要用注册表单独判定，否则点击插件导航项时这里返回 null，整片空白。
    const isPluginPanel = !BuiltinPanel && pluginUiRegistry.isPluginPanel(activeSidePanel)

    const body = BuiltinPanel ? (
        <BuiltinPanel />
    ) : belongsToScenario(activeScenarioId, activeSidePanel) || isPluginPanel ? (
        <DynamicPanelView panelId={activeSidePanel} />
    ) : null

    if (!body) return null

    return (
        <div
          // 大面积容器统一取 --panel-surface，与左侧菜单、底栏、会话区同源
          style={{ backgroundColor: 'var(--panel-surface)' }}
          className="w-full border-r border-border/30 shadow-[1px_0_15px_rgba(0,0,0,0.03)] flex flex-col h-full animate-fade-in relative z-10"
        >
            {body}
        </div>
    )
}
