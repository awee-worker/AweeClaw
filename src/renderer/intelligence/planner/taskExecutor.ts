/**
 * Plan 执行引擎
 *
 * 职责：
 * - 启动/停止计划执行
 * - 为每个任务创建执行上下文
 * - 调用现有 Agent 系统执行任务
 * - 更新任务状态到 Store
 *
 * 设计原则：
 * - 复用 buildAgentSystemPrompt() 构建提示词
 * - 复用 Agent.send() 执行任务
 * - task.role 映射到 promptTemplateId
 * - task.provider + task.model 直接使用
 */

import { useAgentStore } from '../state/IntelligenceStore'
import { useStore } from '@store'
import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { EventBus } from '../engine/EventDispatcher'
import { Agent } from '../engine/IntelligenceCore'
import { BRAND } from '@shared/brand'
import { gitService } from '@services/gitAdapter'
import { ExecutionScheduler } from './TaskScheduler'
import { getLLMConfigForTask } from '../runtime/modelConfigService'
import { toolManager } from '../toolkit/providers'
import {
    type TaskPlan,
    type PlanTask,
    type PlanStatus,
    type ExecutionStats,
    type ExecutionSession,
    type ExecutionSessionTaskBinding,
    type DependencySummary,
    type ToolExecutionContext,
} from '@intelligence/providerTypes'
import { isGraphNode, type GraphNode, type ExecutionGraph, type GraphExecutionContext } from '../graph/graphTypes'
import { loopController } from '../graph/LoopController'
import { createStateAccessor } from '../graph/GraphStateAdapter'
import { GraphScheduler } from '../graph/GraphScheduler'
import { graphExecutionBridge } from '../graph/GraphExecutionBridge'
import { checkpointManager } from '../graph/CheckpointManager'
import { StoreGraphStateAdapter } from '../graph/GraphStateAdapter'
import { edgeRouter, type LlmConditionEvaluator } from '../graph/EdgeRouter'
import { registerRealExecutors, nodeExecutor } from '../graph/NodeExecutor'
import { createToolExecutor, createLlmExecutor } from '../graph/realExecutors'
import { isDynamicGraphPlan, shouldDispatchToNodeExecutor } from '../graph/graphGuard'
import {
    RUNTIME_SCHEMA_VERSION,
    saveRuntimeStateDebounced,
    saveRuntimeStateImmediate,
    deleteRuntimeState,
    type RuntimeStateFile,
    type PersistedSessionMeta,
} from '../graph/runtimePersistence'

// ===== Graph Runtime 真实执行器惰性注入 =====
//
// 设计：不在模块顶层直接注入（会污染 edgeRouter/nodeExecutor 单例，影响单测），
// 而在第一次创建动态图 session 时通过 ensureGraphRuntimeInitialized() 注入一次。
// flag 防止重复注入。
let graphRuntimeInitialized = false

/**
 * 创建 LLM 条件求值器（包装 api.llm.generateObject）
 *
 * 流程：
 * 1. 从 ctx.node.provider/model 解析 LLM 配置（缺省回退 store.llmConfig）
 * 2. 构造完整 prompt：condition.prompt + node.output + node.status + state.metadata
 * 3. 30s 超时 Promise.race，超时保守返回 false
 * 4. 解析 generateObject 返回的 { result: boolean }
 *
 * 失败/超时统一返回 false：错误激活比错误跳过更危险（路由激活会触发节点执行）
 */
function createLlmConditionEvaluator(): LlmConditionEvaluator {
    return async (prompt, ctx) => {
        const { node, state } = ctx

        // 1. 解析 LLM 配置：优先节点配置，回退全局默认
        const providerId = node.provider
        const modelId = node.model
        let config = await getLLMConfigForTask(providerId, modelId)
        if (!config) {
            // 回退到全局默认配置（避免节点配置缺失时无法求值）
            const store = useStore.getState()
            config = store.llmConfig
        }
        if (!config) {
            logger.agent.warn(
                `[EdgeRouter] No LLM config for node ${node.id}, LLM condition treated as false`,
            )
            return false
        }

        // 2. 构造完整 prompt：注入节点上下文与状态元数据
        const metadataSnapshot =
            typeof state.getAllMetadata === 'function' ? state.getAllMetadata() : {}
        const fullPrompt = [
            'You are determining whether to activate a graph edge based on node execution result.',
            '',
            `Node status: ${node.status || 'unknown'}`,
            `Node output: ${node.output || '(empty)'}`,
            `State metadata: ${JSON.stringify(metadataSnapshot)}`,
            '',
            'User-defined judgment prompt:',
            prompt,
            '',
            'Answer with strict JSON: {"result": true} or {"result": false}',
        ].join('\n')

        // 3. 30s 超时保护
        const TIMEOUT_MS = 30000
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('LLM condition eval timeout')), TIMEOUT_MS)
        })

        try {
            const resultPromise = api.llm.generateObject({
                config,
                schema: {
                    type: 'object',
                    properties: {
                        result: { type: 'boolean' },
                    },
                    required: ['result'],
                    additionalProperties: false,
                },
                system: 'You are a graph routing evaluator. Answer strictly with JSON {"result": boolean}.',
                prompt: fullPrompt,
            })

            const response = await Promise.race([resultPromise, timeoutPromise])

            // 4. 解析返回（容错：支持 object.result 或 object 直接是 boolean）
            if (response.error) {
                logger.agent.warn(
                    `[EdgeRouter] LLM condition eval returned error (node ${node.id}): ${response.error}`,
                )
                return false
            }

            const obj = response.object
            if (typeof obj === 'boolean') return obj
            if (obj && typeof obj.result === 'boolean') return obj.result
            if (obj && typeof obj.result === 'string') {
                return obj.result.toLowerCase() === 'true'
            }
            logger.agent.warn(
                `[EdgeRouter] LLM condition eval unexpected response (node ${node.id}): ${JSON.stringify(obj)}`,
            )
            return false
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            logger.agent.warn(
                `[EdgeRouter] LLM condition eval failed (node ${node.id}): ${errorMsg}`,
            )
            return false
        }
    }
}

/**
 * 注入 Graph Runtime 真实执行器（惰性，仅一次）
 *
 * 注册内容：
 * - NodeExecutor: tool / llm 节点真实执行器（task 不注册，由 executeTask 直接分发）
 * - EdgeRouter: LLM 条件求值器（包装 api.llm.generateObject）
 *
 * 在第一次创建动态图 session 时调用，避免模块加载期污染单例影响单测。
 */
function ensureGraphRuntimeInitialized(): void {
    if (graphRuntimeInitialized) return
    graphRuntimeInitialized = true

    registerRealExecutors({
        toolExecutor: createToolExecutor(),
        llmExecutor: createLlmExecutor(),
    })
    edgeRouter.setLlmEvaluator(createLlmConditionEvaluator())

    logger.agent.info('[GraphRuntime] Real executors injected (tool/llm/edgeLlm)')
}

const sessions = new Map<string, ExecutionSession>()
const planToSessionId = new Map<string, string>()

function getSessionByPlanId(planId: string): ExecutionSession | null {
    const sessionId = planToSessionId.get(planId)
    if (!sessionId) return null
    return sessions.get(sessionId) || null
}

