/**
 * Task 7：LLM Graph Builder 端到端集成测试 —— Graph Runtime 阶段六
 *
 * 验证「LLM 工具参数 → planBuilder 构建 → planValidator 校验 → 可执行 plan」完整链路。
 *
 * 测试策略：
 * - 模拟 LLM 调用 create_task_plan 的真实参数结构（含 graphVersion=2 + edges + nodeType）
 * - 串联 buildPlanFromToolArgs + validatePlan，验证产出 plan 的结构正确性
 * - 验证构建出的 plan 能被图运行时消费（GraphNode/GraphEdge 字段完备）
 * - 覆盖 4 类典型场景：条件路由 / 反思重试 / 人工审批 / 校验拦截
 *
 * 与 e2eGraphRuntime.test.ts 的区别：
 * - e2eGraphRuntime：验证图运行时组件（GraphScheduler/EdgeRouter/NodeExecutor）协作
 * - 本测试：验证 LLM → plan 的转换链路（planBuilder + planValidator），不启动真实图执行
 *
 * @module GraphRuntime
 */

import { describe, it, expect } from 'vitest'
import { buildPlanFromToolArgs, type CreatePlanArgs } from '../../toolkit/planBuilder'
import { validatePlan, formatValidationIssues } from '../../planner/planValidator'
import type { TaskPlan } from '../../planner/planTypes'
import type { GraphNode } from '../graphTypes'
import { isGraphNode, asExecutionGraph } from '../graphTypes'

// ============================================
// 模拟 LLM 工具参数构造器
// ============================================

/**
 * 模拟 LLM 调用 create_task_plan 时构造的参数
 * 还原真实场景下 LLM 根据 prompt 指引生成的结构
 */
function llmCreatePlanArgs(overrides: Partial<CreatePlanArgs> = {}): CreatePlanArgs {
    return {
        name: 'LLM Generated Plan',
        requirementsDoc: '# Requirements\nImplement feature X with retry and approval',
        executionMode: 'sequential',
        tasks: [],
        ...overrides,
    }
}

/**
 * 从 plan 中按 id 取节点（GraphNode 视图）
 */
function getNode(plan: TaskPlan, id: string): GraphNode {
    const node = plan.tasks.find(t => t.id === id)
    if (!node) throw new Error(`Node ${id} not found in plan`)
    return node as GraphNode
}

// ============================================
// 端到端测试套件
// ============================================

