import { api } from '../../../adapters/electronBridge'
import type { StateCreator } from 'zustand'
import { logger } from '@toolkit/LogEngine'
import { internalWriteTracker } from '@services/writeTracker'
import {
  buildAgentSessionSnapshot,
  persistCriticalAgentSessionState,
  schedulePersistedAgentSessionState,
} from '../intelligenceStorage'
import type {
  ChatThread,
  CheckpointImage,
  ContextItem,
  FileChangeHistoryEntry,
  FileSnapshot,
  MessageCheckpoint,
  PendingChange,
} from '@intelligence/providerTypes'
import type { BranchSlice } from './conversationBranch'
import type { ThreadSlice } from './dialogThread'

export interface CheckpointState {
  pendingChanges: PendingChange[]
  /** 文件变更历史（接受/拒绝后保留，用于在助手消息底部持续展示"文件变更"chip） */
  fileChangeHistory: FileChangeHistoryEntry[]
}

export interface CheckpointActions {
  addPendingChange: (change: Omit<PendingChange, 'id' | 'timestamp' | 'status'>) => void
  acceptAllChanges: () => void
  undoAllChanges: () => Promise<{ success: boolean; restoredFiles: string[]; errors: string[] }>
  acceptChange: (filePath: string) => void
  undoChange: (filePath: string) => Promise<boolean>
  clearPendingChanges: () => void
  getPendingChanges: () => PendingChange[]
  /** 清空文件变更历史（切换线程或开始新一轮对话时调用） */
  clearFileChangeHistory: () => void

  createMessageCheckpoint: (
    messageId: string,
    description: string,
    images?: CheckpointImage[],
    contextItems?: ContextItem[]
  ) => Promise<string>
  addSnapshotToCheckpoint: (checkpointId: string, filePath: string, content: string | null) => void
  restoreToCheckpoint: (
    checkpointId: string
  ) => Promise<{
    success: boolean
    restoredFiles: string[]
    errors: string[]
    images?: CheckpointImage[]
    contextItems?: ContextItem[]
  }>
  getCheckpointForMessage: (messageId: string) => MessageCheckpoint | null
  clearMessageCheckpoints: () => void
  getMessageCheckpoints: () => MessageCheckpoint[]
}

export type CheckpointSlice = CheckpointState & CheckpointActions

function persistCheckpointState(state: {
  threads: Record<string, unknown>
  currentThreadId: string | null
  branches: Record<string, unknown>
  activeBranchId: Record<string, unknown>
}): void {
  void persistCriticalAgentSessionState(buildAgentSessionSnapshot(state))
}

/** 单个检查点内文件快照的总字符预算（超出后不再收录新快照，避免内存顶满） */
const CHECKPOINT_SNAPSHOT_BUDGET_CHARS = 8 * 1024 * 1024

/** 单个检查点内图片 base64 的总字符预算 */
const CHECKPOINT_IMAGE_BUDGET_CHARS = 16 * 1024 * 1024

/** 统计检查点内文件快照已占用的字符数 */
function countSnapshotChars(fileSnapshots: Record<string, FileSnapshot>): number {
  let total = 0
  for (const snapshot of Object.values(fileSnapshots)) {
    total += snapshot?.content?.length ?? 0
  }
  return total
}

/**
 * 按预算裁剪检查点图片。
 *
 * 图片以 base64 存在检查点里，而检查点会随会话保留 15 份，单张截图放大后
 * 可达数 MB，多轮粘贴会把这些 base64 全部钉在内存中。超出预算时保留先到的
 * 图片并丢弃剩余项，被丢弃的部分只影响该检查点的图片回填，不影响文本回滚。
 */