function createSession(planId: string, workspacePath: string): ExecutionSession {
    const sessionId = crypto.randomUUID()
    const session: ExecutionSession = {
        id: sessionId,
        planId,
        workspacePath,
        startedAt: Date.now(),
        scheduler: new ExecutionScheduler(),
        status: 'running',
        bindings: new Map(),
        abortControllers: new Map(),
    }
    session.scheduler.start()
    sessions.set(sessionId, session)
    planToSessionId.set(planId, sessionId)

    // Graph Runtime 阶段三：动态图注册到桥接器，供 add_node/add_edge 工具访问
    const plan = useAgentStore.getState().getPlan(planId)
    if (plan && isDynamicGraphPlan(plan)) {
        // 阶段四：惰性注入真实执行器（tool/llm 节点 + LLM 条件求值）
        ensureGraphRuntimeInitialized()
        const graphScheduler = new GraphScheduler(session.scheduler)
        // 挂到 session，供 runExecutionLoop / executeTask 通过 session.graphScheduler 访问
        session.graphScheduler = graphScheduler
        graphExecutionBridge.register({
            planId,
            scheduler: graphScheduler,
            workspacePath,
        })
        logger.agent.info(`[PlanExecutor] Dynamic graph session registered: ${planId} (graphVersion=${plan.graphVersion})`)
    }

    return session
}

function clearSession(
    session: ExecutionSession,
    options?: { deleteRuntime?: boolean },
): void {
    const deleteRuntime = options?.deleteRuntime !== false // 默认 true：终态删除 runtime 文件

    session.scheduler.stop()
    sessions.delete(session.id)
    if (planToSessionId.get(session.planId) === session.id) {
        planToSessionId.delete(session.planId)
    }

    // Graph Runtime 阶段三：释放图执行会话与检查点
    graphExecutionBridge.unregister(session.planId)
    checkpointManager.clearGraph(session.planId)

    // Graph Runtime 阶段五：终态删除 runtime 文件（paused 场景传 deleteRuntime=false 保留）
    if (deleteRuntime && session.workspacePath) {
        void deleteRuntimeState(session.workspacePath, session.planId).catch(err => {
            logger.agent.warn(
                `[PlanExecutor] Failed to delete runtime state for plan ${session.planId}:`,
                err,
            )
        })
    }
}

/**
 * 持久化 runtime 状态到磁盘（Graph Runtime 阶段五）
 *
 * 守卫：仅 graphVersion=2 动态图执行，避免污染 graphVersion=1
 * 失败策略：持久化失败不阻断执行，仅日志告警（崩溃恢复是 best-effort，不应影响主流程）
 *
 * @param session 当前 session
 * @param plan 当前 plan（用于校验 revision + 守卫动态图）
 * @param immediate true=立即写（awaiting_approval/paused 等关键状态）；
 *                  false=debounce 120ms（checkpoint 后高频写）
 */
function persistRuntimeState(
    session: ExecutionSession,
    plan: TaskPlan,
    immediate: boolean,
): void {
    // 守卫：仅动态图执行
    if (!isDynamicGraphPlan(plan)) return

    const workspacePath = session.workspacePath
    if (!workspacePath) return

    // 序列化最新 checkpoint（无 checkpoint 不可持久化，恢复时无锚点）
    const checkpoint = checkpointManager.serializeLatest(plan.id)
    if (!checkpoint) {
        logger.agent.warn(
            `[PlanExecutor] persistRuntimeState skipped (no checkpoint): plan ${plan.id}`,
        )
        return
    }

    // 构造 PersistedSessionMeta（仅持久化崩溃恢复所需字段）
    const sessionMeta: PersistedSessionMeta = {
        sessionId: session.id,
        startedAt: session.startedAt,
        status: session.status === 'awaiting_approval' ? 'awaiting_approval' : 'running',
        awaitingNodeId: session.awaitingNodeId,
        lastUpdatedAt: Date.now(),
    }

    const state: RuntimeStateFile = {
        schemaVersion: RUNTIME_SCHEMA_VERSION,
        planId: plan.id,
        planRevision: plan.revision || 1,
        session: sessionMeta,
        checkpoint,
    }

    try {
        if (immediate) {
            void saveRuntimeStateImmediate(workspacePath, state).catch(err => {
                logger.agent.warn(
                    `[PlanExecutor] Immediate runtime persist failed for plan ${plan.id}:`,
                    err,
                )
            })
        } else {
            saveRuntimeStateDebounced(workspacePath, state)
        }
    } catch (err) {
        logger.agent.warn(
            `[PlanExecutor] persistRuntimeState error for plan ${plan.id}:`,
            err,
        )
    }
}

function bindTaskRun(
    session: ExecutionSession,
    taskId: string,
    binding: ExecutionSessionTaskBinding,
): void {
    session.bindings.set(taskId, binding)
    useAgentStore.getState().updateTask(session.planId, taskId, {
        threadId: binding.threadId,
        assistantId: binding.assistantId,
        requestId: binding.requestId,
    })
}

function abortSessionRuns(session: ExecutionSession): void {
    for (const binding of session.bindings.values()) {
        Agent.abort(binding.threadId)
    }
}

function isCancellationReason(reason?: string): boolean {
    return reason === 'aborted' || reason === 'user_rejected' || reason === 'Aborted'
}

async function validatePlanTaskModels(plan: TaskPlan): Promise<string | null> {
    for (const task of plan.tasks) {
        if (task.status !== 'pending') continue
        const config = await getLLMConfigForTask(task.provider, task.model)
        if (!config) {
            return `Task "${task.title}" has invalid LLM config: ${task.provider}/${task.model}`
        }
    }

    return null
}

function createTaskThreadBinding(_task: PlanTask) {
    const store = useAgentStore.getState()
    const threadId = store.createThread({ activate: false })
    const requestId = crypto.randomUUID()
    return { threadId, requestId }
}

function getTaskOutput(threadId: string, assistantId: string): string {
    const thread = useAgentStore.getState().threads[threadId]
    if (!thread) return ''

    const assistantMessage = thread.messages.find(message => message.id === assistantId)
    if (assistantMessage?.role === 'assistant') {
        return assistantMessage.content || ''
    }

    const lastAssistant = [...thread.messages].reverse().find(message => message.role === 'assistant')
    return lastAssistant?.role === 'assistant' ? lastAssistant.content || '' : ''
}

function waitForAgentCompletion(
    identity: { threadId: string; assistantId?: string; requestId: string; taskId: string },
    timeoutMs = 0, // 0 = no timeout
): Promise<{ success: boolean; output: string; error?: string; assistantId?: string }> {
    return new Promise((resolve) => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | null = null

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            unsubscribe()
        }

        const settle = (result: { success: boolean; output: string; error?: string; assistantId?: string }) => {
            if (settled) return
            settled = true
            cleanup()
            resolve(result)
        }

        const unsubscribe = EventBus.on('loop:end', (event) => {
            if (event.threadId !== identity.threadId) return
            if (identity.assistantId && event.assistantId !== identity.assistantId) return
            if (event.requestId !== identity.requestId) return
            if (event.planTaskId && event.planTaskId !== identity.taskId) return

            const assistantId = event.assistantId || identity.assistantId
            const output = assistantId
                ? getTaskOutput(identity.threadId, assistantId) || 'Task execution completed'
                : 'Task execution completed'
            if (event.reason === 'error' || event.reason === 'aborted' || event.reason === 'loop_detected' || event.reason === 'max_iterations' || event.reason === 'interrupted') {
                settle({ success: false, output: '', error: event.reason, assistantId })
                return
            }

            settle({ success: true, output, assistantId })
        })

        // timeoutMs = 0 表示不限制超时
        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                settle({ success: false, output: '', error: `Agent execution timed out after ${timeoutMs}ms` })
            }, timeoutMs)
        }
    })
}

