/**
 * Agent 状态管理
 * 使用 Zustand slice 模式组织代码
 * 
 * 架构原则：
 * - 所有线程相关状态只存于 ChatThread
 * - 切换线程只改变 currentThreadId，无需同步状态
 * - UI 通过 selector 从当前线程获取状态
 */

import { create } from 'zustand'
import { logger } from '@toolkit/LogEngine'
import {
    flushScheduledPersistedAgentSessionState,
    schedulePersistedAgentSessionState,
} from './intelligenceStorage'
import { streamingBuffer, flushStreamingBuffer } from './StreamBuffer'
import {
    createThreadSlice,
    createMessageSlice,
    createCheckpointSlice,
    createBranchSlice,
    type ThreadSlice,
    type MessageSlice,
    type CheckpointSlice,
    type BranchSlice,
    type Branch,
} from './slices'
import {
    createPlanSlice,
    type PlanSlice,
} from './slices/taskSlice'
import { createIdleHandoffState } from '@intelligence/providerTypes'
import type { ChatMessage, ChatThread, ContextItem, MessageCheckpoint, StreamState, TodoItem, ContextStats, ThreadHandoffState, AssistantMessage } from '@intelligence/providerTypes'
import type { CompressionStats } from '@intelligence/providerTypes'
import type { HandoffDocument, StructuredSummary } from '@intelligence/providerTypes'
import { buildHandoffContext } from '../capabilities/context/SessionHandoff'
import { createLatestContextSnapshotSelector } from '../capabilities/context/contextCapture'
import {
    resolveContextIndicatorKindForThread,
    type ContextIndicatorKind,
    type ContextIndicatorTransition,
} from '../capabilities/context/contextGauge'
import type { ToolStreamingPreview } from '@intelligence/providerTypes'
import type { LLMStreamSource } from '@shared/protocols/modelGateway'

// 重新导出刷新函数供外部使用
export { flushStreamingBuffer }
export type { ContextStats } from '@intelligence/providerTypes'

// ===== Store 类型 =====

// 上下文统计信息（用于底部栏显示）
// Handoff 会话创建结果
export interface HandoffSessionResult {
    threadId: string
    objective: string
    pendingSteps: string[]
    todos: TodoItem[]
    lastUserRequest: string
    fileChanges: Array<{ action: string; path: string; summary: string }>
}

export interface ContextTransitionState extends ContextIndicatorTransition {
    sourceThreadId?: string
    targetThreadId?: string
    startedAt?: number
}

// UI 相关状态（全局，非线程相关）
interface UIState {
    inputPrompt: string
    /**
     * 聊天输入框草稿（全局唯一）
     * 草稿不能只放在 ChatPanel 的本地 state：切到设置、用户中心等全屏页面时
     * ChatSection 会卸载 ChatPanel，本地 state 随之丢失，用户输入的内容就没了。
     * 放在 store 中可以跨组件卸载保留，返回聊天界面后内容仍在。
     */
    chatDraft: string
    currentSessionId: string | null
    contextTransition: ContextTransitionState
    // 代码审查状态
    codeReviewSession: import('../types/codeAudit').CodeReviewSession | null
    reviewProgress: { current: number; total: number; currentFile: string } | null
    setInputPrompt: (prompt: string) => void
    setChatDraft: (value: string) => void
    setCurrentSessionId: (id: string | null) => void
    setContextTransition: (transition: ContextTransitionState) => void
    clearContextTransition: () => void
    createHandoffSession: (threadId?: string) => HandoffSessionResult | null
    // 代码审查方法
    setCodeReviewSession: (session: import('../types/codeAudit').CodeReviewSession | null) => void
    updateReviewProgress: (current: number, total: number, currentFile: string) => void
    updateReviewComment: (comment: import('../types/codeAudit').ReviewComment) => void
}

// 线程绑定的 Store 操作接口
// 用于后台任务，确保操作不会影响其他线程
export interface ThreadBoundStore {
    readonly threadId: string