function limitCheckpointImages(images?: CheckpointImage[]): CheckpointImage[] | undefined {
  if (!images || images.length === 0) return images

  let used = 0
  const kept: CheckpointImage[] = []
  for (const image of images) {
    const size = image?.base64?.length ?? 0
    if (used + size > CHECKPOINT_IMAGE_BUDGET_CHARS) {
      logger.agent.warn(
        `[Checkpoint] Image budget exceeded, dropping ${images.length - kept.length} image(s)`,
        { used, limit: CHECKPOINT_IMAGE_BUDGET_CHARS },
      )
      break
    }
    used += size
    kept.push(image)
  }
  return kept
}

/**
 * 写入检查点后的持久化（防抖）。
 *
 * 检查点是 Agent 执行期最热的写入路径：一次任务里每编辑一个文件都会追加一份
 * 文件快照。若每次都同步构建会话全量快照并立即落盘，序列化体积与主线程耗时
 * 都会随会话历史线性放大，表现为执行期窗口卡顿、内存峰值陡增。
 * 这里改为交给存储层的防抖调度：状态变更立即生效，落盘合并到一次，
 * 撤销读的是内存中的检查点，能力不受影响。
 */
function scheduleCheckpointPersist(state: {
  threads: Record<string, unknown>
  currentThreadId: string | null
  branches: Record<string, unknown>
  activeBranchId: Record<string, unknown>
}): void {
  schedulePersistedAgentSessionState(() => state)
}

function getThreadCheckpoints(thread?: ChatThread): MessageCheckpoint[] {
  return thread?.messageCheckpoints ?? []
}

function updateThreadCheckpoints(
  threads: Record<string, ChatThread>,
  threadId: string,
  updater: (checkpoints: MessageCheckpoint[], thread: ChatThread) => MessageCheckpoint[]
): Record<string, ChatThread> {
  const thread = threads[threadId]
  if (!thread) return threads

  const nextCheckpoints = updater(getThreadCheckpoints(thread), thread)
  if (nextCheckpoints === thread.messageCheckpoints) {
    return threads
  }

  return {
    ...threads,
    [threadId]: {
      ...thread,
      messageCheckpoints: nextCheckpoints,
    },
  }
}

function getCurrentThreadId(state: ThreadSlice): string | null {
  return state.currentThreadId
}

export const createCheckpointSlice: StateCreator<
  ThreadSlice & BranchSlice & CheckpointSlice,
  [],
  [],
  CheckpointSlice