export async function startPlanExecution(
    planId?: string
): Promise<{ success: boolean; message: string }> {
    const store = useAgentStore.getState()

    let plan = planId
        ? store.plans.find(p => p.id === planId)
        : store.getActivePlan()

    if (!plan) {
        return { success: false, message: 'No active plan found' }
    }

    if (plan.tasks.length === 0) {
        return { success: false, message: 'Plan has no tasks' }
    }

    if (getSessionByPlanId(plan.id)) {
        return { success: false, message: 'Plan is already executing' }
    }

    const hasPendingTasks = plan.tasks.some(task => task.status === 'pending')
    const hasRetryableTasks = plan.tasks.some(task =>
        task.status === 'failed' || task.status === 'skipped' || task.status === 'running' || task.status === 'cancelled'
    )

    if (!hasPendingTasks && hasRetryableTasks) {
        store.resetTasksForExecution(plan.id)
        plan = store.getPlan(plan.id) || plan
    }

    if (!plan.tasks.some(task => task.status === 'pending')) {
        return { success: false, message: 'Plan has no pending tasks to execute' }
    }

    const workspacePath = gitService.getWorkspace()
    if (!workspacePath) {
        return { success: false, message: 'No workspace open' }
    }

    const validationError = await validatePlanTaskModels(plan)
    if (validationError) {
        return { success: false, message: validationError }
    }

    try {
        const requirementsPath = `${workspacePath}/${BRAND.dirName}/planner/${plan.requirementsDoc}`
        const requirementsContent = await api.file.read(requirementsPath)
        store.updatePlan(plan.id, { requirementsContent: requirementsContent || undefined })
    } catch (e) {
        logger.agent.warn('[PlanExecutor] Failed to load requirements document:', e)
    }

    const session = createSession(plan.id, workspacePath)
    store.startExecution(plan.id)

    logger.agent.info(`[PlanExecutor] Started execution of plan: ${plan.name}`)
    EventBus.emit({ type: 'plan:start', planId: plan.id, sessionId: session.id })

    runExecutionLoop(session).catch(error => {
        logger.agent.error('[PlanExecutor] Execution loop failed:', error)
        handleExecutionError(session, error)
    })

    return {
        success: true,
        message: `Started executing plan "${plan.name}" with ${plan.tasks.length} tasks.`
    }
}

export function stopPlanExecution(planId?: string): void {
    const store = useAgentStore.getState()
    const plan = planId ? store.getPlan(planId) : store.getActivePlan()
    if (!plan) return

    const session = getSessionByPlanId(plan.id)
    if (!session) return

    session.status = 'stopping'
    session.scheduler.stop()
    abortSessionRuns(session)
    store.stopExecution(plan.id, 'stopped')
    if (session.bindings.size === 0) {
        clearSession(session)
    }
    logger.agent.info('[PlanExecutor] Execution stopped')
}

export function pausePlanExecution(planId?: string): void {
    const store = useAgentStore.getState()
    const plan = planId ? store.getPlan(planId) : store.getActivePlan()
    if (!plan) return

    const session = getSessionByPlanId(plan.id)
    if (!session) return

    session.status = 'pausing'
    session.scheduler.pause()
    abortSessionRuns(session)

    store.updatePlan(plan.id, { status: 'pausing' })
    if (session.bindings.size === 0) {
        session.status = 'paused'
        store.pauseExecution(plan.id)
        // 阶段五：paused 状态持久化（立即写），保留 runtime 供崩溃恢复
        persistRuntimeState(session, plan, true)
        // deleteRuntime=false 保留 runtime 文件（paused 可恢复，非终态）
        clearSession(session, { deleteRuntime: false })
    }
    EventBus.emit({ type: 'plan:paused', planId: plan.id, sessionId: session.id })
    logger.agent.info('[PlanExecutor] Execution paused')
}

export async function resumePlanExecution(planId?: string): Promise<void> {
    const store = useAgentStore.getState()
    const plan = planId ? store.getPlan(planId) : store.getActivePlan()
    const workspacePath = gitService.getWorkspace()

    if (!plan || !workspacePath) return

    const session = getSessionByPlanId(plan.id) || createSession(plan.id, workspacePath)
    session.status = 'running'
    session.scheduler.resume()
    store.resumeExecution(plan.id)

    EventBus.emit({ type: 'plan:resumed', planId: plan.id, sessionId: session.id })

    runExecutionLoop(session).catch(error => {
        logger.agent.error('[PlanExecutor] Resume failed:', error)
        handleExecutionError(session, error)
    })
}

/**
 * 从最新检查点恢复图执行（Graph Runtime 阶段三）
 *
 * 场景：动态图执行中断后，用户点击「从断点恢复」。
 * 流程：
 * 1. 从 CheckpointManager 取回最新 checkpoint
 * 2. 重置 running 节点为 pending（跳过已完成）
 * 3. 注入 GraphState 快照
 * 4. 重新进入 runExecutionLoop
 *
 * @param planId 图/计划 id（可选，缺省取活跃 plan）
 * @returns 恢复结果；无检查点或图不存在返回 false
 */
export async function resumeGraphFromCheckpoint(planId?: string): Promise<{ success: boolean; message: string }> {
    const store = useAgentStore.getState()
    const plan = planId ? store.getPlan(planId) : store.getActivePlan()
    if (!plan) {
        return { success: false, message: 'No active plan found' }
    }

    if (!isDynamicGraphPlan(plan)) {
        return { success: false, message: 'Plan is not a dynamic graph (graphVersion=2 required)' }
    }

    const workspacePath = gitService.getWorkspace()
    if (!workspacePath) {
        return { success: false, message: 'No workspace open' }
    }

    const stateAdapter = new StoreGraphStateAdapter(plan.id)
    const restored = checkpointManager.restoreLatest(plan.id, stateAdapter)
    if (!restored) {
        return { success: false, message: `No checkpoint found for graph ${plan.id}` }
    }

    logger.agent.info(
        `[PlanExecutor] Resuming graph ${plan.id} from node ${restored.resumeFrom} (state restored)`,
    )

    // 创建/复用 session 并重新进入执行循环
    const session = getSessionByPlanId(plan.id) || createSession(plan.id, workspacePath)
    session.status = 'running'
    session.scheduler.resume()

    runExecutionLoop(session).catch(error => {
        logger.agent.error('[PlanExecutor] Checkpoint resume failed:', error)
        handleExecutionError(session, error)
    })

    return {
        success: true,
        message: `Resuming graph from node ${restored.resumeFrom}`,
    }
}

/**
 * 列出图的所有检查点（供 UI 展示断点恢复列表）
 */
export function listGraphCheckpoints(planId: string) {
    return checkpointManager.listCheckpoints(planId)
}

