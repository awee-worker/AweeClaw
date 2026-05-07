import { useStore } from '@store'
import { ExplorerView } from './panels/ExplorerView'
import { SearchView } from './panels/SearchView'
import { GitView } from './panels/GitView'
import { ProblemsView } from './panels/ProblemsView'
import { OutlineView } from './panels/OutlineView'
import { HistoryView } from './panels/HistoryView'
import { ShellView } from './panels/ShellView'
import { ScenarioManagerView } from '../scenario/ScenarioManagerView'
import { NotesView } from './panels/NotesView'
import { KnowledgeView } from './panels/KnowledgeView'
import { PromptsView } from './panels/PromptsView'
import { TasksView } from './panels/TasksView'
import { BookmarksView } from './panels/BookmarksView'
import { DynamicPanelView } from './DynamicPanelView'

const BUILTIN_PANELS: Record<string, React.ComponentType> = {
  explorer: ExplorerView,
  search: SearchView,
  git: GitView,
  problems: ProblemsView,
  outline: OutlineView,
  history: HistoryView,
  shell: ShellView,
  scenarios: ScenarioManagerView,
  notes: NotesView,
  knowledge: KnowledgeView,
  prompts: PromptsView,
  tasks: TasksView,
  bookmarks: BookmarksView,
}

export default function Sidebar() {
    const activeSidePanel = useStore(s => s.activeSidePanel)

    if (!activeSidePanel) return null

    const BuiltinPanel = BUILTIN_PANELS[activeSidePanel]

    return (
        <div className="w-full bg-background border-r border-border/30 shadow-[1px_0_15px_rgba(0,0,0,0.03)] flex flex-col h-full animate-fade-in relative z-10">
            {BuiltinPanel ? <BuiltinPanel /> : <DynamicPanelView panelId={activeSidePanel} />}
        </div>
    )
}
