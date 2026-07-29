/**
 * Task 3：taskExecutor 持久化钩子单元测试（Graph Runtime 阶段五）
 *
 * 验证注入点：
 * 1. graphVersion=1 plan → persistRuntimeState 短路（不触发持久化）
 * 2. graphVersion=2 + checkpoint 后 → debounced 持久化
 * 3. graphVersion=2 + awaiting_approval → immediate 持久化（含 awaitingNodeId）
 * 4. graphVersion=2 + 无 checkpoint → 跳过持久化（无锚点）
 * 5. clearSession 默认 → deleteRuntimeState 调用
 * 6. clearSession(deleteRuntime: false) → deleteRuntimeState 不调用（paused 保留）
 *
 * 测试策略：
 * - 通过 __testHelpers 直接调用 persistRuntimeState/clearSession，避免触发完整执行链路
 * - mock runtimePersistence 模块的 save/delete 函数，验证调用情况
 * - mock CheckpointManager.serializeLatest 返回受控 checkpoint
 * - 使用真实 ExecutionSession 构造（绕过 createSession 的重依赖）
 *
 * @module GraphRuntime/persistence
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ===== Mock 外部依赖 =====
// 所有 mock 对象用 vi.hoisted 提升，避免 vi.mock 工厂引用顶层变量导致 ReferenceError

const mocks = vi.hoisted(() => {
    const persistMocks = {
        saveRuntimeStateDebounced: vi.fn(),
        saveRuntimeStateImmediate: vi.fn(),
        deleteRuntimeState: vi.fn().mockResolvedValue(undefined),
        RUNTIME_SCHEMA_VERSION: 1 as number,
    }

    const mockCheckpoint = {
        checkpointId: 'ckpt-test-1',
        graphId: 'plan-dynamic-1',
        nodeId: 'n1',
        stateSnapshot: {
            channels: {},
            metadata: {},
            artifacts: [] as string[],
            nodeOutputs: {} as Record<string, string>,
        },
        timestamp: 1700000000000,
        completedNodes: [] as string[],
        traceId: 'trace-1',
    }

    const checkpointManagerMock = {
        checkpoint: vi.fn(),
        serializeLatest: vi.fn(() => mockCheckpoint),
        clearGraph: vi.fn(),
        restoreLatest: vi.fn(),
        loadPersistedCheckpoint: vi.fn(),
    }

    const graphGuardMock = {
        isDynamicGraphPlan: vi.fn(() => false),
        shouldDispatchToNodeExecutor: vi.fn(() => false),
    }

    const mockStore = {
        getPlan: vi.fn(),
        getActivePlan: vi.fn(),
        startExecution: vi.fn(),
        pauseExecution: vi.fn(),
        stopExecution: vi.fn(),
        updatePlan: vi.fn(),
        updateTask: vi.fn(),
        markTaskCompleted: vi.fn(),
        markTaskFailed: vi.fn(),
        setCurrentTask: vi.fn(),
        createThread: vi.fn(() => 'thread-1'),
    }

    const mockAppStore = {
        getState: vi.fn(() => ({ workspacePath: '/tmp/workspace', llmConfig: null })),
        setState: vi.fn(),
        subscribe: vi.fn(() => () => {}),
    }

    return { persistMocks, mockCheckpoint, checkpointManagerMock, graphGuardMock, mockStore, mockAppStore }
})

vi.mock('@toolkit/LogEngine', () => ({
    logger: {
        agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    },
}))

// Mock offlineModeService：避免模块级单例在 node 环境调 window.addEventListener 报错
vi.mock('../../runtime/knowledgeService/offlineModeService', () => ({
    OfflineModeService: vi.fn(() => ({ handleOnline: vi.fn(), handleOffline: vi.fn() })),
    offlineModeService: { handleOnline: vi.fn(), handleOffline: vi.fn() },
}))

// Mock @store（app store）：避免触发 authSlice → electronBridge 的完整加载链
vi.mock('@store', () => ({
    useStore: mocks.mockAppStore,
}))

// Mock preferencesService / appDirService / longTermMemoryService：阻断 transitive 依赖链
// （node 环境不适用，这些服务在加载期有 I/O 副作用）
vi.mock('../../../settings/preferencesService', () => ({
    preferencesService: { get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => ({})) },
}))
vi.mock('@shared/configuration/preferenceSync', () => ({
    preferenceSync: { sync: vi.fn() },
}))
vi.mock('../../../adapters/appDirService', () => ({
    appDirService: { getAppDir: vi.fn(() => '/tmp/app') },
    getAppDataDir: vi.fn(() => '/tmp/app'),
}))
vi.mock('../../runtime/longTermMemoryService', () => ({
    longTermMemoryService: { get: vi.fn(), set: vi.fn(), search: vi.fn() },
}))
vi.mock('../../runtime/recallService', () => ({
    recallService: { recall: vi.fn() },
}))
vi.mock('../../harness/adapters/MemoryServiceAdapter', () => ({
    MemoryServiceAdapter: vi.fn(),
}))

vi.mock('../../graph/runtimePersistence', () => mocks.persistMocks)

vi.mock('../../graph/CheckpointManager', () => ({
    CheckpointManager: vi.fn(() => mocks.checkpointManagerMock),
    checkpointManager: mocks.checkpointManagerMock,
}))

// Mock GraphStateAdapter（StoreGraphStateAdapter 构造）
vi.mock('../../graph/GraphStateAdapter', () => ({
    StoreGraphStateAdapter: vi.fn().mockImplementation((planId: string) => ({
        planId,
        exportSnapshot: () => ({ channels: {}, metadata: {}, artifacts: [], nodeOutputs: {} }),
        importSnapshot: vi.fn(),
    })),
    createStateAccessor: vi.fn(),
}))

vi.mock('../../graph/graphGuard', () => mocks.graphGuardMock)

vi.mock('../../graph/GraphExecutionBridge', () => ({
    graphExecutionBridge: {
        register: vi.fn(),
        unregister: vi.fn(),
        setCurrent: vi.fn(),
    },
}))

vi.mock('../../graph/NodeExecutor', () => ({
    nodeExecutor: { execute: vi.fn() },
    registerRealExecutors: vi.fn(),
}))

vi.mock('../../graph/realExecutors', () => ({
    createToolExecutor: vi.fn(),
    createLlmExecutor: vi.fn(),
}))

vi.mock('../../graph/EdgeRouter', () => ({
    edgeRouter: { route: vi.fn(), setLlmEvaluator: vi.fn() },
}))

vi.mock('../../graph/LoopController', () => ({
    loopController: { tryLoopBack: vi.fn(), getReflection: vi.fn() },
}))

vi.mock('../../graph/GraphScheduler', () => ({
    GraphScheduler: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        getParallelBatchWithBoost: vi.fn(),
        getNextTaskWithBoost: vi.fn(),
        boostReady: vi.fn(),
    })),
}))

vi.mock('../../state/IntelligenceStore', () => ({
    useAgentStore: { getState: () => mocks.mockStore },
}))

vi.mock('../engine/IntelligenceCore', () => ({
    Agent: { send: vi.fn(), abort: vi.fn() },
}))
vi.mock('../engine/EventDispatcher', () => ({
    EventBus: { emit: vi.fn(), on: vi.fn(() => () => {}) },
}))
vi.mock('@services/gitAdapter', () => ({
    gitService: { getWorkspace: vi.fn(() => '/tmp/workspace') },
}))
vi.mock('../../adapters/electronBridge', () => ({
    api: {
        file: { read: vi.fn(), write: vi.fn(), exists: vi.fn(), ensureDir: vi.fn(), delete: vi.fn(), readDir: vi.fn(), rename: vi.fn() },
        llm: { generateObject: vi.fn() },
        index: { status: vi.fn(), onProgress: vi.fn(() => () => {}) },
    },
}))
vi.mock('../runtime/modelConfigService', () => ({
    getLLMConfigForTask: vi.fn(),
}))
vi.mock('../toolkit/providers', () => ({
    toolManager: { execute: vi.fn() },
}))
vi.mock('../planner/TaskScheduler', () => ({
    ExecutionScheduler: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        markTaskRunning: vi.fn(),
        markTaskCompleted: vi.fn(),
        markTaskFailed: vi.fn(),
        markTaskPending: vi.fn(),
        getParallelBatch: vi.fn(() => []),
        getNextTask: vi.fn(() => null),
        isComplete: vi.fn(() => true),
        hasRunningTasks: vi.fn(() => false),
        isAborted: false,
        calculateStats: vi.fn(() => ({ totalTasks: 0, completedTasks: 0, failedTasks: 0, pendingTasks: 0, runningTasks: 0, skippedTasks: 0, successRate: 0, duration: 0 })),
    })),
}))

// ===== 导入被测模块（在所有 mock 之后） =====
import { __testHelpers } from '../taskExecutor'
import type { TaskPlan, PlanTask, TaskStatus } from '@intelligence/providerTypes'
import type { ExecutionSession } from '../planTypes'

// 解构 mock 对象，便于测试体直接引用（mocks 已通过 vi.hoisted 初始化）
const { persistMocks, mockCheckpoint, checkpointManagerMock, graphGuardMock } = mocks

// ===== 测试辅助 =====

function makeStaticPlan(): TaskPlan {
    return {
        id: 'plan-static-1',
        name: 'Static Plan',
        createdAt: 0,
        updatedAt: 0,
        requirementsDoc: '',
        executionMode: 'parallel',
        status: 'executing',
        revision: 1,
        tasks: [
            {
                id: 't1',
                title: 'Task 1',
                description: '',
                provider: 'openai',
                model: 'gpt-4',
                role: 'default',
                dependencies: [],
                status: 'pending' as TaskStatus,
            } as PlanTask,
        ],
    } as TaskPlan
}

function makeDynamicPlan(): TaskPlan {
    return {
        ...makeStaticPlan(),
        id: 'plan-dynamic-1',
        graphVersion: 2,
        allowDynamicExpansion: true,
    } as TaskPlan
}

function makeSession(planId: string, overrides: Partial<ExecutionSession> = {}): ExecutionSession {
    return {
        id: 'session-test-1',
        planId,
        workspacePath: '/tmp/workspace',
        startedAt: 1700000000000,
        scheduler: {
            stop: vi.fn(),
        } as any,
        status: 'running',
        bindings: new Map(),
        abortControllers: new Map(),
        ...overrides,
    } as ExecutionSession
}

// ===== 测试套件 =====

describe('Task 3: taskExecutor 持久化钩子', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 默认：非动态图（graphVersion=1）
        graphGuardMock.isDynamicGraphPlan.mockReturnValue(false)
        // 默认：serializeLatest 返回 mock checkpoint
        checkpointManagerMock.serializeLatest.mockReturnValue(mockCheckpoint)
    })

    describe('persistRuntimeState 守卫', () => {
        it('graphVersion=1 plan → 不触发任何持久化', () => {
            const plan = makeStaticPlan()
            const session = makeSession(plan.id)

            __testHelpers.persistRuntimeState(session, plan, false)
            __testHelpers.persistRuntimeState(session, plan, true)

            expect(persistMocks.saveRuntimeStateDebounced).not.toHaveBeenCalled()
            expect(persistMocks.saveRuntimeStateImmediate).not.toHaveBeenCalled()
        })

        it('workspacePath 缺失 → 不触发持久化（即使动态图）', () => {
            graphGuardMock.isDynamicGraphPlan.mockReturnValue(true)
            const plan = makeDynamicPlan()
            const session = makeSession(plan.id, { workspacePath: '' })

            __testHelpers.persistRuntimeState(session, plan, false)

            expect(persistMocks.saveRuntimeStateDebounced).not.toHaveBeenCalled()
        })
    })

    describe('persistRuntimeState graphVersion=2 行为', () => {
        beforeEach(() => {
            graphGuardMock.isDynamicGraphPlan.mockReturnValue(true)
        })

        it('checkpoint 后 → debounced 持久化', () => {
            const plan = makeDynamicPlan()
            const session = makeSession(plan.id)

            __testHelpers.persistRuntimeState(session, plan, false)

            expect(persistMocks.saveRuntimeStateDebounced).toHaveBeenCalledTimes(1)
            expect(persistMocks.saveRuntimeStateImmediate).not.toHaveBeenCalled()

            // 验证传入的 state 结构
            const args = persistMocks.saveRuntimeStateDebounced.mock.calls[0]
            expect(args[0]).toBe('/tmp/workspace')
            const state = args[1]
            expect(state.schemaVersion).toBe(1)
            expect(state.planId).toBe('plan-dynamic-1')
            expect(state.planRevision).toBe(1)
            expect(state.checkpoint).toEqual(mockCheckpoint)
            expect(state.session.status).toBe('running')
            expect(state.session.sessionId).toBe('session-test-1')
        })

        it('awaiting_approval → immediate 持久化 + awaitingNodeId', () => {
            const plan = makeDynamicPlan()
            const session = makeSession(plan.id, {
                status: 'awaiting_approval',
                awaitingNodeId: 'human-node-1',
            })

            __testHelpers.persistRuntimeState(session, plan, true)

            expect(persistMocks.saveRuntimeStateImmediate).toHaveBeenCalledTimes(1)
            expect(persistMocks.saveRuntimeStateDebounced).not.toHaveBeenCalled()

            const state = persistMocks.saveRuntimeStateImmediate.mock.calls[0][1]
            expect(state.session.status).toBe('awaiting_approval')
            expect(state.session.awaitingNodeId).toBe('human-node-1')
        })

        it('running 状态 → session.status 序列化为 running', () => {
            const plan = makeDynamicPlan()
            const session = makeSession(plan.id, { status: 'running' })

            __testHelpers.persistRuntimeState(session, plan, true)

            const state = persistMocks.saveRuntimeStateImmediate.mock.calls[0][1]
            expect(state.session.status).toBe('running')
            expect(state.session.awaitingNodeId).toBeUndefined()
        })

        it('无 checkpoint → 跳过持久化', () => {
            checkpointManagerMock.serializeLatest.mockReturnValue(null as any)
            const plan = makeDynamicPlan()
            const session = makeSession(plan.id)

            __testHelpers.persistRuntimeState(session, plan, false)
            __testHelpers.persistRuntimeState(session, plan, true)

            expect(persistMocks.saveRuntimeStateDebounced).not.toHaveBeenCalled()
            expect(persistMocks.saveRuntimeStateImmediate).not.toHaveBeenCalled()
        })

        it('planRevision 从 plan.revision 正确读取', () => {
            const plan = { ...makeDynamicPlan(), revision: 42 }
            const session = makeSession(plan.id)

            __testHelpers.persistRuntimeState(session, plan, false)

            const state = persistMocks.saveRuntimeStateDebounced.mock.calls[0][1]
            expect(state.planRevision).toBe(42)
        })

        it('plan.revision 缺失 → fallback 为 1', () => {
            const plan = { ...makeDynamicPlan(), revision: undefined }
            const session = makeSession(plan.id)

            __testHelpers.persistRuntimeState(session, plan, false)

            const state = persistMocks.saveRuntimeStateDebounced.mock.calls[0][1]
            expect(state.planRevision).toBe(1)
        })
    })

    describe('clearSession deleteRuntime 选项', () => {
        it('默认 → deleteRuntimeState 调用（终态语义）', () => {
            const session = makeSession('plan-dynamic-1')

            __testHelpers.clearSession(session)

            expect(persistMocks.deleteRuntimeState).toHaveBeenCalledTimes(1)
            expect(persistMocks.deleteRuntimeState).toHaveBeenCalledWith('/tmp/workspace', 'plan-dynamic-1')
            expect(checkpointManagerMock.clearGraph).toHaveBeenCalledWith('plan-dynamic-1')
        })

        it('deleteRuntime: false → deleteRuntimeState 不调用（paused 保留）', () => {
            const session = makeSession('plan-dynamic-1')

            __testHelpers.clearSession(session, { deleteRuntime: false })

            expect(persistMocks.deleteRuntimeState).not.toHaveBeenCalled()
            // checkpoint 仍清理（内存释放）
            expect(checkpointManagerMock.clearGraph).toHaveBeenCalledWith('plan-dynamic-1')
        })

        it('deleteRuntime: true → 显式删除', () => {
            const session = makeSession('plan-dynamic-1')

            __testHelpers.clearSession(session, { deleteRuntime: true })

            expect(persistMocks.deleteRuntimeState).toHaveBeenCalledTimes(1)
        })

        it('workspacePath 缺失 → 不调用 deleteRuntimeState（不崩溃）', () => {
            const session = makeSession('plan-dynamic-1', { workspacePath: '' })

            __testHelpers.clearSession(session)

            expect(persistMocks.deleteRuntimeState).not.toHaveBeenCalled()
        })
    })

    describe('持久化与 session 状态一致性', () => {
        beforeEach(() => {
            graphGuardMock.isDynamicGraphPlan.mockReturnValue(true)
        })

        it('awaiting_approval 场景：session 状态正确反映到 PersistedSessionMeta', () => {
            const plan = makeDynamicPlan()
            const session = makeSession(plan.id, {
                status: 'awaiting_approval',
                awaitingNodeId: 'node-hitl',
                startedAt: 1700000050000,
            })

            __testHelpers.persistRuntimeState(session, plan, true)

            const state = persistMocks.saveRuntimeStateImmediate.mock.calls[0][1]
            expect(state.session).toEqual({
                sessionId: 'session-test-1',
                startedAt: 1700000050000,
                status: 'awaiting_approval',
                awaitingNodeId: 'node-hitl',
                lastUpdatedAt: expect.any(Number),
            })
        })

        it('paused 场景（session.status=running 但 plan.status=paused）：序列化为 running', () => {
            // 注意：persistRuntimeState 按 session.status 序列化
            // paused 场景下 session.status 仍是 'running'（pausePlanExecution 中先 persist 再设 paused）
            // 这是预期行为：恢复时按 running 处理，重新进入 runExecutionLoop
            const plan = makeDynamicPlan()
            const session = makeSession(plan.id, { status: 'running' })

            __testHelpers.persistRuntimeState(session, plan, true)

            const state = persistMocks.saveRuntimeStateImmediate.mock.calls[0][1]
            expect(state.session.status).toBe('running')
        })
    })
})