/**
 * 从持久化状态恢复图执行会话（Graph Runtime 阶段五）
 *
 * 由 graphRecovery 在应用启动时调用，将磁盘上的 runtime 状态恢复到内存。
 * 与 resumeGraphFromCheckpoint 的区别：
 * - resumeGraphFromCheckpoint：从内存 CheckpointManager 恢复（用户主动触发断点恢复）
 * - recoverSession：从磁盘 runtime.json 恢复（应用崩溃后自动恢复）
 *
 * 流程：
 * 1. createSession(plan.id, workspacePath) — 重建 session（自动挂载 graphScheduler）
 * 2. checkpointManager.loadPersistedCheckpoint(state.checkpoint) — 注入检查点到内存
 *    （注意：不调 restore，避免重复重置 running 节点；normalizeLoadedPlan 已处理）
 * 3. new StoreGraphStateAdapter(plan.id).importSnapshot(state.checkpoint.stateSnapshot)
 *    — 恢复 channels/metadata（含 LoopController 迭代计数）
 * 4. 按 session.status 分支：
 *    - awaiting_approval: session.status='awaiting_approval' + awaitingNodeId +
 *      updateTask(nodeId, running) + emit task:awaiting_approval 事件
 *      （UI 自动弹出 HumanApprovalCard，不进入 runExecutionLoop，等 resumeHumanNode）
 *    - running: session.status='running' + updatePlan(executing) + runExecutionLoop 继续推进
 *
 * 幂等性：
 * - normalizeLoadedPlan 已把 running→pending（崩溃前 running 的节点重置为 pending）
 * - checkpoint.completedNodes 保留 completed 节点（不重跑）
 * - 若 session 已存在（getSessionByPlanId）则跳过（防并发恢复）
 *
 * @param plan 当前 plan（调用方已校验 graphVersion=2 且非终态）
 * @param state 持久化状态文件内容
 * @param workspacePath 工作区路径
 * @returns 恢复结果
 */
export async function recoverSession(
    plan: TaskPlan,
    state: RuntimeStateFile,
    workspacePath: string,
): Promise<{ success: boolean; message: string }> {
    // 防并发：session 已存在则跳过（避免重复恢复）
    const existingSession = getSessionByPlanId(plan.id)
    if (existingSession) {
        logger.agent.info(
            `[PlanExecutor] recoverSession skipped (session already exists): plan ${plan.id}`,
        )
        return { success: false, message: `Session already exists for plan ${plan.id}` }
    }

    logger.agent.info(
        `[PlanExecutor] Recovering session for plan ${plan.id} from persisted state (status=${state.session.status})`,
    )

    // 1. 重建 session（自动挂载 graphScheduler + 注册到 bridge）
    const session = createSession(plan.id, workspacePath)

    // 2. 注入持久化的 checkpoint 到内存（不调 restore，避免重复重置节点）
    checkpointManager.loadPersistedCheckpoint(state.checkpoint)

    // 3. 恢复 GraphState 快照（channels/metadata/artifacts/nodeOutputs）
    //    metadata 含 loop:${nodeId}:iteration/reflection，恢复后 LoopController 继续计数
    const stateAdapter = new StoreGraphStateAdapter(plan.id)
    stateAdapter.importSnapshot(state.checkpoint.stateSnapshot)

    // 4. 按 session.status 分支恢复
    if (state.session.status === 'awaiting_approval') {
        // HITL 恢复：设置 awaiting 状态 + emit 事件，UI 自动弹出审批卡片
        const awaitingNodeId = state.session.awaitingNodeId
        if (!awaitingNodeId) {
            // 数据异常：awaiting_approval 但无 awaitingNodeId，删除 runtime 文件避免死循环
            logger.agent.warn(
                `[PlanExecutor] recoverSession: awaiting_approval but no awaitingNodeId, deleting runtime file: plan ${plan.id}`,
            )
            void deleteRuntimeState(workspacePath, plan.id)
            return { success: false, message: 'awaiting_approval state missing awaitingNodeId' }
        }

        session.status = 'awaiting_approval'
        session.awaitingNodeId = awaitingNodeId

        const store = useAgentStore.getState()
        // 标记 awaiting 节点为 running（UI 显示执行中状态）
        store.updateTask(plan.id, awaitingNodeId, {
            status: 'running',
            startedAt: Date.now(),
        } as Partial<PlanTask>)

        // emit 审批事件，useHumanApprovalWatcher 收到后渲染 HumanApprovalCard
        EventBus.emit({
            type: 'task:awaiting_approval',
            taskId: awaitingNodeId,
            planId: plan.id,
            threadId: state.checkpoint.traceId,
            requestId: state.checkpoint.traceId,
        })

        logger.agent.info(
            `[PlanExecutor] Recovered awaiting_approval state for plan ${plan.id}, node ${awaitingNodeId} (waiting for human approval)`,
        )

        return {
            success: true,
            message: `Recovered awaiting_approval state for node ${awaitingNodeId}`,
        }
    }

    // running 状态恢复：继续推进执行循环
    session.status = 'running'
    session.scheduler.resume()

    const store = useAgentStore.getState()
    store.updatePlan(plan.id, { status: 'executing' as PlanStatus })

    logger.agent.info(
        `[PlanExecutor] Recovered running state for plan ${plan.id}, resuming execution loop`,
    )

    // 重入执行循环（runExecutionLoop 会跳过 completed 节点，从 pending 节点继续）
    runExecutionLoop(session).catch(error => {
        logger.agent.error(`[PlanExecutor] Recovered session execution failed:`, error)
        handleExecutionError(session, error)
    })

    return {
        success: true,
        message: `Recovered running state for plan ${plan.id}`,
    }
}

/**
 * 恢复 human 节点的人工审批（Graph Runtime 阶段四 HITL）
 *
 * 场景：graphVersion=2 图执行到 human 节点时，executeTask 返回 pending，
 *       session 进入 'awaiting_approval' 状态暂停等待。用户在 UI 决议后调用此函数。
 *
 * 流程：
 * 1. 校验 session 存在且 status === 'awaiting_approval'
 * 2. 校验 awaitingNodeId 与传入 nodeId 一致
 * 3. approved=true → markTaskCompleted + 清空 awaitingNodeId
 *    approved=false → markTaskFailed + 清空 awaitingNodeId
 * 4. emit task:approval_resumed 事件
 * 5. session.status = 'running'，重入 runExecutionLoop
 *
 * 设计决策：
 * - 不复用 pausePlanExecution（太重，会 abort+clearSession 丢失 awaitingNodeId）
 * - 不复用 resumePlanExecution（语义是恢复 paused 状态，与 HITL 不同）
 * - awaitingNodeId 仅内存，跨重启会丢失（阶段五接 CheckpointManager 持久化）
 *
 * @param planId 图/计划 id
 * @param nodeId human 节点 id（必须与 session.awaitingNodeId 一致）
 * @param approved 用户审批结果：true=通过 / false=拒绝
 * @param feedback 可选反馈（拒绝原因等，写入 node.error 供下游判断）
 * @returns 恢复结果
 */
