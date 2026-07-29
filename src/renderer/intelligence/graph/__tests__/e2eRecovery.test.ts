/**
 * Graph Runtime 阶段五端到端集成测试：崩溃恢复
 *
 * 验证完整链路：runtimePersistence 写盘 → 模拟重启 → graphRecovery 读盘 → 校验 → recoverSession 调用
 *
 * 测试策略：
 * - 使用真实的 runtimePersistence + graphRecovery（验证磁盘 IO + 校验逻辑）
 * - mock api.file 为内存文件系统（Map 模拟，支持原子写 write+rename）
 * - mock taskExecutor.recoverSession（验证调用参数，避免触发重模块依赖）
 * - mock IntelligenceStore（getPlan 返回受控 plan）
 *
 * 覆盖场景：
 * 1. awaiting_approval 端到端恢复（HITL 卡片恢复链路）
 * 2. running 端到端恢复
 * 3. schemaVersion 不兼容 → 删除文件
 * 4. planRevision 不匹配 → 删除文件不恢复
 * 5. plan 终态 → 清理 runtime 文件
 * 6. plan 不存在 → 删除孤儿文件
 * 7. 持久化往返一致性（serializeLatest → 写盘 → 读盘 → loadPersistedCheckpoint）
 *
 * @module GraphRuntime/recovery/e2e
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ===== Mock 依赖 =====

const mocks = vi.hoisted(() => {
    const recoverSessionMock = vi.fn().mockResolvedValue({ success: true, message: 'recovered' })

    const storeMock = {
        getPlan: vi.fn<(planId: string) => any>().mockReturnValue(null),
        updatePlan: vi.fn(),
        updateTask: vi.fn(),
    }

    return { recoverSessionMock, storeMock }
})

// 内存文件系统（模拟磁盘）
const memFs = new Map<string, string>()

vi.mock('@toolkit/LogEngine', () => ({
    logger: {
        agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        ui: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        plan: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    },
}))

// Mock electronBridge 的 api.file 为内存文件系统
// exists 同时支持文件和目录语义：精确命中或存在以该路径为前缀的子文件（视为目录）
vi.mock('../../../adapters/electronBridge', () => ({
    api: {
        file: {
            exists: vi.fn(async (path: string) => {
                if (memFs.has(path)) return true
                // 目录语义：若 memFs 中存在以 "path/" 为前缀的文件，视为目录存在
                const prefix = path.endsWith('/') ? path : path + '/'
                for (const key of memFs.keys()) {
                    if (key.startsWith(prefix)) return true
                }
                return false
            }),
            read: vi.fn(async (path: string) => memFs.get(path) || ''),
            write: vi.fn(async (path: string, content: string) => { memFs.set(path, content) }),
            delete: vi.fn(async (path: string) => { memFs.delete(path) }),
            rename: vi.fn(async (from: string, to: string) => {
                const c = memFs.get(from)
                if (c !== undefined) { memFs.set(to, c); memFs.delete(from) }
            }),
            ensureDir: vi.fn(async (path: string) => {
                // 标记目录存在（用空串占位，exists 会因精确命中返回 true）
                if (!memFs.has(path)) memFs.set(path, '')
            }),
            readDir: vi.fn(async (dir: string) => {
                const names: string[] = []
                const prefix = dir.endsWith('/') ? dir : dir + '/'
                for (const key of memFs.keys()) {
                    if (key.startsWith(prefix) && key !== dir) {
                        const name = key.substring(prefix.length)
                        // 只返回直接子项（不含子目录内的文件）
                        if (!name.includes('/')) names.push(name)
                    }
                }
                return names
            }),
        },
        llm: { generateObject: vi.fn() },
        index: { status: vi.fn(), onProgress: vi.fn(() => () => {}) },
    },
}))

vi.mock('../../state/IntelligenceStore', () => ({
    useAgentStore: { getState: () => mocks.storeMock },
}))

vi.mock('../graphGuard', () => ({
    isDynamicGraphPlan: vi.fn((plan: any) => plan?.graphVersion === 2 || plan?.allowDynamicExpansion === true),
}))

vi.mock('../../planner/taskExecutor', () => ({
    recoverSession: mocks.recoverSessionMock,
}))

// Mock offlineModeService：避免模块级单例在 node 环境调 window.addEventListener 报错
vi.mock('../../runtime/knowledgeService/offlineModeService', () => ({
    OfflineModeService: vi.fn(() => ({ handleOnline: vi.fn(), handleOffline: vi.fn() })),
    offlineModeService: { handleOnline: vi.fn(), handleOffline: vi.fn() },
}))

// ===== 导入真实模块（被测对象） =====
import {
    saveRuntimeStateImmediate,
    saveRuntimeStateDebounced,
    loadRuntimeState,
    cleanupOrphanTmp,
    RUNTIME_SCHEMA_VERSION,
    getRuntimeFilePath,
    type RuntimeStateFile,
} from '../runtimePersistence'
import { recoverGraphRuntimeFromDisk, __resetRecoveryState } from '../graphRecovery'
import { checkpointManager, type NodeCheckpoint } from '../CheckpointManager'
import { StoreGraphStateAdapter } from '../GraphStateAdapter'
import type { TaskPlan } from '../../planner/planTypes'

// ===== 测试辅助 =====

const WORKSPACE = '/tmp/test-workspace'

function makePlan(overrides: Partial<any> = {}): TaskPlan {
    return {
        id: 'plan-e2e-1',
        name: 'E2E Test Plan',
        createdAt: 0,
        updatedAt: 0,
        requirementsDoc: '',
        executionMode: 'parallel',
        status: 'paused',
        revision: 5,
        graphVersion: 2,
        allowDynamicExpansion: true,
        tasks: [
            { id: 'n1', title: 'Node 1', dependencies: [], status: 'completed' } as any,
            { id: 'n2', title: 'Node 2', dependencies: [], status: 'pending' } as any,
            { id: 'n3', title: 'Node 3', dependencies: [], status: 'pending' } as any,
        ],
        ...overrides,
    } as TaskPlan
}

function makeCheckpoint(overrides: Partial<NodeCheckpoint> = {}): NodeCheckpoint {
    return {
        checkpointId: 'ckpt-e2e-1',
        graphId: 'plan-e2e-1',
        nodeId: 'n2',
        stateSnapshot: {
            channels: { 'output:n1': 'result-1' },
            metadata: { 'loop:n2:iteration': 2, 'loop:n2:reflection': 'try harder' },
            artifacts: ['/tmp/artifact.txt'],
            nodeOutputs: { n1: 'result-1' },
        },
        timestamp: 1700000000000,
        completedNodes: ['n1'],
        traceId: 'trace-e2e-1',
        ...overrides,
    }
}

function makeRuntimeState(overrides: Partial<RuntimeStateFile> = {}): RuntimeStateFile {
    return {
        schemaVersion: RUNTIME_SCHEMA_VERSION,
        planId: 'plan-e2e-1',
        planRevision: 5,
        session: {
            sessionId: 'session-e2e-uuid',
            startedAt: 1700000000000,
            status: 'running',
            lastUpdatedAt: 1700000001000,
        },
        checkpoint: makeCheckpoint(),
        ...overrides,
    } as RuntimeStateFile
}

/** 等待防抖写入完成 */
async function flushDebounce(): Promise<void> {
    await new Promise(r => setTimeout(r, 150))
}

