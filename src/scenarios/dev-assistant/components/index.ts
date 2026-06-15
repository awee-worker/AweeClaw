import type { ScenarioComponentRegistry } from '@shared/protocols/scenario-arch'
import { SearchView } from './SearchExplorer'
import { GitView } from './SourceControlView'
import { OutlineView } from './SymbolOutline'
import { ProblemsView } from './DiagnosticsView'
import { ShellView } from './ShellExplorer'
import { HistoryView } from './HistoryExplorer'
import DevAssistantSettingsView from './settings/DevAssistantSettingsView'

export const devAssistantComponents: ScenarioComponentRegistry = {
  SearchView,
  GitView,
  OutlineView,
  ProblemsView,
  ShellView,
  HistoryView,
  DevAssistantSettingsView,
}