    // 消息操作
    addAssistantMessage: (content?: string) => string
    addAssistantPartsMessage: (
        parts: import('../providerTypes').AssistantPart[],
        options?: { content?: string; timestamp?: number }
    ) => string
    appendToAssistant: (messageId: string, content: string) => void
    finalizeAssistant: (messageId: string) => void
    finalizeTextBeforeToolCall: (messageId: string) => void
    updateMessage: (messageId: string, updates: Partial<import('../providerTypes').ChatMessage>) => void
    addToolResult: (toolCallId: string, name: string, content: string, type: import('../providerTypes').ToolResultType, rawParams?: Record<string, unknown>) => string
    getMessages: () => import('../providerTypes').ChatMessage[]

    // 工具调用操作
    addToolCallPart: (messageId: string, toolCall: Omit<import('../providerTypes').ToolCall, 'status'>) => void
    updateToolCall: (messageId: string, toolCallId: string, updates: Partial<import('../providerTypes').ToolCall>) => void

    // 状态操作
    setStreamState: (state: Partial<StreamState>) => void
    setStreamPhase: (phase: StreamState['phase']) => void
    setToolStreamingPreview: (toolCallId: string, preview: ToolStreamingPreview) => void
    clearToolStreamingPreview: (toolCallId: string) => void
    getToolStreamingPreview: (toolCallId: string) => ToolStreamingPreview | undefined
    setCompressionStats: (stats: CompressionStats | null) => void
    setContextStats: (stats: ContextStats | null) => void
    setExecutionMeta: (meta: import('../providerTypes').ThreadExecutionMeta | null) => void
    updateExecutionMeta: (meta: Partial<import('../providerTypes').ThreadExecutionMeta>) => void
    clearExecutionMeta: () => void
    setContextSummary: (summary: StructuredSummary | null) => void
    setCompressionPhase: (phase: import('../providerTypes').CompressionPhase) => void
    setHandoffState: (handoff: ThreadHandoffState) => void
    clearHandoffState: () => void
    setIsCompacting: (compacting: boolean) => void

    // Reasoning 操作
    addReasoningPart: (messageId: string) => string
    updateReasoningPart: (messageId: string, partId: string, content: string, isStreaming?: boolean) => void
    finalizeReasoningPart: (messageId: string, partId: string) => void

    // Search 操作
    addSearchPart: (messageId: string) => string
    updateSearchPart: (messageId: string, partId: string, content: string, isStreaming?: boolean, append?: boolean) => void
    finalizeSearchPart: (messageId: string, partId: string) => void

    // Sources 操作
    upsertSourcesPart: (messageId: string, source: LLMStreamSource) => void

    // Lint Check 操作
    addLintCheckPart: (messageId: string) => void
    updateLintCheckPart: (messageId: string, updates: Partial<import('../providerTypes').LintCheckPart>) => void
    addSystemAlertPart: (
        messageId: string,
        alert: {
            alertType: 'error' | 'warning' | 'info' | 'success'
            title?: string
            message: string
            suggestion?: string
            compact?: boolean
            action?: { label: string; actionType: 'continue' | 'retry' | 'dismiss' | 'open-settings' | 'switch-model' | 'upgrade' }
            actions?: Array<{ label: string; actionType: 'continue' | 'retry' | 'dismiss' | 'open-settings' | 'switch-model' | 'upgrade' }>
        }
    ) => void

    // 交互式内容操作
    setInteractive: (messageId: string, interactive: import('../providerTypes').InteractiveContent) => void
    addFormPart: (messageId: string, form: import('../providerTypes').FormContent) => void

    // 多智能体工作流操作
    addMultiAgentWorkflowPart: (messageId: string, part: import('../types/conversationModel').MultiAgentWorkflowPart) => void
    updateMultiAgentWorkflowPart: (messageId: string, sessionId: string, updates: Partial<import('../types/conversationModel').MultiAgentWorkflowPart>) => void
}

export type AgentStore = ThreadSlice & MessageSlice & CheckpointSlice & BranchSlice & PlanSlice & UIState & {
    _flushTextBuffer: (messageId: string) => void
    forThread: (threadId: string) => ThreadBoundStore
}

function createHandoffDigestMessage(handoff: HandoffDocument): AssistantMessage {
    const createdAt = handoff.createdAt

    return {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: createdAt,
        isStreaming: false,
        parts: [{
            id: `context-handoff-${createdAt}`,
            type: 'context_snapshot',
            snapshotKind: 'handoff',
            presentation: 'resume_card',
            level: 4,
            summary: handoff.summary,
            generatedAt: createdAt,
            note: 'This thread was created from an automatic handoff packet.',
            lastUserRequest: handoff.lastUserRequest,
        }],
        toolCalls: [],
    }
}

