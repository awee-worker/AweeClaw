/**
 * Graph Runtime 核心类型定义
 *
 * 设计原则（演进式，零破坏）：
 * - GraphNode extends PlanTask：保留所有旧字段，新增全部 optional，缺省回退现有行为
 * - ExecutionGraph extends TaskPlan：复用持久化通道，graphVersion 随 TaskPlan 持久化
 * - 边（edges）与依赖（dependencies）并存：dependencies 决定就绪，edges 决定流向
 *
 * @module GraphRuntime
 */

import type {
  PlanTask,
  TaskPlan,
  DependencySummary,
  TaskExecutionResult,
} from '../planner/planTypes'

// ============================================
// 节点与边
// ============================================

/**
 * 节点类型 —— 决定执行器如何运行该节点
 * - task：执行一个子 Agent 子循环（现有行为，复用 AgentSubLoop）
 * - llm：单次 LLM 调用（轻量决策 / 路由判断）
 * - tool：直接执行工具（不走子循环）
 * - decision：纯路由节点，不求值副作用，仅决定下一步
 * - human：HITL 节点，暂停等待人工输入
 */
export type GraphNodeType = 'task' | 'llm' | 'tool' | 'decision' | 'human'

/**
 * 边类型
 * - simple：无条件，节点完成后直接到 target
 * - conditional：条件边，由 condition 求值决定是否走该边（可多条，首个为真者生效，短路）
 * - loop：循环边，target 指向已执行节点（含自身），受 maxIterations 约束，用于反思重试
 */
export type GraphEdgeType = 'simple' | 'conditional' | 'loop'

/**
 * 条件求值定义
 * - rule：声明式表达式（受限沙箱求值，非 eval），适合简单字段判断
 * - llm：异步 LLM 判断，适合复杂语义判断（如"上游输出是否含错误需重试"）
 */
export interface EdgeCondition {
  kind: 'rule' | 'llm'
  /** rule 模式：表达式，如 "state.retryCount < 3 && node.status === 'failed'" */
  expression?: string
  /** llm 模式：判断 prompt */
  prompt?: string
}

/**
 * 图的边 —— 显式出边
 *
 * 与 PlanTask.dependencies 的关系：
 * - dependencies（入边）：决定节点何时就绪（依赖全部完成后才可执行）
 * - edges（出边）：决定节点完成后流向哪个节点
 * - 二者并存，互不冲突：无 edges 时回退到依赖拓扑自动推进（现有行为）
 */
export interface GraphEdge {
  /** 源节点 id（隐含于 GraphNode.edges，可留空） */
  source?: string
  /** 目标节点 id */
  target: string
  type: GraphEdgeType
  /** 条件求值（仅 conditional 类型有意义；simple/loop 时忽略） */
  condition?: EdgeCondition
  /** loop 边的循环上限（覆盖节点 maxIterations，默认 2，对齐 PlanConfig.maxRetries） */
  maxIterations?: number
}

/**
 * 图节点 —— 扩展自 PlanTask，保持向后兼容
 *
 * 兼容策略：
 * - PlanTask 的所有字段保留，旧执行器仍可按 PlanTask 读取
 * - 新增字段全部 optional，缺省时回退到现有行为
 * - nodeType 缺省时按 'task' 处理（现有 AgentSubLoop 行为）
 */
export interface GraphNode extends PlanTask {
  /** 节点类型，缺省 'task'（现有行为） */
  nodeType?: GraphNodeType
  /** 显式出边。空时回退到 dependencies 拓扑自动推进 */
  edges?: GraphEdge[]
  /** 节点级状态读键，用于从 GraphState 通道读取数据 */
  stateReads?: string[]
  /** 节点级状态写键，用于向 GraphState 通道写入数据 */
  stateWrites?: string[]
  /** 该节点是否需要人工审批（true 时覆盖全局授权方式，强制审批） */
  requireApproval?: boolean
  /** 循环控制：最大重试次数（覆盖 PlanConfig.maxRetries，默认 2） */
  maxIterations?: number
  /** 该节点当前循环执行次数（LoopController 维护，用于反思重试计数） */
  iterationCount?: number
  /** tool 节点专用：要执行的工具调用（name + arguments）。缺省时 tool 执行器报错 */
  toolCall?: {
    name: string
    arguments: Record<string, unknown>
  }
  /** llm 节点专用：LLM 调用 prompt（缺省时回退到 description） */
  llmPrompt?: string
}

