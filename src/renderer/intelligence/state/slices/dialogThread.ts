/**
 * 对话线程切片 — 线程生命周期与线程级临时流式预览状态
 */

import type { StateCreator } from 'zustand'
import type { ChatThread, StreamState, CompressionPhase, TodoItem, ContextStats, ThreadHandoffState } from '@intelligence/providerTypes'
import type { CompressionStats } from '../../engine/providerTypes'
import type { StructuredSummary } from '../../capabilities/context/providerTypes'
import type { BranchSlice } from './conversationBranch'
import type { ToolStreamingPreview } from '@intelligence/providerTypes'
import { agentSessionRepository } from '@services/sessionRepository'
import { createIdleHandoffState, createRuntimeThreadState } from '@intelligence/providerTypes'
import { EventBus } from '../../engine/EventDispatcher'
import { useStore } from '@store'
import { logger } from '@shared/toolkit/LogEngine'
import * as perfTrace from '@intelligence/diagnostics/perfTraceReporter'
import { PERF_TRACE_COUNTERS } from '@shared/protocols/perfTraceProtocol'

/**
 * 把流式阶段转移写成一对 end/begin 锚点。
 *
 * 成对落盘而不是只记一条「阶段变了」，是为了让时间轴上每个阶段都成为一段
 * 有明确起止的区间，事后可以直接按阶段聚合计时。只记转移点的话，分析侧
 * 还得自己把先后两条配成区间，配错一次整段结论就偏了。
 *
 * 未开启性能追踪时，这里的全部开销是几次布尔判断（见 perfTraceReporter）。
 */
function traceStreamPhaseTransition(
    previous: StreamState | undefined,
    next: Partial<StreamState>,
): void {
    if (next.phase !== undefined && next.phase !== previous?.phase) {
        if (previous?.phase) {
            perfTrace.anchor('stream-phase', 'end', { phase: previous.phase })
        }
        perfTrace.anchor('stream-phase', 'begin', { phase: next.phase })
    }

    if (next.waitPhase !== undefined && next.waitPhase !== previous?.waitPhase) {
        if (previous?.waitPhase) {
            perfTrace.anchor('wait-phase', 'end', { phase: previous.waitPhase })
        }
        perfTrace.anchor('wait-phase', 'begin', { phase: next.waitPhase })
    }
}

export interface ThreadStoreState {
    threads: Record<string, ChatThread>
    currentThreadId: string | null
    threadMessageVersions: Record<string, number>
}

export interface ThreadActions {
    createThread: (options?: { activate?: boolean }) => string
    renameThread: (threadId: string, title: string) => boolean
    /**
     * 切换当前会话
     *
     * 返回 Promise：切换是异步的（先确保线程与消息加载完成再改 currentThreadId），
     * 调用方需要等待切换生效时应 await 它（例如测试、脚本化流程）。
     */
    switchThread: (threadId: string) => Promise<void>
    /**
     * 确保指定线程已加载到 store（含消息体）
     *
     * 与 switchThread 的区别：**不修改 currentThreadId、不关闭全屏页面**。
     * 用于在不切换主聊天线程的前提下，加载某个任务关联线程（如项目任务执行）。
     *
     * @param threadId 线程 ID
     */
    ensureThreadLoaded: (threadId: string) => Promise<void>
    deleteThread: (threadId: string) => void
    getCurrentThread: () => ChatThread | null

    setStreamState: (state: Partial<StreamState>, threadId?: string) => void
    setStreamPhase: (phase: StreamState['phase'], threadId?: string) => void
    setToolStreamingPreview: (toolCallId: string, preview: ToolStreamingPreview, threadId?: string) => void
    clearToolStreamingPreview: (toolCallId: string, threadId?: string) => void
    clearToolStreamingPreviews: (threadId?: string) => void
    getToolStreamingPreview: (toolCallId: string, threadId?: string) => ToolStreamingPreview | undefined
    setCompressionStats: (stats: CompressionStats | null, threadId?: string) => void
    setContextStats: (stats: ContextStats | null, threadId?: string) => void
    setContextSummary: (summary: StructuredSummary | null, threadId?: string) => void
    setCompressionPhase: (phase: CompressionPhase, threadId?: string) => void
    setHandoffState: (handoff: ThreadHandoffState, threadId?: string) => void
    clearHandoffState: (threadId?: string) => void
    setIsCompacting: (compacting: boolean, threadId?: string) => void