describe('Task 7: LLM Graph Builder 端到端', () => {
    const TIMESTAMP = 1700000000000
    const PLAN_ID = 'plan-e2e-1'

    describe('场景一：条件路由 plan（graphVersion=2 + conditional edges）', () => {
        it('LLM 生成条件路由 plan → 构建 + 校验通过 → 节点结构完备', () => {
            // 模拟 LLM 生成的参数：task-1 完成后根据条件路由到 task-2 或 task-3
            const args = llmCreatePlanArgs({
                name: 'Conditional Routing Plan',
                graphVersion: 2,
                tasks: [
                    {
                        title: 'Analyze input',
                        description: '分析输入数据特征',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                        nodeType: 'llm',
                        llmPrompt: 'Analyze the input and classify it',
                    },
                    {
                        title: 'Handle case A',
                        description: '处理情况 A',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                    },
                    {
                        title: 'Handle case B',
                        description: '处理情况 B',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                    },
                ],
                edges: [
                    {
                        source: 'task-1',
                        target: 'task-2',
                        type: 'conditional',
                        conditionKind: 'rule',
                        conditionExpression: 'node.output.includes("case-a")',
                    },
                    {
                        source: 'task-1',
                        target: 'task-3',
                        type: 'conditional',
                        conditionKind: 'llm',
                        conditionPrompt: 'Does the output indicate case B?',
                    },
                ],
            })

            // Step 1: planBuilder 构建
            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })

            // Step 2: planValidator 校验
            const validation = validatePlan(plan)
            expect(validation.valid).toBe(true)
            expect(validation.issues.filter(i => i.severity === 'error')).toHaveLength(0)

            // Step 3: 结构完备性验证（可被图运行时消费）
            expect(plan.graphVersion).toBe(2)
            expect(plan.id).toBe(PLAN_ID)
            expect(plan.tasks).toHaveLength(3)

            // task-1 是 llm 节点，带 2 条 conditional 出边
            const node1 = getNode(plan, 'task-1')
            expect(isGraphNode(node1)).toBe(true)
            expect(node1.nodeType).toBe('llm')
            expect(node1.llmPrompt).toBe('Analyze the input and classify it')
            expect(node1.edges).toHaveLength(2)
            expect(node1.edges![0].type).toBe('conditional')
            expect(node1.edges![0].condition?.kind).toBe('rule')
            expect(node1.edges![0].condition?.expression).toBe('node.output.includes("case-a")')
            expect(node1.edges![1].type).toBe('conditional')
            expect(node1.edges![1].condition?.kind).toBe('llm')
            expect(node1.edges![1].condition?.prompt).toBe('Does the output indicate case B?')

            // task-2 / task-3 是普通 task 节点，无出边
            const node2 = getNode(plan, 'task-2')
            const node3 = getNode(plan, 'task-3')
            expect(node2.nodeType).toBeUndefined()
            expect(node2.edges).toBeUndefined()
            expect(node3.edges).toBeUndefined()
        })

        it('ExecutionGraph 视图转换正确（asExecutionGraph）', () => {
            const args = llmCreatePlanArgs({
                graphVersion: 2,
                allowDynamicExpansion: true,
                tasks: [
                    { title: 'T1', description: 'd1', suggestedProvider: 'default', suggestedRole: 'default' },
                    { title: 'T2', description: 'd2', suggestedProvider: 'default', suggestedRole: 'default' },
                ],
                edges: [{ source: 'task-1', target: 'task-2', type: 'simple' }],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            const graph = asExecutionGraph(plan)

            expect(graph.graphVersion).toBe(2)
            expect(graph.allowDynamicExpansion).toBe(true)
            expect(graph.tasks).toHaveLength(2)
        })
    })

    describe('场景二：反思重试 plan（loop + maxIterations + reflectionPrompt）', () => {
        it('LLM 生成自重试 plan → 构建校验通过 → loop 边结构正确', () => {
            const args = llmCreatePlanArgs({
                name: 'Retry Loop Plan',
                graphVersion: 2,
                tasks: [
                    {
                        title: 'Implement and test',
                        description: '实现核心逻辑并运行测试，失败则反思重试',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                        nodeType: 'task',
                        maxIterations: 3,
                        reflectionPrompt: 'If tests fail, analyze the root cause and fix it differently',
                    },
                ],
                edges: [
                    { source: 'task-1', target: 'task-1', type: 'loop', maxIterations: 3 },
                ],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            const validation = validatePlan(plan)

            expect(validation.valid).toBe(true)
            // loop 边有 maxIterations（边级 + 节点级都有），不应有 warning
            const loopWarnings = validation.issues.filter(i => i.code === 'LOOP_EDGE_NO_MAX_ITERATIONS')
            expect(loopWarnings).toHaveLength(0)

            // 验证 loop 边结构
            const node1 = getNode(plan, 'task-1')
            expect(node1.edges).toHaveLength(1)
            expect(node1.edges![0].type).toBe('loop')
            expect(node1.edges![0].target).toBe('task-1') // 自环
            expect(node1.edges![0].maxIterations).toBe(3)
            expect(node1.maxIterations).toBe(3)
            expect((node1 as GraphNode & { reflectionPrompt?: string }).reflectionPrompt)
                .toBe('If tests fail, analyze the root cause and fix it differently')
        })

        it('loop 边无 maxIterations 且节点也无 → warning 但不阻断', () => {
            const args = llmCreatePlanArgs({
                graphVersion: 2,
                tasks: [
                    { title: 'T1', description: 'd1', suggestedProvider: 'default', suggestedRole: 'default' },
                ],
                edges: [{ source: 'task-1', target: 'task-1', type: 'loop' }],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            const validation = validatePlan(plan)

            // warning 不阻断
            expect(validation.valid).toBe(true)
            const warnings = validation.issues.filter(i => i.code === 'LOOP_EDGE_NO_MAX_ITERATIONS')
            expect(warnings).toHaveLength(1)
            expect(warnings[0].severity).toBe('warning')
        })
    })

    describe('场景三：人工审批 plan（human node + requireApproval）', () => {
        it('LLM 生成含 human 审批节点的 plan → 构建校验通过', () => {
            const args = llmCreatePlanArgs({
                name: 'Human Approval Plan',
                graphVersion: 2,
                tasks: [
                    {
                        title: 'Draft proposal',
                        description: '起草方案',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                    },
                    {
                        title: 'User approval gate',
                        description: '等待用户审批方案',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                        nodeType: 'human',
                        requireApproval: true,
                    },
                    {
                        title: 'Execute approved plan',
                        description: '执行已审批的方案',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                    },
                ],
                edges: [
                    { source: 'task-1', target: 'task-2', type: 'simple' },
                    { source: 'task-2', target: 'task-3', type: 'simple' },
                ],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            const validation = validatePlan(plan)

            expect(validation.valid).toBe(true)
            expect(validation.issues).toHaveLength(0)

            // human 节点结构验证
            const humanNode = getNode(plan, 'task-2')
            expect(humanNode.nodeType).toBe('human')
            expect(humanNode.requireApproval).toBe(true)
            expect(humanNode.edges).toHaveLength(1)
            expect(humanNode.edges![0].target).toBe('task-3')
        })

        it('requireApproval=true 但 nodeType 缺省 → 仍校验通过（视为 task 节点强制审批）', () => {
            const args = llmCreatePlanArgs({
                graphVersion: 2,
                tasks: [
                    {
                        title: 'Critical operation',
                        description: '危险操作需审批',
                        suggestedProvider: 'default',
                        suggestedRole: 'default',
                        requireApproval: true,
                    },
                ],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            const validation = validatePlan(plan)

            // requireApproval 不会触发 graphVersion=2（不在 shouldBuildGraphPlan 触发列表）
            // 但显式传了 graphVersion=2 所以仍为图计划
            expect(plan.graphVersion).toBe(2)
            expect(validation.valid).toBe(true)

            const node = getNode(plan, 'task-1')
            expect(node.requireApproval).toBe(true)
        })
    })

    describe('场景四：校验拦截（LLM 生成非法 plan）', () => {
        it('条件边无 condition → 校验失败 + 错误信息可读', () => {
            const args = llmCreatePlanArgs({
                graphVersion: 2,
                tasks: [
                    { title: 'T1', description: 'd1', suggestedProvider: 'default', suggestedRole: 'default' },
                    { title: 'T2', description: 'd2', suggestedProvider: 'default', suggestedRole: 'default' },
                ],
                edges: [
                    // conditional 边但漏了 conditionKind/conditionExpression
                    { source: 'task-1', target: 'task-2', type: 'conditional' },
                ],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            const validation = validatePlan(plan)

            expect(validation.valid).toBe(false)
            expect(validation.issues).toContainEqual(expect.objectContaining({
                severity: 'error',
                code: 'CONDITIONAL_EDGE_MISSING_CONDITION',
            }))

            // 错误信息格式化可读
            const formatted = formatValidationIssues(validation)
            expect(formatted).toContain('❌')
            expect(formatted).toContain('CONDITIONAL_EDGE_MISSING_CONDITION')
        })

        it('edge target 悬空 → 校验失败', () => {
            const args = llmCreatePlanArgs({
                graphVersion: 2,
                tasks: [
                    { title: 'T1', description: 'd1', suggestedProvider: 'default', suggestedRole: 'default' },
                ],
                edges: [
                    { source: 'task-1', target: 'task-99', type: 'simple' },
                ],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            const validation = validatePlan(plan)

            expect(validation.valid).toBe(false)
            expect(validation.issues).toContainEqual(expect.objectContaining({
                code: 'EDGE_TARGET_NOT_FOUND',
                ref: 'task-99',
            }))
        })

        it('tool 节点无 toolCall → 校验失败', () => {
            const args = llmCreatePlanArgs({
                graphVersion: 2,
                tasks: [
                    {
                        title: 'Run tool',
                        description: '直接执行工具',
                        suggestedProvider: 'default',
                        suggestedRole: 'default',
                        nodeType: 'tool',
                        // 漏了 toolCall
                    },
                ],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            const validation = validatePlan(plan)

            expect(validation.valid).toBe(false)
            expect(validation.issues).toContainEqual(expect.objectContaining({
                code: 'TOOL_NODE_MISSING_TOOLCALL',
                ref: 'task-1',
            }))
        })

        it('graphVersion=2 但 tasks 为空 → 校验失败', () => {
            const args = llmCreatePlanArgs({
                graphVersion: 2,
                tasks: [],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            const validation = validatePlan(plan)

            expect(validation.valid).toBe(false)
            expect(validation.issues).toContainEqual(expect.objectContaining({
                code: 'EMPTY_TASKS',
            }))
        })
    })

    describe('场景五：graphVersion=1 兼容性（LLM 未使用图能力）', () => {
        it('LLM 生成传统 plan（无 graphVersion/edges/nodeType）→ 静态 DAG，校验跳过', () => {
            const args = llmCreatePlanArgs({
                name: 'Legacy Plan',
                // 不传 graphVersion、edges、nodeType
                tasks: [
                    {
                        title: 'Task A',
                        description: '普通任务',
                        suggestedProvider: 'default',
                        suggestedRole: 'default',
                        dependencies: [],
                    },
                    {
                        title: 'Task B',
                        description: '依赖 A 的任务',
                        suggestedProvider: 'default',
                        suggestedRole: 'default',
                        dependencies: ['task-1'],
                    },
                ],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })

            // graphVersion 未激活
            expect(plan.graphVersion).toBeUndefined()

            // 校验器对 graphVersion=1 跳过（零破坏）
            const validation = validatePlan(plan)
            expect(validation.valid).toBe(true)
            expect(validation.issues).toHaveLength(0)

            // 节点不带任何图扩展字段
            const node1 = getNode(plan, 'task-1')
            expect(isGraphNode(node1)).toBe(false)
            expect(node1.edges).toBeUndefined()
            expect(node1.nodeType).toBeUndefined()

            // 依赖关系保留（现有拓扑推进行为）
            expect(plan.tasks[1].dependencies).toEqual(['task-1'])
        })

        it('graphVersion=1 显式传入 → 仍不激活图能力（向后兼容）', () => {
            const args = llmCreatePlanArgs({
                graphVersion: 1,
                tasks: [
                    { title: 'T1', description: 'd1', suggestedProvider: 'default', suggestedRole: 'default' },
                ],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            expect(plan.graphVersion).toBeUndefined()

            const validation = validatePlan(plan)
            expect(validation.valid).toBe(true)
        })
    })

    describe('场景六：增量增强触发判定（shouldBuildGraphPlan 隐式升级）', () => {
        it('仅传 edges 不传 graphVersion → 自动升级 graphVersion=2', () => {
            const args = llmCreatePlanArgs({
                tasks: [
                    { title: 'T1', description: 'd1', suggestedProvider: 'default', suggestedRole: 'default' },
                    { title: 'T2', description: 'd2', suggestedProvider: 'default', suggestedRole: 'default' },
                ],
                edges: [{ source: 'task-1', target: 'task-2', type: 'simple' }],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            expect(plan.graphVersion).toBe(2)

            const validation = validatePlan(plan)
            expect(validation.valid).toBe(true)
        })

        it('仅传 nodeType 不传 graphVersion → 自动升级 graphVersion=2', () => {
            const args = llmCreatePlanArgs({
                tasks: [
                    {
                        title: 'T1',
                        description: 'd1',
                        suggestedProvider: 'default',
                        suggestedRole: 'default',
                        nodeType: 'decision',
                    },
                ],
            })

            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })
            expect(plan.graphVersion).toBe(2)

            const node = getNode(plan, 'task-1')
            expect(node.nodeType).toBe('decision')
        })
    })

    describe('端到端：完整 plan 生命周期模拟', () => {
        it('LLM 生成 → 构建 → 校验 → ExecutionGraph 视图 → 字段完备性', () => {
            // 模拟一个真实复杂场景：分析 → 决策（条件路由）→ 实施（含重试）→ 审批 → 完成
            const args = llmCreatePlanArgs({
                name: 'Full Lifecycle Plan',
                graphVersion: 2,
                allowDynamicExpansion: true,
                executionMode: 'sequential',
                tasks: [
                    {
                        title: 'Analyze requirements',
                        description: '分析需求',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                        nodeType: 'llm',
                        llmPrompt: 'Analyze the requirements and output a plan summary',
                    },
                    {
                        title: 'Route decision',
                        description: '根据分析结果路由',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                        nodeType: 'decision',
                    },
                    {
                        title: 'Implement with retry',
                        description: '实现并重试',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                        nodeType: 'task',
                        maxIterations: 3,
                        reflectionPrompt: 'Fix root cause on failure',
                    },
                    {
                        title: 'User approval',
                        description: '用户审批',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                        nodeType: 'human',
                        requireApproval: true,
                    },
                    {
                        title: 'Finalize',
                        description: '完成',
                        suggestedProvider: 'anthropic',
                        suggestedModel: 'claude-sonnet-4-20250514',
                        suggestedRole: 'coder',
                    },
                ],
                edges: [
                    // task-1 (llm) → task-2 (decision)
                    { source: 'task-1', target: 'task-2', type: 'simple' },
                    // task-2 (decision) → 条件路由到 task-3 或 task-5
                    {
                        source: 'task-2',
                        target: 'task-3',
                        type: 'conditional',
                        conditionKind: 'rule',
                        conditionExpression: 'node.output.includes("implement")',
                    },
                    {
                        source: 'task-2',
                        target: 'task-5',
                        type: 'conditional',
                        conditionKind: 'llm',
                        conditionPrompt: 'Should we skip implementation?',
                    },
                    // task-3 (task) → 自重试 loop
                    { source: 'task-3', target: 'task-3', type: 'loop', maxIterations: 3 },
                    // task-3 → task-4 (human approval)
                    { source: 'task-3', target: 'task-4', type: 'simple' },
                    // task-4 → task-5
                    { source: 'task-4', target: 'task-5', type: 'simple' },
                ],
            })

            // Step 1: 构建
            const plan = buildPlanFromToolArgs({ args, planId: PLAN_ID, timestamp: TIMESTAMP })

            // Step 2: 校验
            const validation = validatePlan(plan)
            if (!validation.valid) {
                throw new Error(`Plan validation failed:\n${formatValidationIssues(validation)}`)
            }
            expect(validation.valid).toBe(true)

            // Step 3: ExecutionGraph 视图
            const graph = asExecutionGraph(plan)
            expect(graph.graphVersion).toBe(2)
            expect(graph.allowDynamicExpansion).toBe(true)
            expect(graph.tasks).toHaveLength(5)

            // Step 4: 逐节点字段完备性
            const n1 = getNode(plan, 'task-1')
            expect(n1.nodeType).toBe('llm')
            expect(n1.llmPrompt).toBeDefined()
            expect(n1.edges).toHaveLength(1)

            const n2 = getNode(plan, 'task-2')
            expect(n2.nodeType).toBe('decision')
            expect(n2.edges).toHaveLength(2) // 2 条 conditional
            expect(n2.edges!.every(e => e.type === 'conditional')).toBe(true)

            const n3 = getNode(plan, 'task-3')
            expect(n3.nodeType).toBe('task')
            expect(n3.maxIterations).toBe(3)
            expect(n3.edges).toHaveLength(2) // loop + simple
            const loopEdge = n3.edges!.find(e => e.type === 'loop')
            const simpleEdge = n3.edges!.find(e => e.type === 'simple')
            expect(loopEdge).toBeDefined()
            expect(loopEdge!.target).toBe('task-3')
            expect(loopEdge!.maxIterations).toBe(3)
            expect(simpleEdge).toBeDefined()
            expect(simpleEdge!.target).toBe('task-4')

            const n4 = getNode(plan, 'task-4')
            expect(n4.nodeType).toBe('human')
            expect(n4.requireApproval).toBe(true)
            expect(n4.edges).toHaveLength(1)

            const n5 = getNode(plan, 'task-5')
            expect(n5.nodeType).toBeUndefined()
            expect(n5.edges).toBeUndefined()

            // Step 5: plan 基础字段完备
            expect(plan.id).toBe(PLAN_ID)
            expect(plan.name).toBe('Full Lifecycle Plan')
            expect(plan.revision).toBe(1)
            expect(plan.status).toBe('draft')
            expect(plan.createdAt).toBe(TIMESTAMP)
            expect(plan.updatedAt).toBe(TIMESTAMP)
        })
    })
})
