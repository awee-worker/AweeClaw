/**
 * Graph Runtime 动态建图工具执行器（阶段三）
 *
 * 职责：实现 add_node / add_edge 两个 LLM 工具的执行逻辑，
 *       通过 GraphExecutionBridge 访问当前执行图，调用 GraphScheduler 动态扩展。
 *
 * 独立拆分原因（遵循「单文件不宜过大，可拆分尽可能拆分」原则）：
 * - toolExecutors.ts 已 3400+ 行，新增图工具继续堆叠会降低可维护性
 * - 图建图工具依赖链独立（仅 LogEngine + bridge + graphTypes），便于单独测试
 * - 与通用工具执行器解耦，后续图能力演进不影响主工具集
 *
 * @module GraphRuntime
 */

import { toAppError } from '@shared/toolkit/errorCatalog'
import { logger } from '@toolkit/LogEngine'
import type { ToolExecutionResult, ToolExecutionContext } from '@intelligence/providerTypes'
import { resolveAgentLanguage, pickLocalizedText } from '@intelligence/utils/intelligenceTextUtils'
import type { Language } from '@renderer/i18n'
import type {
    GraphNode,
    GraphEdge,
    EdgeCondition,
    ExecutionGraph,
} from '../graph/graphTypes'

// ===== 辅助函数 =====

function getLocalizedText(language: Language, zh: string, en: string): string {
    return pickLocalizedText(zh, en, language as 'en' | 'zh')
}

function getCurrentLanguage(): Language {
    return resolveAgentLanguage() as Language
}

/**
 * 生成图中唯一的节点 id（动态建图用）
 * 基于 task-N 模式，取图中现有最大序号 +1，避免与既有节点冲突
 */
export function generateUniqueNodeId(graph: ExecutionGraph): string {
    let maxNum = 0
    for (const task of graph.tasks) {
        const match = task.id.match(/^task-(\d+)$/)
        if (match) {
            const num = parseInt(match[1], 10)
            if (num > maxNum) maxNum = num
        }
    }
    return `task-${maxNum + 1}`
}

// ===== 动态导入桥接器（避免静态依赖循环）=====

/**
 * 获取当前活跃图句柄（动态导入桥接器）
 * 动态导入原因：graph 模块在加载期不依赖 toolkit，保持单向依赖
 */
async function getActiveGraphHandle() {
    const { graphExecutionBridge } = await import('../graph/GraphExecutionBridge')
    return graphExecutionBridge.getCurrent()
}

/** 解析活跃图，返回友好错误信息（无活跃图 / 图已移除 / 静态图） */
async function resolveActiveGraph(): Promise<
    | { ok: true; graph: ExecutionGraph }
    | { ok: false; error: string }
> {
    const handle = await getActiveGraphHandle()
    if (!handle) {
        return {
            ok: false,
            error: getLocalizedText(
                getCurrentLanguage(),
                '当前没有正在执行的动态图（graphVersion=2）。该工具仅在动态图执行期间可用。',
                'No active dynamic graph (graphVersion=2) is executing. This tool is only available during dynamic graph execution.',
            ),
        }
    }

    const graph = handle.getGraph()
    if (!graph) {
        return {
            ok: false,
            error: getLocalizedText(
                getCurrentLanguage(),
                `活跃图 ${handle.planId} 已从 store 中移除，无法动态建图。`,
                `Active graph ${handle.planId} no longer exists in store.`,
            ),
        }
    }

    if (graph.graphVersion !== 2 && graph.allowDynamicExpansion !== true) {
        return {
            ok: false,
            error: getLocalizedText(
                getCurrentLanguage(),
                `当前图 ${graph.id} 不允许动态扩展（需 graphVersion=2 或 allowDynamicExpansion=true）。`,
                `Graph ${graph.id} does not allow dynamic expansion (requires graphVersion=2 or allowDynamicExpansion=true).`,
            ),
        }
    }

    return { ok: true, graph }
}

// ===== 工具执行器 =====

/**
 * add_node —— 动态添加图节点
 *
 * 通过 graphExecutionBridge 定位当前执行中的图（graphVersion=2），
 * 调用 GraphScheduler.addNode 将新节点加入调度队列。
 */