function createHandoffSourceMarkerMessage(handoff: HandoffDocument): AssistantMessage {
    const createdAt = handoff.createdAt

    return {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: createdAt,
        isStreaming: false,
        parts: [{
            id: `context-handoff-${createdAt}`,
            type: 'context_snapshot',
            snapshotKind: 'handoff',
            presentation: 'source_marker',
            level: 4,
            summary: handoff.summary,
            generatedAt: createdAt,
            note: 'Context was compressed and continued in a new thread.',
            lastUserRequest: handoff.lastUserRequest,
        }],
        toolCalls: [],
    }
}

function hasHandoffSourceMarker(messages: ChatMessage[], createdAt: number): boolean {
    return messages.some(message =>
        message.role === 'assistant' &&
        message.parts.some(part =>
            part.type === 'context_snapshot' &&
            part.snapshotKind === 'handoff' &&
            part.presentation === 'source_marker' &&
            part.generatedAt === createdAt
        )
    )
}

// ===== Store 实现 =====

export const useAgentStore = create<AgentStore>()(
        (...args) => {
            // 创建各个 slice
            const threadSlice = createThreadSlice(...args)
            const messageSlice = createMessageSlice(...args)
            const checkpointSlice = createCheckpointSlice(...args)
            const branchSlice = createBranchSlice(...args)
            const planSlice = createPlanSlice(...args)

            const [set, get] = args

            // 初始化 StreamingBuffer 的 callback（流式内容写入正确的线程）
            streamingBuffer.setFlushCallback((messageId, content, threadId) => {
                messageSlice._doAppendToAssistant(messageId, content, threadId)
            })

            // 推理增量走同一条缓冲，合并后一次写入推理分段与消息推理文本
            streamingBuffer.setReasoningFlushCallback((messageId, partId, content, threadId) => {
                messageSlice._doUpdateReasoningPart(messageId, partId, content, true, threadId)
            })

            // UI 状态（全局）
            const uiState: UIState = {
                inputPrompt: '',
                chatDraft: '',
                currentSessionId: null,
                contextTransition: { status: 'idle' },
                codeReviewSession: null,
                reviewProgress: null,
                setInputPrompt: (prompt) => set({ inputPrompt: prompt }),
                setChatDraft: (value) => set({ chatDraft: value }),
                setCurrentSessionId: (id) => set({ currentSessionId: id }),
                setContextTransition: (transition) => set({ contextTransition: transition }),
                clearContextTransition: () => set({ contextTransition: { status: 'idle' } }),
                createHandoffSession: (threadId) => {
                    const state = get()
                    const sourceThreadId = threadId ?? state.currentThreadId
                    if (!sourceThreadId) {
                        logger.agent.warn('[AgentStore] No source thread for handoff session')
                        return null
                    }

                    const sourceThread = state.threads[sourceThreadId]
                    const handoff = sourceThread?.handoff.document

                    if (!handoff) {
                        logger.agent.warn('[AgentStore] No handoff document to create session from')
                        return null
                    }

                    // 创建新线程
                    set(s => ({
                        threads: {
                            ...s.threads,
                            [sourceThreadId]: {
                                ...s.threads[sourceThreadId],
                                handoff: {
                                    ...s.threads[sourceThreadId].handoff,
                                    status: 'transitioning',
                                },
                            },
                        },
                    }))

                    set({
                        contextTransition: {
                            status: 'switching',
                            sourceThreadId,
                            startedAt: Date.now(),
                        },
                    })

                    const newThreadId = threadSlice.createThread({ activate: false })

                    // 构建 handoff 上下文
                    const handoffContext = buildHandoffContext(handoff)
                    const handoffDigestMessage = createHandoffDigestMessage(handoff)

                    // 更新新线程的元数据
                    set(s => {
                        const thread = s.threads[newThreadId]
                        if (!thread) return s
                        const sourceThread = s.threads[sourceThreadId]
                        const sourceMessages = hasHandoffSourceMarker(sourceThread.messages, handoff.createdAt)
                            ? sourceThread.messages
                            : [...sourceThread.messages, createHandoffSourceMarkerMessage(handoff)]
                        return {
                            threads: {
                                ...s.threads,
                                [sourceThreadId]: {
                                    ...sourceThread,
                                    handoff: createIdleHandoffState(),
                                    messages: sourceMessages,
                                    lastModified: Date.now(),
                                },
                                [newThreadId]: {
                                    ...thread,
                                    messages: [handoffDigestMessage],
                                    handoffContext,
                                    handoffResume: {
                                        sourceThreadId,
                                        createdAt: handoff.createdAt,
                                    },
                                    pendingObjective: handoff.summary.objective,
                                    pendingSteps: handoff.summary.pendingSteps,
                                    todos: handoff.summary.todos || [],
                                    contextSummary: handoff.summary,
                                }
                            },
                            currentThreadId: newThreadId,
                            contextTransition: {
                                status: 'switching',
                                sourceThreadId,
                                targetThreadId: newThreadId,
                                startedAt: Date.now(),
                            },
                            threadMessageVersions: {
                                ...s.threadMessageVersions,
                                [sourceThreadId]: (s.threadMessageVersions[sourceThreadId] || 0) + 1,
                                [newThreadId]: 1,
                            },
                        }
                    })

                    logger.agent.info('[AgentStore] Created handoff session:', newThreadId)

                    setTimeout(() => {
                        const latestState = get()
                        const transition = latestState.contextTransition
                        if (transition.status === 'switching' && transition.targetThreadId === newThreadId) {
                            latestState.clearContextTransition()
                        }
                    }, 900)

                    return {
                        threadId: newThreadId,
                        objective: handoff.summary.objective,
                        pendingSteps: handoff.summary.pendingSteps || [],
                        todos: handoff.summary.todos || [],
                        lastUserRequest: handoff.lastUserRequest,
                        fileChanges: handoff.summary.fileChanges || [],
                    }
                },
                // 代码审查方法
                setCodeReviewSession: (session) => set({ codeReviewSession: session }),
                updateReviewProgress: (current, total, currentFile) =>
                    set({ reviewProgress: { current, total, currentFile } }),
                updateReviewComment: (comment) => {
                    set(state => {
                        if (!state.codeReviewSession) return state
                        const files = state.codeReviewSession.files.map((file: import('../types/codeAudit').ReviewFile) => {
                            const commentIndex = file.comments.findIndex((c: import('../types/codeAudit').ReviewComment) => c.id === comment.id)
                            if (commentIndex === -1) return file
                            const newComments = [...file.comments]
                            newComments[commentIndex] = comment
                            return { ...file, comments: newComments }
                        })
                        return {
                            codeReviewSession: {
                                ...state.codeReviewSession,
                                files
                            }
                        }
                    })
                },
            }

            // 重写 finalizeAssistant 先刷新 StreamingBuffer
            const originalFinalizeAssistant = messageSlice.finalizeAssistant
            messageSlice.finalizeAssistant = (messageId: string, targetThreadId?: string) => {
                streamingBuffer.flushNow()
                originalFinalizeAssistant(messageId, targetThreadId)
            }

            // 内部方法：刷新文本缓冲区
            const _flushTextBuffer = (_messageId: string) => {
                streamingBuffer.flushNow()
            }

            // 创建线程绑定的 Store（用于后台任务）
            const forThread = (threadId: string): ThreadBoundStore => ({
                threadId,

                // 消息操作
                addAssistantMessage: (content) =>
                    messageSlice.addAssistantMessage(content, threadId),
                addAssistantPartsMessage: (parts, options) =>
                    messageSlice.addAssistantPartsMessage(parts, options, threadId),
                appendToAssistant: (messageId, content) => {
                    // 调用公开方法（经过 StreamingBuffer 缓冲），绑定 threadId
                    messageSlice.appendToAssistant(messageId, content, threadId)
                },
                finalizeAssistant: (messageId) =>
                    messageSlice.finalizeAssistant(messageId, threadId),
                finalizeTextBeforeToolCall: (messageId) =>
                    messageSlice.finalizeTextBeforeToolCall(messageId, threadId),
                updateMessage: (messageId, updates) =>
                    messageSlice.updateMessage(messageId, updates, threadId),
                addToolResult: (toolCallId, name, content, type, rawParams) =>
                    messageSlice.addToolResult(toolCallId, name, content, type, rawParams, threadId),
                getMessages: () =>
                    messageSlice.getMessages(threadId),

                // 工具调用操作
                addToolCallPart: (messageId, toolCall) =>
                    messageSlice.addToolCallPart(messageId, toolCall, threadId),
                updateToolCall: (messageId, toolCallId, updates) =>
                    messageSlice.updateToolCall(messageId, toolCallId, updates, threadId),

                // 状态操作
                setStreamState: (state) => threadSlice.setStreamState(state, threadId),
                setStreamPhase: (phase) => threadSlice.setStreamState({ phase }, threadId),
                setToolStreamingPreview: (toolCallId, preview) =>
                    threadSlice.setToolStreamingPreview(toolCallId, preview, threadId),
                clearToolStreamingPreview: (toolCallId) =>
                    threadSlice.clearToolStreamingPreview(toolCallId, threadId),
                getToolStreamingPreview: (toolCallId) =>
                    threadSlice.getToolStreamingPreview(toolCallId, threadId),
                setCompressionStats: (stats) => threadSlice.setCompressionStats(stats, threadId),
                setContextStats: (stats) => threadSlice.setContextStats(stats, threadId),
                setExecutionMeta: (meta) => threadSlice.setExecutionMeta(meta, threadId),
                updateExecutionMeta: (meta) => threadSlice.updateExecutionMeta(meta, threadId),
                clearExecutionMeta: () => threadSlice.clearExecutionMeta(threadId),
                setContextSummary: (summary) => threadSlice.setContextSummary(summary, threadId),
                setCompressionPhase: (phase) => threadSlice.setCompressionPhase(phase, threadId),
                setHandoffState: (handoff) => threadSlice.setHandoffState(handoff, threadId),
                clearHandoffState: () => threadSlice.clearHandoffState(threadId),
                setIsCompacting: (compacting) => threadSlice.setIsCompacting(compacting, threadId),

                // Reasoning 操作
                addReasoningPart: (messageId) =>
                    messageSlice.addReasoningPart(messageId, threadId),
                updateReasoningPart: (messageId, partId, content, isStreaming) =>
                    messageSlice.updateReasoningPart(messageId, partId, content, isStreaming, threadId),
                finalizeReasoningPart: (messageId, partId) =>
                    messageSlice.finalizeReasoningPart(messageId, partId, threadId),

                // Search 操作
                addSearchPart: (messageId) =>
                    messageSlice.addSearchPart(messageId, threadId),
                updateSearchPart: (messageId, partId, content, isStreaming, append) =>
                    messageSlice.updateSearchPart(messageId, partId, content, isStreaming, append, threadId),
                finalizeSearchPart: (messageId, partId) =>
                    messageSlice.finalizeSearchPart(messageId, partId, threadId),
                upsertSourcesPart: (messageId, source) =>
                    messageSlice.upsertSourcesPart(messageId, source, threadId),

                // Lint Check 操作
                addLintCheckPart: (messageId) =>
                    messageSlice.addLintCheckPart(messageId, threadId),
                updateLintCheckPart: (messageId, updates) =>
                    messageSlice.updateLintCheckPart(messageId, updates, threadId),
                addSystemAlertPart: (messageId, alert) =>
                    messageSlice.addSystemAlertPart(messageId, alert, threadId),

                // 交互式内容操作
                setInteractive: (messageId, interactive) =>
                    messageSlice.setInteractive(messageId, interactive, threadId),

                addFormPart: (messageId, form) =>
                    messageSlice.addFormPart(messageId, form, threadId),

                // 多智能体工作流操作
                addMultiAgentWorkflowPart: (messageId, part) =>
                    messageSlice.addMultiAgentWorkflowPart(messageId, part, threadId),
                updateMultiAgentWorkflowPart: (messageId, sessionId, updates) =>
                    messageSlice.updateMultiAgentWorkflowPart(messageId, sessionId, updates, threadId),
            })

            return {
                ...threadSlice,
                ...messageSlice,
                ...checkpointSlice,
                ...branchSlice,
                ...planSlice,
                ...uiState,
                _flushTextBuffer,
                forThread,
            }
        }
    )

