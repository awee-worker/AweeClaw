import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import {
  buildAgentSessionSnapshot,
  markAgentStorageSnapshotAsCurrent,
  suspendAgentStorageWrites,
  resumeAgentStorageWrites,
} from '@intelligence/state/intelligenceStorage'
import { agentSessionRepository } from './sessionRepository'
import { mcpService } from './toolProtocolAdapter'
import { gitService } from './gitAdapter'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { getMessageText } from '@intelligence/types/conversationModel'
import { workspaceStorageRuntime } from './workspaceStorageAdapter'
import type { FileItem } from '@protocols'
import type { WorkspaceConfig } from '@store'
import type { ChatThread } from '@intelligence/providerTypes'
import type { Branch } from '@intelligence/state/slices'

export interface WorkspaceLoadOptions {
  rehydrateAgentStore?: boolean
  initializeMcp?: boolean
}

export interface WorkspaceShellState {
  workspace: WorkspaceConfig
  primaryRoot: string | null
  files: FileItem[]
}

function buildThreadMessageVersions(threads: Record<string, ChatThread>): Record<string, number> {
  const versions: Record<string, number> = {}
  for (const [threadId, thread] of Object.entries(threads)) {
    versions[threadId] = thread.messages?.length || 0
  }
  return versions
}

export async function rehydrateWorkspaceAgentStore(): Promise<void> {
  const snapshot = await agentSessionRepository.getSnapshot()
  const threads = snapshot?.threads || {}
  logger.agent.info('[WorkspaceLoad] Session snapshot loaded', {
    threadCount: Object.keys(threads).length,
    currentThreadId: snapshot?.currentThreadId || null,
    threadIds: Object.keys(threads),
  })

  suspendAgentStorageWrites()
  try {
    useAgentStore.setState({
      threads,
      currentThreadId: snapshot?.currentThreadId || null,
      threadMessageVersions: buildThreadMessageVersions(threads),
      branches: (snapshot?.branches || {}) as Record<string, Branch[]>,
      activeBranchId: (snapshot?.activeBranchId || {}) as Record<string, string | null>,
    })
    markAgentStorageSnapshotAsCurrent(snapshot)
  } finally {
    resumeAgentStorageWrites()
  }

  logger.agent.info(`[WorkspaceLoad] Agent store restored from workspace snapshot (${Object.keys(threads).length} threads)`)
}

export async function restoreWorkspaceAgentStore(): Promise<void> {
  await rehydrateWorkspaceAgentStore()

  const state = useAgentStore.getState()
  const { threads, currentThreadId } = state
  const threadIds = Object.keys(threads)

  logger.system.info('[WorkspaceLoad] Store state after restore', {
    threadCount: threadIds.length,
    currentThreadId,
    threadIds,
  })

  if (threadIds.length === 0) {
    logger.system.info('[WorkspaceLoad] No persisted threads found, leaving store empty')
    return
  }

  if (!currentThreadId || !threads[currentThreadId]) {
    const firstThreadId = threadIds[0]
    useAgentStore.setState({ currentThreadId: firstThreadId })
    logger.system.info(`[WorkspaceLoad] Activated first thread: ${firstThreadId}`)
  }

  const activeThreadId = useAgentStore.getState().currentThreadId
  if (!activeThreadId) {
    return
  }

  const activeThread = useAgentStore.getState().threads[activeThreadId]
  if (!activeThread) {
    return
  }

  const messageCount = activeThread.messages?.length || 0
  logger.system.info(`[WorkspaceLoad] Current thread has ${messageCount} messages`)

  void hydrateThreadMessages(activeThreadId).catch(error => {
    logger.system.warn('[WorkspaceLoad] Active thread hydration failed:', error)
  })
}

export async function hydrateThreadMessages(threadId: string): Promise<void> {
  const state = useAgentStore.getState()
  const thread = state.threads[threadId]
  if (!thread || thread.messagesHydrated) {
    return
  }

  const messages = await agentSessionRepository.loadThreadMessages(threadId)

  // 从第一条用户消息提取标题（仅当线程缺少标题时）
  let autoTitle: string | undefined
  if (!thread.title?.trim()) {
    const firstUserMsg = messages.find(m => m.role === 'user')
    if (firstUserMsg) {
      autoTitle = getMessageText(firstUserMsg.content).trim().slice(0, 60) || undefined
    }
  }

  suspendAgentStorageWrites()
  try {
    useAgentStore.setState(currentState => {
      const currentThread = currentState.threads[threadId]
      if (!currentThread || currentThread.messagesHydrated) {
        return currentState
      }

      return {
        threads: {
          ...currentState.threads,
          [threadId]: {
            ...currentThread,
            messages,
            messagesHydrated: true,
            messageCount: messages.length,
            ...(autoTitle ? { title: autoTitle } : {}),
          },
        },
        threadMessageVersions: buildThreadMessageVersions({
          ...currentState.threads,
          [threadId]: {
            ...currentThread,
            messages,
            messagesHydrated: true,
            messageCount: messages.length,
          },
        }),
      }
    })
    markAgentStorageSnapshotAsCurrent(buildAgentSessionSnapshot(useAgentStore.getState()))
  } finally {
    resumeAgentStorageWrites()
  }
}

export async function prepareWorkspaceShell(workspace: WorkspaceConfig): Promise<WorkspaceShellState> {
  if (workspace.roots.length === 0) {
    return {
      workspace,
      primaryRoot: null,
      files: [],
    }
  }

  const primaryRoot = workspace.roots[0]
  let files: FileItem[] = []

  try {
    files = await api.file.readDir(primaryRoot)
  } catch (err) {
    const error = toAppError(err)
    logger.system.error(`[WorkspaceLoad] Failed to read directory: ${error.code}`, error)
  }

  return {
    workspace,
    primaryRoot,
    files,
  }
}

export async function bindWorkspaceRoot(shellState: WorkspaceShellState): Promise<void> {
  if (!shellState.primaryRoot) {
    gitService.setWorkspace(null)
    return
  }

  await workspaceStorageRuntime.bindPrimaryRoot(shellState.primaryRoot)
  gitService.setWorkspace(shellState.primaryRoot)
}

/** 轻量级绑定 — 仅创建目录 + 设置 git 工作区，不初始化 SQLite */
export async function bindWorkspaceRootLite(shellState: WorkspaceShellState): Promise<void> {
  if (!shellState.primaryRoot) {
    gitService.setWorkspace(null)
    return
  }

  await workspaceStorageRuntime.bindPrimaryRootLite(shellState.primaryRoot)
  gitService.setWorkspace(shellState.primaryRoot)
}

export function commitWorkspaceShell(shellState: WorkspaceShellState): void {
  const { setWorkspace, setFiles } = useStore.getState()
  setWorkspace(shellState.workspace)
  setFiles(shellState.files)
}

export async function initializeWorkspaceServices(
  workspace: WorkspaceConfig,
  options: WorkspaceLoadOptions = {}
): Promise<void> {
  const {
    rehydrateAgentStore: shouldRehydrateAgentStore = true,
    initializeMcp: shouldInitializeMcp = true,
  } = options

  if (shouldRehydrateAgentStore) {
    await restoreWorkspaceAgentStore()
  }

  if (shouldInitializeMcp) {
    await mcpService.initialize(workspace.roots)
  }
}

export async function loadWorkspace(
  workspace: WorkspaceConfig,
  options: WorkspaceLoadOptions = {}
): Promise<void> {
  const shellState = await prepareWorkspaceShell(workspace)
  await bindWorkspaceRoot(shellState)
  await initializeWorkspaceServices(workspace, options)
  commitWorkspaceShell(shellState)
}