/**
 * 类型守卫：判断 PlanTask 是否为 GraphNode（是否携带图扩展字段）
 *
 * 判定依据：存在 nodeType 或 edges 任一图扩展字段即视为 GraphNode。
 * 运行时无法区分 extends 关系，故用字段存在性判定。
 */
export function isGraphNode(task: PlanTask): task is GraphNode {
  const node = task as GraphNode
  return node.nodeType !== undefined || (node.edges !== undefined && node.edges.length > 0)
}

/**
 * 将 PlanTask 安全转换为 GraphNode（不改变原对象，补充缺省字段）
 */
export function asGraphNode(task: PlanTask): GraphNode {
  return task as GraphNode
}

// ============================================
// 执行图
// ============================================

/**
 * 执行图 —— 扩展自 TaskPlan
 *
 * 兼容策略：
 * - tasks 字段类型升级为 GraphNode[]（GraphNode extends PlanTask，数组兼容）
 * - 旧代码读取 plan.tasks 仍得到 PlanTask 字段
 * - graphVersion 用于区分图能力：1=静态 DAG（现有行为），2=动态图
 *
 * 注意：graphVersion 字段定义在 TaskPlan 上以随持久化流转，
 *       此处仅声明类型约束；roots/allowDynamicExpansion 为运行时维护。
 */
export interface ExecutionGraph extends TaskPlan {
  /** 图能力版本（1=静态DAG，2=动态图）。运行时维护，graphVersion 见 TaskPlan */
  /** 根节点 id 列表（无入边的节点）。graphVersion=2 时由建图器填充 */
  roots?: string[]
  /** 是否允许运行时动态加节点（graphVersion=2 且为 true 时 GraphScheduler.addNode 生效） */
  allowDynamicExpansion?: boolean
}

/**
 * 将 TaskPlan 视为 ExecutionGraph（不改变原对象）
 */
export function asExecutionGraph(plan: TaskPlan): ExecutionGraph {
  return plan as ExecutionGraph
}

/**
 * 判断是否为动态图（graphVersion=2）
 */
export function isDynamicGraph(plan: TaskPlan): boolean {
  return (plan as ExecutionGraph).roots !== undefined ||
    (plan as ExecutionGraph).allowDynamicExpansion === true
}

// ============================================
// 图状态（统一适配层）
// ============================================

/**
 * 图运行时统一状态 —— 节点间数据通道
 *
 * 设计：薄适配层，非新 store
 * - channels：节点间显式数据流（key 对应 stateReads/stateWrites）
 * - messages：对话历史（代理到 conversationSlice）
 * - artifacts：产出物（文件路径、图、报告等）
 * - nodeOutputs：各节点输出（代理到 taskSlice 的 PlanTask.output）
 * - metadata：任意元数据（计数器、标志位、循环反思上下文等）
 */
export interface GraphState {
  /** 节点间数据通道（显式 stateReads/Writes 对应） */
  channels: Record<string, unknown>
  /** 对话消息（代理 conversationSlice） */
  messages: unknown[]
  /** 产出物路径 */
  artifacts: string[]
  /** 节点输出快照（代理 taskSlice） */
  nodeOutputs: Record<string, string>
  /** 任意元数据：retryCount、标志位、外部输入、循环反思等 */
  metadata: Record<string, unknown>
}

/**
 * 状态读写器 —— 节点通过它访问状态，底层路由到 store
 *
 * 职责：隔离节点逻辑与 store 实现，便于测试与替换。
 * - read/write：通用键值（含 metadata）
 * - readChannel/writeChannel：节点间显式数据通道
 * - getNodeOutput/setNodeOutput：代理 PlanTask.output
 */
