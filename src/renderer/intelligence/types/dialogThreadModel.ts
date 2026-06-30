/**
 * 对话线程模型 — 线程与线程级运行时状态
 */

import type { ToolCall, ToolStreamingPreview } from '@intelligence/providerTypes'
import type { ChatMessage } from './conversationModel'
import { getMessageText } from './conversationModel'
import type { MessageCheckpoint } from './sessionSnapshot'
import type { ContextItem } from './contextModel'
import type { HandoffDocument, StructuredSummary } from '@intelligence/providerTypes'
import type { CompressionStats } from '@intelligence/providerTypes'

export interface ContextStats {
  totalChars: number
  maxChars: number
  fileCount: number
  maxFiles: number
  messageCount: number
  maxMessages: number
  semanticResultCount: number
  terminalChars: number
}

export interface TodoItem {
  content: string
  /**
   * 任务状态：
   * - pending：待执行
   * - in_progress：执行中
   * - verifying：验证中（Loop Engineering 验证门，标记 completed 前需先验证）
   * - completed：已完成
   */
  status: 'pending' | 'in_progress' | 'verifying' | 'completed'
  /** Present-tense copy used by the UI for the active task label. */
  activeForm: string
}

export type StreamPhase = 'idle' | 'streaming' | 'tool_pending' | 'tool_running' | 'error'
export type StreamDetail = 'reasoning' | 'responding' | 'tool_executing' | 'tool_awaiting'
export type WaitPhase = 'connecting' | 'building_context' | 'compressing' | 'waiting_model' | 'idle'

export type CompressionPhase = 'idle' | 'analyzing' | 'compressing' | 'summarizing' | 'done'
export type ThreadHandoffStatus = 'idle' | 'ready' | 'transitioning' | 'failed'

export interface ThreadHandoffState {
  status: ThreadHandoffStatus
  document: HandoffDocument | null
  source?: 'llm' | 'rule_based'
  createdAt?: number
  error?: string
}

export interface ThreadExecutionMeta {
  requestId?: string
  assistantId?: string
  /** 当前执行关联的 Plan 任务 ID，用于把线程执行态和任务实例绑定起来。 */
  planTaskId?: string
  loopState?: 'idle' | 'running' | 'waiting_for_tools' | 'waiting_for_user' | 'completed' | 'failed' | 'aborted'
}

/** 待审批工具调用，包含关联的 requestId 用于构建 approval ID */
export interface PendingToolApproval {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: import('@intelligence/providerTypes').ToolStatus
  /** 关联的 requestId，用于构建 approvalId: `${requestId}_${toolCallId}` */
  requestId: string
}

/** Thread-local streaming state for the current agent run. */
export interface StreamState {
  phase: StreamPhase
  streamDetail?: StreamDetail
  waitPhase?: WaitPhase
  currentToolCall?: ToolCall
  pendingApprovalToolCalls?: PendingToolApproval[]
  error?: string
  statusText?: string
  requestId?: string
  assistantId?: string
  streamStartTime?: number
  iterationIndex?: number
  iterationTotal?: number
  retryAttempt?: number
  retryDelay?: number
}

export interface HandoffResumeMeta {
  sourceThreadId: string
  createdAt: number
}

/** Complete persisted thread record plus thread-scoped ephemeral preview state. */
export interface ChatThread {
  id: string
  createdAt: number
  lastModified: number
  title?: string

  messages: ChatMessage[]
  contextItems: ContextItem[]
  messageCheckpoints?: MessageCheckpoint[]
  /**
   * 消息总数（从磁盘元数据读取，用于懒加载线程的 UI 计数显示）
   * 当前线程实时值以 messages.length 为准；非当前线程用此字段
   */
  messageCount?: number
  /** Runtime-only flag: whether the full message body has been loaded into memory. */
  messagesHydrated?: boolean

  streamState: StreamState
  toolStreamingPreviews?: Record<string, ToolStreamingPreview>

  contextStats: ContextStats | null
  compressionStats: CompressionStats | null
  contextSummary: StructuredSummary | null
  handoff: ThreadHandoffState
  isCompacting: boolean
  compressionPhase: CompressionPhase

