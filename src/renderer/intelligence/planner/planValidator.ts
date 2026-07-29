/**
 * Plan 校验器 —— Graph Runtime 阶段六
 *
 * 职责：校验 graphVersion=2 计划的结构完整性，在 start_task_execution 前拦截非法计划。
 *
 * 设计原则：
 * - 纯函数，无副作用，便于单测
 * - graphVersion=1 计划跳过校验（现有行为，零破坏）
 * - graphVersion=2 计划校验边完整性、节点引用、条件边配置
 * - 严重错误（error）阻断执行；轻微问题（warning）仅记录不阻断
 *
 * @module GraphRuntime/planValidator
 */

import type { TaskPlan, PlanTask } from './planTypes'
import type { GraphNode, GraphEdge } from '../graph/graphTypes'

// ============================================
// 校验结果类型
// ============================================

export type ValidationSeverity = 'error' | 'warning'

export interface ValidationIssue {
    /** 严重级别：error 阻断执行，warning 仅提示 */
    severity: ValidationSeverity
    /** 规则编码 */
    code: string
    /** 人类可读描述 */
    message: string
    /** 相关节点/边 id（便于定位） */
    ref?: string
}

export interface ValidationResult {
    valid: boolean
    issues: ValidationIssue[]
}

// ============================================
// 辅助函数
// ============================================

/**
 * 收集 plan 中所有节点 id（用于边引用校验）
 */
function collectNodeIds(tasks: PlanTask[]): Set<string> {
    return new Set(tasks.map(t => t.id))
}

/**
 * 收集 plan 中所有节点的出边（合并 plan 级 edges 和节点级 edges）
 *
 * 节点级 edges 存储在 GraphNode.edges 上（按 source 分组后挂载）。
 * 校验时统一收集所有边进行引用检查。
 */
function collectAllEdges(tasks: PlanTask[]): GraphEdge[] {
    const edges: GraphEdge[] = []
    for (const task of tasks) {
        const node = task as GraphNode
        if (node.edges && node.edges.length > 0) {
            // 节点级 edges 的 source 隐含为该节点 id
            for (const edge of node.edges) {
                edges.push({
                    ...edge,
                    source: edge.source || task.id,
                })
            }
        }
    }
    return edges
}

// ============================================
// 核心校验函数
// ============================================

/**
 * 校验 plan 结构完整性
 *
 * @param plan 待校验的计划
 * @returns 校验结果（valid=true 表示可执行，无 error 级问题）
 */
export function validatePlan(plan: TaskPlan): ValidationResult {
    const issues: ValidationIssue[] = []

    // graphVersion=1 跳过图校验（现有行为，零破坏）
    if (plan.graphVersion !== 2) {
        return { valid: true, issues: [] }
    }

    // 空任务列表
    if (!plan.tasks || plan.tasks.length === 0) {
        issues.push({
            severity: 'error',
            code: 'EMPTY_TASKS',
            message: 'Plan has no tasks',
        })
        return { valid: false, issues }
    }

    const nodeIds = collectNodeIds(plan.tasks)
    const allEdges = collectAllEdges(plan.tasks)

    // 规则 1：边引用有效性（source/target 必须存在于 tasks）
    for (const edge of allEdges) {
        if (edge.source && !nodeIds.has(edge.source)) {
            issues.push({
                severity: 'error',
                code: 'EDGE_SOURCE_NOT_FOUND',
                message: `Edge source "${edge.source}" does not exist in tasks`,
                ref: edge.source,
            })
        }
        if (!nodeIds.has(edge.target)) {
            issues.push({
                severity: 'error',
                code: 'EDGE_TARGET_NOT_FOUND',
                message: `Edge target "${edge.target}" does not exist in tasks`,
                ref: edge.target,
            })
        }
    }

    // 规则 2：条件边完整性（conditional 类型必须有 condition 配置）
    for (const edge of allEdges) {
        if (edge.type === 'conditional') {
            if (!edge.condition) {
                issues.push({
                    severity: 'error',
                    code: 'CONDITIONAL_EDGE_MISSING_CONDITION',
                    message: `Conditional edge from "${edge.source}" to "${edge.target}" has no condition`,
                    ref: `${edge.source}->${edge.target}`,
                })
                continue
            }
            const cond = edge.condition
            if (cond.kind === 'rule' && !cond.expression) {
                issues.push({
                    severity: 'error',
                    code: 'RULE_CONDITION_MISSING_EXPRESSION',
                    message: `Rule condition on edge "${edge.source}->${edge.target}" has no expression`,
                    ref: `${edge.source}->${edge.target}`,
                })
            }
            if (cond.kind === 'llm' && !cond.prompt) {
                issues.push({
                    severity: 'error',
                    code: 'LLM_CONDITION_MISSING_PROMPT',
                    message: `LLM condition on edge "${edge.source}->${edge.target}" has no prompt`,
                    ref: `${edge.source}->${edge.target}`,
                })
            }
        }
    }

    // 规则 3：loop 边约束（target 指向已执行节点或自身；source 节点建议有 maxIterations）
    for (const edge of allEdges) {
        if (edge.type === 'loop') {
            // loop 边的 target 应指向 source 自身或其上游（循环回流）
            // 这里仅做宽松校验：target 必须存在（已在规则1检查），不强制指向自身
            // 检查 source 节点是否有 maxIterations（警告级，不阻断）
            const sourceNode = plan.tasks.find(t => t.id === edge.source) as GraphNode | undefined
            const effectiveMaxIter = edge.maxIterations || sourceNode?.maxIterations
            if (!effectiveMaxIter) {
                issues.push({
                    severity: 'warning',
                    code: 'LOOP_EDGE_NO_MAX_ITERATIONS',
                    message: `Loop edge "${edge.source}->${edge.target}" has no maxIterations on edge or source node (will use default 2)`,
                    ref: `${edge.source}->${edge.target}`,
                })
            }
        }
    }

    // 规则 4：nodeType 一致性（tool 节点需有 toolCall）
    for (const task of plan.tasks) {
        const node = task as GraphNode
        if (node.nodeType === 'tool' && !node.toolCall) {
            issues.push({
                severity: 'error',
                code: 'TOOL_NODE_MISSING_TOOLCALL',
                message: `Tool node "${task.id}" has no toolCall configuration`,
                ref: task.id,
            })
        }
        // llm 节点建议有 llmPrompt（缺省回退 description，故为 warning）
        if (node.nodeType === 'llm' && !node.llmPrompt && !task.description) {
            issues.push({
                severity: 'warning',
                code: 'LLM_NODE_NO_PROMPT',
                message: `LLM node "${task.id}" has no llmPrompt or description`,
                ref: task.id,
            })
        }
    }

    // valid = 无 error 级问题
    const hasErrors = issues.some(i => i.severity === 'error')
    return { valid: !hasErrors, issues }
}

/**
 * 格式化校验结果为可读字符串（用于工具返回）
 */
export function formatValidationIssues(result: ValidationResult): string {
    if (result.issues.length === 0) return ''

    const lines: string[] = []
    for (const issue of result.issues) {
        const prefix = issue.severity === 'error' ? '❌' : '⚠️'
        const ref = issue.ref ? ` [${issue.ref}]` : ''
        lines.push(`${prefix} ${issue.code}: ${issue.message}${ref}`)
    }
    return lines.join('\n')
}