    setTodos: (todos: TodoItem[], threadId?: string) => void
    getTodos: (threadId?: string) => TodoItem[]
    setExecutionMeta: (meta: import('../../providerTypes').ThreadExecutionMeta | null, threadId?: string) => void
    updateExecutionMeta: (meta: Partial<import('../../providerTypes').ThreadExecutionMeta>, threadId?: string) => void
    clearExecutionMeta: (threadId?: string) => void
}

export type ThreadSlice = ThreadStoreState & ThreadActions

/**
 * ensureThreadLoaded 实现：加载线程元数据 + 消息体到 store
 *
 * 与 switchThread 的区别：**不修改 currentThreadId、不关闭全屏页面**。
 * 用于项目任务执行等场景，在不切换主聊天线程的前提下加载指定线程。
 *
 * 幂等：线程已加载（messagesHydrated === true）时直接返回。
 */
async function ensureThreadLoadedImpl(
    get: () => ThreadSlice,
    set: (partial: Partial<ThreadSlice> | ((state: ThreadSlice) => Partial<ThreadSlice>)) => void,
    threadId: string,
): Promise<void> {
    const state = get()
    // 已加载完成，直接返回
    if (state.threads[threadId]?.messagesHydrated) return

    // 线程不在 store → 从数据库加载元数据
    if (!state.threads[threadId]) {
        let threadData: ChatThread | null
        try {
            threadData = await agentSessionRepository.loadThreadById(threadId)
        } catch (err) {
            logger.agent.error(`[ThreadSlice] ensureThreadLoaded: failed to load thread ${threadId}:`, err)
            return
        }
        if (!threadData) {
            logger.agent.warn(`[ThreadSlice] ensureThreadLoaded: thread ${threadId} not found in repository`)
            return
        }
        set(s => ({
            threads: { ...s.threads, [threadId]: threadData },
            threadMessageVersions: {
                ...s.threadMessageVersions,
                [threadId]: (s.threadMessageVersions[threadId] || 0) + 1,
            },
        }))
    }

    // 懒加载消息体
    const thread = get().threads[threadId]
    if (thread?.messagesHydrated === false) {
        try {
            const messages = await agentSessionRepository.loadThreadMessages(threadId)
            set(s => ({
                threads: {
                    ...s.threads,
                    [threadId]: {
                        ...s.threads[threadId],
                        messages,
                        messagesHydrated: true,
                        messageCount: messages.length,
                    },
                },
            }))
        } catch (err) {
            logger.agent.error(`[ThreadSlice] ensureThreadLoaded: failed to load messages for ${threadId}:`, err)
            // 加载失败时也标记为已水合（空消息），避免重复加载
            set(s => ({
                threads: {
                    ...s.threads,
                    [threadId]: {
                        ...s.threads[threadId],
                        messages: [],
                        messagesHydrated: true,
                    },
                },
            }))
        }
    }
}

const generateId = () => crypto.randomUUID()

export const createEmptyThread = (): ChatThread => ({
    id: generateId(),
    createdAt: Date.now(),
    lastModified: Date.now(),
    messages: [],
    messagesHydrated: true,
    contextItems: [],
    messageCheckpoints: [],
    contextSummary: null,
    ...createRuntimeThreadState(),
})

const updateThread = (
    threads: Record<string, ChatThread>,
    threadId: string,
    updates: Partial<ChatThread>
): Record<string, ChatThread> => {
    const thread = threads[threadId]
    if (!thread) return threads

    return {
        ...threads,
        [threadId]: { ...thread, ...updates, lastModified: Date.now() },
    }
}