// ===== Selectors =====

const EMPTY_MESSAGES: ChatMessage[] = []
const EMPTY_CONTEXT_ITEMS: ContextItem[] = []
const EMPTY_MESSAGE_CHECKPOINTS: MessageCheckpoint[] = []
const EMPTY_TODOS: TodoItem[] = []
const DEFAULT_STREAM_STATE: StreamState = { phase: 'idle' }
const IDLE_HANDOFF_STATE = createIdleHandoffState()
const DEFAULT_MESSAGE_LIST_STATE = { messages: EMPTY_MESSAGES, version: 0 }
let lastMessageListThreadId: string | null = null
let lastMessageListMessages: ChatMessage[] = EMPTY_MESSAGES
let lastMessageListVersion = 0
let lastMessageListState = DEFAULT_MESSAGE_LIST_STATE
let hasInitializedAgentSessionSync = false
const selectLatestContextSnapshotCached = createLatestContextSnapshotSelector()

// ===== 流状态缓存：避免每次 store 更新都返回新对象引用 =====
// 防止 useAgentViewState 因 streamState 引用变化而触发不必要的重渲染
let lastStreamStateThreadId: string | null = null
let lastStreamState: StreamState = DEFAULT_STREAM_STATE
let lastStreamStateRef: StreamState = DEFAULT_STREAM_STATE

