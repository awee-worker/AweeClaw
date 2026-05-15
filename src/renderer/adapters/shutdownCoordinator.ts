import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'
import { flushAgentSessionPersistence, flushStreamingBuffer } from '@intelligence/state/IntelligenceStore'
import { agentSessionRepository } from './sessionRepository'
import { flushWorkspaceStatePersistence } from './workspaceStateAdapter'
import { aweeclawDir } from './appDirService'
import { api } from './electronBridge'
import { shellRegistryService } from '../shell/services/terminalRegistry'

async function persistWorkspaceBinding(): Promise<void> {
  const workspace = useStore.getState().workspace
  if (!workspace || workspace.roots.length === 0) {
    return
  }

  try {
    await api.workspace.save(workspace.configPath || '', workspace.roots)
  } catch (error) {
    logger.system.warn('[Shutdown] Failed to persist workspace binding:', error)
  }
}

export async function persistAllRuntimeState(): Promise<void> {
  flushStreamingBuffer()
  flushAgentSessionPersistence()

  await flushWorkspaceStatePersistence()
  await Promise.all([
    agentSessionRepository.flush(),
    shellRegistryService.flush(),
    persistWorkspaceBinding(),
  ])
  await aweeclawDir.flush()
}
