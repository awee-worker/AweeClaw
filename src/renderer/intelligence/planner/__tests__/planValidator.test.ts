/**
 * Plan 校验器单元测试 —— Graph Runtime 阶段六
 *
 * 验证 validatePlan：
 * 1. graphVersion=1 → 跳过校验
 * 2. 有效 graphVersion=2 → 通过
 * 3. 悬空 target → error
 * 4. conditional 无 condition → error
 * 5. rule condition 无 expression → error
 * 6. llm condition 无 prompt → error
 * 7. tool 节点无 toolCall → error
 * 8. loop 边无 maxIterations → warning（不阻断）
 * 9. formatValidationIssues 格式化输出
 *
 * @module GraphRuntime/planValidator/test
 */

import { describe, it, expect } from 'vitest'
import { validatePlan, formatValidationIssues } from '../planValidator'
import type { TaskPlan, PlanTask } from '../planTypes'
import type { GraphNode } from '../../graph/graphTypes'

// ===== 测试辅助 =====

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
    return {
        id: 'task-1',
        title: 'Task 1',
        description: 'desc',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        role: 'coder',
        dependencies: [],
        status: 'pending',
        ...overrides,
    }
}

function makeGraphPlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
    return {
        id: 'plan-1',
        name: 'Test',
        createdAt: 0,
        updatedAt: 0,
        revision: 1,
        requirementsDoc: 'plan-1.md',
        executionMode: 'sequential',
        status: 'draft',
        graphVersion: 2,
        tasks: [makeTask()],
        ...overrides,
    } as TaskPlan
}

// ===== 测试套件 =====

