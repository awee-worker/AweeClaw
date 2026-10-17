import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { resetLspState } from './languageServerAdapter'
import { clearExtraLibs } from './monacoTypeAdapter'
import { lintService } from '@intelligence/runtime/codeAnalysisService'
import { streamingEditService } from '@intelligence/runtime/streamingEditor'
import { clearHealthCache } from './providerHealthAdapter'
import { workspaceStorageRuntime } from './workspaceStorageAdapter'
import { skillService } from '@intelligence/runtime/skillRepository'
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
      chatDraft: '',
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

  // 技能只有工作空间层与当前目录相关，其余层级保留缓存，切回时无需重扫
  skillService.invalidateWorkspaceSkills()
}
