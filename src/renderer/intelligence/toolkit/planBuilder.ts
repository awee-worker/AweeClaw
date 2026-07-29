/**
 * Plan 构建器 —— 从 LLM 工具参数构建 TaskPlan（Graph Runtime 阶段六）
 *
 * 职责：
 * - 解析 create_task_plan 工具参数（含 graphVersion=2 图扩展字段）
 * - 将 plan 级 edges 按 source 分组挂到对应 GraphNode.edges（节点级出边）
 * - 构建完整的 TaskPlan 对象（含 revision、graphVersion 等）
 *
 * 设计原则：
 * - 纯函数，无副作用，便于单测
 * - 渐进式增强：graphVersion 不传或缺省 1 时，行为与旧版完全一致
 * - 复用 graphTypes 的 GraphNode/GraphEdge 类型，通过类型断言访问图扩展字段
 *
 * @module GraphRuntime/planBuilder
 */

import type {
    TaskPlan,
    PlanTask,
    TaskStatus,
    ExecutionMode,
    PlanStatus,
} from '../planner/planTypes'
import type {
    GraphNode,
    GraphEdge,
    GraphEdgeType,
    GraphNodeType,
    EdgeCondition,
} from '../graph/graphTypes'

// ============================================
// 类型定义（工具参数结构）
// ============================================

/** create_task_plan 工具的 task 参数结构 */
export interface PlanTaskArg {
    title: string
    description: string
    suggestedProvider?: string
    suggestedModel?: string
    suggestedRole?: string
    dependencies?: string[]
    // Graph Runtime 扩展字段（全部 optional）
    nodeType?: string
    maxIterations?: number
    reflectionPrompt?: string
    llmPrompt?: string
    toolCall?: { name: string; arguments: Record<string, unknown> }
    requireApproval?: boolean
}

/** create_task_plan 工具的 edge 参数结构 */
export interface PlanEdgeArg {
    source: string
    target: string
    type: 'simple' | 'conditional' | 'loop'
    conditionKind?: 'rule' | 'llm'
    conditionExpression?: string
    conditionPrompt?: string
    maxIterations?: number
}

/** create_task_plan 工具的完整参数结构 */
export interface CreatePlanArgs {
    name: string
    requirementsDoc: string
    tasks: PlanTaskArg[]
    executionMode?: string
    graphVersion?: number
    allowDynamicExpansion?: boolean
    edges?: PlanEdgeArg[]
}

/** buildPlanFromToolArgs 的输入参数 */
export interface BuildPlanParams {
    /** 工具参数 */
    args: CreatePlanArgs
    /** 生成的 plan id */
    planId: string
    /** 时间戳（createdAt/updatedAt） */
    timestamp: number
}

// ============================================
// 常量
// ============================================

const DEFAULT_PROVIDER = 'anthropic'
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'
const DEFAULT_ROLE = 'coder'

// ============================================
// 辅助函数
// ============================================

/**
 * 处理 "default" 值，转换为真实的默认配置
 */
function resolveDefault(value: string | undefined, fallback: string): string {
    if (!value || value === 'default' || value === 'Default') return fallback
    return value
}

/**
 * 校验并归一化 nodeType
 */
function normalizeNodeType(value?: string): GraphNodeType | undefined {
    if (!value) return undefined
    const valid: GraphNodeType[] = ['task', 'llm', 'tool', 'decision', 'human']
    return valid.includes(value as GraphNodeType) ? (value as GraphNodeType) : undefined
}

/**
 * 将 plan 级 edges 按 source 分组，构建节点级 edges 映射
 *
 * @returns Map<sourceNodeId, GraphEdge[]>
 */