/** 流式进行中的持久化间隔：此时内容仍在变化，落盘价值低而整篇序列化开销高 */
const STREAMING_PERSIST_DEBOUNCE_MS = 1200

/** 是否存在正在流式输出的线程 */
function hasStreamingThread(): boolean {
    const threads = useAgentStore.getState().threads
    for (const threadId of Object.keys(threads)) {
        const phase = threads[threadId]?.streamState?.phase
        if (phase && phase !== 'idle') return true
    }
    return false
}

function scheduleAgentSessionPersistence(): void {
    // 会话快照需要整体序列化，开销随会话规模增长。流式期间 setState 极为频繁，
    // 固定短间隔会造成持续的整篇序列化；流式期间改用更长间隔，
    // 流式结束、切换工作区、应用退出等关键节点仍会立即落盘。
    const delayMs = hasStreamingThread() ? STREAMING_PERSIST_DEBOUNCE_MS : undefined
    schedulePersistedAgentSessionState(() => useAgentStore.getState(), delayMs)
}

export function flushAgentSessionPersistence(): void {
    flushScheduledPersistedAgentSessionState(() => useAgentStore.getState())
}

// ===== 当前线程缓存：避免 thread 对象重建导致下游 selector 缓存失效 =====
let lastCurrentThreadId: string | null = null
let lastCurrentThread: ChatThread | null = null