export interface GraphStateAccessor {
  /** 通用读取（优先 channels，其次 metadata） */
  read(key: string): unknown
  /** 通用写入（默认写 metadata） */
  write(key: string, value: unknown): void
  /** 节点间数据通道读 */
  readChannel(key: string): unknown
  /** 节点间数据通道写 */
  writeChannel(key: string, value: unknown): void
  /** 读取节点输出（代理 PlanTask.output） */
  getNodeOutput(nodeId: string): string | undefined
  /** 写入节点输出（代理 taskSlice.markTaskCompleted） */
  setNodeOutput(nodeId: string, output: string): void
  /** 读取元数据 */
  getMetadata(key: string): unknown
  /** 写入元数据 */
  setMetadata(key: string, value: unknown): void
  /**
   * 读取全部元数据快照（供 EdgeRouter 规则表达式求值等需要遍历的场景）
   * 可选实现：测试 mock 或轻量适配器可不实现，调用方需做存在性判断
   */
  getAllMetadata?(): Record<string, unknown>
}

// ============================================
// 节点执行结果与上下文（阶段二/三使用，此处先定义）
// ============================================

/**
 * 节点执行结果 —— 扩展自 TaskExecutionResult
 */
export interface NodeExecutionResult extends TaskExecutionResult {
  /** 节点 id（继承自 TaskExecutionResult.taskId） */
  /** 是否成功（继承自 TaskExecutionResult.success） */
  /** 是否触发了循环回流（LoopController 回流时为 true） */
  looped?: boolean
  /** 本次循环迭代次数 */
  iteration?: number
  /**
   * 是否处于暂停等待状态（human 节点 HITL 专用）
   * - true：节点未完成但需暂停等待外部输入（人工审批），区别于普通失败
   * - 调用方据此走暂停分支而非失败处理
   */
  pending?: boolean
}

/**
 * 图执行上下文 —— 传递给 NodeExecutor
 */
export interface GraphExecutionContext {
  /** 图实例 */
  graph: ExecutionGraph
  /** 当前节点 */
  node: GraphNode
  /** 状态访问器 */
  state: GraphStateAccessor
  /** 工作区路径 */
  workspacePath: string
  /** 追踪 id（用于 Span 关联） */
  traceId: string
  /** 父 Span id（图根 span） */
  parentSpanId?: string
  /** 中止信号 */
  abortSignal?: AbortSignal
  /** 上游依赖摘要（复用现有 DependencySummary） */
  dependencySummary?: DependencySummary[]
  /**
   * tool 节点执行回调（由 executeTask 注入闭包，内部封装 orchestrateToolBatch）
   *
   * 设计：NodeExecutor 不直接依赖 ToolExecutionContext/ThreadBoundStore 等重上下文，
   * 而通过此回调解耦。executeTask 构造 ctx 时注入闭包，闭包内捕获 session/store 调用真实工具编排。
   * 非 tool 节点无需此回调。
   */
  executeToolCall?: (
    toolCall: { name: string; arguments: Record<string, unknown> },
  ) => Promise<{ success: boolean; output: string; error?: string }>
  /**
   * llm 节点执行回调（由 executeTask 注入闭包，内部封装 api.llm.generateObject）
   * 非 llm 节点无需此回调。
   */
  executeLlmCall?: (prompt: string) => Promise<{ success: boolean; output: string; error?: string }>
}

/**
 * 图静态配置（描述图本身的配置，扩展 PlanConfig，阶段二/三使用）
 * 与 graphRuntime.ts 的 GraphRuntimeConfig（运行时实例配置）区分
 */
export interface GraphStaticConfig {
  /** 图能力版本 */
  graphVersion: 1 | 2
  /** 是否允许运行时动态扩展 */
  allowDynamicExpansion: boolean
  /** 默认循环最大次数 */
  defaultMaxIterations: number
  /** 条件边 LLM 求值超时（毫秒） */
  edgeLlmTimeout: number
}

/** 默认图静态配置 */
export const DEFAULT_GRAPH_STATIC_CONFIG: GraphStaticConfig = {
  graphVersion: 1,
  allowDynamicExpansion: false,
  defaultMaxIterations: 2,
  edgeLlmTimeout: 30000,
}