function groupEdgesBySource(edges: PlanEdgeArg[]): Map<string, GraphEdge[]> {
    const map = new Map<string, GraphEdge[]>()
    for (const edge of edges) {
        if (!edge.source || !edge.target) continue

        const graphEdge: GraphEdge = {
            source: edge.source,
            target: edge.target,
            type: edge.type as GraphEdgeType,
        }

        // 条件求值
        if (edge.type === 'conditional' && edge.conditionKind) {
            const condition: EdgeCondition = { kind: edge.conditionKind }
            if (edge.conditionKind === 'rule' && edge.conditionExpression) {
                condition.expression = edge.conditionExpression
            }
            if (edge.conditionKind === 'llm' && edge.conditionPrompt) {
                condition.prompt = edge.conditionPrompt
            }
            graphEdge.condition = condition
        }

        // loop 边的 maxIterations
        if (edge.type === 'loop' && typeof edge.maxIterations === 'number') {
            graphEdge.maxIterations = edge.maxIterations
        }

        const existing = map.get(edge.source)
        if (existing) {
            existing.push(graphEdge)
        } else {
            map.set(edge.source, [graphEdge])
        }
    }
    return map
}

/**
 * 判断是否应构建为 graphVersion=2 计划
 *
 * 触发条件（任一满足）：
 * 1. 显式传入 graphVersion=2
 * 2. 传入 edges 数组（图边定义）
 * 3. 任一 task 携带图扩展字段（nodeType/edges/maxIterations/reflectionPrompt 等）
 */
function shouldBuildGraphPlan(args: CreatePlanArgs): boolean {
    if (args.graphVersion === 2) return true
    if (args.edges && args.edges.length > 0) return true
    return args.tasks.some(t =>
        t.nodeType !== undefined ||
        t.maxIterations !== undefined ||
        t.reflectionPrompt !== undefined ||
        t.llmPrompt !== undefined ||
        t.toolCall !== undefined ||
        t.requireApproval !== undefined,
    )
}

// ============================================
// 核心构建函数
// ============================================

/**
 * 将图扩展字段应用到 GraphNode（覆盖/追加模式）
 *
 * 抽取自 buildPlanTask，供 update_task_plan 的 addTasks/updateTasks 复用。
 * 仅在字段存在时挂载，缺省字段保持原值不变。
 *
 * @param node 目标节点（会被原地修改）
 * @param arg 工具参数中的 task 定义
 */
export function applyGraphFieldsToNode(node: GraphNode, arg: PlanTaskArg): void {
    const nodeType = normalizeNodeType(arg.nodeType)
    if (nodeType) {
        node.nodeType = nodeType
    }

    if (typeof arg.maxIterations === 'number') {
        node.maxIterations = arg.maxIterations
    }
    if (arg.reflectionPrompt) {
        // reflectionPrompt 挂在节点上（JS 松散，TS 通过 as 断言访问）
        ;(node as GraphNode & { reflectionPrompt?: string }).reflectionPrompt = arg.reflectionPrompt
    }
    if (arg.llmPrompt) {
        node.llmPrompt = arg.llmPrompt
    }
    if (arg.toolCall) {
        node.toolCall = arg.toolCall
    }
    if (arg.requireApproval !== undefined) {
        node.requireApproval = arg.requireApproval
    }
}

/**
 * 从工具参数构建单个 PlanTask（GraphNode）
 *
 * @param arg 工具参数中的 task 定义
 * @param index 任务序号（用于生成 task id）
 * @param edgesBySource 按 source 分组的 edges 映射
 */
export function buildPlanTask(
    arg: PlanTaskArg,
    index: number,
    edgesBySource: Map<string, GraphEdge[]>,
): PlanTask {
    const taskId = `task-${index + 1}`

    const task: PlanTask = {
        id: taskId,
        title: arg.title,
        description: arg.description,
        provider: resolveDefault(arg.suggestedProvider, DEFAULT_PROVIDER),
        model: resolveDefault(arg.suggestedModel, DEFAULT_MODEL),
        role: resolveDefault(arg.suggestedRole, DEFAULT_ROLE),
        dependencies: arg.dependencies || [],
        status: 'pending' as TaskStatus,
    }

    // 图扩展字段（复用 applyGraphFieldsToNode）
    const node = task as GraphNode
    applyGraphFieldsToNode(node, arg)

    // 节点级出边：从 edgesBySource 取该节点的出边
    const edges = edgesBySource.get(taskId)
    if (edges && edges.length > 0) {
        node.edges = edges
    }

    return task
}

