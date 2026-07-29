/**
 * Plan 构建器单元测试 —— Graph Runtime 阶段六
 *
 * 验证 buildPlanFromToolArgs：
 * 1. graphVersion=1（无图字段）→ plan 不含 graphVersion/edges
 * 2. graphVersion=2 + edges → plan 含 graphVersion=2、节点带 edges 出边
 * 3. 节点级字段映射（nodeType/maxIterations/reflectionPrompt/toolCall）
 * 4. edges 按 source 分组到节点
 * 5. buildAddedTask（update_task_plan addTasks 用）
 * 6. applyUpdateEdges（update_task_plan updateEdges 用）
 *
 * @module GraphRuntime/planBuilder/test
 */

import { describe, it, expect } from 'vitest'
import {
    buildPlanFromToolArgs,
    buildAddedTask,
    applyUpdateEdges,
    applyGraphFieldsToNode,
    type CreatePlanArgs,
    type PlanTaskArg,
} from '../planBuilder'
import type { PlanTask } from '../../planner/planTypes'
import type { GraphNode } from '../../graph/graphTypes'

// ===== 测试辅助 =====

function makeBasicTaskArg(overrides: Partial<PlanTaskArg> = {}): PlanTaskArg {
    return {
        title: 'Test Task',
        description: 'Test description',
        suggestedProvider: 'anthropic',
        suggestedModel: 'claude-sonnet-4-20250514',
        suggestedRole: 'coder',
        ...overrides,
    }
}

function makeBasicArgs(overrides: Partial<CreatePlanArgs> = {}): CreatePlanArgs {
    return {
        name: 'Test Plan',
        requirementsDoc: '# Requirements\nTest',
        tasks: [makeBasicTaskArg()],
        ...overrides,
    }
}

// ===== 测试套件 =====