export async function executeAddNode(
    args: Record<string, unknown>,
    _ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
    const title = args.title as string
    const description = args.description as string

    if (!title || !description) {
        return { success: false, result: 'title and description are required' }
    }

    try {
        const resolved = await resolveActiveGraph()
        if (!resolved.ok) {
            return { success: false, result: resolved.error }
        }
        const { graph } = resolved
        const handle = await getActiveGraphHandle()

        // 校验依赖引用的节点存在
        const dependencies = (args.dependencies as string[] | undefined) ?? []
        const existingIds = new Set(graph.tasks.map(t => t.id))
        for (const depId of dependencies) {
            if (!existingIds.has(depId)) {
                return {
                    success: false,
                    result: getLocalizedText(
                        getCurrentLanguage(),
                        `依赖节点 ${depId} 不存在于图中，无法添加。`,
                        `Dependency node ${depId} does not exist in the graph.`,
                    ),
                }
            }
        }

        // 生成唯一节点 id：基于图中现有最大 task-N 序号递增
        const nodeId = generateUniqueNodeId(graph)

        // 构造 GraphNode（保留 PlanTask 必填字段，补充图扩展字段）
        const newNode = {
            id: nodeId,
            title,
            description,
            provider: (args.provider as string) || 'anthropic',
            model: (args.model as string) || 'claude-sonnet-4-20250514',
            role: (args.role as string) || 'coder',
            dependencies,
            status: 'pending' as const,
            // 图扩展字段
            nodeType: (args.nodeType as GraphNode['nodeType']) || 'task',
            maxIterations: args.maxIterations as number | undefined,
            requireApproval: args.requireApproval as boolean | undefined,
        } as GraphNode

        handle!.scheduler.addNode(graph, newNode)

        logger.agent.info(`[add_node] Dynamically added node ${nodeId} (${newNode.nodeType}) to graph ${graph.id}`)

        return {
            success: true,
            result: getLocalizedText(
                getCurrentLanguage(),
                `已动态添加节点「${title}」（id=${nodeId}，类型=${newNode.nodeType}）到图。依赖满足后将自动执行。`,
                `Dynamically added node "${title}" (id=${nodeId}, type=${newNode.nodeType}) to graph. It will execute once dependencies are satisfied.`,
            ),
            meta: { nodeId, graphId: graph.id },
        }
    } catch (err) {
        const error = toAppError(err)
        return { success: false, result: error.message }
    }
}

/**
 * add_edge —— 动态添加图边
 *
 * 调用 GraphScheduler.addEdge 为节点添加出边（simple/conditional/loop）。
 */
export async function executeAddEdge(
    args: Record<string, unknown>,
    _ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
    const sourceId = args.sourceId as string
    const targetId = args.targetId as string
    const edgeType = args.type as GraphEdge['type']

    if (!sourceId || !targetId || !edgeType) {
        return { success: false, result: 'sourceId, targetId and type are required' }
    }

    try {
        const resolved = await resolveActiveGraph()
        if (!resolved.ok) {
            return { success: false, result: resolved.error }
        }
        const { graph } = resolved
        const handle = await getActiveGraphHandle()

        // 构造边条件（仅 conditional 类型）
        let condition: EdgeCondition | undefined
        if (edgeType === 'conditional') {
            const conditionKind = args.conditionKind as EdgeCondition['kind'] | undefined
            if (!conditionKind) {
                return {
                    success: false,
                    result: getLocalizedText(
                        getCurrentLanguage(),
                        "条件边需要 conditionKind 参数（'rule' 或 'llm'）。",
                        "Conditional edge requires conditionKind ('rule' or 'llm').",
                    ),
                }
            }
            condition = {
                kind: conditionKind,
                expression: conditionKind === 'rule' ? (args.conditionExpression as string | undefined) : undefined,
                prompt: conditionKind === 'llm' ? (args.conditionPrompt as string | undefined) : undefined,
            }

            if (conditionKind === 'rule' && !condition.expression) {
                return { success: false, result: "Rule condition requires conditionExpression." }
            }
            if (conditionKind === 'llm' && !condition.prompt) {
                return { success: false, result: "LLM condition requires conditionPrompt." }
            }
        }

        // GraphScheduler.addEdge 内部会校验 source/target 存在性，此处直接委托
        const edge = {
            target: targetId,
            type: edgeType,
            condition,
            maxIterations: edgeType === 'loop' ? (args.maxIterations as number | undefined) : undefined,
        } as GraphEdge

        handle!.scheduler.addEdge(graph, sourceId, edge)

        logger.agent.info(`[add_edge] Dynamically added edge ${sourceId} -> ${targetId} (${edgeType}) to graph ${graph.id}`)

        return {
            success: true,
            result: getLocalizedText(
                getCurrentLanguage(),
                `已动态添加边 ${sourceId} → ${targetId}（类型=${edgeType}）。`,
                `Dynamically added edge ${sourceId} -> ${targetId} (type=${edgeType}).`,
            ),
            meta: { sourceId, targetId, type: edgeType, graphId: graph.id },
        }
    } catch (err) {
        const error = toAppError(err)
        return { success: false, result: error.message }
    }
}
