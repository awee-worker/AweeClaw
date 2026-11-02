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
  /** 恢复会话后是否自动打开上次的会话（默认 false：切换工作空间后停在「新建任务」页） */
  activateLastThread?: boolean
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

/** 线程是否正在执行（流式输出、工具循环或等待工具返回） */
function isThreadExecuting(thread: ChatThread | undefined): boolean {
  if (!thread) return false
  const phase = thread.streamState?.phase
  if (phase && phase !== 'idle') return true
  const loopState = thread.executionMeta?.loopState
  return loopState === 'running' || loopState === 'waiting_for_tools'
}

/**
 * 合并磁盘快照与内存线程
 *
 * 重新登录会重新加载会话，但正在执行的任务并不会随登录态停止：内存里的线程比磁盘
 * 快照新，甚至可能因为归属过滤而不在快照里。直接用磁盘快照覆盖会让正在跑的任务从
 * 会话列表消失，而引擎仍在推进同一个 threadId —— 界面没有记录、后台还在执行。
 * 因此保留执行中或版本更新的内存线程，其余以磁盘为准。
 */
function mergePreservingActiveThreads(
  memoryThreads: Record<string, ChatThread>,
  diskThreads: Record<string, ChatThread>,
  currentUserId?: string,
): Record<string, ChatThread> {
  const merged: Record<string, ChatThread> = { ...diskThreads }

  for (const [threadId, memoryThread] of Object.entries(memoryThreads)) {
    // 换了账号登录时不要把上一个账号的线程带进当前会话列表
    const ownerId = memoryThread.userId
    if (ownerId && currentUserId && ownerId !== currentUserId) continue

    const diskThread = diskThreads[threadId]
    const executing = isThreadExecuting(memoryThread)

    if (!diskThread) {
      // 执行中的线程必须留在内存里，否则引擎与界面就断开了
      if (executing) merged[threadId] = memoryThread
      continue
    }

    if (executing || memoryThread.lastModified > diskThread.lastModified) {
      merged[threadId] = memoryThread
    }
  }

  return merged
}

export interface RehydrateAgentStoreOptions {
  /**
   * 是否保留内存中执行中 / 更新的线程。
   * 认证恢复（重新登录）时必须开启，否则会覆盖掉正在执行的任务。
   */
  preserveActiveThreads?: boolean
}