describe('Plan Builder (阶段六)', () => {
    describe('buildPlanFromToolArgs - graphVersion=1 默认行为', () => {
        it('不传 graphVersion → plan.graphVersion 为 undefined（静态 DAG）', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs(),
                planId: 'plan-1',
                timestamp: 1700000000000,
            })

            expect(plan.id).toBe('plan-1')
            expect(plan.name).toBe('Test Plan')
            expect(plan.graphVersion).toBeUndefined()
            expect(plan.revision).toBe(1)
            expect(plan.status).toBe('draft')
            expect(plan.tasks).toHaveLength(1)
            expect(plan.tasks[0].id).toBe('task-1')
            expect(plan.tasks[0].provider).toBe('anthropic')
            expect(plan.tasks[0].status).toBe('pending')
        })

        it('graphVersion=1 显式传入 → 仍为 undefined（不激活图能力）', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({ graphVersion: 1 }),
                planId: 'plan-1',
                timestamp: 1700000000000,
            })

            expect(plan.graphVersion).toBeUndefined()
        })

        it('"default" 值的 provider/model/role 转换为真实默认值', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({
                    tasks: [makeBasicTaskArg({
                        suggestedProvider: 'default' as any,
                        suggestedModel: 'Default' as any,
                        suggestedRole: 'default' as any,
                    })],
                }),
                planId: 'plan-1',
                timestamp: 1700000000000,
            })

            expect(plan.tasks[0].provider).toBe('anthropic')
            expect(plan.tasks[0].model).toBe('claude-sonnet-4-20250514')
            expect(plan.tasks[0].role).toBe('coder')
        })
    })

    describe('buildPlanFromToolArgs - graphVersion=2 图计划', () => {
        it('graphVersion=2 → plan.graphVersion=2 + allowDynamicExpansion', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({ graphVersion: 2, allowDynamicExpansion: true }),
                planId: 'plan-graph-1',
                timestamp: 1700000000000,
            })

            expect(plan.graphVersion).toBe(2)
            expect((plan as any).allowDynamicExpansion).toBe(true)
        })

        it('传入 edges 但不传 graphVersion → 自动升级为 graphVersion=2', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({
                    tasks: [
                        makeBasicTaskArg(),
                        makeBasicTaskArg(),
                    ],
                    edges: [
                        { source: 'task-1', target: 'task-2', type: 'simple' },
                    ],
                }),
                planId: 'plan-graph-2',
                timestamp: 1700000000000,
            })

            expect(plan.graphVersion).toBe(2)
        })

        it('任务携带 nodeType → 自动升级为 graphVersion=2', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({
                    tasks: [makeBasicTaskArg({ nodeType: 'llm' })],
                }),
                planId: 'plan-graph-3',
                timestamp: 1700000000000,
            })

            expect(plan.graphVersion).toBe(2)
            const node = plan.tasks[0] as GraphNode
            expect(node.nodeType).toBe('llm')
        })

        it('edges 按 source 分组挂到对应节点', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({
                    graphVersion: 2,
                    tasks: [
                        makeBasicTaskArg(),
                        makeBasicTaskArg(),
                        makeBasicTaskArg(),
                    ],
                    edges: [
                        { source: 'task-1', target: 'task-2', type: 'simple' },
                        { source: 'task-1', target: 'task-3', type: 'conditional', conditionKind: 'rule', conditionExpression: 'node.status === "completed"' },
                        { source: 'task-2', target: 'task-3', type: 'simple' },
                    ],
                }),
                planId: 'plan-graph-4',
                timestamp: 1700000000000,
            })

            const node1 = plan.tasks[0] as GraphNode
            const node2 = plan.tasks[1] as GraphNode
            const node3 = plan.tasks[2] as GraphNode

            // task-1 有 2 条出边
            expect(node1.edges).toHaveLength(2)
            expect(node1.edges![0].target).toBe('task-2')
            expect(node1.edges![1].target).toBe('task-3')
            expect(node1.edges![1].type).toBe('conditional')
            expect(node1.edges![1].condition).toBeDefined()
            expect(node1.edges![1].condition!.kind).toBe('rule')
            expect(node1.edges![1].condition!.expression).toBe('node.status === "completed"')

            // task-2 有 1 条出边
            expect(node2.edges).toHaveLength(1)
            expect(node2.edges![0].target).toBe('task-3')

            // task-3 无出边
            expect(node3.edges).toBeUndefined()
        })

        it('loop 边带 maxIterations', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({
                    graphVersion: 2,
                    tasks: [makeBasicTaskArg()],
                    edges: [
                        { source: 'task-1', target: 'task-1', type: 'loop', maxIterations: 5 },
                    ],
                }),
                planId: 'plan-graph-5',
                timestamp: 1700000000000,
            })

            const node = plan.tasks[0] as GraphNode
            expect(node.edges).toHaveLength(1)
            expect(node.edges![0].type).toBe('loop')
            expect(node.edges![0].maxIterations).toBe(5)
        })
    })

    describe('节点级字段映射', () => {
        it('nodeType/llmPrompt/toolCall/requireApproval 正确映射', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({
                    graphVersion: 2,
                    tasks: [makeBasicTaskArg({
                        nodeType: 'tool',
                        llmPrompt: 'custom prompt',
                        toolCall: { name: 'write_file', arguments: { path: '/tmp/test.txt' } },
                        requireApproval: true,
                        maxIterations: 3,
                        reflectionPrompt: 'fix root cause',
                    })],
                }),
                planId: 'plan-graph-6',
                timestamp: 1700000000000,
            })

            const node = plan.tasks[0] as GraphNode
            expect(node.nodeType).toBe('tool')
            expect(node.llmPrompt).toBe('custom prompt')
            expect(node.toolCall).toEqual({ name: 'write_file', arguments: { path: '/tmp/test.txt' } })
            expect(node.requireApproval).toBe(true)
            expect(node.maxIterations).toBe(3)
            expect((node as any).reflectionPrompt).toBe('fix root cause')
        })

        it('非法 nodeType 值被忽略', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({
                    graphVersion: 2,
                    tasks: [makeBasicTaskArg({ nodeType: 'invalid-type' as any })],
                }),
                planId: 'plan-graph-7',
                timestamp: 1700000000000,
            })

            const node = plan.tasks[0] as GraphNode
            expect(node.nodeType).toBeUndefined()
        })

        it('llm 类型 condition 缺 prompt 时 condition 仍存在但无 prompt', () => {
            const plan = buildPlanFromToolArgs({
                args: makeBasicArgs({
                    graphVersion: 2,
                    tasks: [makeBasicTaskArg(), makeBasicTaskArg()],
                    edges: [
                        { source: 'task-1', target: 'task-2', type: 'conditional', conditionKind: 'llm' },
                    ],
                }),
                planId: 'plan-graph-8',
                timestamp: 1700000000000,
            })

            const node = plan.tasks[0] as GraphNode
            expect(node.edges![0].condition).toBeDefined()
            expect(node.edges![0].condition!.kind).toBe('llm')
            expect(node.edges![0].condition!.prompt).toBeUndefined()
        })
    })

    describe('buildAddedTask - update_task_plan 用', () => {
        it('构建带图字段的 task，id 基于时间戳', () => {
            const task = buildAddedTask(
                makeBasicTaskArg({ nodeType: 'decision', maxIterations: 4 }),
                1700000000000,
                0,
            )

            expect(task.id).toBe('task-1700000000000-0')
            expect(task.status).toBe('pending')
            const node = task as GraphNode
            expect(node.nodeType).toBe('decision')
            expect(node.maxIterations).toBe(4)
        })

        it('不挂载节点级 edges（edges 由 updateEdges 单独处理）', () => {
            const task = buildAddedTask(makeBasicTaskArg(), 1700000000000, 0)
            const node = task as GraphNode
            expect(node.edges).toBeUndefined()
        })
    })

    describe('applyUpdateEdges - update_task_plan 用', () => {
        it('替换现有节点的 edges', () => {
            const tasks: PlanTask[] = [
                { id: 'task-1', title: 'T1', description: '', provider: 'p', model: 'm', role: 'r', dependencies: [], status: 'pending' },
                { id: 'task-2', title: 'T2', description: '', provider: 'p', model: 'm', role: 'r', dependencies: [], status: 'pending' },
            ]

            applyUpdateEdges(tasks, [
                { source: 'task-1', target: 'task-2', type: 'simple' },
            ])

            const node1 = tasks[0] as GraphNode
            const node2 = tasks[1] as GraphNode
            expect(node1.edges).toHaveLength(1)
            expect(node1.edges![0].target).toBe('task-2')
            expect(node2.edges).toBeUndefined()
        })

        it('传入空 edges 数组 → 节点保持原出边（增量更新语义）', () => {
            const tasks: PlanTask[] = [
                { id: 'task-1', title: 'T1', description: '', provider: 'p', model: 'm', role: 'r', dependencies: [], status: 'pending' } as any,
            ]
            ;(tasks[0] as GraphNode).edges = [{ source: 'task-1', target: 'task-2', type: 'simple' }]

            // 传入空 edges 数组：未提供 task-1 的新 edges → 保持原 edges
            applyUpdateEdges(tasks, [])

            const node = tasks[0] as GraphNode
            expect(node.edges).toHaveLength(1)
            expect(node.edges![0].target).toBe('task-2')
        })

        it('非法 edge（target 为空）被 groupEdgesBySource 跳过 → 节点保持原出边', () => {
            const tasks: PlanTask[] = [
                { id: 'task-1', title: 'T1', description: '', provider: 'p', model: 'm', role: 'r', dependencies: [], status: 'pending' } as any,
            ]
            ;(tasks[0] as GraphNode).edges = [{ source: 'task-1', target: 'task-2', type: 'simple' }]

            // target 为空的边被 groupEdgesBySource 跳过（防御性处理非法输入）
            applyUpdateEdges(tasks, [
                { source: 'task-1', target: '', type: 'simple' } as any,
            ])

            const node = tasks[0] as GraphNode
            // source 不在 map 中 → applyUpdateEdges 保持原 edges 不变
            expect(node.edges).toHaveLength(1)
            expect(node.edges![0].target).toBe('task-2')
        })
    })

    describe('applyGraphFieldsToNode', () => {
        it('仅设置传入的字段，缺省字段保持不变', () => {
            const node: GraphNode = {
                id: 'task-1',
                title: 'T1',
                description: '',
                provider: 'p',
                model: 'm',
                role: 'r',
                dependencies: [],
                status: 'pending',
                nodeType: 'task',
                maxIterations: 2,
            } as GraphNode

            applyGraphFieldsToNode(node, {
                title: 'T1',
                description: '',
                maxIterations: 5,
            })

            expect(node.maxIterations).toBe(5)
            expect(node.nodeType).toBe('task') // 保持不变
        })
    })
})
