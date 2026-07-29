/**
 * GraphScheduler 单元测试
 *
 * 验证组合调度器的路由优先级：
 * 1. 循环回流优先（失败 + loop 边 + 未超限）
 * 2. 显式出边（conditional/simple）
 * 3. 回退依赖拓扑（无 edges → base.getExecutableTasks）
 *
 * 同时验证复用 base 的能力（getParallelBatch/getNextTask）与动态建图。
 *
 * @module GraphRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@toolkit/LogEngine', () => ({
  logger: {
    agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

// Mock IntelligenceStore（GraphStateAdapter + GraphScheduler 依赖）
const mockStore = {
  getPlan: vi.fn(() => null),
  markTaskCompleted: vi.fn(),
  updatePlan: vi.fn(),
  updateTask: vi.fn(),
}
vi.mock('../../state/IntelligenceStore', () => ({
  useAgentStore: { getState: () => mockStore },
}))

import { GraphScheduler } from '../GraphScheduler'
import { ExecutionScheduler } from '../../planner/TaskScheduler'
import { StoreGraphStateAdapter } from '../GraphStateAdapter'
import type { GraphNode, ExecutionGraph } from '../graphTypes'
import type { PlanTask } from '../../planner/planTypes'

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'n1',
    title: 'Node',
    description: '',
    provider: 'openai',
    model: 'gpt-4',
    role: 'default',
    dependencies: [],
    status: 'pending',
    ...overrides,
  } as GraphNode
}

function makeGraph(nodes: GraphNode[], overrides: Partial<ExecutionGraph> = {}): ExecutionGraph {
  return {
    id: 'g1',
    name: 'test',
    createdAt: 0,
    updatedAt: 0,
    requirementsDoc: '',
    executionMode: 'parallel',
    status: 'executing',
    tasks: nodes as PlanTask[],
    ...overrides,
  } as ExecutionGraph
}

describe('GraphScheduler', () => {
  let baseScheduler: ExecutionScheduler
  let scheduler: GraphScheduler
  let state: StoreGraphStateAdapter

  beforeEach(() => {
    baseScheduler = new ExecutionScheduler()
    scheduler = new GraphScheduler(baseScheduler)
    state = new StoreGraphStateAdapter('g1')
    vi.clearAllMocks()
  })

  describe('路由优先级：循环回流 > 显式边 > 拓扑', () => {
    it('失败 + loop 边 → 回流优先', async () => {
      const failed = makeNode({
        id: 'n1',
        status: 'failed',
        error: 'oops',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([failed])

      const result = await scheduler.resolveNextNodes(graph, failed, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n1')
    })

    it('成功 + loop 边 → 不回流，走显式边', async () => {
      const completed = makeNode({
        id: 'n1',
        status: 'completed',
        edges: [
          { target: 'n2', type: 'simple' },
          { target: 'n1', type: 'loop' }, // loop 边存在但节点成功，不回流
        ],
      })
      const n2 = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([completed, n2])

      const result = await scheduler.resolveNextNodes(graph, completed, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n2') // 走 simple 边
    })

    it('失败 + loop 边超限 → 不回流，回退拓扑', async () => {
      const failed = makeNode({
        id: 'n1',
        status: 'failed',
        error: 'oops',
        edges: [{ target: 'n1', type: 'loop', maxIterations: 1 }],
      })
      // 加一个 pending 节点让拓扑有可执行任务
      const n2 = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([failed, n2])

      // 第一次回流（iteration=1，未超 1）
      let result = await scheduler.resolveNextNodes(graph, failed, state)
      expect(result.some(n => n.id === 'n1')).toBe(true)

      // 第二次超限 → 不回流，回退拓扑（返回 pending 节点）
      failed.status = 'failed'
      result = await scheduler.resolveNextNodes(graph, failed, state)
      // 回退到 base.getExecutableTasks，应包含 pending 的 n2
      expect(result.some(n => n.id === 'n2')).toBe(true)
    })

    it('有显式 simple 边 → 走边路由', async () => {
      const completed = makeNode({
        id: 'n1',
        status: 'completed',
        edges: [{ target: 'n2', type: 'simple' }],
      })
      const n2 = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([completed, n2])

      const result = await scheduler.resolveNextNodes(graph, completed, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n2')
    })

    it('有 conditional 边且为真 → 走边路由', async () => {
      const completed = makeNode({
        id: 'n1',
        status: 'completed',
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: 'success === true' },
        }],
      })
      const n2 = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([completed, n2])

      const result = await scheduler.resolveNextNodes(graph, completed, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n2')
    })

    it('无 edges → 回退依赖拓扑', async () => {
      // n1 已完成，n2 依赖 n1，应通过拓扑返回 n2
      const completed = makeNode({ id: 'n1', status: 'completed' })
      const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'] })
      const graph = makeGraph([completed, n2])

      const result = await scheduler.resolveNextNodes(graph, completed, state)
      expect(result.some(n => n.id === 'n2')).toBe(true)
    })
  })

  describe('复用 base 调度能力', () => {
    it('getExecutableTasks 复用 base 就绪判定', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'] })
      const n3 = makeNode({ id: 'n3', status: 'pending', dependencies: ['n2'] })
      const graph = makeGraph([n1, n2, n3])

      const executable = scheduler.getExecutableTasks(graph)
      expect(executable.some(n => n.id === 'n2')).toBe(true)
      expect(executable.some(n => n.id === 'n3')).toBe(false) // n3 依赖 n2，未就绪
    })

    it('getNextTask 复用 base 优先级排序', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'], priority: 1 })
      const n3 = makeNode({ id: 'n3', status: 'pending', dependencies: ['n1'], priority: 5 })
      const graph = makeGraph([n1, n2, n3])

      const next = scheduler.getNextTask(graph)
      expect(next).not.toBeNull()
      expect(next!.id).toBe('n3') // 优先级高者先
    })

    it('getParallelBatch 复用 base 资源互斥', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      // 两个写同一文件的任务应互斥
      const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'], producesFiles: ['a.ts'], executionClass: 'write-heavy' })
      const n3 = makeNode({ id: 'n3', status: 'pending', dependencies: ['n1'], producesFiles: ['a.ts'], executionClass: 'write-heavy' })
      const graph = makeGraph([n1, n2, n3])

      const batch = scheduler.getParallelBatch(graph)
      // write-heavy 互斥，只选一个
      expect(batch.length).toBeLessThanOrEqual(1)
    })
  })

  describe('Boost 机制（阶段四：边路由目标入队）', () => {
    it('boostReady 加入队列 + peekBoostedIds 查看', () => {
      scheduler.boostReady(['n2', 'n3'])
      expect(scheduler.peekBoostedIds()).toEqual(expect.arrayContaining(['n2', 'n3']))
      expect(scheduler.peekBoostedIds()).toHaveLength(2)
    })

    it('boostReady 自动去重', () => {
      scheduler.boostReady(['n2'])
      scheduler.boostReady(['n2', 'n3'])
      expect(scheduler.peekBoostedIds()).toHaveLength(2)
    })

    it('boostReady 忽略空 id', () => {
      scheduler.boostReady(['n2', '', 'n3'])
      expect(scheduler.peekBoostedIds()).toHaveLength(2)
    })

    it('clearBoost 清空队列', () => {
      scheduler.boostReady(['n2'])
      scheduler.clearBoost()
      expect(scheduler.peekBoostedIds()).toHaveLength(0)
    })

    it('getParallelBatchWithBoost 合并 boosted 节点到批次', () => {
      // n1 完成，n2 依赖 n1（拓扑就绪），n3 无依赖但不在拓扑就绪中（被 boost 入队）
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'] })
      const n3 = makeNode({ id: 'n3', status: 'pending' }) // 无依赖，拓扑也应就绪
      const graph = makeGraph([n1, n2, n3])

      // boost 一个不在批次中的节点 n4
      const n4 = makeNode({ id: 'n4', status: 'pending' })
      graph.tasks.push(n4)
      scheduler.boostReady(['n4'])

      const batch = scheduler.getParallelBatchWithBoost(graph)
      expect(batch.some(t => t.id === 'n4')).toBe(true)
    })

    it('getParallelBatchWithBoost 已在批次中的 boosted 节点不重复加入', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'] })
      const graph = makeGraph([n1, n2])

      // n2 已在 base 批次中，boost 它不应重复
      scheduler.boostReady(['n2'])
      const batch = scheduler.getParallelBatchWithBoost(graph)
      const n2Count = batch.filter(t => t.id === 'n2').length
      expect(n2Count).toBe(1)
    })

    it('getParallelBatchWithBoost 已完成节点不合并', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const completed = makeNode({ id: 'n2', status: 'completed' })
      const graph = makeGraph([n1, completed])

      scheduler.boostReady(['n2']) // boost 一个已完成节点
      const batch = scheduler.getParallelBatchWithBoost(graph)
      expect(batch.some(t => t.id === 'n2')).toBe(false)
    })

    it('getParallelBatchWithBoost 资源冲突的节点重新入队', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      // n2 是 write-heavy，会独占批次
      const n2 = makeNode({
        id: 'n2',
        status: 'pending',
        dependencies: ['n1'],
        producesFiles: ['a.ts'],
        executionClass: 'write-heavy',
      })
      // n3 也是 write-heavy 写同一文件，与 n2 冲突
      const n3 = makeNode({
        id: 'n3',
        status: 'pending',
        producesFiles: ['a.ts'],
        executionClass: 'write-heavy',
      })
      const graph = makeGraph([n1, n2, n3])

      scheduler.boostReady(['n3'])
      const batch = scheduler.getParallelBatchWithBoost(graph)

      // n3 与 n2 冲突，不应在批次中
      expect(batch.some(t => t.id === 'n3')).toBe(false)
      // n3 应被重新入队（下轮再试）
      expect(scheduler.peekBoostedIds()).toContain('n3')
    })

    it('getParallelBatchWithBoost 消费后队列清空', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const n2 = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([n1, n2])

      scheduler.boostReady(['n2'])
      scheduler.getParallelBatchWithBoost(graph)
      // 队列应已清空（除非有冲突重新入队，此处 n2 无冲突）
      expect(scheduler.peekBoostedIds()).toHaveLength(0)
    })

    it('getParallelBatchWithBoost boosted 节点不在图中 → 告警并跳过', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const graph = makeGraph([n1])

      scheduler.boostReady(['nonexistent'])
      const batch = scheduler.getParallelBatchWithBoost(graph)
      expect(batch.some(t => t.id === 'nonexistent')).toBe(false)
      // 不存在的节点应被消费清空，不残留
      expect(scheduler.peekBoostedIds()).toHaveLength(0)
    })

    it('getNextTaskWithBoost 优先返回 boosted 节点', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      // n2 优先级低，n3 优先级高（拓扑会选 n3）
      const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'], priority: 1 })
      const n3 = makeNode({ id: 'n3', status: 'pending', dependencies: ['n1'], priority: 5 })
      const graph = makeGraph([n1, n2, n3])

      // boost n2（优先级低），应优先返回 n2 而非拓扑的 n3
      scheduler.boostReady(['n2'])
      const next = scheduler.getNextTaskWithBoost(graph)
      expect(next).not.toBeNull()
      expect(next!.id).toBe('n2')
      // 消费后从队列删除
      expect(scheduler.peekBoostedIds()).not.toContain('n2')
    })

    it('getNextTaskWithBoost 队列空 → 回退 base.getNextTask', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'], priority: 5 })
      const graph = makeGraph([n1, n2])

      const next = scheduler.getNextTaskWithBoost(graph)
      expect(next).not.toBeNull()
      expect(next!.id).toBe('n2')
    })

    it('getNextTaskWithBoost 非 pending 的 boosted 节点跳过并删除', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const completed = makeNode({ id: 'n2', status: 'completed' })
      const n3 = makeNode({ id: 'n3', status: 'pending', dependencies: ['n1'] })
      const graph = makeGraph([n1, completed, n3])

      // boost 已完成的 n2，应跳过并删除，然后回退到 n3
      scheduler.boostReady(['n2'])
      const next = scheduler.getNextTaskWithBoost(graph)
      expect(next!.id).toBe('n3')
      expect(scheduler.peekBoostedIds()).not.toContain('n2')
    })

    it('boosted 节点不修改 plan.dependencies（不污染持久化）', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const n2 = makeNode({ id: 'n2', status: 'pending', dependencies: ['n1'] })
      const graph = makeGraph([n1, n2])

      // 记录原始 dependencies
      const originalDeps = [...(graph.tasks[1] as GraphNode).dependencies]

      scheduler.boostReady(['n2'])
      scheduler.getParallelBatchWithBoost(graph)

      // dependencies 不应被修改
      expect((graph.tasks[1] as GraphNode).dependencies).toEqual(originalDeps)
    })
  })

  describe('循环重试支持', () => {
    it('getReflection 返回注入的反思', async () => {
      const failed = makeNode({
        id: 'n1',
        status: 'failed',
        error: 'timeout',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([failed])

      await scheduler.resolveNextNodes(graph, failed, state)
      const reflection = scheduler.getReflection('n1', state)
      expect(reflection).toContain('timeout')
    })

    it('getIteration 返回迭代次数', async () => {
      const failed = makeNode({
        id: 'n1',
        status: 'failed',
        error: 'err',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([failed])

      await scheduler.resolveNextNodes(graph, failed, state)
      expect(scheduler.getIteration('n1', state)).toBe(1)
    })
  })

  describe('动态建图', () => {
    it('addNode 在允许扩展的图中追加节点', () => {
      const n1 = makeNode({ id: 'n1', status: 'completed' })
      const graph = makeGraph([n1], { graphVersion: 2, allowDynamicExpansion: true })
      const newNode = makeNode({ id: 'n2', status: 'pending' })

      scheduler.addNode(graph, newNode)
      expect(graph.tasks).toHaveLength(2)
      expect(graph.tasks.some(t => t.id === 'n2')).toBe(true)
      expect(mockStore.updatePlan).toHaveBeenCalled()
    })

    it('addNode 不允许扩展时抛错', () => {
      const graph = makeGraph([], { graphVersion: 1 }) // 静态 DAG
      const newNode = makeNode({ id: 'n2' })

      expect(() => scheduler.addNode(graph, newNode)).toThrow('does not allow dynamic expansion')
    })

    it('addNode 重复 id 抛错', () => {
      const n1 = makeNode({ id: 'n1' })
      const graph = makeGraph([n1], { graphVersion: 2, allowDynamicExpansion: true })
      const dup = makeNode({ id: 'n1' })

      expect(() => scheduler.addNode(graph, dup)).toThrow('already exists')
    })

    it('addEdge 追加边到源节点', () => {
      const n1 = makeNode({ id: 'n1' })
      const n2 = makeNode({ id: 'n2' })
      const graph = makeGraph([n1, n2], { graphVersion: 2, allowDynamicExpansion: true })

      scheduler.addEdge(graph, 'n1', { target: 'n2', type: 'simple' })
      const sourceNode = graph.tasks.find(t => t.id === 'n1') as GraphNode
      expect(sourceNode.edges).toHaveLength(1)
      expect(sourceNode.edges![0].target).toBe('n2')
    })

    it('addEdge 源节点不存在抛错', () => {
      const graph = makeGraph([], { graphVersion: 2, allowDynamicExpansion: true })
      expect(() => scheduler.addEdge(graph, 'nope', { target: 'n2', type: 'simple' })).toThrow('not found')
    })

    it('addEdge 目标节点不存在抛错', () => {
      const n1 = makeNode({ id: 'n1' })
      const graph = makeGraph([n1], { graphVersion: 2, allowDynamicExpansion: true })
      expect(() => scheduler.addEdge(graph, 'n1', { target: 'nope', type: 'simple' })).toThrow('not found')
    })
  })
})