describe('Plan Validator (阶段六)', () => {
    describe('graphVersion=1 跳过校验', () => {
        it('graphVersion 未设置 → valid=true, issues=[]', () => {
            const plan = makeGraphPlan({ graphVersion: undefined })
            plan.tasks = [] // 即使空任务也不校验

            const result = validatePlan(plan)

            expect(result.valid).toBe(true)
            expect(result.issues).toHaveLength(0)
        })

        it('graphVersion=1 → 跳过校验', () => {
            const plan = makeGraphPlan({ graphVersion: 1 })

            const result = validatePlan(plan)

            expect(result.valid).toBe(true)
            expect(result.issues).toHaveLength(0)
        })
    })

    describe('有效 graphVersion=2 计划', () => {
        it('单节点无 edges → 通过', () => {
            const plan = makeGraphPlan()

            const result = validatePlan(plan)

            expect(result.valid).toBe(true)
            expect(result.issues).toHaveLength(0)
        })

        it('带 normal 边 → 通过', () => {
            const plan = makeGraphPlan({
                tasks: [
                    makeTask({ id: 'task-1' }) as any,
                    makeTask({ id: 'task-2' }) as any,
                ],
            })
            ;(plan.tasks[0] as GraphNode).edges = [
                { source: 'task-1', target: 'task-2', type: 'simple' },
            ]

            const result = validatePlan(plan)

            expect(result.valid).toBe(true)
        })

        it('带 conditional rule 边（有 expression）→ 通过', () => {
            const plan = makeGraphPlan({
                tasks: [
                    makeTask({ id: 'task-1' }) as any,
                    makeTask({ id: 'task-2' }) as any,
                ],
            })
            ;(plan.tasks[0] as GraphNode).edges = [
                {
                    source: 'task-1',
                    target: 'task-2',
                    type: 'conditional',
                    condition: { kind: 'rule', expression: 'node.status === "completed"' },
                },
            ]

            const result = validatePlan(plan)

            expect(result.valid).toBe(true)
        })

        it('带 loop 边（有 maxIterations）→ 通过且无 warning', () => {
            const plan = makeGraphPlan({
                tasks: [makeTask({ id: 'task-1', maxIterations: 3 } as any) as any],
            })
            ;(plan.tasks[0] as GraphNode).edges = [
                { source: 'task-1', target: 'task-1', type: 'loop', maxIterations: 3 },
            ]

            const result = validatePlan(plan)

            expect(result.valid).toBe(true)
            const warnings = result.issues.filter(i => i.severity === 'warning')
            expect(warnings).toHaveLength(0)
        })
    })

    describe('边引用错误', () => {
        it('edge target 不存在 → error', () => {
            const plan = makeGraphPlan({
                tasks: [makeTask({ id: 'task-1' }) as any],
            })
            ;(plan.tasks[0] as GraphNode).edges = [
                { source: 'task-1', target: 'non-existent', type: 'simple' },
            ]

            const result = validatePlan(plan)

            expect(result.valid).toBe(false)
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'error',
                code: 'EDGE_TARGET_NOT_FOUND',
                ref: 'non-existent',
            }))
        })

        it('edge source 不存在 → error', () => {
            const plan = makeGraphPlan({
                tasks: [makeTask({ id: 'task-1' }) as any],
            })
            ;(plan.tasks[0] as GraphNode).edges = [
                { source: 'ghost-node', target: 'task-1', type: 'simple' },
            ]

            const result = validatePlan(plan)

            expect(result.valid).toBe(false)
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'error',
                code: 'EDGE_SOURCE_NOT_FOUND',
                ref: 'ghost-node',
            }))
        })
    })

    describe('条件边完整性', () => {
        it('conditional 边无 condition → error', () => {
            const plan = makeGraphPlan({
                tasks: [
                    makeTask({ id: 'task-1' }) as any,
                    makeTask({ id: 'task-2' }) as any,
                ],
            })
            ;(plan.tasks[0] as GraphNode).edges = [
                { source: 'task-1', target: 'task-2', type: 'conditional' },
            ]

            const result = validatePlan(plan)

            expect(result.valid).toBe(false)
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'error',
                code: 'CONDITIONAL_EDGE_MISSING_CONDITION',
            }))
        })

        it('rule condition 无 expression → error', () => {
            const plan = makeGraphPlan({
                tasks: [
                    makeTask({ id: 'task-1' }) as any,
                    makeTask({ id: 'task-2' }) as any,
                ],
            })
            ;(plan.tasks[0] as GraphNode).edges = [
                {
                    source: 'task-1',
                    target: 'task-2',
                    type: 'conditional',
                    condition: { kind: 'rule' },
                },
            ]

            const result = validatePlan(plan)

            expect(result.valid).toBe(false)
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'error',
                code: 'RULE_CONDITION_MISSING_EXPRESSION',
            }))
        })

        it('llm condition 无 prompt → error', () => {
            const plan = makeGraphPlan({
                tasks: [
                    makeTask({ id: 'task-1' }) as any,
                    makeTask({ id: 'task-2' }) as any,
                ],
            })
            ;(plan.tasks[0] as GraphNode).edges = [
                {
                    source: 'task-1',
                    target: 'task-2',
                    type: 'conditional',
                    condition: { kind: 'llm' },
                },
            ]

            const result = validatePlan(plan)

            expect(result.valid).toBe(false)
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'error',
                code: 'LLM_CONDITION_MISSING_PROMPT',
            }))
        })
    })

    describe('loop 边约束（warning 不阻断）', () => {
        it('loop 边无 maxIterations 且节点也无 → warning 但 valid=true', () => {
            const plan = makeGraphPlan({
                tasks: [makeTask({ id: 'task-1' }) as any],
            })
            ;(plan.tasks[0] as GraphNode).edges = [
                { source: 'task-1', target: 'task-1', type: 'loop' },
            ]

            const result = validatePlan(plan)

            expect(result.valid).toBe(true) // warning 不阻断
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'warning',
                code: 'LOOP_EDGE_NO_MAX_ITERATIONS',
            }))
        })
    })

    describe('nodeType 一致性', () => {
        it('tool 节点无 toolCall → error', () => {
            const plan = makeGraphPlan({
                tasks: [makeTask({ id: 'task-1' }) as any],
            })
            ;(plan.tasks[0] as GraphNode).nodeType = 'tool'

            const result = validatePlan(plan)

            expect(result.valid).toBe(false)
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'error',
                code: 'TOOL_NODE_MISSING_TOOLCALL',
            }))
        })

        it('tool 节点有 toolCall → 通过', () => {
            const plan = makeGraphPlan({
                tasks: [makeTask({ id: 'task-1' }) as any],
            })
            ;(plan.tasks[0] as GraphNode).nodeType = 'tool'
            ;(plan.tasks[0] as GraphNode).toolCall = { name: 'write_file', arguments: {} }

            const result = validatePlan(plan)

            expect(result.valid).toBe(true)
        })

        it('llm 节点无 llmPrompt 和 description → warning', () => {
            const plan = makeGraphPlan({
                tasks: [makeTask({ id: 'task-1', description: '' }) as any],
            })
            ;(plan.tasks[0] as GraphNode).nodeType = 'llm'

            const result = validatePlan(plan)

            expect(result.valid).toBe(true)
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'warning',
                code: 'LLM_NODE_NO_PROMPT',
            }))
        })
    })

    describe('空任务列表', () => {
        it('graphVersion=2 但 tasks=[] → error', () => {
            const plan = makeGraphPlan({ tasks: [] })

            const result = validatePlan(plan)

            expect(result.valid).toBe(false)
            expect(result.issues).toContainEqual(expect.objectContaining({
                severity: 'error',
                code: 'EMPTY_TASKS',
            }))
        })
    })

    describe('formatValidationIssues', () => {
        it('空 issues → 空字符串', () => {
            const result = formatValidationIssues({ valid: true, issues: [] })
            expect(result).toBe('')
        })

        it('多个 issues → 格式化输出', () => {
            const result = formatValidationIssues({
                valid: false,
                issues: [
                    { severity: 'error', code: 'TEST_ERR', message: 'Error msg', ref: 'task-1' },
                    { severity: 'warning', code: 'TEST_WARN', message: 'Warning msg' },
                ],
            })

            expect(result).toContain('❌ TEST_ERR: Error msg [task-1]')
            expect(result).toContain('⚠️ TEST_WARN: Warning msg')
        })
    })
})