  todos?: TodoItem[]

  executionMeta?: ThreadExecutionMeta

  handoffContext?: string
  handoffResume?: HandoffResumeMeta
  pendingObjective?: string
  pendingSteps?: string[]

  // ===== Thread Ownership Metadata (Phase 3.1) =====
  /** Thread mode: chat/plan */
  mode?: import('@protocols/workModeProtocol').WorkMode
  /** Thread origin: user-created or plan-task worker */
  origin?: 'user' | 'plan-task'
  /** Associated plan ID (if origin is plan-task) */
  planId?: string
  /** Associated task ID (if origin is plan-task) */
  taskId?: string
  /** Owner user ID (associated with logged-in user, empty for anonymous) */
  userId?: string
}

export interface PersistedChatThread {
  id: string
  createdAt: number
  lastModified: number
  title?: string
  messages: ChatMessage[]
  contextItems: ContextItem[]
  messageCheckpoints?: MessageCheckpoint[]
  messageCount?: number
  contextSummary: StructuredSummary | null
  todos?: TodoItem[]
  handoffContext?: string
  handoffResume?: HandoffResumeMeta
  pendingObjective?: string
  pendingSteps?: string[]
  mode?: import('@protocols/workModeProtocol').WorkMode
  origin?: 'user' | 'plan-task'
  planId?: string
  taskId?: string
  userId?: string
}

export function createRuntimeThreadState(): Pick<
  ChatThread,
  'streamState' | 'toolStreamingPreviews' | 'contextStats' | 'compressionStats' | 'handoff' | 'isCompacting' | 'compressionPhase' | 'executionMeta'
> {
  return {
    streamState: { phase: 'idle' },
    toolStreamingPreviews: {},
    contextStats: null,
    compressionStats: null,
    handoff: createIdleHandoffState(),
    isCompacting: false,
    compressionPhase: 'idle',
    executionMeta: { loopState: 'idle' },
  }
}

export function createIdleHandoffState(): ThreadHandoffState {
  return {
    status: 'idle',
    document: null,
  }
}

export function toPersistedChatThread(thread: ChatThread): PersistedChatThread {
  return {
    id: thread.id,
    createdAt: thread.createdAt,
    lastModified: thread.lastModified,
    title: thread.title,
    messages: thread.messages,
    contextItems: thread.contextItems,
    messageCheckpoints: thread.messageCheckpoints ?? [],
    messageCount: thread.messages.length,
    contextSummary: thread.contextSummary,
    todos: thread.todos,
    handoffContext: thread.handoffContext,
    handoffResume: thread.handoffResume,
    pendingObjective: thread.pendingObjective,
    pendingSteps: thread.pendingSteps,
    mode: thread.mode,
    origin: thread.origin,
    planId: thread.planId,
    taskId: thread.taskId,
    userId: thread.userId,
  }
}

export function fromPersistedChatThread(thread: PersistedChatThread): ChatThread {
  return {
    ...thread,
    messages: thread.messages || [],
    // 如果 messageCount > 0 但 messages 为空，说明消息还没加载（懒加载）
    // 如果 messageCount === 0，说明线程真的没有消息，hydrated = true
    messagesHydrated: thread.messageCount !== undefined
      ? (thread.messageCount === 0 || (thread.messages?.length ?? 0) > 0)
      : (thread.messages?.length ?? 0) > 0,
    contextItems: thread.contextItems || [],
    messageCheckpoints: thread.messageCheckpoints || [],
    ...createRuntimeThreadState(),
  }
}

export function getThreadDisplayTitle(thread: Pick<ChatThread, 'title' | 'messages'>, fallback = 'New Chat'): string {
  const manualTitle = thread.title?.trim()
  if (manualTitle) {
    return manualTitle
  }

  const firstUserMessage = thread.messages.find(message => message.role === 'user')
  if (!firstUserMessage) {
    return fallback
  }

  const extractedTitle = getMessageText(firstUserMessage.content).trim().slice(0, 60)
  return extractedTitle || fallback
}
