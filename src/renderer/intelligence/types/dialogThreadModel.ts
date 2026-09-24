/**
 * 对话线程模型 — 线程与线程级运行时状态
 */

import type { ToolCall, ToolStreamingPreview } from '@intelligence/providerTypes'
import type { ChatMessage, UserMessage } from './conversationModel'
import { getMessageText } from './conversationModel'
import type { MessageCheckpoint } from './sessionSnapshot'
import type { ContextItem } from './contextModel'
import type { HandoffDocument, StructuredSummary } from '@intelligence/providerTypes'
import type { CompressionStats } from '@intelligence/providerTypes'
import type { UntrustedSourceSummary } from './trustTypes'

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
  /**
   * 触发本次审批的外部内容来源
   *
   * 仅当本轮消费过不可信内容、且该操作具副作用时才有值。用于在确认卡片上
   * 说明「这次操作为什么被拦下来」，让用户知道它可能受外部内容影响。
   */
  untrustedSources?: UntrustedSourceSummary[]
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

/**
 * 挂载任务 — 会话被手动停止时，把「当前任务执行到哪一步」附着在会话上
 *
 * 用途：
 * - 历史会话带挂载标识，用户重新打开后可一键「继续执行任务」
 * - `summary` 是挂载时整理出的执行情况，续跑时静默注入给 AI，
 *   让 AI 知道之前做到哪、还剩什么，而不是从头开始
 * - `resumedAt` 记录最近一次续跑时间；续跑正常结束后挂载会被清除，
 *   任务再次被停止时用户可重新挂载（执行情况随之刷新）
 */
export interface MountedTaskInfo {
  /** 挂载时间 */
  mountedAt: number
  /** 任务目标（一句话，用于界面展示） */
  objective: string
  /** 尚未完成的步骤（用于界面展示） */
  pendingSteps: string[]
  /** 整理出的完整任务执行情况（续跑时静默交给 AI） */
  summary: string
  /** 执行情况的生成方式：llm=模型整理，rule_based=规则兜底 */
  source: 'llm' | 'rule_based'
  /** 最近一次「继续执行任务」的时间；未续跑过则为 undefined */
  resumedAt?: number
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
  /** 挂载任务（会话被手动停止时附着，支持一键续跑） */
  mountedTask?: MountedTaskInfo
  /**
   * Runtime-only：挂载任务正在续跑
   *
   * 续跑期间底部任务栏会收起（进度已经在时间线里逐条展开），因此这个标记必须跟着
   * 真实运行状态走：派发续跑时置位，本轮 `loop:end` 复位。只存在内存里，不参与持久化
   * —— 否则异常退出后残留的标记会让后续无关问答也被当成续跑。
   */
  mountedTaskResuming?: boolean

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
  /**
   * 运行时标记：消息体是否已载入内存
   *
   * 落盘前必须随线程一起透传，否则下游无法区分「消息为空」的两种含义 ——
   * 「线程真的没有消息」与「消息还没从磁盘载入」。混淆两者会让懒加载线程被
   * 当成空线程写回磁盘（message_count 被清成 0），此后该会话再也读不到历史。
   */
  messagesHydrated?: boolean
  contextSummary: StructuredSummary | null
  todos?: TodoItem[]
  handoffContext?: string
  handoffResume?: HandoffResumeMeta
  pendingObjective?: string
  pendingSteps?: string[]
  /** 挂载任务（会话被手动停止时附着，支持一键续跑） */
  mountedTask?: MountedTaskInfo
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

/**
 * 剥离只在当轮生效的瞬态字段
 *
 * agentContext 是「组装当次请求时」才注入给模型的衔接说明，消息进入历史后不再参与
 * 任何请求；原样落盘只会让这段说明长期留在会话文件里。没有该字段时直接复用原数组，
 * 避免在高频持久化路径上白白做一次整表拷贝。
 */
function stripRuntimeOnlyMessageFields(messages: ChatMessage[]): ChatMessage[] {
  const needsStrip = messages.some(m => m.role === 'user' && !!(m as UserMessage).agentContext)
  if (!needsStrip) return messages

  return messages.map(m => {
    if (m.role !== 'user' || !(m as UserMessage).agentContext) return m
    const { agentContext: _transient, ...persisted } = m as UserMessage
    return persisted as ChatMessage
  })
}

export function toPersistedChatThread(thread: ChatThread): PersistedChatThread {
  // 消息体不在内存时（懒加载线程），messages 必然是空数组，用它推导条数会把
  // message_count 清成 0：下次启动该线程会被判定为「空线程」而丢失全部历史。
  // 因此这里只在消息已载入时以内存为准，否则保留磁盘上的既有条数。
  const hydrated = thread.messagesHydrated !== false || thread.messages.length > 0

  return {
    id: thread.id,
    createdAt: thread.createdAt,
    lastModified: thread.lastModified,
    title: thread.title,
    messages: stripRuntimeOnlyMessageFields(thread.messages),
    contextItems: thread.contextItems,
    messageCheckpoints: thread.messageCheckpoints ?? [],
    messageCount: hydrated ? thread.messages.length : (thread.messageCount ?? 0),
    messagesHydrated: thread.messagesHydrated,
    contextSummary: thread.contextSummary,
    todos: thread.todos,
    handoffContext: thread.handoffContext,
    handoffResume: thread.handoffResume,
    pendingObjective: thread.pendingObjective,
    pendingSteps: thread.pendingSteps,
    mountedTask: thread.mountedTask,
    mode: thread.mode,
    origin: thread.origin,
    planId: thread.planId,
    taskId: thread.taskId,
    userId: thread.userId,
  }
}

export function fromPersistedChatThread(thread: PersistedChatThread): ChatThread {
  // ⚠️ messageCount === 0 不能推出「线程真的没有消息」：历史版本会把懒加载线程的
  // 条数写成 0，据此判定「已加载且为空」会让该会话永远读不到消息 —— 用户看到空
  // 会话，AI 也拿不到任何历史，表现为「AI 不知道它刚才回复的内容」。
  // 因此这里只认内存里确实有消息这一种「已加载」情形，其余一律按需加载。
  const loadedMessages = thread.messages ?? []

  return {
    ...thread,
    messages: loadedMessages,
    messagesHydrated: loadedMessages.length > 0,
    messageCount: loadedMessages.length > 0
      ? loadedMessages.length
      : (thread.messageCount ?? 0),
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