export async function rehydrateWorkspaceAgentStore(
  options: RehydrateAgentStoreOptions = {},
): Promise<void> {
  const snapshot = await agentSessionRepository.getSnapshot()
  const diskThreads = (snapshot?.threads || {}) as Record<string, ChatThread>

  const previous = useAgentStore.getState()
  const threads = options.preserveActiveThreads
    ? mergePreservingActiveThreads(
      previous.threads,
      diskThreads,
      useStore.getState().cloudUser?.id,
    )
    : diskThreads

  // 合并后当前线程可能只存在于内存（执行中），优先保留它
  const memoryCurrentThreadId = previous.currentThreadId
  const currentThreadId = options.preserveActiveThreads
    && memoryCurrentThreadId
    && threads[memoryCurrentThreadId]
    ? memoryCurrentThreadId
    : (snapshot?.currentThreadId || null)

  logger.agent.info('[WorkspaceLoad] Session snapshot loaded', {
    threadCount: Object.keys(threads).length,
    currentThreadId,
    threadIds: Object.keys(threads),
    preservedActiveThreads: options.preserveActiveThreads === true,
  })

  suspendAgentStorageWrites()
  try {
    useAgentStore.setState({
      threads,
      currentThreadId,
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

/** restoreWorkspaceAgentStore 的恢复策略 */
export interface RestoreAgentStoreOptions {
  /**
   * 是否自动打开快照里记录的会话。
   * - true（默认，应用启动）：续接上次停留的会话；
   * - false（切换工作空间）：会话列表照常恢复，但聊天区停在「新建任务」
   *   空状态，由用户从左侧历史列表主动进入某个会话。
   */
  activateLastThread?: boolean
  /**
   * 是否保留内存中执行中 / 更新的线程（重新登录时使用）。
   * 默认 false：应用启动、切换工作空间按磁盘快照整体恢复。
   */
  preserveActiveThreads?: boolean
}

export async function restoreWorkspaceAgentStore(options: RestoreAgentStoreOptions = {}): Promise<void> {
  const activateLastThread = options.activateLastThread ?? true

  // 初始化存储引擎（SQLite + 迁移 + 全量加载），统一在此完成，避免与 bindWorkspaceRootLite 重复加载
  await workspaceStorageRuntime.initializeStorage()

  await rehydrateWorkspaceAgentStore({
    preserveActiveThreads: options.preserveActiveThreads,
  })

  const { threads } = useAgentStore.getState()
  const threadIds = Object.keys(threads)

  logger.system.info('[WorkspaceLoad] Store state after restore', {
    threadCount: threadIds.length,
    currentThreadId: useAgentStore.getState().currentThreadId,
    threadIds,
  })

  if (threadIds.length === 0) {
    logger.system.info('[WorkspaceLoad] No persisted threads found, leaving store empty')
    return
  }

  // 切换工作空间：不续接上次会话。会话数据照常恢复（左侧历史列表可用），
  // 但聊天区停在「新建任务」空状态，用户需主动进入某个会话。
  if (!activateLastThread) {
    suspendAgentStorageWrites()
    try {
      useAgentStore.setState({ currentThreadId: null })
      // 把「无激活会话」记为持久化基线，避免后续落盘把旧 currentThreadId 写回
      markAgentStorageSnapshotAsCurrent(buildAgentSessionSnapshot(useAgentStore.getState()))
    } finally {
      resumeAgentStorageWrites()
    }
    logger.system.info('[WorkspaceLoad] Workspace switched, chat reset to new-task view')
    return
  }

  let activeThreadId = useAgentStore.getState().currentThreadId
  if (!activeThreadId || !threads[activeThreadId]) {
    activeThreadId = threadIds[0]
    useAgentStore.setState({ currentThreadId: activeThreadId })
    logger.system.info(`[WorkspaceLoad] Activated first thread: ${activeThreadId}`)
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

      // 读取磁盘期间线程可能已经进入新的对话轮次（用户抢先发了消息）或正在执行。
      // 这时内存里的消息比磁盘新，用磁盘快照覆盖会把本轮内容抹掉，会话直接断掉；
      // 因此只补标记，不动消息。
      const isBusy = !!currentThread.streamState?.phase && currentThread.streamState.phase !== 'idle'
      if (currentThread.messages.length > 0 || isBusy) {
        return {
          threads: {
            ...currentState.threads,
            [threadId]: { ...currentThread, messagesHydrated: true },
          },
        }
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

  // 后台静默 fetch（受「设置 → Git → 打开工作空间时自动 fetch」控制）
  // 不 await：工作空间加载不应被网络请求拖慢
  void autoFetchOnOpen(shellState.primaryRoot)
}

/**
 * 打开工作空间时静默执行 git fetch
 *
 * 刻意使用 fetchQuiet（不弹凭证框）：
 * 打开工作空间属于被动行为，这里弹凭证框会打扰用户；
 * 需要凭证的同步操作应由用户主动点击或 AI 工具显式发起。
 */
async function autoFetchOnOpen(workspacePath: string): Promise<void> {
  try {
    if (useStore.getState().editorConfig?.git?.autoFetchOnOpen !== true) return

    const isRepo = await gitService.isGitRepo(workspacePath)
    if (!isRepo) return

    const remotes = await gitService.getRemotes(workspacePath)
    if (remotes.length === 0) return

    await gitService.fetchQuiet(workspacePath)
  } catch {
    // 静默失败：离线 / 无凭证 / 远程不可达都不应产生任何用户可见的打扰
  }
}

/** 轻量级绑定 — 仅创建目录 + 设置 git 工作空间，不初始化 SQLite */
export async function bindWorkspaceRootLite(shellState: WorkspaceShellState): Promise<void> {
  if (!shellState.primaryRoot) {
    gitService.setWorkspace(null)
    return
  }

  await workspaceStorageRuntime.bindPrimaryRootLite(shellState.primaryRoot)
  gitService.setWorkspace(shellState.primaryRoot)
}

/** 工作空间根路径比较口径：忽略末尾分隔符差异，null 与空串等价 */
function normalizeRootForCompare(root: string | null): string | null {
  if (!root) return null
  const trimmed = root.replace(/[\\/]+$/, '')
  return trimmed || root
}

export function commitWorkspaceShell(shellState: WorkspaceShellState): void {
  const { setWorkspace, setFiles, workspacePath, clearArtifacts } = useStore.getState()
  const nextRoot = shellState.workspace.roots[0] || null

  // 产物记录归属于产生它的那个工作空间：切换后旧产物既打不开也没有参考价值，
  // 直接清空，避免面板里残留上一份工作空间的条目。
  if (normalizeRootForCompare(workspacePath) !== normalizeRootForCompare(nextRoot)) {
    clearArtifacts()
  }

  setWorkspace(shellState.workspace)
  setFiles(shellState.files)
}

/**
 * MCP 初始化串行队列
 *
 * 工作空间切换不再等待 MCP 初始化，用户可能在上一轮尚未结束时再次切换；
 * 用一条链把初始化按序串起来，避免两轮初始化并发操作同一批服务器进程。
 */
let mcpInitChain: Promise<void> = Promise.resolve()

function scheduleMcpInitialize(workspaceRoots: string[]): void {
  const run = () => mcpService.initialize(workspaceRoots)
  mcpInitChain = mcpInitChain.then(run, run).catch(err => {
    logger.system.warn('[WorkspaceLoad] Background MCP initialization failed:', err)
  })
}

export async function initializeWorkspaceServices(
  workspace: WorkspaceConfig,
  options: WorkspaceLoadOptions = {}
): Promise<void> {
  const {
    rehydrateAgentStore: shouldRehydrateAgentStore = true,
    initializeMcp: shouldInitializeMcp = true,
    // 进入工作空间默认不续接上次会话：本函数只服务「切换工作空间」这条链路，
    // 切换后停在「新建任务」页；应用启动的续接走 appInitializer 单独调用。
    activateLastThread = false,
  } = options

  // MCP 初始化需要逐个拉起外部进程，耗时不可控，且只影响工具可用性。
  // 放到后台串行执行：不阻塞工作空间切换返回，失败只记录日志，不回滚整个切换。
  if (shouldInitializeMcp) {
    scheduleMcpInitialize(workspace.roots)
  }

  // 历史会话是进入工作空间后立刻要看的内容，保持等待
  if (shouldRehydrateAgentStore) {
    await restoreWorkspaceAgentStore({ activateLastThread })
  }
}

export async function loadWorkspace(
  workspace: WorkspaceConfig,
  options: WorkspaceLoadOptions = {}
): Promise<void> {
  const shellState = await prepareWorkspaceShell(workspace)

  // 先把工作空间与文件树提交到 store：标题栏与文件树立即切换到新工作空间，
  // 不再等待存储引擎初始化、会话恢复与 MCP 启动这些耗时操作
  commitWorkspaceShell(shellState)

  await bindWorkspaceRoot(shellState)
  await initializeWorkspaceServices(workspace, options)
}