export const selectCurrentThread = (state: AgentStore): ChatThread | null => {
    const threadId = state.currentThreadId
    if (!threadId) return null
    const thread = state.threads[threadId]
    // 缓存：仅在 threadId 或 thread 对象变化时更新
    if (lastCurrentThreadId === threadId && lastCurrentThread === thread) {
        return lastCurrentThread
    }
    lastCurrentThreadId = threadId
    lastCurrentThread = thread
    return thread
}

export const selectMessages = (state: AgentStore) => {
    if (!state.currentThreadId) return EMPTY_MESSAGES
    const thread = state.threads[state.currentThreadId]
    return thread?.messages || EMPTY_MESSAGES
}

export const selectMessageListState = (state: AgentStore) => {
    if (!state.currentThreadId) return DEFAULT_MESSAGE_LIST_STATE

    const threadId = state.currentThreadId
    const thread = state.threads[threadId]
    if (!thread) return DEFAULT_MESSAGE_LIST_STATE

    const messages = thread.messages || EMPTY_MESSAGES
    const version = state.threadMessageVersions[threadId] || 0

    // 线程切换时清除缓存，防止旧缓存返回错误数据
    if (lastMessageListThreadId !== threadId) {
        lastMessageListThreadId = threadId
        lastMessageListMessages = messages
        lastMessageListVersion = version
        lastMessageListState = { messages, version }
        return lastMessageListState
    }

    if (
        lastMessageListMessages === messages &&
        lastMessageListVersion === version
    ) {
        return lastMessageListState
    }

    lastMessageListMessages = messages
    lastMessageListVersion = version
    lastMessageListState = { messages, version }

    return lastMessageListState
}

export const selectMessageCount = (state: AgentStore) => {
    if (!state.currentThreadId) return 0
    const thread = state.threads[state.currentThreadId]
    if (!thread) return 0
    return thread.messages.filter(m => m.role === 'user' || m.role === 'assistant').length
}