> = (set, get) => ({
  pendingChanges: [],
  fileChangeHistory: [],

  addPendingChange: (change) => {
    set(state => {
      // 获取当前流式助手消息 ID，用于关联文件变更历史
      const threadId = state.currentThreadId
      const assistantMessageId = threadId
        ? state.threads[threadId]?.streamState?.assistantId
        : undefined

      const existingIdx = state.pendingChanges.findIndex(c => c.filePath === change.filePath)
      if (existingIdx !== -1) {
        const existing = state.pendingChanges[existingIdx]
        const updated = [...state.pendingChanges]
        updated[existingIdx] = {
          ...existing,
          relativePath: change.relativePath,
          toolCallId: change.toolCallId,
          toolName: change.toolName,
          newContent: change.newContent,
          changeType: change.changeType,
          linesAdded: existing.linesAdded + change.linesAdded,
          linesRemoved: existing.linesRemoved + change.linesRemoved,
        }

        // 同步更新历史记录（同文件累加）
        const historyUpdated = state.fileChangeHistory.map(h =>
          h.filePath === change.filePath && h.assistantMessageId === assistantMessageId
            ? {
                ...h,
                relativePath: change.relativePath,
                toolCallId: change.toolCallId,
                toolName: change.toolName,
                changeType: change.changeType,
                linesAdded: h.linesAdded + change.linesAdded,
                linesRemoved: h.linesRemoved + change.linesRemoved,
              }
            : h,
        )

        return { pendingChanges: updated, fileChangeHistory: historyUpdated }
      }

      const newId = crypto.randomUUID()
      const now = Date.now()
      const newChange: PendingChange = {
        ...change,
        id: newId,
        status: 'pending',
        timestamp: now,
      }

      // 新增历史记录条目（仅当有关联的 assistantMessageId 时）
      const newHistoryEntry: FileChangeHistoryEntry | null = assistantMessageId
        ? {
            filePath: change.filePath,
            relativePath: change.relativePath,
            newContent: change.newContent,
            changeType: change.changeType,
            linesAdded: change.linesAdded,
            linesRemoved: change.linesRemoved,
            isLargeWrite: change.isLargeWrite,
            contentTruncated: change.contentTruncated,
            oldContentLength: change.oldContentLength,
            newContentLength: change.newContentLength,
            toolCallId: change.toolCallId,
            toolName: change.toolName,
            id: newId,
            status: 'pending',
            assistantMessageId,
            timestamp: now,
          }
        : null

      // 如果 assistantMessageId 变化了，清除上一轮的历史（只保留当前轮次）
      let fileChangeHistory = state.fileChangeHistory
      if (newHistoryEntry) {
        const lastEntry = state.fileChangeHistory[state.fileChangeHistory.length - 1]
        if (lastEntry && lastEntry.assistantMessageId !== assistantMessageId) {
          // 新一轮对话，清空旧历史
          fileChangeHistory = []
        }
      }

      return {
        pendingChanges: [...state.pendingChanges, newChange],
        fileChangeHistory: newHistoryEntry
          ? [...fileChangeHistory, newHistoryEntry]
          : fileChangeHistory,
      }
    })
  },

  acceptAllChanges: () => {
    set(state => ({
      pendingChanges: [],
      // 历史记录中所有 pending 标记为 accepted
      fileChangeHistory: state.fileChangeHistory.map(h =>
        h.status === 'pending' ? { ...h, status: 'accepted' as const } : h,
      ),
    }))
  },

  undoAllChanges: async () => {
    const changes = get().pendingChanges
    const restoredFiles: string[] = []
    const errors: string[] = []

    for (const change of changes) {
      try {
        if (change.snapshot.content === null) {
          const deleted = await api.file.delete(change.filePath)
          if (deleted) {
            restoredFiles.push(change.filePath)
          } else {
            errors.push(`Failed to delete: ${change.filePath}`)
          }
        } else {
          internalWriteTracker.mark(change.filePath)
          const written = await api.file.write(change.filePath, change.snapshot.content)
          if (written) {
            restoredFiles.push(change.filePath)
          } else {
            errors.push(`Failed to restore: ${change.filePath}`)
          }
        }
      } catch (error) {
        errors.push(`Error restoring ${change.filePath}: ${error}`)
      }
    }

    set(state => ({
      pendingChanges: [],
      // 历史记录中所有 pending 标记为 rejected
      fileChangeHistory: state.fileChangeHistory.map(h =>
        h.status === 'pending' ? { ...h, status: 'rejected' as const } : h,
      ),
    }))

    return { success: errors.length === 0, restoredFiles, errors }
  },

  acceptChange: (filePath) => {
    set(state => ({
      pendingChanges: state.pendingChanges.filter(change => change.filePath !== filePath),
      // 历史记录中标记为 accepted（不删除）
      fileChangeHistory: state.fileChangeHistory.map(h =>
        h.filePath === filePath && h.status === 'pending'
          ? { ...h, status: 'accepted' as const }
          : h,
      ),
    }))
  },

  undoChange: async (filePath) => {
    const change = get().pendingChanges.find(item => item.filePath === filePath)
    if (!change) return false

    try {
      if (change.snapshot.content === null) {
        const deleted = await api.file.delete(change.filePath)
        if (!deleted) return false
      } else {
        internalWriteTracker.mark(change.filePath)
        const written = await api.file.write(change.filePath, change.snapshot.content)
        if (!written) return false
      }

      set(state => ({
        pendingChanges: state.pendingChanges.filter(item => item.filePath !== filePath),
        // 历史记录中标记为 rejected（不删除）
        fileChangeHistory: state.fileChangeHistory.map(h =>
          h.filePath === filePath && h.status === 'pending'
            ? { ...h, status: 'rejected' as const }
            : h,
        ),
      }))
      return true
    } catch {
      return false
    }
  },

  clearPendingChanges: () => {
    set({ pendingChanges: [] })
  },

  clearFileChangeHistory: () => {
    set({ fileChangeHistory: [] })
  },

  getPendingChanges: () => get().pendingChanges,

  createMessageCheckpoint: async (messageId, description, images, contextItems) => {
    const threadId = getCurrentThreadId(get())
    if (!threadId) return ''

    // Only snapshots collected for the current message should belong to this
    // checkpoint. Pulling in all pendingChanges here makes rollback spill into
    // files modified by previous messages that are still awaiting acceptance.
    const fileSnapshots: Record<string, FileSnapshot> = {}

    const checkpoint: MessageCheckpoint = {
      id: crypto.randomUUID(),
      messageId,
      timestamp: Date.now(),
      fileSnapshots,
      description,
      images: limitCheckpointImages(images),
      contextItems,
    }

    logger.agent.info(
      '[Checkpoint] Created checkpoint:',
      checkpoint.id,
      'for message:',
      messageId,
      'with files:',
      Object.keys(fileSnapshots),
      'images:',
      checkpoint.images?.length ?? 0,
      'contextItems:',
      contextItems?.length ?? 0
    )

    set(state => {
      const threads = updateThreadCheckpoints(state.threads, threadId, checkpoints => {
        const next = [...checkpoints, checkpoint]
        return next.length > 15 ? next.slice(-15) : next
      })

      if (threads === state.threads) return state
      return { threads }
    })

    scheduleCheckpointPersist(get())
    return checkpoint.id
  },

  addSnapshotToCheckpoint: (checkpointId, filePath, content) => {
    logger.agent.debug(
      '[Checkpoint] Adding snapshot for checkpoint:',
      checkpointId,
      'file:',
      filePath,
      'content length:',
      content?.length ?? 'null'
    )

    const threadId = getCurrentThreadId(get())
    if (!threadId) return

    set(state => {
      const thread = state.threads[threadId]
      if (!thread) return state

      const checkpoints = getThreadCheckpoints(thread)
      if (checkpoints.length === 0) {
        logger.agent.debug('[Checkpoint] No checkpoints exist, cannot add snapshot')
        return state
      }

      const nextCheckpoints = [...checkpoints]
      const checkpointIndex = nextCheckpoints.findIndex(checkpoint => checkpoint.id === checkpointId)
      if (checkpointIndex === -1) {
        logger.agent.warn('[Checkpoint] Target checkpoint not found:', checkpointId)
        return state
      }
      const targetCheckpoint = nextCheckpoints[checkpointIndex]

      logger.agent.debug(
        '[Checkpoint] Target checkpoint:',
        targetCheckpoint.id,
        'existing files:',
        Object.keys(targetCheckpoint.fileSnapshots)
      )

      if (filePath in targetCheckpoint.fileSnapshots) {
        logger.agent.debug('[Checkpoint] Snapshot already exists for:', filePath)
        return state
      }

      // 预算检查：单个检查点内的快照总量受控，避免多轮编辑后正文全部驻留内存。
      // 超出预算的文件不建撤销点（与跳过超大文件同一语义），不影响本轮写入本身。
      const usedChars = countSnapshotChars(targetCheckpoint.fileSnapshots)
      const incomingChars = content?.length ?? 0
      if (usedChars + incomingChars > CHECKPOINT_SNAPSHOT_BUDGET_CHARS) {
        logger.agent.warn('[Checkpoint] Snapshot budget exceeded, skip undo point:', {
          filePath,
          usedChars,
          incomingChars,
          limit: CHECKPOINT_SNAPSHOT_BUDGET_CHARS,
        })
        return state
      }

      nextCheckpoints[checkpointIndex] = {
        ...targetCheckpoint,
        fileSnapshots: {
          ...targetCheckpoint.fileSnapshots,
          [filePath]: { path: filePath, content },
        },
      }

      logger.agent.debug('[Checkpoint] Added snapshot for:', filePath)

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...thread,
            messageCheckpoints: nextCheckpoints,
          },
        },
      }
    })

    scheduleCheckpointPersist(get())
  },

  restoreToCheckpoint: async (checkpointId) => {
    const state = get()
    const threadId = getCurrentThreadId(state)
    if (!threadId) {
      return { success: false, restoredFiles: [], errors: ['Checkpoint not found'] }
    }

    const thread = state.threads[threadId]
    if (!thread) {
      return { success: false, restoredFiles: [], errors: ['Checkpoint not found'] }
    }

    const checkpoints = getThreadCheckpoints(thread)
    const checkpointIdx = checkpoints.findIndex(cp => cp.id === checkpointId)

    logger.agent.info('[Restore] Looking for checkpoint:', checkpointId)

    if (checkpointIdx === -1) {
      return { success: false, restoredFiles: [], errors: ['Checkpoint not found'] }
    }

    const checkpoint = checkpoints[checkpointIdx]
    const restoredFiles: string[] = []
    const errors: string[] = []
    const filesToRestore: Record<string, FileSnapshot> = {}

    for (let index = checkpointIdx; index < checkpoints.length; index += 1) {
      const currentCheckpoint = checkpoints[index]
      for (const [path, snapshot] of Object.entries(currentCheckpoint.fileSnapshots)) {
        if (!(path in filesToRestore)) {
          filesToRestore[path] = snapshot
        }
      }
    }

    for (const change of state.pendingChanges) {
      if (!(change.filePath in filesToRestore)) {
        filesToRestore[change.filePath] = change.snapshot
      }
    }

    logger.agent.info('[Restore] Files to restore:', Object.keys(filesToRestore))

    for (const [filePath, snapshot] of Object.entries(filesToRestore)) {
      try {
        if (snapshot.content === null) {
          const deleted = await api.file.delete(filePath)
          if (deleted) {
            restoredFiles.push(filePath)
          }
        } else {
          internalWriteTracker.mark(filePath)
          const written = await api.file.write(filePath, snapshot.content)
          if (written) {
            restoredFiles.push(filePath)
          } else {
            errors.push(`Failed to restore: ${filePath}`)
          }
        }
      } catch (error) {
        errors.push(`Error restoring ${filePath}: ${error}`)
      }
    }

    const messageIdx = thread.messages.findIndex(message => message.id === checkpoint.messageId)
    const nextCheckpoints = checkpoints.slice(0, checkpointIdx)

    set(currentState => {
      const currentThread = currentState.threads[threadId]
      if (!currentThread) return currentState

      return {
        threads: {
          ...currentState.threads,
          [threadId]: {
            ...currentThread,
            messages: messageIdx === -1 ? currentThread.messages : currentThread.messages.slice(0, messageIdx),
            messageCheckpoints: nextCheckpoints,
            lastModified: Date.now(),
          },
        },
        pendingChanges: [],
      }
    })

    persistCheckpointState(get())

    return {
      success: errors.length === 0,
      restoredFiles,
      errors,
      images: checkpoint.images,
      contextItems: checkpoint.contextItems,
    }
  },

  getCheckpointForMessage: (messageId) => {
    const threadId = getCurrentThreadId(get())
    if (!threadId) return null
    const thread = get().threads[threadId]
    return getThreadCheckpoints(thread).find(checkpoint => checkpoint.messageId === messageId) || null
  },

  clearMessageCheckpoints: () => {
    const threadId = getCurrentThreadId(get())
    if (!threadId) return

    set(state => {
      const thread = state.threads[threadId]
      if (!thread) return state

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...thread,
            messageCheckpoints: [],
          },
        },
      }
    })

    persistCheckpointState(get())
  },

  getMessageCheckpoints: () => {
    const threadId = getCurrentThreadId(get())
    if (!threadId) return []
    return getThreadCheckpoints(get().threads[threadId])
  },
})
