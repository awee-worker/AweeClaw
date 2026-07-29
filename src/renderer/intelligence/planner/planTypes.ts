/**
 * Plan 类型定义
 *
 * 设计原则：复用现有系统，不造轮子
 * - role → 映射到 promptTemplateId
 * - provider/model → 使用现有的 providerConfigs
 */

// ============================================
// 持久化目录常量
// ============================================

/**
 * Plan 持久化目录名（相对 ${BRAND.dirName}/）
 *
 * 统一所有 plan 文件读写路径，消除历史 `plan/` 与 `planner/` 目录不一致问题。
 * 旧版本数据落在 `plan/` 目录的，loadPlansFromDisk 会兼容回退读取。
 */
export const PLAN_DIR_NAME = 'planner'

/** 旧版 plan 目录名（兼容回退读取用） */
export const LEGACY_PLAN_DIR_NAME = 'plan'

// ============================================
// 状态机类型
// ============================================

/** Plan 状态 */
export type PlanState =
    | 'idle'        // 空闲，等待用户输入
    | 'gathering'   // 收集需求（多轮对话）
    | 'planning'    // 生成任务计划
    | 'reviewing'   // 等待用户审批
    | 'ready'       // 计划已批准，待执行
    | 'executing'   // 执行中
    | 'paused'      // 已暂停
    | 'completed'   // 已完成
    | 'failed'      // 失败

// ============================================
// 任务类型
// ============================================

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'

/** 执行模式 */
export type ExecutionMode = 'sequential' | 'parallel'

/** 计划状态 */
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'pausing' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'failed'

export type TaskExecutionClass = 'analysis-read-heavy' | 'write-heavy' | 'approval-heavy' | 'general'

export interface TaskResourceScope {
    kind: 'file' | 'scope'
    value: string
}

export interface DependencySummary {
    taskId: string
    title: string
    summary: string
    status: Extract<TaskStatus, 'completed' | 'failed' | 'skipped'>
}

/** 单个任务 */
export interface PlanTask {
    id: string
    title: string
    description: string
    /** 分配的 Provider（来自 BUILTIN_PROVIDERS） */
    provider: string
    /** 分配的模型 */
    model: string
    /** 分配的角色（对应 promptTemplateId，如 'default', 'professional', 'reviewer'） */
    role: string
    /** 依赖的任务 ID */
    dependencies: string[]
    /** 任务状态 */
    status: TaskStatus
    /** 执行输出 */
    output?: string
    /** 错误信息 */
    error?: string
    /** 开始时间 */
    startedAt?: number
    /** 完成时间 */
    completedAt?: number
    /** 重试次数 */
    retryCount?: number
    /** 当前运行线程 ID */
    threadId?: string
    /** 当前运行助手消息 ID */
    assistantId?: string
    /** 当前执行请求 ID */
    requestId?: string
    /** 调度尝试次数 */
    attempt?: number
    /** 调度优先级，越大越优先 */
    priority?: number
    /** 预计消耗 token */
    estimatedTokens?: number
    /** 任务将写入的文件/资源 */
    producesFiles?: string[]
    /** 任务将读取或依赖的文件/资源 */
    consumesFiles?: string[]
    /** 执行类别，用于并发调度 */
    executionClass?: TaskExecutionClass
    /** 上游任务输出摘要，供下游任务注入上下文 */
    dependencySummary?: DependencySummary[]
}

/** 任务计划 */
export interface TaskPlan {
    id: string
    name: string
    createdAt: number
    updatedAt: number
    /** 持久化修订号，用于避免并发覆盖 */
    revision?: number
    /** 需求文档路径（相对于 BRAND.dirName/planner/） */
    requirementsDoc: string
    /** 需求文档内容（缓存，用于注入上下文） */
    requirementsContent?: string
    /** 执行模式 */
    executionMode: ExecutionMode
    /** 计划状态 */
    status: PlanStatus
    /** 任务列表 */
    tasks: PlanTask[]
    /** 用户原始请求 */
    userRequest?: string
    /**
     * 图能力版本（Graph Runtime）
     * - 缺省/1：静态 DAG，回退现有执行行为（拓扑排序 + 并行批次）
     * - 2：动态图，启用条件边 / 循环回流 / 运行时建图
     * 字段 optional 保证旧版本持久化数据向后兼容
     */
    graphVersion?: 1 | 2
}