export const selectToolStreamingPreview = (toolCallId: string) => (state: AgentStore) => {
    if (!state.currentThreadId) return undefined
    return state.threads[state.currentThreadId]?.toolStreamingPreviews?.[toolCallId]
}

// 从当前线程获取流状态
// 使用缓存确保引用稳定性：当流状态未变化时返回同一对象引用，
// 避免 useAgentViewState 因引用变化而触发不必要的重渲染（导致 Maximum update depth exceeded）
export const selectStreamState = (state: AgentStore) => {
    const thread = selectCurrentThread(state)
    if (!thread) return DEFAULT_STREAM_STATE

    const streamState = thread.streamState
    // 使用 thread 的 streamState 内容比较而非引用比较，避免 thread 对象重建导致缓存失效
    if (
        lastStreamStateThreadId === state.currentThreadId &&
        lastStreamState === streamState
    ) {
        return lastStreamStateRef
    }

    lastStreamStateThreadId = state.currentThreadId
    lastStreamState = streamState
    lastStreamStateRef = streamState
    return streamState
}

// 上下文 items 缓存：避免每次 store 更新都返回新数组引用
let lastContextItemsThreadId: string | null = null
let lastContextItems: ContextItem[] = EMPTY_CONTEXT_ITEMS
let lastContextItemsRef: ContextItem[] = EMPTY_CONTEXT_ITEMS

export const selectContextItems = (state: AgentStore) => {
    if (!state.currentThreadId) return EMPTY_CONTEXT_ITEMS
    const thread = state.threads[state.currentThreadId]
    const contextItems = thread?.contextItems || EMPTY_CONTEXT_ITEMS
    if (
        lastContextItemsThreadId === state.currentThreadId &&
        lastContextItems === contextItems
    ) {
        return lastContextItemsRef
    }
    lastContextItemsThreadId = state.currentThreadId
    lastContextItems = contextItems
    lastContextItemsRef = contextItems
    return contextItems
}

export const selectIsStreaming = (state: AgentStore) => {
    const streamState = selectStreamState(state)
    return streamState.phase === 'streaming' || streamState.phase === 'tool_running' || streamState.phase === 'tool_pending'
}

export const selectIsAwaitingApproval = (state: AgentStore) => {
    const streamState = selectStreamState(state)
    return streamState.phase === 'tool_pending'
}

export const selectPendingChanges = (state: AgentStore) => state.pendingChanges

export const selectHasPendingChanges = (state: AgentStore) => state.pendingChanges.length > 0

// 消息检查点缓存
let lastCheckpointThreadId: string | null = null
let lastMessageCheckpoints: MessageCheckpoint[] = EMPTY_MESSAGE_CHECKPOINTS
let lastMessageCheckpointsRef: MessageCheckpoint[] = EMPTY_MESSAGE_CHECKPOINTS

export const selectMessageCheckpoints = (state: AgentStore) => {
    const thread = selectCurrentThread(state)
    const checkpoints = thread?.messageCheckpoints || EMPTY_MESSAGE_CHECKPOINTS
    if (
        lastCheckpointThreadId === state.currentThreadId &&
        lastMessageCheckpoints === checkpoints
    ) {
        return lastMessageCheckpointsRef
    }
    lastCheckpointThreadId = state.currentThreadId
    lastMessageCheckpoints = checkpoints
    lastMessageCheckpointsRef = checkpoints
    return checkpoints
}

// 分支相关 selectors
const EMPTY_BRANCHES: Branch[] = []
const MAINLINE_BRANCH_ID = '__mainline__'

const filteredBranchesCache = new Map<string, { branches: Branch[]; filtered: Branch[] }>()

export const selectBranches = (state: AgentStore) => {
    const threadId = state.currentThreadId
    if (!threadId) return EMPTY_BRANCHES

    const allBranches = state.branches[threadId]
    if (!allBranches || allBranches.length === 0) return EMPTY_BRANCHES

    const cached = filteredBranchesCache.get(threadId)
    if (cached && cached.branches === allBranches) {
        return cached.filtered
    }

    const filtered = allBranches.filter(b => b.id !== MAINLINE_BRANCH_ID)
    filteredBranchesCache.set(threadId, { branches: allBranches, filtered })

    // 清理不存在线程的缓存
    if (filteredBranchesCache.size > 100) {
        for (const key of filteredBranchesCache.keys()) {
            if (!state.threads[key]) {
                filteredBranchesCache.delete(key)
            }
        }
    }

    return filtered
}