/** 重置内存文件系统 */
function resetMemFs(): void {
    memFs.clear()
}

// ===== 测试套件 =====

describe('Graph Runtime 阶段五 E2E: 崩溃恢复', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        __resetRecoveryState()
        resetMemFs()
        checkpointManager.clearAll()

        // 默认 mock：recoverSession 成功
        mocks.recoverSessionMock.mockResolvedValue({ success: true, message: 'recovered' })
        // 默认 mock：store 无 plan（各测试按需覆盖）
        mocks.storeMock.getPlan.mockReturnValue(null)
    })

    describe('场景 1: awaiting_approval 崩溃恢复', () => {
        it('崩溃前持久化 awaiting_approval → 重启后恢复并传给 recoverSession', async () => {
            // 模拟崩溃前：awaiting_approval 状态立即写盘
            const state = makeRuntimeState({
                session: {
                    sessionId: 'session-awaiting',
                    startedAt: 1700000000000,
                    status: 'awaiting_approval',
                    awaitingNodeId: 'n2',
                    lastUpdatedAt: 1700000002000,
                },
            })
            await saveRuntimeStateImmediate(WORKSPACE, state)

            // 验证文件已写入磁盘
            const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
            expect(memFs.has(filePath)).toBe(true)

            // 模拟重启：plan 已加载到 store（非终态）
            mocks.storeMock.getPlan.mockReturnValue(makePlan({ status: 'paused', revision: 5 }))

            // 执行恢复
            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.recovered).toBe(1)
            // 验证 recoverSession 被调用，且传入正确的 awaiting_approval 状态
            expect(mocks.recoverSessionMock).toHaveBeenCalledTimes(1)
            const [plan, passedState, workspacePath] = mocks.recoverSessionMock.mock.calls[0]
            expect(plan.id).toBe('plan-e2e-1')
            expect(passedState.session.status).toBe('awaiting_approval')
            expect(passedState.session.awaitingNodeId).toBe('n2')
            expect(workspacePath).toBe(WORKSPACE)
            // runtime 文件不应被删除（恢复成功，由 clearSession 在终态删除）
            expect(memFs.has(filePath)).toBe(true)
        })

        it('HITL 状态含 awaitingNodeId → checkpoint 元数据完整保留', async () => {
            const checkpoint = makeCheckpoint({
                stateSnapshot: {
                    channels: {},
                    metadata: { 'loop:n3:iteration': 5 },
                    artifacts: [],
                    nodeOutputs: {},
                },
            })
            const state = makeRuntimeState({
                session: {
                    sessionId: 's1',
                    startedAt: 0,
                    status: 'awaiting_approval',
                    awaitingNodeId: 'n3',
                    lastUpdatedAt: 0,
                },
                checkpoint,
            })
            await saveRuntimeStateImmediate(WORKSPACE, state)

            mocks.storeMock.getPlan.mockReturnValue(makePlan({ revision: 5 }))

            await recoverGraphRuntimeFromDisk(WORKSPACE)

            const passedState = mocks.recoverSessionMock.mock.calls[0][1] as RuntimeStateFile
            expect(passedState.checkpoint.stateSnapshot.metadata).toHaveProperty('loop:n3:iteration', 5)
            expect(passedState.session.awaitingNodeId).toBe('n3')
        })
    })

    describe('场景 2: running 崩溃恢复', () => {
        it('崩溃前持久化 running → 重启后恢复', async () => {
            const state = makeRuntimeState({
                session: { sessionId: 's-run', startedAt: 0, status: 'running', lastUpdatedAt: 0 },
            })
            await saveRuntimeStateImmediate(WORKSPACE, state)

            mocks.storeMock.getPlan.mockReturnValue(makePlan({ status: 'paused', revision: 5 }))

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.recovered).toBe(1)
            const passedState = mocks.recoverSessionMock.mock.calls[0][1] as RuntimeStateFile
            expect(passedState.session.status).toBe('running')
            expect(passedState.session.awaitingNodeId).toBeUndefined()
        })
    })

    describe('场景 3: schemaVersion 不兼容', () => {
        it('schemaVersion 错误 → loadRuntimeState 返回 null → failed', async () => {
            // 直接写一个 schemaVersion 错误的文件
            const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
            memFs.set(filePath, JSON.stringify({
                schemaVersion: 999, // 不兼容的版本
                planId: 'plan-e2e-1',
                planRevision: 5,
                session: { sessionId: 's', startedAt: 0, status: 'running', lastUpdatedAt: 0 },
                checkpoint: makeCheckpoint(),
            }))

            mocks.storeMock.getPlan.mockReturnValue(makePlan({ revision: 5 }))

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            // loadRuntimeState 校验失败返回 null，processRuntimeFile 返回 failed
            expect(result.failed).toBe(1)
            expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
        })

        it('损坏的 JSON → loadRuntimeState 返回 null → failed', async () => {
            const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
            memFs.set(filePath, '{ this is not valid json')

            mocks.storeMock.getPlan.mockReturnValue(makePlan({ revision: 5 }))

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.failed).toBe(1)
            expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
        })
    })

    describe('场景 4: planRevision 不匹配', () => {
        it('runtime revision=5 但 plan revision=10 → 删除文件不恢复', async () => {
            const state = makeRuntimeState({ planRevision: 5 })
            await saveRuntimeStateImmediate(WORKSPACE, state)

            // plan 被外部修改，revision 变成 10
            mocks.storeMock.getPlan.mockReturnValue(makePlan({ revision: 10 }))

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.skipped).toBe(1)
            expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
            // 文件应被删除
            const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
            expect(memFs.has(filePath)).toBe(false)
        })

        it('runtime revision=5 且 plan revision=5 → 正常恢复', async () => {
            const state = makeRuntimeState({ planRevision: 5 })
            await saveRuntimeStateImmediate(WORKSPACE, state)

            mocks.storeMock.getPlan.mockReturnValue(makePlan({ revision: 5 }))

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.recovered).toBe(1)
            expect(mocks.recoverSessionMock).toHaveBeenCalledTimes(1)
        })
    })

    describe('场景 5: plan 终态清理', () => {
        it.each(['completed', 'failed', 'stopped', 'approved'] as const)(
            'plan.status=%s → 删除 runtime 文件',
            async (status) => {
                const state = makeRuntimeState()
                await saveRuntimeStateImmediate(WORKSPACE, state)

                mocks.storeMock.getPlan.mockReturnValue(makePlan({ status, revision: 5 }))

                const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

                expect(result.skipped).toBe(1)
                expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
                const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
                expect(memFs.has(filePath)).toBe(false)
            },
        )
    })

    describe('场景 6: plan 不存在（孤儿文件）', () => {
        it('runtime 文件存在但 plan 已删除 → 删除孤儿文件', async () => {
            const state = makeRuntimeState()
            await saveRuntimeStateImmediate(WORKSPACE, state)

            // store 中无此 plan
            mocks.storeMock.getPlan.mockReturnValue(null)

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.skipped).toBe(1)
            const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
            expect(memFs.has(filePath)).toBe(false)
        })
    })

    describe('场景 7: 持久化往返一致性', () => {
        it('checkpointManager.serializeLatest → 写盘 → 读盘 → loadPersistedCheckpoint 状态等价', async () => {
            // 1. 在内存 checkpointManager 中创建 checkpoint
            const plan = makePlan()
            const stateAdapter = new StoreGraphStateAdapter(plan.id)
            stateAdapter.setMetadata('counter', 7)
            stateAdapter.writeChannel('ch1', { deep: { value: 1 } })
            stateAdapter.addArtifact('/path/file.txt')

            // mock store.getPlan 让 StoreGraphStateAdapter 能读到 plan
            mocks.storeMock.getPlan.mockReturnValue(plan)

            const ckptId = checkpointManager.checkpoint(
                plan as any,
                { id: 'n2' } as any,
                stateAdapter,
                'trace-roundtrip',
            )

            // 2. 序列化最新 checkpoint
            const serialized = checkpointManager.serializeLatest(plan.id)!
            expect(serialized).not.toBeNull()

            // 3. 写盘
            const stateFile: RuntimeStateFile = {
                schemaVersion: RUNTIME_SCHEMA_VERSION,
                planId: plan.id,
                planRevision: plan.revision || 1,
                session: {
                    sessionId: 'roundtrip-session',
                    startedAt: 1700000000000,
                    status: 'running',
                    lastUpdatedAt: 1700000001000,
                },
                checkpoint: serialized,
            }
            await saveRuntimeStateImmediate(WORKSPACE, stateFile)

            // 4. 读盘
            const loaded = await loadRuntimeState(WORKSPACE, plan.id)
            expect(loaded).not.toBeNull()
            expect(loaded!.checkpoint.checkpointId).toBe(ckptId)
            expect(loaded!.checkpoint.stateSnapshot.metadata).toEqual({ counter: 7 })
            expect(loaded!.checkpoint.stateSnapshot.artifacts).toEqual(['/path/file.txt'])

            // 5. loadPersistedCheckpoint 到新的 manager（模拟重启）
            checkpointManager.clearAll()
            const ok = checkpointManager.loadPersistedCheckpoint(loaded!.checkpoint)
            expect(ok).toBe(true)

            // 6. 验证恢复后状态可访问
            const restored = checkpointManager.getCheckpoint(ckptId)!
            expect(restored.stateSnapshot.metadata).toEqual({ counter: 7 })
            expect(restored.stateSnapshot.channels).toHaveProperty('ch1')
            expect(restored.stateSnapshot.artifacts).toEqual(['/path/file.txt'])
        })
    })

    describe('场景 8: 原子写入与 .tmp 清理', () => {
        it('原子写：write .tmp + rename → 最终文件存在，.tmp 不存在', async () => {
            await saveRuntimeStateImmediate(WORKSPACE, makeRuntimeState())

            const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
            const tmpPath = `${filePath}.tmp`

            expect(memFs.has(filePath)).toBe(true)
            expect(memFs.has(tmpPath)).toBe(false) // .tmp 已被 rename 消费
        })

        it('cleanupOrphanTmp 清理残留 .tmp 文件', async () => {
            // 模拟崩溃残留 .tmp
            const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
            const tmpPath = `${filePath}.tmp`
            memFs.set(tmpPath, 'incomplete write')

            await cleanupOrphanTmp(WORKSPACE)

            expect(memFs.has(tmpPath)).toBe(false)
        })

        it('恢复启动时自动清理 .tmp 孤儿', async () => {
            // 残留 .tmp
            const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
            const tmpPath = `${filePath}.tmp`
            memFs.set(tmpPath, 'incomplete')

            await recoverGraphRuntimeFromDisk(WORKSPACE)

            // .tmp 应被清理（cleanupOrphanTmp 在恢复流程开头调用）
            expect(memFs.has(tmpPath)).toBe(false)
        })
    })

    describe('场景 9: 防抖写入', () => {
        it('debounced 写入：120ms 内多次调用只写一次', async () => {
            const state = makeRuntimeState()
            // 连续调用 3 次 debounced 写
            saveRuntimeStateDebounced(WORKSPACE, state)
            saveRuntimeStateDebounced(WORKSPACE, state)
            saveRuntimeStateDebounced(WORKSPACE, state)

            // 立即检查：文件还未写入（防抖中）
            const filePath = getRuntimeFilePath(WORKSPACE, 'plan-e2e-1')
            expect(memFs.has(filePath)).toBe(false)

            // 等待防抖完成
            await flushDebounce()

            expect(memFs.has(filePath)).toBe(true)
        })
    })

    describe('场景 10: 多 plan 批量恢复', () => {
        it('两个 plan 的 runtime 文件 → 逐个恢复', async () => {
            // plan-1: 可恢复
            await saveRuntimeStateImmediate(WORKSPACE, makeRuntimeState({
                planId: 'plan-1',
                checkpoint: makeCheckpoint({ graphId: 'plan-1' }),
            }))
            // plan-2: plan 不存在
            await saveRuntimeStateImmediate(WORKSPACE, makeRuntimeState({
                planId: 'plan-2',
                checkpoint: makeCheckpoint({ graphId: 'plan-2', checkpointId: 'ckpt-2' }),
            }))

            mocks.storeMock.getPlan.mockImplementation((planId: string) =>
                planId === 'plan-1' ? makePlan({ id: 'plan-1', revision: 5 }) : null,
            )

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.recovered).toBe(1) // plan-1 恢复
            expect(result.skipped).toBe(1) // plan-2 plan 不存在，跳过

            // plan-2 的 runtime 文件应被删除
            const plan2File = getRuntimeFilePath(WORKSPACE, 'plan-2')
            expect(memFs.has(plan2File)).toBe(false)
        })
    })
})
