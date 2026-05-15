import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { resetLspState } from './languageServerAdapter'
import { clearExtraLibs } from './monacoTypeAdapter'
import { lintService } from '@intelligence/runtime/codeAnalysisService'
import { streamingEditService } from '@intelligence/runtime/streamingEditor'
import { clearHealthCache } from './providerHealthAdapter'
import { workspaceStorageRuntime } from './workspaceStorageAdapter'
import {
  suspendAgentStorageWrites,
  resumeAgentStorageWrites,
  markAgentStorageSnapshotAsCurrent,
} from '@intelligence/state/intelligenceStorage'

export function resetWorkspaceRuntimeState(): void {
  useStore.setState({
    openFiles: [],
    activeFilePath: null,
    expandedFolders: new Set(),
    selectedFolderPath: null,
  })

  suspendAgentStorageWrites()
  try {
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
      threadMessageVersions: {},
      pendingChanges: [],
      branches: {},
      activeBranchId: {},
      inputPrompt: '',
      currentSessionId: null,
    })
    markAgentStorageSnapshotAsCurrent(null)
  } finally {
    resumeAgentStorageWrites()
  }

  useStore.getState().clearToolCallLogs()

  resetLspState()
  clearExtraLibs()
  lintService.clearCache()
  streamingEditService.clearAll()
  clearHealthCache()
  workspaceStorageRuntime.reset()
}