export async function resumeHumanNode(
    planId: string,
    nodeId: string,
    approved: boolean,
    feedback?: string,
): Promise<{ success: boolean; message: string }> {
    const store = useAgentStore.getState()
    const plan = store.getPlan(planId)
    if (!plan) {
        return { success: false, message: `Plan ${planId} not found` }
    }

    const session = getSessionByPlanId(planId)
    if (!session) {
        return { success: false, message: `No active session for plan ${planId}` }
    }

    if (session.status !== 'awaiting_approval') {
        return {
            success: false,
            message: `Session is not awaiting approval (current status: ${session.status})`,
        }
    }

    if (session.awaitingNodeId !== nodeId) {
        return {
            success: false,
            message: `Node ${nodeId} is not the awaiting node (expected: ${session.awaitingNodeId})`,
        }
    }

    logger.agent.info(
        `[PlanExecutor] Resuming human node ${nodeId} (approved=${approved}, feedback=${feedback || 'none'})`,
    )

    // 根据 approved 决议节点状态
    if (approved) {
        session.scheduler.markTaskCompleted({ id: nodeId } as PlanTask, 'Approved by human')
        store.markTaskCompleted(planId, nodeId, 'Approved by human')
    } else {
        const errorMsg = feedback || 'Rejected by human'
        session.scheduler.markTaskFailed({ id: nodeId } as PlanTask, errorMsg)
        store.markTaskFailed(planId, nodeId, errorMsg)
    }

    // 清空 awaiting 状态
    session.awaitingNodeId = undefined
    session.status = 'running'
    session.scheduler.resume()

    // 发射审批决议事件（供 UI 与审计）
    EventBus.emit({
        type: 'task:approval_resumed',
        taskId: nodeId,
        planId,
        approved,
        feedback,
    })

    // 重入执行循环（runExecutionLoop 会继续推进批次）
    runExecutionLoop(session).catch(error => {
        logger.agent.error('[PlanExecutor] Resume after human approval failed:', error)
        handleExecutionError(session, error)
    })

    return {
        success: true,
        message: approved
            ? `Node ${nodeId} approved, resuming execution`
            : `Node ${nodeId} rejected: ${feedback || 'no feedback'}`,
    }
}

/**
 * 查询当前是否有人工审批待处理（供 UI 显示审批弹窗）
 */
export function getPendingHumanApproval(planId?: string): {
    planId: string
    nodeId: string
} | null {
    if (planId) {
        const session = getSessionByPlanId(planId)
        if (session?.status === 'awaiting_approval' && session.awaitingNodeId) {
            return { planId: session.planId, nodeId: session.awaitingNodeId }
        }
        return null
    }

    // 无 planId 时扫描所有 session
    for (const session of sessions.values()) {
        if (session.status === 'awaiting_approval' && session.awaitingNodeId) {
            return { planId: session.planId, nodeId: session.awaitingNodeId }
        }
    }
    return null
}

export function getExecutionStatus(): {
    isRunning: boolean
    stats: ExecutionStats | null
} {
    const store = useAgentStore.getState()
    const plan = store.getActivePlan()
    if (!plan) {
        return { isRunning: false, stats: null }
    }

    const session = getSessionByPlanId(plan.id)
    if (!session) {
        return { isRunning: false, stats: null }
    }

    return {
        isRunning: session.status === 'running',
        stats: session.scheduler.calculateStats(plan, session.startedAt)
    }
}

export function getCurrentPhase(): 'planning' | 'executing' {
    const state = useAgentStore.getState()
    const activePlan = state.getActivePlan()
    return activePlan?.status === 'executing' || activePlan?.status === 'pausing' || activePlan?.status === 'stopping'
        ? 'executing'
        : 'planning'
}

async function runExecutionLoop(session: ExecutionSession): Promise<void> {
    const store = useAgentStore.getState()

    while (session.status === 'running' && !session.scheduler.isAborted) {
        const plan = store.getPlan(session.planId)
        if (!plan) {
            throw new Error(`Plan ${session.planId} not found during execution`)
        }

        // Graph Runtime 阶段四：graphVersion=2 使用 graphScheduler 的 boost 感知批次
        // - graphVersion=1 时 graphScheduler 为 undefined，走原 getParallelBatch（零变化）
        // - graphVersion=2 时优先用 getParallelBatchWithBoost，合并边路由 boost 节点
        const useGraphScheduler = !!session.graphScheduler && isDynamicGraphPlan(plan)

        if (plan.executionMode === 'parallel') {
            const batch = useGraphScheduler
                ? session.graphScheduler!.getParallelBatchWithBoost(plan as ExecutionGraph)
                : session.scheduler.getParallelBatch(plan)
            if (batch.length === 0) {
                if (session.scheduler.isComplete(plan) || !session.scheduler.hasRunningTasks()) {
                    await completeExecution(session, plan)
                }
                break
            }
            await Promise.all(batch.map(task => executeTask(session, task, plan)))
            // Graph Runtime 阶段四：批次完成后执行边路由后处理（boost 下一批节点）
            if (useGraphScheduler) {
                await routeAfterBatch(session, plan as ExecutionGraph, batch)
            }
        } else {
            const task = useGraphScheduler
                ? session.graphScheduler!.getNextTaskWithBoost(plan as ExecutionGraph)
                : session.scheduler.getNextTask(plan)
            if (!task) {
                if (session.scheduler.isComplete(plan) || !session.scheduler.hasRunningTasks()) {
                    await completeExecution(session, plan)
                }
                break
            }
            await executeTask(session, task, plan)
            // Graph Runtime 阶段四：单任务完成后边路由后处理
            if (useGraphScheduler) {
                await routeAfterBatch(session, plan as ExecutionGraph, [task])
            }
        }
    }
}

/**
 * Graph Runtime 阶段四：批次执行完成后的边路由后处理
 *
 * 流程：
 * 1. 对批次中每个 completed 节点，调用 edgeRouter.route 求值出边
 * 2. 命中的目标节点 id 通过 graphScheduler.boostReady 加入 boost 队列
 * 3. 下一轮 runExecutionLoop 会通过 getParallelBatchWithBoost 优先取出 boosted 节点
 *
 * 设计：
 * - 仅处理 completed 节点（failed 节点由 LoopController.tryLoopBack 在 executeTask 内处理）
 * - 边路由失败（target 不存在/条件不满足）保守跳过，不传播错误
 * - boost 机制不修改 plan.dependencies，避免污染持久化
 *
 * @param session 当前执行 session
 * @param graph 执行图
 * @param batch 刚执行完的批次
 */
async function routeAfterBatch(
    session: ExecutionSession,
    graph: ExecutionGraph,
    batch: PlanTask[],
): Promise<void> {
    if (!session.graphScheduler) return

    const state = new StoreGraphStateAdapter(graph.id)

    for (const task of batch) {
        // 仅对已完成的 GraphNode 做边路由（failed 走 LoopController，pending 走 boost）
        if (task.status !== 'completed') continue
        if (!isGraphNode(task)) continue

        const node = task as GraphNode
        // 无显式 edges 的节点走原拓扑推进，跳过（dependencies 由 base scheduler 处理）
        if (!node.edges || node.edges.length === 0) continue

        try {
            const targets = await edgeRouter.route(graph, node, state)
            if (targets.length > 0) {
                const targetIds = targets.map(t => t.id)
                session.graphScheduler.boostReady(targetIds)
                logger.agent.info(
                    `[PlanExecutor] Edge routed from ${node.id} → ${targetIds.join(',')} (boosted)`,
                )
            }
        } catch (err) {
            // 边路由失败不阻断执行，仅记录
            const errorMsg = err instanceof Error ? err.message : String(err)
            logger.agent.warn(
                `[PlanExecutor] Edge route failed for node ${node.id}: ${errorMsg}`,
            )
        }
    }
}

// ===== Graph Runtime 阶段四：NodeExecutor 分发辅助 =====
//
// 设计原则：
// - graphVersion=1（或非 GraphNode）→ 完全走原 runTaskWithAgent 路径，零变化
// - graphVersion=2 且 nodeType !== 'task'（tool/llm/decision/human）→ 走 NodeExecutor 分发
// - task 节点即使在 graphVersion=2 中也走 runTaskWithAgent（需 session/threadId/requestId，
//   不适合 NodeTypeExecutor 接口）
// - 三重守卫（在 graphGuard.ts 中实现）：isDynamicGraphPlan + isGraphNode + nodeType 校验

