import { logger } from '@toolkit/LogEngine'
import { agentSessionRepository, type AgentSessionSnapshot } from '@services/sessionRepository'
import { toPersistedChatThread, type ChatThread } from '@intelligence/providerTypes'

/**
 * 上一次已落盘快照的指纹
 *
 * 这里只保留指纹而不保留整串序列化结果：会话快照包含消息正文与检查点里的
 * 文件副本，一份完整字符串常有数十 MB，常驻等于凭空多占一份会话内存。
 * 指纹由长度与两个独立滚动哈希组成，用于「内容未变则跳过写盘」的等价判断，
 * 碰撞概率可忽略。
 */
let lastSerializedFingerprint: string | null = null

/** 计算序列化内容的轻量指纹（不保留原串，避免大字符串常驻） */
function fingerprintOf(serialized: string): string {
  let hashA = 0x811c9dc5
  let hashB = 0x1000193
  for (let i = 0; i < serialized.length; i += 1) {
    const code = serialized.charCodeAt(i)
    hashA = Math.imul(hashA ^ code, 0x01000193)
    hashB = Math.imul(hashB + code, 0x85ebca6b)
  }
  return `${serialized.length}:${(hashA >>> 0).toString(36)}:${(hashB >>> 0).toString(36)}`
}
let writeSuspendCount = 0
let scheduledPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingStateGetter: (() => Partial<PersistedAgentSessionState>) | null = null
const AGENT_STORAGE_VERSION = 0
const DEFAULT_PERSIST_DEBOUNCE_MS = 240

export interface PersistedAgentSessionState {
  threads: Record<string, unknown>
  currentThreadId: string | null
  branches: Record<string, unknown>
  activeBranchId: Record<string, unknown>
}

interface PersistedAgentStorageEnvelope {
  state: PersistedAgentSessionState
  version: number
}

const EMPTY_PERSISTED_AGENT_SESSION_STATE: PersistedAgentSessionState = {
  threads: {},
  currentThreadId: null,
  branches: {},
  activeBranchId: {},
}

export function buildPersistedAgentSessionState(
  state: Partial<PersistedAgentSessionState>
): PersistedAgentSessionState {
  const rawThreads = state.threads || {}
  const threads = Object.fromEntries(
    Object.entries(rawThreads).map(([threadId, thread]) => [threadId, toPersistedChatThread(thread as ChatThread)])
  )

  return {
    threads,
    currentThreadId: state.currentThreadId || null,
    branches: state.branches || {},
    activeBranchId: state.activeBranchId || {},
  }
}

export function suspendAgentStorageWrites(): void {
  writeSuspendCount += 1
}

export function resumeAgentStorageWrites(): void {
  writeSuspendCount = Math.max(0, writeSuspendCount - 1)
}

export async function runWithAgentStorageWritesSuspended<T>(
  task: () => Promise<T> | T
): Promise<T> {
  suspendAgentStorageWrites()
  try {
    return await task()
  } finally {
    resumeAgentStorageWrites()
  }
}

export function areAgentStorageWritesSuspended(): boolean {
  return writeSuspendCount > 0
}

export function getSuspendedAgentPersistState(): PersistedAgentSessionState {
  return EMPTY_PERSISTED_AGENT_SESSION_STATE
}

export function buildAgentSessionSnapshot(
  state: Partial<PersistedAgentSessionState>,
  version = AGENT_STORAGE_VERSION
): AgentSessionSnapshot {
  const persistedState = buildPersistedAgentSessionState(state)

  return {
    threads: persistedState.threads as AgentSessionSnapshot['threads'],
    currentThreadId: persistedState.currentThreadId,
    branches: persistedState.branches,
    activeBranchId: persistedState.activeBranchId,
    version,
  }
}

/**
 * 序列化会话快照
 *
 * 入参已经是持久化形状，这里不再走一遍线程转换 —— 该转换会对每个线程做整体深拷贝，
 * 在高频持久化路径上重复执行会白白消耗主线程时间。
 */
export function serializeAgentSessionSnapshot(snapshot: AgentSessionSnapshot): string {
  const envelope: PersistedAgentStorageEnvelope = {
    state: {
      threads: snapshot.threads as Record<string, unknown>,
      currentThreadId: snapshot.currentThreadId,
      branches: snapshot.branches,
      activeBranchId: snapshot.activeBranchId,
    },
    version: snapshot.version,
  }

  return JSON.stringify(envelope)
}

export function parseAgentStorageValue(value: string): AgentSessionSnapshot {
  const parsed = JSON.parse(value) as PersistedAgentStorageEnvelope

  return buildAgentSessionSnapshot(parsed.state, parsed.version || AGENT_STORAGE_VERSION)
}

export function markAgentStorageSnapshotAsCurrent(snapshot: AgentSessionSnapshot | null): void {
  lastSerializedFingerprint = snapshot ? fingerprintOf(serializeAgentSessionSnapshot(snapshot)) : null
}

function clearScheduledPersistTimer(): void {
  if (scheduledPersistTimer !== null) {
    clearTimeout(scheduledPersistTimer)
    scheduledPersistTimer = null
  }
}

function stagePersistedAgentSessionFromGetter(
  getState: () => Partial<PersistedAgentSessionState>
): void {
  if (writeSuspendCount > 0) {
    return
  }
  const snapshot = buildAgentSessionSnapshot(getState())
  const fingerprint = fingerprintOf(serializeAgentSessionSnapshot(snapshot))
  if (fingerprint === lastSerializedFingerprint) {
    return
  }

  agentSessionRepository.stageSnapshot(snapshot)
  lastSerializedFingerprint = fingerprint
}

export function schedulePersistedAgentSessionState(
  getState: () => Partial<PersistedAgentSessionState>,
  delayMs = DEFAULT_PERSIST_DEBOUNCE_MS
): void {
  if (writeSuspendCount > 0) {
    return
  }

  pendingStateGetter = getState
  clearScheduledPersistTimer()
  scheduledPersistTimer = setTimeout(() => {
    scheduledPersistTimer = null
    const stateGetter = pendingStateGetter
    pendingStateGetter = null
    if (!stateGetter) {
      return
    }

    stagePersistedAgentSessionFromGetter(stateGetter)
  }, delayMs)
}

export function flushScheduledPersistedAgentSessionState(
  getState?: () => Partial<PersistedAgentSessionState>
): void {
  clearScheduledPersistTimer()
  const stateGetter = getState || pendingStateGetter
  pendingStateGetter = null
  if (!stateGetter) {
    return
  }

  stagePersistedAgentSessionFromGetter(stateGetter)
}

export function stageAgentSessionState(
  state: Partial<PersistedAgentSessionState>
): void {
  stagePersistedAgentSessionFromGetter(() => state)
}

export async function persistCriticalAgentSessionState(
  state: PersistedAgentSessionState
): Promise<void> {
  try {
    flushScheduledPersistedAgentSessionState()
    agentSessionRepository.stageSnapshot(buildAgentSessionSnapshot(state))
    await agentSessionRepository.flush()
    lastSerializedFingerprint = null
  } catch (error) {
    logger.agent.error('[AgentStorage] Failed to persist critical agent session state:', error)
  }
}

export async function clearPersistedAgentSessionState(): Promise<void> {
  clearScheduledPersistTimer()
  pendingStateGetter = null
  lastSerializedFingerprint = null
  await agentSessionRepository.clear()
}