// ============================================
// 执行上下文（传递给任务执行器）
// ============================================

/** 任务执行上下文 */
export interface TaskExecutionContext {
    /** 工作区路径 */
    workspacePath: string
    /** 当前计划 */
    plan: TaskPlan
    /** 当前任务 */
    task: PlanTask
    /** 已完成任务的输出（可用于传递上下文） */
    completedOutputs: Record<string, string>
    /** 依赖任务摘要（优先使用，而不是原始完整输出） */
    dependencySummary: DependencySummary[]
    /** 需求文档内容 */
    requirementsContent?: string
}

/** 任务执行结果 */
export interface TaskExecutionResult {
    taskId: string
    success: boolean
    output: string
    error?: string
    duration: number
}

/** 执行统计 */
export interface ExecutionStats {
    totalTasks: number
    completedTasks: number
    failedTasks: number
    skippedTasks: number
    totalDuration: number
    startedAt: number
    completedAt?: number
}

export interface ExecutionSessionTaskBinding {
    planId: string
    taskId: string
    threadId: string
    assistantId?: string
    requestId: string
}

export interface ExecutionSession {
    id: string
    planId: string
    workspacePath: string
    startedAt: number
    scheduler: import('./TaskScheduler').ExecutionScheduler
    /**
     * Session 状态
     * - running / pausing / paused / stopping / stopped / completed / failed：现有语义
     * - awaiting_approval：Graph Runtime 阶段四新增，human 节点 HITL 暂停
     *   （区别于 paused：不 abort 现有任务、不清空 session，仅停止批次推进等待恢复）
     */
    status: 'running' | 'pausing' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'awaiting_approval'
    bindings: Map<string, ExecutionSessionTaskBinding>
    abortControllers: Map<string, AbortController>
    /**
     * Graph Runtime 阶段四：图调度器实例（仅 graphVersion=2 时挂载）
     * - 持有 boost 机制、边路由等图能力
     * - undefined 时（graphVersion=1）所有图分支跳过，走原拓扑行为
     */
    graphScheduler?: import('../graph/GraphScheduler').GraphScheduler
    /**
     * 当前等待人工审批的节点 id（human 节点 HITL 专用）
     * - status === 'awaiting_approval' 时必有值
     * - resumeHumanNode(approved) 时据此节点恢复执行
     */
    awaitingNodeId?: string
}

// ============================================
// 事件类型
// ============================================

/** Plan 事件 */
export type PlanEvent =
    | { type: 'state:change'; from: PlanState; to: PlanState }
    | { type: 'task:start'; taskId: string; planId: string; threadId?: string; assistantId?: string; requestId?: string }
    | { type: 'task:progress'; taskId: string; message: string }
    | { type: 'task:complete'; taskId: string; output: string; duration: number; threadId?: string; assistantId?: string; requestId?: string }
    | { type: 'task:failed'; taskId: string; error: string; threadId?: string; assistantId?: string; requestId?: string }
    | { type: 'task:skipped'; taskId: string; reason: string }
    | { type: 'plan:start'; planId: string; sessionId?: string }
    | { type: 'plan:complete'; planId: string; stats: ExecutionStats; sessionId?: string }
    | { type: 'plan:failed'; planId: string; error: string; sessionId?: string }
    | { type: 'plan:paused'; planId: string; sessionId?: string }
    | { type: 'plan:resumed'; planId: string; sessionId?: string }

// ============================================
// 配置
// ============================================

/** Plan 配置 */
export interface PlanConfig {
    /** 最大重试次数 */
    maxRetries: number
    /** 任务超时（毫秒） */
    taskTimeout: number
    /** 是否自动跳过失败依赖的任务 */
    autoSkipOnDependencyFailure: boolean
    /** 并行执行的最大并发数 */
    maxConcurrency: number
}

/** 默认配置 */
export const DEFAULT_PLAN_CONFIG: PlanConfig = {
    maxRetries: 2,
    taskTimeout: 0, // 0 = 不限制超时
    autoSkipOnDependencyFailure: true,
    maxConcurrency: 3,
}
