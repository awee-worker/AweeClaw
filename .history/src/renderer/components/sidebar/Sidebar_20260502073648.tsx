/**
 * Sidebar 主组件
 * 重塑：沉浸式设计，去除多余色块
 */

import { useStore } from '@store'
import { ExplorerView } from './panels/ExplorerView'
import { SearchView } from './panels/SearchView'
import { GitView } from './panels/GitView'
import { ProblemsView } from './panels/ProblemsView'
import { OutlineView } from './panels/OutlineView'
import { HistoryView } from './panels/HistoryView'
import { ShellView } from './panels/ShellView'
import { DataSourceView } from './panels/DataSourceView'
import { ChartsView } from './panels/ChartsView'
import { CharactersView } from './panels/CharactersView'
import { ScenarioManagerView } from '../scenario/ScenarioManagerView'
import { NotesView } from './panels/NotesView'
import { KnowledgeView } from './panels/KnowledgeView'
import { PromptsView } from './panels/PromptsView'
import { TasksView } from './panels/TasksView'
import { BookmarksView } from './panels/BookmarksView'

export default function Sidebar() {
    const activeSidePanel = useStore(s => s.activeSidePanel)

    if (!activeSidePanel) return null

    return (
        <div className="w-full bg-background border-r border-border/30 shadow-[1px_0_15px_rgba(0,0,0,0.03)] flex flex-col h-full animate-fade-in relative z-10">
            {activeSidePanel === 'explorer' && <ExplorerView />}
            {activeSidePanel === 'search' && <SearchView />}
            {activeSidePanel === 'git' && <GitView />}
            {activeSidePanel === 'problems' && <ProblemsView />}
            {activeSidePanel === 'outline' && <OutlineView />}
            {activeSidePanel === 'history' && <HistoryView />}
            {activeSidePanel === 'shell' && <ShellView />}
            {activeSidePanel === 'data-sources' && <DataSourceView />}
            {activeSidePanel === 'charts' && <ChartsView />}
            {activeSidePanel === 'characters' && <CharactersView />}
            {activeSidePanel === 'scenarios' && <ScenarioManagerView />}
            {activeSidePanel === 'notes' && <NotesView />}
            {activeSidePanel === 'knowledge' && <KnowledgeView />}
            {activeSidePanel === 'prompts' && <PromptsView />}
            {activeSidePanel === 'tasks' && <TasksView />}
            {activeSidePanel === 'bookmarks' && <BookmarksView />}
        </div>
    )
}