export const selectActiveBranch = (state: AgentStore) => {
    const threadId = state.currentThreadId
    if (!threadId) return null
    const branchId = state.activeBranchId[threadId]
    if (!branchId) return null
    const branches = state.branches[threadId]
    if (!branches) return null
    return branches.find(b => b.id === branchId) || null
}

export const selectIsOnBranch = (state: AgentStore) => {
    const threadId = state.currentThreadId
    if (!threadId) return false
    return state.activeBranchId[threadId] != null
}

// 从当前线程获取压缩相关状态
export const selectContextStats = (state: AgentStore): ContextStats | null => {
    const thread = selectCurrentThread(state)
    return thread?.contextStats ?? null
}
export const selectInputPrompt = (state: AgentStore) => state.inputPrompt
export const selectChatDraft = (state: AgentStore) => state.chatDraft
export const selectCurrentSessionId = (state: AgentStore) => state.currentSessionId

export const selectCompressionStats = (state: AgentStore): CompressionStats | null => {
    const thread = selectCurrentThread(state)
    return thread?.compressionStats ?? null
}

export const selectHandoffState = (state: AgentStore): ThreadHandoffState => {
    const thread = selectCurrentThread(state)
    return thread?.handoff ?? IDLE_HANDOFF_STATE
}

export const selectHandoffDocument = (state: AgentStore) => selectHandoffState(state).document

export const selectHandoffRequired = (state: AgentStore): boolean => {
    const handoff = selectHandoffState(state)
    return handoff.status === 'ready' && !!handoff.document
}

export const selectIsHandoffTransitioning = (state: AgentStore): boolean => {
    const handoff = selectHandoffState(state)
    return handoff.status === 'transitioning'
}

export const selectContextSummary = (state: AgentStore): StructuredSummary | null => {
    const thread = selectCurrentThread(state)
    return thread?.contextSummary ?? null
}

export const selectLatestContextSnapshot = (state: AgentStore) => {
    const thread = selectCurrentThread(state)
    return selectLatestContextSnapshotCached(thread)
}

export const selectCompressionPhase = (state: AgentStore) => {
    const thread = selectCurrentThread(state)
    return thread?.compressionPhase ?? 'idle'
}

export const selectContextIndicatorKind = (state: AgentStore): ContextIndicatorKind => {
    const thread = selectCurrentThread(state)
    return resolveContextIndicatorKindForThread(thread, state.contextTransition, state.currentThreadId)
}

export const selectIsCompacting = (state: AgentStore): boolean => {
    const thread = selectCurrentThread(state)
    return thread?.isCompacting ?? false
}

export const selectTodos = (state: AgentStore) => {
    const thread = selectCurrentThread(state)
    return thread?.todos || EMPTY_TODOS
}

// ===== StreamingBuffer 初始化 =====
// ===== Store 初始化 =====

function initializeAgentSessionSync(): void {
    if (hasInitializedAgentSessionSync) {
        return
    }

    hasInitializedAgentSessionSync = true
    const rawSetState = useAgentStore.setState
    useAgentStore.setState = ((partial: any, replace?: boolean) => {
        const prevState = useAgentStore.getState()
        if (replace === undefined) {
            rawSetState(partial)
        } else if (replace) {
            rawSetState(partial, true)
        } else {
            rawSetState(partial, false)
        }
        const nextState = useAgentStore.getState()

        if (
            prevState.currentThreadId !== nextState.currentThreadId ||
            prevState.threads !== nextState.threads ||
            prevState.branches !== nextState.branches ||
            prevState.activeBranchId !== nextState.activeBranchId
        ) {
            scheduleAgentSessionPersistence()
        }
    }) as typeof useAgentStore.setState
}

export async function initializeAgentStore(): Promise<void> {
    try {
        // 注意：不在这里调用 rehydrate()，因为此时 aweeclawDir 可能还没有初始化
        // rehydrate() 会在 initService.ts 的 scheduleBackgroundInit() 中延迟调用

        initializeAgentSessionSync()
        logger.agent.info('[AgentStore] Initialized (tool registry deferred until first agent run)')
    } catch (error) {
        logger.agent.error('[AgentStore] Failed to initialize:', error)
    }
}
