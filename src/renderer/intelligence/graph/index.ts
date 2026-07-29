/**
 * Graph Runtime 模块入口
 *
 * 阶段一：仅导出类型与状态适配层，不改任何执行行为。
 * 现有代码不引用本模块，故零破坏。
 *
 * 后续阶段将在此追加 GraphScheduler / EdgeRouter / LoopController / NodeExecutor / CheckpointManager。
 *
 * @module GraphRuntime
 */

// 核心类型
export type {
  GraphNodeType,
  GraphEdgeType,
  EdgeCondition,
  GraphEdge,
  GraphNode,
  ExecutionGraph,
  GraphState,
  GraphStateAccessor,
  NodeExecutionResult,
  GraphExecutionContext,
  GraphStaticConfig,
} from './graphTypes'

export {
  isGraphNode,
  asGraphNode,
  asExecutionGraph,
  isDynamicGraph,
  DEFAULT_GRAPH_STATIC_CONFIG,
} from './graphTypes'

// 状态适配层
export {
  StoreGraphStateAdapter,
  createStateAccessor,
  readReflection,
  readIteration,
  nodeRequiresApproval,
} from './GraphStateAdapter'

// 阶段二：图调度核心
export { LoopController, loopController } from './LoopController'
export { EdgeRouter, edgeRouter } from './EdgeRouter'
export type { LlmConditionEvaluator } from './EdgeRouter'
export { GraphScheduler, createGraphScheduler } from './GraphScheduler'

// 阶段三：节点执行 / 检查点 / 运行时入口
// 阶段四：升级为模块单例 nodeExecutor + registerRealExecutors 注入真实执行器
export {
  NodeExecutor,
  nodeExecutor,
  registerRealExecutors,
  clearExecutors,
  createNodeExecutor,
} from './NodeExecutor'
export type { NodeTypeExecutor } from './NodeExecutor'
export { createToolExecutor, createLlmExecutor } from './realExecutors'
export { CheckpointManager, checkpointManager } from './CheckpointManager'
export type { NodeCheckpoint, RestoreResult } from './CheckpointManager'
export { GraphRuntime, createGraphRuntime, DEFAULT_RUNTIME_CONFIG } from './graphRuntime'
export type { GraphRuntimeConfig, GraphRunResult, GraphRunStatus } from './graphRuntime'

// 阶段三：动态建图桥接器（供 add_node/add_edge 工具访问当前执行图）
export { graphExecutionBridge } from './GraphExecutionBridge'
export type { GraphSessionHandle } from './GraphExecutionBridge'

// 阶段四：守卫逻辑（纯函数，便于测试与复用）
export { isDynamicGraphPlan, shouldDispatchToNodeExecutor } from './graphGuard'
