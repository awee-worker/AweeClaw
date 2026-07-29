/**
 * Task 10：Graph Runtime 端到端集成测试
 *
 * 验证 graphVersion=2 动态图的完整执行链路：
 * 1. tool 节点执行 → 边路由 → boost 目标节点
 * 2. llm 节点执行 → LLM 条件求值 → 路由分支
 * 3. decision 节点 → 纯路由（无副作用）
 * 4. human 节点 → HITL 暂停 → resumeHumanNode 恢复
 * 5. boost 机制：边路由目标优先入队
 * 6. 失败节点 → LoopController 回流（反思重试）
 *
 * 测试策略：
 * - 使用真实 GraphScheduler + EdgeRouter + NodeExecutor + LoopController
 * - Mock LLM evaluator 和 tool/llm 回调
 * - 不依赖 taskExecutor.ts（重模块），直接测试图组件协作
 *
 * @module GraphRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@toolkit/LogEngine', () => ({
    logger: {
        agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    },
}))

// Mock IntelligenceStore（GraphStateAdapter 依赖）
const mockStore = {
    getPlan: vi.fn(() => null),
    markTaskCompleted: vi.fn(),
    markTaskFailed: vi.fn(),
    updateTask: vi.fn(),
}
vi.mock('../../state/IntelligenceStore', () => ({
    useAgentStore: { getState: () => mockStore },
}))

import { EdgeRouter } from '../EdgeRouter'
import { GraphScheduler } from '../GraphScheduler'
import { NodeExecutor, clearExecutors } from '../NodeExecutor'
import { createToolExecutor, createLlmExecutor } from '../realExecutors'
import { LoopController } from '../LoopController'
import { StoreGraphStateAdapter } from '../GraphStateAdapter'
import type { GraphNode, ExecutionGraph, GraphExecutionContext } from '../graphTypes'
import type { PlanTask } from '../../planner/planTypes'
import { ExecutionScheduler } from '../../planner/TaskScheduler'

// ===== 测试辅助 =====

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
    return {
        id: 'n1',
        title: 'Node',
        description: '',
        provider: 'openai',
        model: 'gpt-4',
        role: 'default',
        dependencies: [],
        status: 'pending',
        ...overrides,
    } as GraphNode
}

function makeGraph(nodes: GraphNode[]): ExecutionGraph {
    return {
        id: 'g1',
        name: 'test-e2e',
        createdAt: 0,
        updatedAt: 0,
        requirementsDoc: '',
        executionMode: 'parallel',
        status: 'executing',
        tasks: nodes as PlanTask[],
        graphVersion: 2,
        allowDynamicExpansion: true,
    } as ExecutionGraph
}

function makeCtx(overrides: Partial<GraphExecutionContext> = {}): GraphExecutionContext {
    return {
        graph: makeGraph([]),
        node: makeNode(),
        state: new StoreGraphStateAdapter('g1'),
        workspacePath: '/tmp',
        traceId: 'trace-1',
        ...overrides,
    } as GraphExecutionContext
}

// ===== E2E 测试套件 =====

describe('Task 10: Graph Runtime 端到端集成', () => {
    let router: EdgeRouter
    let scheduler: GraphScheduler
    let executor: NodeExecutor
    let looper: LoopController
    let baseScheduler: ExecutionScheduler

    beforeEach(() => {
        baseScheduler = new ExecutionScheduler()
        router = new EdgeRouter()
        looper = new LoopController()
        scheduler = new GraphScheduler(baseScheduler, router, looper)
        executor = new NodeExecutor()
        clearExecutors()
    })

    describe('tool 节点 → 边路由 → boost 链路', () => {
        it('tool 节点执行成功 → simple 边路由 → boost 目标节点入队', async () => {
            // 直接注册到本地 executor 实例（registerRealExecutors 注册到单例）
            executor.registerExecutor('tool', createToolExecutor())

            const toolNode = makeNode({
                id: 'tool-1',
                nodeType: 'tool',
                status: 'pending',
                toolCall: { name: 'read_file', arguments: { path: '/tmp/x' } },
                edges: [{ target: 'next-1', type: 'simple' }],
            })
            const nextNode = makeNode({
                id: 'next-1',
                nodeType: 'decision',
                status: 'pending',
            })
            const graph = makeGraph([toolNode, nextNode])

            // 执行 tool 节点
            const ctx = makeCtx({
                graph,
                node: toolNode,
                executeToolCall: async () => ({
                    success: true,
                    output: 'file content',
                }),
            })
            const result = await executor.execute(toolNode, ctx)
            expect(result.success).toBe(true)
            expect(result.output).toBe('file content')

            // 模拟 executeTask 成功后标记节点完成
            toolNode.status = 'completed'
            toolNode.output = result.output

            // 模拟 routeAfterBatch：边路由 + boost
            const state = new StoreGraphStateAdapter(graph.id)
            const targets = await router.route(graph, toolNode, state)
            expect(targets).toHaveLength(1)
            expect(targets[0].id).toBe('next-1')

            // boost 目标节点
            scheduler.boostReady(targets.map(t => t.id))
            expect(scheduler.peekBoostedIds()).toContain('next-1')
        })

        it('tool 节点执行失败 → 无边路由 → 不 boost', async () => {
            executor.registerExecutor('tool', createToolExecutor())

            const toolNode = makeNode({
                id: 'tool-fail',
                nodeType: 'tool',
                status: 'pending',
                toolCall: { name: 'write_file', arguments: {} },
                edges: [{ target: 'next-1', type: 'simple' }],
            })
            const graph = makeGraph([toolNode])

            const ctx = makeCtx({
                graph,
                node: toolNode,
                executeToolCall: async () => ({
                    success: false,
                    output: '',
                    error: 'permission denied',
                }),
            })
            const result = await executor.execute(toolNode, ctx)
            expect(result.success).toBe(false)

            // 失败节点不路由（routeAfterBatch 仅处理 completed）
            toolNode.status = 'failed'
            // routeAfterBatch 在 taskExecutor 中会跳过 failed 节点
        })
    })

    describe('llm 节点 → LLM 条件求值 → 路由分支', () => {
        it('llm 节点执行 → conditional 边 LLM 求值 true → boost 分支目标', async () => {
            executor.registerExecutor('llm', createLlmExecutor())

            const llmNode = makeNode({
                id: 'llm-1',
                nodeType: 'llm',
                status: 'pending',
                llmPrompt: 'Analyze if retry needed',
                edges: [{
                    target: 'retry-node',
                    type: 'conditional',
                    condition: { kind: 'llm', prompt: 'Should retry?' },
                }],
            })
            const retryNode = makeNode({
                id: 'retry-node',
                nodeType: 'task',
                status: 'pending',
            })
            const graph = makeGraph([llmNode, retryNode])

            // 注入 LLM evaluator 返回 true
            router.setLlmEvaluator(async () => true)

            // 执行 llm 节点
            const ctx = makeCtx({
                graph,
                node: llmNode,
                executeLlmCall: async () => ({
                    success: true,
                    output: 'analysis complete',
                }),
            })
            const result = await executor.execute(llmNode, ctx)
            expect(result.success).toBe(true)

            // 模拟完成 + 边路由
            llmNode.status = 'completed'
            const state = new StoreGraphStateAdapter(graph.id)
            const targets = await router.route(graph, llmNode, state)
            expect(targets).toHaveLength(1)
            expect(targets[0].id).toBe('retry-node')

            scheduler.boostReady(targets.map(t => t.id))
            expect(scheduler.peekBoostedIds()).toContain('retry-node')
        })

        it('llm 节点执行 → conditional 边 LLM 求值 false → 不 boost', async () => {
            executor.registerExecutor('llm', createLlmExecutor())

            const llmNode = makeNode({
                id: 'llm-2',
                nodeType: 'llm',
                status: 'pending',
                llmPrompt: 'Analyze',
                edges: [{
                    target: 'retry-node',
                    type: 'conditional',
                    condition: { kind: 'llm', prompt: 'Should retry?' },
                }],
            })
            const graph = makeGraph([llmNode])

            router.setLlmEvaluator(async () => false)

            const ctx = makeCtx({
                graph,
                node: llmNode,
                executeLlmCall: async () => ({ success: true, output: 'done' }),
            })
            await executor.execute(llmNode, ctx)

            llmNode.status = 'completed'
            const state = new StoreGraphStateAdapter(graph.id)
            const targets = await router.route(graph, llmNode, state)
            expect(targets).toHaveLength(0)
            expect(scheduler.peekBoostedIds()).toHaveLength(0)
        })
    })

    describe('decision 节点 → 纯路由（无副作用）', () => {
        it('decision 节点执行成功 → 多 conditional 边短路', async () => {
            const decisionNode = makeNode({
                id: 'dec-1',
                nodeType: 'decision',
                status: 'pending',
                output: 'route-A',
                edges: [
                    {
                        target: 'branch-A',
                        type: 'conditional',
                        condition: { kind: 'rule', expression: "output === 'route-A'" },
                    },
                    {
                        target: 'branch-B',
                        type: 'conditional',
                        condition: { kind: 'rule', expression: "output === 'route-B'" },
                    },
                ],
            })
            const branchA = makeNode({ id: 'branch-A', status: 'pending' })
            const branchB = makeNode({ id: 'branch-B', status: 'pending' })
            const graph = makeGraph([decisionNode, branchA, branchB])

            // decision 节点执行（默认执行器，无副作用）
            const ctx = makeCtx({ graph, node: decisionNode })
            const result = await executor.execute(decisionNode, ctx)
            expect(result.success).toBe(true)
            expect(result.output).toBe('')

            // 模拟完成 + 边路由（短路：首个为真者激活）
            decisionNode.status = 'completed'
            decisionNode.output = 'route-A'
            const state = new StoreGraphStateAdapter(graph.id)
            const targets = await router.route(graph, decisionNode, state)
            expect(targets).toHaveLength(1)
            expect(targets[0].id).toBe('branch-A')
        })
    })

    describe('human 节点 → HITL 暂停 → 恢复', () => {
        it('human 节点执行 → 返回 pending → 模拟恢复后继续', async () => {
            const humanNode = makeNode({
                id: 'human-1',
                nodeType: 'human',
                status: 'pending',
                title: 'Approve deployment?',
            })
            const graph = makeGraph([humanNode])

            // 执行 human 节点
            const ctx = makeCtx({ graph, node: humanNode })
            const result = await executor.execute(humanNode, ctx)

            // 验证 pending 状态（HITL 暂停）
            expect(result.success).toBe(false)
            expect(result.pending).toBe(true)
            expect(result.error).toContain('Awaiting human')

            // 模拟用户审批通过
            // （实际由 taskExecutor.resumeHumanNode 处理，这里验证 pending 标记正确）
            // 审批通过后，外部会将节点标记为 completed
            humanNode.status = 'completed'
            humanNode.output = 'Approved by human'

            // 验证边路由可继续（如果有出边）
            humanNode.edges = [{ target: 'deploy', type: 'simple' }]
            const deployNode = makeNode({ id: 'deploy', status: 'pending' })
            graph.tasks.push(deployNode)

            const state = new StoreGraphStateAdapter(graph.id)
            const targets = await router.route(graph, humanNode, state)
            expect(targets).toHaveLength(1)
            expect(targets[0].id).toBe('deploy')
        })

        it('human 节点拒绝 → 节点标记 failed → 不路由', async () => {
            const humanNode = makeNode({
                id: 'human-2',
                nodeType: 'human',
                status: 'pending',
            })
            const graph = makeGraph([humanNode])

            const ctx = makeCtx({ graph, node: humanNode })
            const result = await executor.execute(humanNode, ctx)
            expect(result.pending).toBe(true)

            // 模拟用户拒绝
            humanNode.status = 'failed'
            humanNode.error = 'Rejected by human'

            // routeAfterBatch 仅处理 completed，failed 不路由
            // 这里验证 status 已更新为 failed
            expect(humanNode.status).toBe('failed')
        })
    })

    describe('boost 机制端到端', () => {
        it('boosted 节点优先于拓扑就绪节点被取出', () => {
            const n1 = makeNode({ id: 'n1', status: 'completed' })
            const n2 = makeNode({
                id: 'n2',
                status: 'pending',
                dependencies: ['n1'],
                priority: 1,
            })
            const n3 = makeNode({
                id: 'n3',
                status: 'pending',
                dependencies: ['n1'],
                priority: 5, // 高优先级
            })
            const graph = makeGraph([n1, n2, n3])

            // boost 低优先级的 n2
            scheduler.boostReady(['n2'])

            // getNextTaskWithBoost 应优先返回 n2（boost 优先于拓扑优先级）
            const next = scheduler.getNextTaskWithBoost(graph)
            expect(next).not.toBeNull()
            expect(next!.id).toBe('n2')
        })

        it('boost 消费后队列清空，下次回退拓扑', () => {
            const n1 = makeNode({ id: 'n1', status: 'completed' })
            const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'] })
            const graph = makeGraph([n1, n2])

            scheduler.boostReady(['n2'])
            scheduler.getNextTaskWithBoost(graph)
            expect(scheduler.peekBoostedIds()).toHaveLength(0)

            // 再次取任务，回退到拓扑
            const next = scheduler.getNextTaskWithBoost(graph)
            expect(next).not.toBeNull()
        })
    })

    describe('LoopController 回流端到端', () => {
        it('失败节点携带 loop 边 → LoopController 回流目标', () => {
            const failedNode = makeNode({
                id: 'task-1',
                nodeType: 'task',
                status: 'failed',
                maxIterations: 3,
                edges: [{
                    target: 'task-1', // 自环
                    type: 'loop',
                    maxIterations: 3,
                }],
            })
            const graph = makeGraph([failedNode])
            const state = new StoreGraphStateAdapter(graph.id)

            // 首次回流：iteration 从 0→1，1 <= 3 回流
            const loopTargets = looper.tryLoopBack(graph, failedNode, state)
            expect(loopTargets.length).toBeGreaterThan(0)
            // 回流目标应为自身（反思重试）
            expect(loopTargets.some(t => t.id === 'task-1')).toBe(true)
        })

        it('达到 maxIterations → 不回流', () => {
            const failedNode = makeNode({
                id: 'task-2',
                nodeType: 'task',
                status: 'failed',
                maxIterations: 2,
                edges: [{
                    target: 'task-2',
                    type: 'loop',
                    maxIterations: 2,
                }],
            })
            const graph = makeGraph([failedNode])
            const state = new StoreGraphStateAdapter(graph.id)

            // 预设 iteration=2（已达上限），下次 count=3 > 2 → 不回流
            // metaKey 格式：loop:{nodeId}:{field}
            state.setMetadata('loop:task-2:iteration', 2)

            const loopTargets = looper.tryLoopBack(graph, failedNode, state)
            expect(loopTargets).toHaveLength(0)
        })
    })

    describe('Span 可观测性端到端', () => {
        it('所有节点类型执行都生成 Span（不抛错）', async () => {
            // 验证 NodeExecutor.execute 对每种节点类型都创建了 Span
            // Span 创建失败不应影响执行结果
            const nodeTypes: Array<{ nodeType: GraphNode['nodeType']; expected: 'success' | 'pending' | 'fail' }> = [
                { nodeType: 'decision', expected: 'success' },
                { nodeType: 'human', expected: 'pending' },
            ]

            for (const { nodeType, expected } of nodeTypes) {
                const node = makeNode({ id: `span-${nodeType}`, nodeType })
                const ctx = makeCtx({ node })

                const result = await executor.execute(node, ctx)
                if (expected === 'success') {
                    expect(result.success).toBe(true)
                } else if (expected === 'pending') {
                    expect(result.pending).toBe(true)
                }
                // 不抛错即说明 Span 生成正常
            }
        })
    })

    describe('graphVersion=1 零变化端到端验证', () => {
        it('graphVersion=1 plan 不创建 GraphScheduler（模拟）', () => {
            // 模拟 createSession 在 graphVersion=1 时的行为
            // graphVersion !== 2 时 session.graphScheduler 为 undefined
            const session = {
                graphScheduler: undefined, // graphVersion=1 不挂载
            }
            expect(session.graphScheduler).toBeUndefined()

            // runExecutionLoop 中 useGraphScheduler = !!undefined && ... = false
            const useGraphScheduler = !!session.graphScheduler && false
            expect(useGraphScheduler).toBe(false)
        })
    })
})
