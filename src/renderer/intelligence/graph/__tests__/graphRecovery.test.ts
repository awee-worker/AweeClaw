/**
 * Graph Recovery 单元测试（Graph Runtime 阶段五）
 *
 * 验证：
 * 1. 无 runtime 目录 → 直接返回（recovered=0）
 * 2. plan 不存在 → 删除 runtime 文件，跳过
 * 3. graphVersion≠2 → 删除 runtime 文件，跳过
 * 4. plan 终态 → 删除 runtime 文件，跳过
 * 5. planRevision 不匹配 → 删除 runtime 文件，跳过
 * 6. checkpoint 节点不在 plan.tasks → 删除 runtime 文件，failed
 * 7. awaiting_approval 恢复 → 调 recoverSession + 返回 recovered
 * 8. running 恢复 → 调 recoverSession + 返回 recovered
 * 9. recoverSession 返回失败 → skipped（不删 runtime 文件）
 * 10. 防并发：重复调用跳过
 *
 * @module GraphRuntime/recovery
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ===== Mock 依赖 =====

const mocks = vi.hoisted(() => {
    const runtimePersistenceMock = {
        listRuntimeFiles: vi.fn<(workspacePath: string) => Promise<string[]>>().mockResolvedValue([]),
        loadRuntimeState: vi.fn().mockResolvedValue(null),
        deleteRuntimeState: vi.fn().mockResolvedValue(undefined),
        cleanupOrphanTmp: vi.fn().mockResolvedValue(undefined),
        extractPlanIdFromFileName: vi.fn((fileName: string) => fileName.replace(/\.runtime\.json$/, '')),
        getRuntimeDir: vi.fn((workspacePath: string) => `${workspacePath}/.aweeclaw/runtime`),
    }

    const recoverSessionMock = vi.fn().mockResolvedValue({ success: false, message: 'not mocked' })

    const storeMock = {
        getPlan: vi.fn<(planId: string) => any>().mockReturnValue(null),
    }

    return { runtimePersistenceMock, recoverSessionMock, storeMock }
})

vi.mock('@toolkit/LogEngine', () => ({
    logger: {
        agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    },
}))

vi.mock('../../state/IntelligenceStore', () => ({
    useAgentStore: { getState: () => mocks.storeMock },
}))

vi.mock('../runtimePersistence', () => mocks.runtimePersistenceMock)

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

// ===== 导入被测模块 =====
import {
    recoverGraphRuntimeFromDisk,
    __resetRecoveryState,
    __testHelpers,
} from '../graphRecovery'
import type { TaskPlan } from '../../planner/planTypes'
import type { RuntimeStateFile } from '../runtimePersistence'

// ===== 测试辅助 =====

function makePlan(overrides: Partial<any> = {}): TaskPlan {
    return {
        id: 'plan-1',
        name: 'Test Plan',
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
        ],
        ...overrides,
    } as TaskPlan
}

function makeRuntimeState(overrides: Partial<RuntimeStateFile> = {}): RuntimeStateFile {
    return {
        schemaVersion: 1,
        planId: 'plan-1',
        planRevision: 5,
        session: {
            sessionId: 'session-uuid',
            startedAt: 1700000000000,
            status: 'running',
            lastUpdatedAt: 1700000001000,
        },
        checkpoint: {
            checkpointId: 'ckpt-1',
            graphId: 'plan-1',
            nodeId: 'n2',
            stateSnapshot: {
                channels: {},
                metadata: {},
                artifacts: [],
                nodeOutputs: {},
            },
            timestamp: 1700000000500,
            completedNodes: ['n1'],
            traceId: 'trace-1',
        },
        ...overrides,
    } as RuntimeStateFile
}

// ===== 测试套件 =====

describe('Graph Recovery (阶段五)', () => {
    const WORKSPACE = '/tmp/workspace'

    beforeEach(() => {
        vi.clearAllMocks()
        __resetRecoveryState()

        // 默认 mock：无 runtime 文件
        mocks.runtimePersistenceMock.listRuntimeFiles.mockResolvedValue([])
        mocks.runtimePersistenceMock.loadRuntimeState.mockResolvedValue(null)
        mocks.runtimePersistenceMock.deleteRuntimeState.mockResolvedValue(undefined)
        mocks.runtimePersistenceMock.cleanupOrphanTmp.mockResolvedValue(undefined)
        mocks.runtimePersistenceMock.getRuntimeDir.mockReturnValue(`${WORKSPACE}/.aweeclaw/runtime`)

        // 默认 mock：recoverSession 成功
        mocks.recoverSessionMock.mockResolvedValue({ success: true, message: 'recovered' })

        // 默认 mock：store 无 plan
        mocks.storeMock.getPlan.mockReturnValue(null)
    })

    describe('recoverGraphRuntimeFromDisk 基本流程', () => {
        it('无 runtime 文件 → 返回 recovered=0', async () => {
            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result).toEqual({ recovered: 0, skipped: 0, failed: 0 })
            expect(mocks.runtimePersistenceMock.cleanupOrphanTmp).toHaveBeenCalledWith(WORKSPACE)
            expect(mocks.runtimePersistenceMock.listRuntimeFiles).toHaveBeenCalledWith(WORKSPACE)
        })

        it('清理 .tmp 孤儿文件（无论是否有 runtime 文件）', async () => {
            await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(mocks.runtimePersistenceMock.cleanupOrphanTmp).toHaveBeenCalledTimes(1)
            expect(mocks.runtimePersistenceMock.cleanupOrphanTmp).toHaveBeenCalledWith(WORKSPACE)
        })
    })

    describe('plan 校验分支', () => {
        beforeEach(() => {
            // 设置：1 个 runtime 文件，加载成功，plan 存在
            mocks.runtimePersistenceMock.listRuntimeFiles.mockResolvedValue(['plan-1.runtime.json'])
            mocks.runtimePersistenceMock.loadRuntimeState.mockResolvedValue(makeRuntimeState())
        })

        it('plan 不存在 → 删除 runtime 文件，skipped', async () => {
            mocks.storeMock.getPlan.mockReturnValue(null)

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.skipped).toBe(1)
            expect(mocks.runtimePersistenceMock.deleteRuntimeState).toHaveBeenCalledWith(WORKSPACE, 'plan-1')
            expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
        })

        it('graphVersion≠2 → 删除 runtime 文件，skipped', async () => {
            mocks.storeMock.getPlan.mockReturnValue(makePlan({ graphVersion: undefined, allowDynamicExpansion: false }))

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.skipped).toBe(1)
            expect(mocks.runtimePersistenceMock.deleteRuntimeState).toHaveBeenCalledWith(WORKSPACE, 'plan-1')
            expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
        })

        it('plan 终态（completed）→ 删除 runtime 文件，skipped', async () => {
            mocks.storeMock.getPlan.mockReturnValue(makePlan({ status: 'completed' }))

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.skipped).toBe(1)
            expect(mocks.runtimePersistenceMock.deleteRuntimeState).toHaveBeenCalledWith(WORKSPACE, 'plan-1')
            expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
        })

        it('plan 终态（failed）→ 删除 runtime 文件', async () => {
            mocks.storeMock.getPlan.mockReturnValue(makePlan({ status: 'failed' }))

            await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(mocks.runtimePersistenceMock.deleteRuntimeState).toHaveBeenCalledWith(WORKSPACE, 'plan-1')
        })

        it('planRevision 不匹配 → 删除 runtime 文件，skipped', async () => {
            // runtime 文件记录 revision=5，但 plan 当前 revision=10（被外部修改）
            mocks.storeMock.getPlan.mockReturnValue(makePlan({ revision: 10 }))

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.skipped).toBe(1)
            expect(mocks.runtimePersistenceMock.deleteRuntimeState).toHaveBeenCalledWith(WORKSPACE, 'plan-1')
            expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
        })

        it('planRevision 匹配 → 不删除，调 recoverSession', async () => {
            mocks.storeMock.getPlan.mockReturnValue(makePlan({ revision: 5 }))

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.recovered).toBe(1)
            expect(mocks.runtimePersistenceMock.deleteRuntimeState).not.toHaveBeenCalled()
            expect(mocks.recoverSessionMock).toHaveBeenCalledTimes(1)
        })
    })

    describe('checkpoint 节点校验', () => {
        beforeEach(() => {
            mocks.runtimePersistenceMock.listRuntimeFiles.mockResolvedValue(['plan-1.runtime.json'])
            mocks.runtimePersistenceMock.loadRuntimeState.mockResolvedValue(makeRuntimeState())
            mocks.storeMock.getPlan.mockReturnValue(makePlan({ revision: 5 }))
        })

        it('checkpoint.nodeId 不在 plan.tasks → 删除 runtime 文件，failed', async () => {
            // checkpoint 指向不存在的节点
            mocks.runtimePersistenceMock.loadRuntimeState.mockResolvedValue(
                makeRuntimeState({
                    checkpoint: {
                        checkpointId: 'ckpt-1',
                        graphId: 'plan-1',
                        nodeId: 'non-existent-node',
                        stateSnapshot: { channels: {}, metadata: {}, artifacts: [], nodeOutputs: {} },
                        timestamp: 1700000000500,
                        completedNodes: ['n1'],
                        traceId: 'trace-1',
                    } as any,
                }),
            )

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.failed).toBe(1)
            expect(mocks.runtimePersistenceMock.deleteRuntimeState).toHaveBeenCalledWith(WORKSPACE, 'plan-1')
            expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
        })

        it('checkpoint.nodeId 存在但 completedNodes 部分缺失 → 仍恢复（宽松校验）', async () => {
            // completedNodes 含不存在的节点，但入口节点 n2 存在
            mocks.runtimePersistenceMock.loadRuntimeState.mockResolvedValue(
                makeRuntimeState({
                    checkpoint: {
                        checkpointId: 'ckpt-1',
                        graphId: 'plan-1',
                        nodeId: 'n2',
                        stateSnapshot: { channels: {}, metadata: {}, artifacts: [], nodeOutputs: {} },
                        timestamp: 1700000000500,
                        completedNodes: ['n1', 'ghost-node'],
                        traceId: 'trace-1',
                    } as any,
                }),
            )

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.recovered).toBe(1)
            expect(mocks.recoverSessionMock).toHaveBeenCalledTimes(1)
        })
    })

    describe('loadRuntimeState 失败处理', () => {
        it('loadRuntimeState 返回 null（损坏文件）→ failed', async () => {
            mocks.runtimePersistenceMock.listRuntimeFiles.mockResolvedValue(['plan-1.runtime.json'])
            mocks.runtimePersistenceMock.loadRuntimeState.mockResolvedValue(null)

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.failed).toBe(1)
            // loadRuntimeState 内部已处理文件删除，这里不重复删除
            expect(mocks.recoverSessionMock).not.toHaveBeenCalled()
        })
    })

    describe('recoverSession 调用', () => {
        beforeEach(() => {
            mocks.runtimePersistenceMock.listRuntimeFiles.mockResolvedValue(['plan-1.runtime.json'])
            mocks.runtimePersistenceMock.loadRuntimeState.mockResolvedValue(makeRuntimeState())
            mocks.storeMock.getPlan.mockReturnValue(makePlan({ revision: 5 }))
        })

        it('awaiting_approval 状态 → 传给 recoverSession', async () => {
            mocks.runtimePersistenceMock.loadRuntimeState.mockResolvedValue(
                makeRuntimeState({
                    session: {
                        sessionId: 'session-uuid',
                        startedAt: 1700000000000,
                        status: 'awaiting_approval',
                        awaitingNodeId: 'n2',
                        lastUpdatedAt: 1700000001000,
                    },
                }),
            )

            await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(mocks.recoverSessionMock).toHaveBeenCalledTimes(1)
            const args = mocks.recoverSessionMock.mock.calls[0]
            expect(args[0].id).toBe('plan-1')
            expect(args[1].session.status).toBe('awaiting_approval')
            expect(args[1].session.awaitingNodeId).toBe('n2')
            expect(args[2]).toBe(WORKSPACE)
        })

        it('running 状态 → 传给 recoverSession', async () => {
            await recoverGraphRuntimeFromDisk(WORKSPACE)

            const args = mocks.recoverSessionMock.mock.calls[0]
            expect(args[1].session.status).toBe('running')
        })

        it('recoverSession 返回失败 → skipped（不删 runtime 文件）', async () => {
            mocks.recoverSessionMock.mockResolvedValue({ success: false, message: 'session exists' })

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.skipped).toBe(1)
            // 失败不删 runtime 文件（保留供下次尝试）
            expect(mocks.runtimePersistenceMock.deleteRuntimeState).not.toHaveBeenCalled()
        })
    })

    describe('防并发', () => {
        it('重复调用同一 workspace → 第二次直接返回 0', async () => {
            mocks.runtimePersistenceMock.listRuntimeFiles.mockResolvedValue([])

            // 第一次调用（未 await，模拟并发）
            const p1 = recoverGraphRuntimeFromDisk(WORKSPACE)
            const p2 = recoverGraphRuntimeFromDisk(WORKSPACE)

            const [r1, r2] = await Promise.all([p1, p2])

            // 第一次正常处理，第二次因防并发跳过
            // 注意：由于 listRuntimeFiles 返回空，第一次也是 recovered=0
            // 关键验证：cleanupOrphanTmp 只调用一次（第二次被防并发跳过）
            expect(mocks.runtimePersistenceMock.cleanupOrphanTmp).toHaveBeenCalledTimes(1)
            // 第二次返回全 0（防并发跳过）
            // 由于并发，第一次可能先完成，第二次被跳过；或相反
            // 至少有一个返回全 0
            const allZero = (r: any) => r.recovered === 0 && r.skipped === 0 && r.failed === 0
            expect(allZero(r1) || allZero(r2)).toBe(true)
        })

        it('不同 workspace 不互相阻塞', async () => {
            mocks.runtimePersistenceMock.listRuntimeFiles.mockResolvedValue([])

            await Promise.all([
                recoverGraphRuntimeFromDisk('/tmp/ws1'),
                recoverGraphRuntimeFromDisk('/tmp/ws2'),
            ])

            // 两个 workspace 都应正常处理
            expect(mocks.runtimePersistenceMock.cleanupOrphanTmp).toHaveBeenCalledTimes(2)
        })
    })

    describe('多文件批量处理', () => {
        it('多个 runtime 文件 → 逐个处理', async () => {
            mocks.runtimePersistenceMock.listRuntimeFiles.mockResolvedValue([
                'plan-1.runtime.json',
                'plan-2.runtime.json',
            ])

            // plan-1 可恢复，plan-2 plan 不存在
            mocks.runtimePersistenceMock.loadRuntimeState.mockImplementation((_ws: string, planId: string) =>
                Promise.resolve(makeRuntimeState({ planId })),
            )
            mocks.storeMock.getPlan.mockImplementation((planId: string) =>
                planId === 'plan-1' ? makePlan({ id: 'plan-1', revision: 5 }) : null,
            )

            const result = await recoverGraphRuntimeFromDisk(WORKSPACE)

            expect(result.recovered).toBe(1) // plan-1 恢复
            expect(result.skipped).toBe(1) // plan-2 plan 不存在
        })
    })

    describe('内部校验函数', () => {
        it('isPlanTerminal: completed → true', () => {
            expect(__testHelpers.isPlanTerminal(makePlan({ status: 'completed' }))).toBe(true)
        })

        it('isPlanTerminal: paused → false', () => {
            expect(__testHelpers.isPlanTerminal(makePlan({ status: 'paused' }))).toBe(false)
        })

        it('validateCheckpointNodes: nodeId 存在 → true', () => {
            const state = {
                checkpoint: { nodeId: 'n2', completedNodes: ['n1'] },
            }
            const plan = makePlan()
            expect(__testHelpers.validateCheckpointNodes(state, plan)).toBe(true)
        })

        it('validateCheckpointNodes: nodeId 不存在 → false', () => {
            const state = {
                checkpoint: { nodeId: 'ghost', completedNodes: ['n1'] },
            }
            const plan = makePlan()
            expect(__testHelpers.validateCheckpointNodes(state, plan)).toBe(false)
        })
    })
})