/**
 * 构造 GraphExecutionContext（供 NodeExecutor.execute 使用）
 *
 * 注入的回调：
 * - executeToolCall：包装 toolManager.execute，构造 ToolExecutionContext
 * - executeLlmCall：包装 api.llm.generateObject，单次 LLM 调用
 *
 * 设计：闭包捕获 session/threadId/requestId，让 NodeExecutor 不直接依赖重上下文
 */
function buildGraphExecutionContext(
    session: ExecutionSession,
    node: GraphNode,
    plan: ExecutionGraph,
    threadId: string,
    requestId: string,
    abortSignal?: AbortSignal,
): GraphExecutionContext {
    const workspacePath = session.workspacePath
    const traceId = `plan:${plan.id}:node:${node.id}`

    // tool 节点执行回调：构造 ToolExecutionContext 调用 toolManager.execute
    const executeToolCall: GraphExecutionContext['executeToolCall'] = async (toolCall) => {
        try {
            const { name, arguments: args } = toolCall
            const context: ToolExecutionContext = {
                workspacePath,
                threadId,
                requestId,
                toolCallId: `${requestId}_tool_${name}`,
                skipMainApproval: false,
                abortSignal,
            }
            const result = await toolManager.execute(name, args, context)
            return {
                success: result.success,
                output: result.result || '',
                error: result.error,
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            logger.agent.error(`[executeTask] Tool node ${node.id} execution failed: ${errorMsg}`)
            return { success: false, output: '', error: errorMsg }
        }
    }

    // llm 节点执行回调：调用 api.llm.generateObject
    const executeLlmCall: GraphExecutionContext['executeLlmCall'] = async (prompt) => {
        try {
            const config = await getLLMConfigForTask(node.provider, node.model)
            if (!config) {
                return {
                    success: false,
                    output: '',
                    error: `No LLM config for ${node.provider}/${node.model}`,
                }
            }
            const response = await api.llm.generateObject({
                config,
                schema: {
                    type: 'object',
                    properties: {
                        response: { type: 'string' },
                    },
                    required: ['response'],
                    additionalProperties: false,
                },
                system: 'You are a graph node executor. Respond with JSON {"response": string}.',
                prompt,
            })
            if (response.error) {
                return { success: false, output: '', error: response.error }
            }
            const obj = response.object
            const output = typeof obj === 'string'
                ? obj
                : (obj?.response ?? (typeof obj === 'object' ? JSON.stringify(obj) : String(obj)))
            return { success: true, output: output || '' }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            logger.agent.error(`[executeTask] LLM node ${node.id} execution failed: ${errorMsg}`)
            return { success: false, output: '', error: errorMsg }
        }
    }

    return {
        graph: plan,
        node,
        state: new StoreGraphStateAdapter(plan.id),
        workspacePath,
        traceId,
        parentSpanId: undefined,
        abortSignal,
        dependencySummary: node.dependencySummary,
        executeToolCall,
        executeLlmCall,
    }
}

/**
 * 通过 NodeExecutor 执行非 task 节点（tool/llm/decision/human）
 *
 * 返回结构与 runTaskWithAgent 对齐，便于 executeTask 后续统一处理：
 * - success + output
 * - pending（human 节点 HITL 暂停，区别于失败）
 * - error
 */
async function executeNodeViaNodeExecutor(
    session: ExecutionSession,
    node: GraphNode,
    plan: ExecutionGraph,
    threadId: string,
    requestId: string,
): Promise<{
    success: boolean
    output: string
    error?: string
    pending?: boolean
    threadId: string
    requestId: string
}> {
    const ctx = buildGraphExecutionContext(
        session,
        node,
        plan,
        threadId,
        requestId,
        session.abortControllers.get(node.id)?.signal,
    )

    const result = await nodeExecutor.execute(node, ctx)

    return {
        success: result.success,
        output: result.output || '',
        error: result.error,
        pending: result.pending,
        threadId,
        requestId,
    }
}

async function executeTask(
    session: ExecutionSession,
    task: PlanTask,
    plan: TaskPlan,
): Promise<void> {
    const store = useAgentStore.getState()
    const existingTask = store.getPlan(plan.id)?.tasks.find(candidate => candidate.id === task.id) || task
    const { threadId, requestId } = createTaskThreadBinding(existingTask)
    bindTaskRun(session, existingTask.id, {
        planId: plan.id,
        taskId: existingTask.id,
        threadId,
        requestId,
    })

    session.scheduler.markTaskRunning(existingTask)
    store.setCurrentTask(existingTask.id)
    store.updateTask(plan.id, existingTask.id, {
        status: 'running',
        startedAt: Date.now(),
        threadId,
        requestId,
        attempt: (existingTask.attempt || 0) + 1,
        dependencySummary: existingTask.dependencySummary,
        executionClass: existingTask.executionClass,
    })

    EventBus.emit({
        type: 'task:start',
        taskId: existingTask.id,
        planId: plan.id,
        threadId,
        requestId,
    })

    logger.agent.info(`[PlanExecutor] Executing task: ${existingTask.title}`)

    // Graph Runtime 阶段三：动态图节点入口打 checkpoint（支持中断后从节点恢复）
    // 同时标记当前活跃图，供 add_node/add_edge 工具定位
    if (isDynamicGraphPlan(plan)) {
        try {
            graphExecutionBridge.setCurrent(plan.id)
            const stateAdapter = new StoreGraphStateAdapter(plan.id)
            checkpointManager.checkpoint(
                plan as ExecutionGraph,
                existingTask as GraphNode,
                stateAdapter,
                requestId,
            )
            // 阶段五：checkpoint 后防抖持久化 runtime 状态（高频写避免阻塞执行）
            persistRuntimeState(session, plan, false)
        } catch (ckptErr) {
            // 检查点失败不阻断执行，仅记录
            logger.agent.warn(`[PlanExecutor] Checkpoint failed for node ${existingTask.id}:`, ckptErr)
        }
    }

    try {
        // Graph Runtime 阶段四：按节点类型分发
        // - graphVersion=2 且非 task 节点（tool/llm/decision/human）→ 走 NodeExecutor
        // - 其他情况（graphVersion=1 或 task 节点）→ 走原 runTaskWithAgent，零变化
        const dispatchToNodeExecutor = shouldDispatchToNodeExecutor(plan, existingTask)
        // 统一结果类型：合并 runTaskWithAgent 与 executeNodeViaNodeExecutor 的返回结构
        // - pending 仅 NodeExecutor 路径有（human 节点 HITL）
        // - assistantId 仅 runTaskWithAgent 路径有（Agent 子循环产出）
        const rawResult = dispatchToNodeExecutor
            ? await executeNodeViaNodeExecutor(
                  session,
                  existingTask,
                  plan as ExecutionGraph,
                  threadId,
                  requestId,
              )
            : await runTaskWithAgent(session, existingTask, store.getPlan(plan.id) || plan, threadId, requestId)
        // 归一化为统一结构（缺省字段补 undefined），避免 TS 联合类型字段访问报错
        const result: {
            success: boolean
            output: string
            error?: string
            pending?: boolean
            threadId: string
            assistantId?: string
            requestId: string
        } = {
            success: rawResult.success,
            output: rawResult.output,
            error: rawResult.error,
            pending: 'pending' in rawResult ? rawResult.pending : undefined,
            threadId: rawResult.threadId,
            assistantId: 'assistantId' in rawResult ? rawResult.assistantId : undefined,
            requestId: rawResult.requestId,
        }

        // Graph Runtime 阶段四：human 节点 HITL 暂停（pending=true）
        // 区别于普通失败：不 markTaskFailed，而是暂停 session 等待人工恢复
        if (!result.success && result.pending) {
            session.status = 'awaiting_approval'
            session.awaitingNodeId = existingTask.id
            // 保持任务状态为 running（不 markFailed），等待 resumeHumanNode 决议
            EventBus.emit({
                type: 'task:awaiting_approval',
                taskId: existingTask.id,
                planId: plan.id,
                threadId,
                requestId,
            })
            logger.agent.info(`[PlanExecutor] Task ${existingTask.id} awaiting human approval`)
            // 阶段五：awaiting_approval 是关键状态，立即持久化（无 debounce）
            // 确保崩溃后能恢复审批卡片，避免 HITL 状态丢失
            persistRuntimeState(session, plan, true)
            // 不进入失败/成功分支，直接 return（runExecutionLoop 见 status≠running 自然退出）
            return
        }

        if (!result.success && isCancellationReason(result.error)) {
            session.scheduler.markTaskPending(existingTask)
            store.updateTask(plan.id, existingTask.id, {
                status: 'pending',
                error: undefined,
                startedAt: undefined,
                completedAt: undefined,
            })

            if (session.status === 'pausing') {
                session.status = 'paused'
                store.pauseExecution(plan.id)
                EventBus.emit({ type: 'plan:paused', planId: plan.id, sessionId: session.id })
                // 阶段五：paused 状态持久化（立即写），保留 runtime 供崩溃恢复
                persistRuntimeState(session, plan, true)
                // deleteRuntime=false 保留 runtime 文件（paused 可恢复，非终态）
                clearSession(session, { deleteRuntime: false })
                return
            }

            if (session.status === 'stopping') {
                session.status = 'stopped'
                store.stopExecution(plan.id, 'stopped')
                clearSession(session)
                return
            }
        }

        if (result.success) {
            session.scheduler.markTaskCompleted(existingTask, result.output)
            store.markTaskCompleted(plan.id, existingTask.id, result.output)
            store.updateTask(plan.id, existingTask.id, {
                threadId: result.threadId,
                assistantId: result.assistantId,
                requestId: result.requestId,
            })

            EventBus.emit({
                type: 'task:complete',
                taskId: existingTask.id,
                output: result.output,
                duration: Date.now() - (existingTask.startedAt || Date.now()),
                threadId: result.threadId,
                assistantId: result.assistantId,
                requestId: result.requestId,
            })
        } else {
            // Graph Runtime：失败节点若携带 loop 边且未超 maxIterations，触发反思回流而非传播失败
            // 回流后节点状态重置为 pending，下一轮 while 循环会重新调度执行（带反思上下文）
            if (isGraphNode(existingTask)) {
                const graphState = createStateAccessor(plan.id)
                const loopTargets = loopController.tryLoopBack(plan as ExecutionGraph, existingTask as GraphNode, graphState)
                if (loopTargets.length > 0) {
                    // 回流：重置目标节点为 pending，重新入队
                    for (const target of loopTargets) {
                        session.scheduler.markTaskPending(target)
                        store.updateTask(plan.id, target.id, {
                            status: 'pending',
                            error: undefined,
                            startedAt: undefined,
                            completedAt: undefined,
                            // 注入反思上下文供 buildTaskMessage 读取
                            dependencySummary: target.dependencySummary,
                        } as Partial<PlanTask>)
                    }
                    logger.agent.info(`[PlanExecutor] Task ${existingTask.id} failed, looped back to ${loopTargets.map(t => t.id).join(',')}`)
                    // 不传播失败，继续 while 循环重新调度（反思上下文已注入 GraphState，下次执行读取）

                } else {
                    session.scheduler.markTaskFailed(existingTask, result.error || 'Unknown error')
                    store.markTaskFailed(plan.id, existingTask.id, result.error || 'Unknown error')
                    store.updateTask(plan.id, existingTask.id, {
                        threadId: result.threadId,
                        assistantId: result.assistantId,
                        requestId: result.requestId,
                    })

                    EventBus.emit({
                        type: 'task:failed',
                        taskId: existingTask.id,
                        error: result.error || 'Unknown error',
                        threadId: result.threadId,
                        assistantId: result.assistantId,
                        requestId: result.requestId,
                    })
                }
            } else {
                session.scheduler.markTaskFailed(existingTask, result.error || 'Unknown error')
                store.markTaskFailed(plan.id, existingTask.id, result.error || 'Unknown error')
                store.updateTask(plan.id, existingTask.id, {
                    threadId: result.threadId,
                    assistantId: result.assistantId,
                    requestId: result.requestId,
                })

                EventBus.emit({
                    type: 'task:failed',
                    taskId: existingTask.id,
                    error: result.error || 'Unknown error',
                    threadId: result.threadId,
                    assistantId: result.assistantId,
                    requestId: result.requestId,
                })
            }
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        session.scheduler.markTaskFailed(existingTask, errorMsg)
        store.markTaskFailed(plan.id, existingTask.id, errorMsg)
        EventBus.emit({ type: 'task:failed', taskId: existingTask.id, error: errorMsg, threadId, requestId })
        logger.agent.error(`[PlanExecutor] Task execution error: ${existingTask.title}`, error)
    } finally {
        session.bindings.delete(existingTask.id)
        session.abortControllers.delete(existingTask.id)
        if (store.currentTaskId === existingTask.id) {
            store.setCurrentTask(null)
        }
    }
}

async function completeExecution(session: ExecutionSession, plan: TaskPlan): Promise<void> {
    const stats = session.scheduler.calculateStats(plan, session.startedAt)
    const hasFailures = stats.failedTasks > 0

    const store = useAgentStore.getState()
    store.stopExecution(plan.id, hasFailures ? 'failed' : 'completed')

    session.status = hasFailures ? 'failed' : 'completed'
    EventBus.emit({ type: 'plan:complete', planId: plan.id, stats, sessionId: session.id })
    clearSession(session)

    logger.agent.info('[PlanExecutor] Execution complete:', stats)
}

function handleExecutionError(session: ExecutionSession, error: unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const store = useAgentStore.getState()
    store.stopExecution(session.planId, 'failed')

    session.status = 'failed'
    EventBus.emit({ type: 'plan:failed', planId: session.planId, error: errorMsg, sessionId: session.id })
    clearSession(session)

    logger.agent.error('[PlanExecutor] Plan execution failed:', errorMsg)
}

async function runTaskWithAgent(
    session: ExecutionSession,
    task: PlanTask,
    plan: TaskPlan,
    threadId: string,
    requestId: string,
): Promise<{ success: boolean; output: string; error?: string; threadId: string; assistantId?: string; requestId: string }> {
    try {
        const isCoderTask = /coder|developer|engineer/i.test(task.role || '')
        const maxReviewLoops = 3
        let currentLoop = 0
        let currentRole = task.role || 'default'
        let feedbackMessage = buildTaskMessage(task, plan)
        let finalOutput = ''
        let lastAssistantId: string | undefined
        let activeRequestId = requestId

        while (currentLoop < maxReviewLoops && session.status === 'running') {
            const llmConfig = await getLLMConfigForTask(task.provider, task.model)
            if (!llmConfig) {
                return { success: false, output: '', error: `Failed to get LLM config for ${task.provider}/${task.model}`, threadId, requestId: activeRequestId }
            }

            const templateId = mapRoleToTemplateId(currentRole)
            logger.agent.info(`[PlanExecutor] Emitting subtask. Loop: ${currentLoop}, Role: ${currentRole} (Template: ${templateId})`)

            if (session.status !== 'running') {
                return { success: false, output: '', error: 'aborted', threadId, requestId: activeRequestId }
            }

            const completionPromise = waitForAgentCompletion({
                threadId,
                requestId: activeRequestId,
                taskId: task.id,
            })

            const sendPromise = Agent.send(
                feedbackMessage,
                llmConfig,
                session.workspacePath,
                'agent',
                {
                    promptTemplateId: templateId,
                    planPhase: 'executing',
                },
                {
                    threadId,
                    requestId: activeRequestId,
                    planTaskId: task.id,
                }
            ).then(
                execution => ({ execution }),
                error => ({ error })
            )

            const firstOutcome = await Promise.race([
                completionPromise.then(result => ({ result })),
                sendPromise,
            ])

            if ('error' in firstOutcome) {
                const errorMsg = firstOutcome.error instanceof Error ? firstOutcome.error.message : String(firstOutcome.error)
                return { success: false, output: '', error: errorMsg, threadId, requestId: activeRequestId }
            }

            const sendOutcome = 'execution' in firstOutcome ? firstOutcome : await sendPromise
            if ('error' in sendOutcome) {
                const errorMsg = sendOutcome.error instanceof Error ? sendOutcome.error.message : String(sendOutcome.error)
                return { success: false, output: '', error: errorMsg, threadId, requestId: activeRequestId }
            }

            const execution = sendOutcome.execution
            const result = 'result' in firstOutcome ? firstOutcome.result : await completionPromise
            lastAssistantId = result.assistantId || execution.assistantId
            activeRequestId = execution.requestId
            bindTaskRun(session, task.id, {
                planId: plan.id,
                taskId: task.id,
                threadId: execution.threadId,
                assistantId: lastAssistantId,
                requestId: execution.requestId,
            })

            if (!result.success) {
                return { ...result, threadId: execution.threadId, assistantId: lastAssistantId, requestId: execution.requestId }
            }

            finalOutput = result.output

            if (isCoderTask) {
                if (currentRole !== 'reviewer') {
                    currentRole = 'reviewer'
                    feedbackMessage = `[System: Reviewer Phase]\nCoder has completed the sequence for task: "${task.title}".\nPlease verify the latest changes. Use reading tools if necessary. If everything is fully correct and meets requirements without regressions, output exactly <LGTM>. Otherwise, point out the exact logical flaws or remaining steps.`
                    currentLoop++
                } else if (finalOutput.includes('<LGTM>')) {
                    break
                } else {
                    currentRole = task.role || 'coder'
                    feedbackMessage = `[System: Coder Phase]\nReviewer found issues or missing steps:\n\n${finalOutput}\n\nPlease address these issues and continue working on the task.`
                    currentLoop++
                }
            } else {
                break
            }
        }

        return { success: true, output: finalOutput, threadId, assistantId: lastAssistantId, requestId: activeRequestId }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        return { success: false, output: '', error: errorMsg, threadId, requestId }
    }
}

function buildTaskMessage(task: PlanTask, plan: TaskPlan): string {
    const lines: string[] = []

    lines.push('# Task Execution Request')
    lines.push('')
    lines.push(`## Task: ${task.title}`)
    lines.push('')
    lines.push('### Description')
    lines.push(task.description)
    lines.push('')

    if (plan.requirementsContent) {
        lines.push('### Requirements Context')
        lines.push('')
        const truncated = plan.requirementsContent.length > 3000
            ? plan.requirementsContent.slice(0, 3000) + '\n\n... (truncated)'
            : plan.requirementsContent
        lines.push(truncated)
        lines.push('')
    }

    const dependencySummaries = (task.dependencySummary || buildDependencySummaryFromPlan(task, plan))
        .filter(summary => Boolean(summary.summary))

    if (dependencySummaries.length > 0) {
        lines.push('### Dependency Summaries')
        lines.push('')
        for (const summary of dependencySummaries) {
            lines.push(`- **${summary.title}** [${summary.status}]: ${summary.summary}`)
        }
        lines.push('')
    }

    // Graph Runtime：若节点处于循环重试中，注入反思上下文引导 LLM 调整策略
    if (isGraphNode(task)) {
        const graphState = createStateAccessor(plan.id)
        const reflection = loopController.getReflection(task.id, graphState)
        if (reflection) {
            lines.push('### ⚠️ Reflection (Retry Context)')
            lines.push('')
            lines.push(reflection)
            lines.push('')
        }
    }

    lines.push('### Instructions')
    lines.push('')
    lines.push('1. Execute this task completely')
    lines.push('2. Use all available tools as needed')
    lines.push('3. When finished, provide a clear summary of what you accomplished')
    lines.push('4. Do NOT ask for user confirmation - just execute')
    lines.push('')
    lines.push('### Important')
    lines.push(`- You are part of plan: "${plan.name}"`)
    lines.push(`- Bound identity: planId=${plan.id}, taskId=${task.id}, threadId=${task.threadId || 'pending'}, requestId=${task.requestId || 'pending'}`)
    lines.push('- Focus ONLY on this specific task')
    lines.push('- Be thorough and handle edge cases')

    return lines.join('\n')
}

function buildDependencySummaryFromPlan(task: PlanTask, plan: TaskPlan): DependencySummary[] {
    return task.dependencies
        .map(depId => plan.tasks.find(t => t.id === depId))
        .filter((depTask): depTask is PlanTask => Boolean(depTask))
        .map(depTask => ({
            taskId: depTask.id,
            title: depTask.title,
            summary: (depTask.output || depTask.error || '').slice(0, 600),
            status: (depTask.status === 'completed' || depTask.status === 'failed' || depTask.status === 'skipped')
                ? depTask.status
                : 'completed',
        }))
}

function mapRoleToTemplateId(role: string): string {
    const r = role.toLowerCase()
    if (r.includes('frontend') || r.includes('backend') || r.includes('developer') || r.includes('coder') || r.includes('engineer')) {
        return 'coder'
    }
    if (r.includes('architect') || r.includes('system design')) {
        return 'architect'
    }
    if (r.includes('ui') || r.includes('ux') || r.includes('designer') || r.includes('visual')) {
        return 'uiux-designer'
    }
    if (r.includes('analyst') || r.includes('research') || r.includes('gather') || r.includes('planning')) {
        return 'analyst'
    }
    if (r.includes('review') || r.includes('audit') || r.includes('careful')) {
        return 'reviewer'
    }
    if (r.includes('concise') || r.includes('efficient') || r.includes('minimal')) {
        return 'concise'
    }
    return role
}

// ============================================
// 测试专用导出（Graph Runtime 阶段五）
// ============================================
//
// 暴露内部函数供单元测试精准验证持久化钩子行为，避免测试需要 mock 整个执行链路
// （store/Agent/api/scheduler/toolManager 等重依赖，mock 量过大且脆弱）。
//
// 生产代码不应使用这些导出。通过下划线前缀 + __testHelpers 命名明确标识。
//
export const __testHelpers = {
    /** 持久化 runtime 状态（守卫 + 序列化 + 调用 saveRuntimeState*） */
    persistRuntimeState,
    /** 清理 session（含 deleteRuntime 选项） */
    clearSession,
    /** 创建 session */
    createSession,
    /** 按 planId 查询 session */
    getSessionByPlanId,
}