const updateThreadEphemeral = (
    threads: Record<string, ChatThread>,
    threadId: string,
    updates: Partial<ChatThread>
): Record<string, ChatThread> => {
    const thread = threads[threadId]
    if (!thread) return threads

    return {
        ...threads,
        [threadId]: { ...thread, ...updates },
    }
}

const arePreviewArgsEqual = (
    left?: Record<string, unknown>,
    right?: Record<string, unknown>
): boolean => {
    if (left === right) return true
    if (!left || !right) return !left && !right

    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
        if (left[key] !== right[key]) {
            return false
        }
    }

    return true
}

export const createThreadSlice: StateCreator<
    ThreadSlice & BranchSlice,
    [],
    [],
    ThreadSlice
> = (set, get) => ({
    threads: {},
    currentThreadId: null,
    threadMessageVersions: {},

    createThread: (options) => {
        const thread = createEmptyThread()
        const cloudUser = useStore.getState().cloudUser
        if (cloudUser?.id) {
            thread.userId = cloudUser.id
        }
        const activate = options?.activate ?? true
        set(state => {
            const newThreads = { ...state.threads, [thread.id]: thread }
            let newBranches = state.branches
            let newActiveBranch = state.activeBranchId

            const MAX_THREADS = 50
            const threadIds = Object.keys(newThreads)
            if (threadIds.length > MAX_THREADS) {
                const sorted = threadIds
                    .filter(id => id !== thread.id)
                    .map(id => ({ id, lastModified: newThreads[id].lastModified }))
                    .sort((a, b) => a.lastModified - b.lastModified)

                const toDelete = sorted.slice(0, threadIds.length - MAX_THREADS)
                newBranches = { ...newBranches }
                newActiveBranch = { ...newActiveBranch }

                for (const { id } of toDelete) {
                    delete newThreads[id]
                    delete newBranches[id]
                    delete newActiveBranch[id]
                }
            }

            return {
                threads: newThreads,
                currentThreadId: activate ? thread.id : state.currentThreadId,
                threadMessageVersions: {
                    ...state.threadMessageVersions,
                    [thread.id]: 0,
                },
                branches: newBranches,
                activeBranchId: newActiveBranch,
            }
        })

        if (activate) {
            const storeState = useStore.getState()
            // 新建会话时关闭欢迎页面等全屏页面
            if (storeState.showWelcomePage || storeState.showSettingsPage || storeState.showUserProfilePage || storeState.showBillingCenterPage || storeState.showSessionHistoryPage) {
                storeState.closeAllFullPages()
            }
            if (storeState.activeWorkspaceSession) {
                useStore.getState().clearWorkspaceSession()
            }
        }

        return thread.id
    },

    renameThread: (threadId, title) => {
        const trimmedTitle = title.trim()
        if (!trimmedTitle) return false

        let renamed = false

        set(state => {
            const thread = state.threads[threadId]
            if (!thread || thread.title === trimmedTitle) {
                return state
            }

            renamed = true
            return {
                threads: updateThread(state.threads, threadId, {
                    title: trimmedTitle,
                }),
            }
        })

        return renamed
    },

    switchThread: (threadId) => {
        const state = get()
        if (state.currentThreadId === threadId && state.threads[threadId]) {
            // 即使 currentThreadId 已是目标，若当前处于全屏页面（仪表盘、设置等），
            // 仍需关闭全屏页面回到聊天界面
            const storeState = useStore.getState()
            if (storeState.showWelcomePage || storeState.showSettingsPage || storeState.showUserProfilePage || storeState.showBillingCenterPage || storeState.showSessionHistoryPage) {
                useStore.getState().closeAllFullPages()
            }
            return Promise.resolve()
        }

        // 复用 ensureThreadLoaded 加载线程与消息（不切 currentThreadId）
        return ensureThreadLoadedImpl(get, set, threadId).then(() => {
            // 加载完成后切换 currentThreadId 并关闭全屏页面
            set({ currentThreadId: threadId })

            const storeState = useStore.getState()
            if (storeState.showWelcomePage || storeState.showSettingsPage || storeState.showUserProfilePage || storeState.showBillingCenterPage || storeState.showSessionHistoryPage) {
                useStore.getState().closeAllFullPages()
            }
            if (storeState.activeWorkspaceSession && storeState.activeWorkspaceSession.threadId !== threadId) {
                useStore.getState().clearWorkspaceSession()
            }
        })
    },

    ensureThreadLoaded: (threadId) => ensureThreadLoadedImpl(get, set, threadId),

    deleteThread: (threadId) => {
        let didDelete = false

        set(state => {
            if (!state.threads[threadId]) return state

            const { [threadId]: _thread, ...remaining } = state.threads
            const remainingIds = Object.keys(remaining)
            const { [threadId]: _messageVersion, ...remainingMessageVersions } = state.threadMessageVersions
            const { [threadId]: _branch, ...remainingBranches } = state.branches || {}
            const { [threadId]: _activeBranch, ...remainingActiveBranch } = state.activeBranchId || {}
            didDelete = true

            return {
                threads: remaining,
                currentThreadId: state.currentThreadId === threadId
                    ? (remainingIds[0] || null)
                    : state.currentThreadId,
                threadMessageVersions: remainingMessageVersions,
                branches: remainingBranches,
                activeBranchId: remainingActiveBranch,
            }
        })

        if (didDelete) {
            // 删除 JSONL 文件和元数据
            void agentSessionRepository.deleteThread(threadId)

            // 清理关联的工作台会话
            const storeState = useStore.getState()
            if (storeState.activeWorkspaceSession?.threadId === threadId) {
                useStore.getState().clearWorkspaceSession()
            }
        }
    },

    getCurrentThread: () => {
        const state = get()
        if (!state.currentThreadId) return null
        return state.threads[state.currentThreadId] || null
    },

    setStreamState: (streamState, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        perfTrace.bump(PERF_TRACE_COUNTERS.streamStateCalls)

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            // 无差异时直接返回原 state。
            // streamProcessor 在流式期间对每个 chunk 都要写一次 streamDetail/waitPhase，
            // 而这些值在同一阶段内基本不变；若照旧合并出新对象，每次写入都会产生新的
            // threads 引用，把全部订阅者（每条消息组件都订阅了 streamState）整批唤醒。
            // 这里只比较本次要写入的键，全部相同即视为无变化。
            const current = thread.streamState
            let changed = false
            for (const key of Object.keys(streamState) as Array<keyof StreamState>) {
                if (current?.[key] !== streamState[key]) {
                    changed = true
                    break
                }
            }
            if (!changed) {
                perfTrace.bump(PERF_TRACE_COUNTERS.streamStateSkipped)
                return state
            }

            perfTrace.bump(PERF_TRACE_COUNTERS.streamStateCommits)
            traceStreamPhaseTransition(current, streamState)

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    streamState: { ...thread.streamState, ...streamState },
                }),
            }
        })
    },

    setStreamPhase: (phase, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        perfTrace.bump(PERF_TRACE_COUNTERS.streamStateCalls)

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            // 防止重复设置相同 phase 导致 streamState 引用变化，触发下游 selector 缓存失效和无限重渲染
            if (thread.streamState?.phase === phase) {
                perfTrace.bump(PERF_TRACE_COUNTERS.streamStateSkipped)
                return state
            }

            perfTrace.bump(PERF_TRACE_COUNTERS.streamStateCommits)
            traceStreamPhaseTransition(thread.streamState, { phase })

            const nextStreamState = phase === 'idle'
                ? {
                    ...thread.streamState,
                    phase,
                    // streamDetail 也必须清空：它是 ephemeral 状态，残留 'reasoning'/'responding'
                    // 会让下一轮请求刚发出（首包未到）时就被判定为「思考中」。
                    streamDetail: undefined,
                    currentToolCall: undefined,
                    error: undefined,
                    statusText: undefined,
                    requestId: undefined,
                    assistantId: undefined,
                    waitPhase: undefined,
                    streamStartTime: undefined,
                    iterationIndex: undefined,
                    iterationTotal: undefined,
                    retryAttempt: undefined,
                    retryDelay: undefined,
                }
                : { ...thread.streamState, phase }

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    streamState: nextStreamState,
                }),
            }
        })
    },

    setToolStreamingPreview: (toolCallId, preview, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            const currentPreview = thread.toolStreamingPreviews?.[toolCallId]
            const nextPreview: ToolStreamingPreview = {
                ...currentPreview,
                ...preview,
            }

            if (
                currentPreview?.isStreaming === nextPreview.isStreaming &&
                currentPreview?.name === nextPreview.name &&
                currentPreview?.lastUpdateTime === nextPreview.lastUpdateTime &&
                arePreviewArgsEqual(currentPreview?.partialArgs, nextPreview.partialArgs)
            ) {
                return state
            }

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    toolStreamingPreviews: {
                        ...(thread.toolStreamingPreviews || {}),
                        [toolCallId]: nextPreview,
                    },
                }),
            }
        })
    },

    clearToolStreamingPreview: (toolCallId, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread?.toolStreamingPreviews?.[toolCallId]) return state

            const { [toolCallId]: _preview, ...rest } = thread.toolStreamingPreviews
            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    toolStreamingPreviews: rest,
                }),
            }
        })
    },

    clearToolStreamingPreviews: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread?.toolStreamingPreviews || Object.keys(thread.toolStreamingPreviews).length === 0) {
                return state
            }

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    toolStreamingPreviews: {},
                }),
            }
        })
    },

    getToolStreamingPreview: (toolCallId, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return undefined
        return get().threads[targetId]?.toolStreamingPreviews?.[toolCallId]
    },

    setCompressionStats: (stats, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { compressionStats: stats }),
        }))
    },

    setContextStats: (stats, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { contextStats: stats }),
        }))
    },

    setContextSummary: (summary, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, { contextSummary: summary }),
        }))
    },

    setCompressionPhase: (phase, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { compressionPhase: phase }),
        }))
    },

    setHandoffState: (handoff, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { handoff }),
        }))
    },

    clearHandoffState: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { handoff: createIdleHandoffState() }),
        }))
    },

    setIsCompacting: (compacting, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { isCompacting: compacting }),
        }))
    },

    setTodos: (todos, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        const prevTodos = get().threads[targetId]?.todos || []
        const wasNotAllCompleted = prevTodos.length > 0 && !prevTodos.every(t => t.status === 'completed')
        const isAllCompleted = todos.length > 0 && todos.every(t => t.status === 'completed')

        set(state => ({
            threads: updateThread(state.threads, targetId, { todos }),
        }))

        if (wasNotAllCompleted && isAllCompleted) {
            EventBus.emit({ type: 'todos:all_completed', total: todos.length })
        }
    },

    getTodos: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return []

        const thread = get().threads[targetId]
        return thread?.todos || []
    },

    setExecutionMeta: (meta, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, { executionMeta: meta || { loopState: 'idle' } }),
        }))
    },

    updateExecutionMeta: (meta, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    executionMeta: {
                        ...(thread.executionMeta || { loopState: 'idle' }),
                        ...meta,
                    },
                }),
            }
        })
    },

    clearExecutionMeta: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThreadEphemeral(state.threads, targetId, {
                executionMeta: { loopState: 'idle' },
                streamState: {
                    ...state.threads[targetId]?.streamState,
                    requestId: undefined,
                    assistantId: undefined,
                },
            }),
        }))
    },
})