/**
 * 从 create_task_plan 工具参数构建完整 TaskPlan
 *
 * 渐进式增强：
 * - graphVersion 不传或缺省 1：构建普通静态 DAG plan（无图字段）
 * - graphVersion=2 或有图扩展字段：构建 ExecutionGraph（带 graphVersion/edges/nodeType）
 *
 * @returns 完整的 TaskPlan 对象（可直接持久化和加入 store）
 */
export function buildPlanFromToolArgs(params: BuildPlanParams): TaskPlan {
    const { args, planId, timestamp } = params

    const executionMode = (args.executionMode as ExecutionMode) || 'sequential'
    const isGraphPlan = shouldBuildGraphPlan(args)

    // 分组 edges 到节点级
    const edgesBySource = args.edges ? groupEdgesBySource(args.edges) : new Map<string, GraphEdge[]>()

    // 构建任务列表
    const tasks = args.tasks.map((arg, idx) => buildPlanTask(arg, idx, edgesBySource))

    // 构建 plan 基础对象
    const plan: TaskPlan = {
        id: planId,
        name: args.name,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        requirementsDoc: `${planId}.md`,
        executionMode,
        status: 'draft' as PlanStatus,
        tasks,
    }

    // 图扩展字段：仅在 graphVersion=2 时挂载
    if (isGraphPlan) {
        const graph = plan as TaskPlan & {
            graphVersion?: 1 | 2
            allowDynamicExpansion?: boolean
        }
        graph.graphVersion = 2
        graph.allowDynamicExpansion = args.allowDynamicExpansion === true
    }

    return plan
}

// ============================================
// update_task_plan 辅助函数
// ============================================

/**
 * 为 update_task_plan 的 addTasks 构建单个 PlanTask
 *
 * 与 buildPlanTask 区别：id 基于时间戳生成（避免与现有 task-N 冲突），
 * 不挂载节点级 edges（addTasks 不直接定义 edges，edges 由 updateEdges 单独更新）。
 *
 * @param arg 工具参数中的 task 定义
 * @param timestamp 时间戳（用于生成唯一 id）
 * @param index 序号（避免同一批 timestamp 冲突）
 */
export function buildAddedTask(
    arg: PlanTaskArg,
    timestamp: number,
    index: number,
): PlanTask {
    const task: PlanTask = {
        id: `task-${timestamp}-${index}`,
        title: arg.title,
        description: arg.description,
        provider: resolveDefault(arg.suggestedProvider, DEFAULT_PROVIDER),
        model: resolveDefault(arg.suggestedModel, DEFAULT_MODEL),
        role: resolveDefault(arg.suggestedRole, DEFAULT_ROLE),
        dependencies: arg.dependencies || [],
        status: 'pending' as TaskStatus,
    }

    // 图扩展字段（复用 applyGraphFieldsToNode）
    applyGraphFieldsToNode(task as GraphNode, arg)

    return task
}

/**
 * 将 updateEdges 参数应用到 plan 的 tasks（重分配节点级出边）
 *
 * 策略：
 * - 按 source 分组
 * - 对每个 source 节点：清除原有 edges，设置新 edges
 * - 若 source 节点不存在则跳过（由 planValidator 校验拦截）
 *
 * @param tasks plan 的任务列表（会被原地修改）
 * @param edgeArgs updateEdges 工具参数
 */
export function applyUpdateEdges(
    tasks: PlanTask[],
    edgeArgs: PlanEdgeArg[],
): void {
    const edgesBySource = groupEdgesBySource(edgeArgs)

    for (const task of tasks) {
        const node = task as GraphNode
        const newEdges = edgesBySource.get(task.id)
        if (newEdges !== undefined) {
            // 有新 edges：替换
            node.edges = newEdges.length > 0 ? newEdges : undefined
        }
        // 无新 edges 的节点保持原 edges 不变
    }
}

