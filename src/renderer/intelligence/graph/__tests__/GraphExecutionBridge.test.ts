/**
 * GraphExecutionBridge + 动态建图集成测试（阶段三）
 *
 * 验证：
 * - 桥接器注册 / 注销 / 当前活跃图切换
 * - getGraph() 实时从 store 读取（避免过期快照）
 * - add_node 工具通过桥接器动态加节点到图
 * - add_edge 工具通过桥接器动态加边
 * - 无活跃图 / 静态图 / 依赖不存在时的友好错误
 * - 多 plan 并行时 setCurrent 正确定位
 *
 * @module GraphRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@toolkit/LogEngine', () => ({
  logger: {
    agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

// IntelligenceStore mock：可动态切换返回的 plan（模拟 store 更新）
let mockPlans: Record<string, any> = {}
const mockStore = {
  getPlan: vi.fn((planId: string) => mockPlans[planId] ?? null),
  updatePlan: vi.fn((planId: string, patch: any) => {
    if (mockPlans[planId]) {
      mockPlans[planId] = { ...mockPlans[planId], ...patch }
    }
  }),
  markTaskCompleted: vi.fn(),
  updateTask: vi.fn(),
}
vi.mock('../../state/IntelligenceStore', () => ({
  useAgentStore: { getState: () => mockStore },
}))

import { graphExecutionBridge } from '../GraphExecutionBridge'
import { GraphScheduler } from '../GraphScheduler'
import { ExecutionScheduler } from '../../planner/TaskScheduler'
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

function makeGraph(
  nodes: GraphNode[],
  overrides: Partial<ExecutionGraph> = {},
): ExecutionGraph {
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

describe('GraphExecutionBridge', () => {
  let baseScheduler: ExecutionScheduler
  let graphScheduler: GraphScheduler

  beforeEach(() => {
    graphExecutionBridge.clearAll()
    mockPlans = {}
    vi.clearAllMocks()
    baseScheduler = new ExecutionScheduler()
    baseScheduler.start()
    graphScheduler = new GraphScheduler(baseScheduler)
  })

  describe('注册 / 注销 / 当前活跃图', () => {
    it('注册后 getCurrent 返回句柄', () => {
      graphExecutionBridge.register({
        planId: 'g1',
        scheduler: graphScheduler,
        workspacePath: '/tmp',
      })

      const handle = graphExecutionBridge.getCurrent()
      expect(handle).not.toBeNull()
      expect(handle!.planId).toBe('g1')
      expect(handle!.workspacePath).toBe('/tmp')
      expect(handle!.scheduler).toBe(graphScheduler)
    })

    it('未注册时 getCurrent 返回 null', () => {
      expect(graphExecutionBridge.getCurrent()).toBeNull()
    })

    it('unregister 后 getCurrent 返回 null', () => {
      graphExecutionBridge.register({
        planId: 'g1',
        scheduler: graphScheduler,
        workspacePath: '/tmp',
      })
      graphExecutionBridge.unregister('g1')
      expect(graphExecutionBridge.getCurrent()).toBeNull()
    })

    it('多 plan 注册时 setCurrent 切换活跃图', () => {
      const sched2 = new GraphScheduler(new ExecutionScheduler())
      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      graphExecutionBridge.register({ planId: 'g2', scheduler: sched2, workspacePath: '/tmp' })

      // 最后注册的为活跃
      expect(graphExecutionBridge.getCurrent()!.planId).toBe('g2')

      // 切换到 g1
      graphExecutionBridge.setCurrent('g1')
      expect(graphExecutionBridge.getCurrent()!.planId).toBe('g1')

      // 切换到 g2
      graphExecutionBridge.setCurrent('g2')
      expect(graphExecutionBridge.getCurrent()!.planId).toBe('g2')
    })

    it('注销当前活跃图后回退到剩余会话', () => {
      const sched2 = new GraphScheduler(new ExecutionScheduler())
      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      graphExecutionBridge.register({ planId: 'g2', scheduler: sched2, workspacePath: '/tmp' })

      graphExecutionBridge.unregister('g2')
      // 应回退到 g1
      expect(graphExecutionBridge.getCurrent()!.planId).toBe('g1')
    })

    it('setCurrent 传入未注册的 plan 不会切换', () => {
      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      graphExecutionBridge.setCurrent('unknown')
      expect(graphExecutionBridge.getCurrent()!.planId).toBe('g1')
    })

    it('setCurrent(null) 清空活跃图', () => {
      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      graphExecutionBridge.setCurrent(null)
      expect(graphExecutionBridge.getCurrent()).toBeNull()
    })
  })

  describe('getGraph() 实时读取（避免过期快照）', () => {
    it('从 store 读取最新图', () => {
      const graph = makeGraph([makeNode({ id: 'n1' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockPlans['g1'] = graph

      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      const handle = graphExecutionBridge.getCurrent()!

      expect(handle.getGraph()).not.toBeNull()
      expect(handle.getGraph()!.id).toBe('g1')
      expect(handle.getGraph()!.tasks).toHaveLength(1)
    })

    it('store 更新后 getGraph 返回最新任务列表', () => {
      const graph = makeGraph([makeNode({ id: 'n1' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockPlans['g1'] = graph

      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      const handle = graphExecutionBridge.getCurrent()!

      // 模拟 store 更新（如其他节点完成）
      mockPlans['g1'] = {
        ...graph,
        tasks: [...graph.tasks, makeNode({ id: 'n2', status: 'completed' })],
      }

      const latest = handle.getGraph()!
      expect(latest.tasks).toHaveLength(2)
      expect(latest.tasks[1].id).toBe('n2')
    })

    it('plan 从 store 移除后 getGraph 返回 null', () => {
      const graph = makeGraph([makeNode({ id: 'n1' })], { graphVersion: 2 })
      mockPlans['g1'] = graph

      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      const handle = graphExecutionBridge.getCurrent()!

      // 模拟 plan 被删除
      delete mockPlans['g1']
      expect(handle.getGraph()).toBeNull()
    })
  })

  describe('getByPlanId', () => {
    it('按 planId 查询会话', () => {
      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      const handle = graphExecutionBridge.getByPlanId('g1')
      expect(handle).not.toBeNull()
      expect(handle!.planId).toBe('g1')
    })

    it('未知 planId 返回 null', () => {
      expect(graphExecutionBridge.getByPlanId('unknown')).toBeNull()
    })
  })

  describe('size 与 clearAll', () => {
    it('size 反映活跃会话数', () => {
      expect(graphExecutionBridge.size).toBe(0)
      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      expect(graphExecutionBridge.size).toBe(1)
      graphExecutionBridge.register({ planId: 'g2', scheduler: new GraphScheduler(new ExecutionScheduler()), workspacePath: '/tmp' })
      expect(graphExecutionBridge.size).toBe(2)
    })

    it('clearAll 清空所有会话', () => {
      graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
      graphExecutionBridge.register({ planId: 'g2', scheduler: new GraphScheduler(new ExecutionScheduler()), workspacePath: '/tmp' })

      graphExecutionBridge.clearAll()
      expect(graphExecutionBridge.size).toBe(0)
      expect(graphExecutionBridge.getCurrent()).toBeNull()
    })
  })
})

/**
 * 端到端：桥接器 + GraphScheduler.addNode/addEdge 联动
 * 模拟 add_node 工具通过桥接器动态扩展图的真实流程
 */
describe('GraphExecutionBridge 端到端：动态建图联动', () => {
  let graphScheduler: GraphScheduler

  beforeEach(() => {
    graphExecutionBridge.clearAll()
    mockPlans = {}
    vi.clearAllMocks()
    const base = new ExecutionScheduler()
    base.start()
    graphScheduler = new GraphScheduler(base)
  })

  it('通过桥接器调用 addNode 真实扩展图（同步到 store）', () => {
    const graph = makeGraph([makeNode({ id: 'task-1' })], {
      graphVersion: 2,
      allowDynamicExpansion: true,
    })
    mockPlans['g1'] = graph

    graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
    const handle = graphExecutionBridge.getCurrent()!
    const liveGraph = handle.getGraph()!

    const newNode = makeNode({ id: 'task-2', title: 'Dynamic Task' })
    handle.scheduler.addNode(liveGraph, newNode)

    // store 应被同步更新
    expect(mockStore.updatePlan).toHaveBeenCalledWith('g1', expect.objectContaining({
      tasks: expect.arrayContaining([expect.objectContaining({ id: 'task-2' })]),
    }))
  })

  it('通过桥接器调用 addEdge 真实加边', () => {
    const n1 = makeNode({ id: 'task-1', status: 'completed' })
    const n2 = makeNode({ id: 'task-2' })
    const graph = makeGraph([n1, n2], {
      graphVersion: 2,
      allowDynamicExpansion: true,
    })
    mockPlans['g1'] = graph

    graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
    const handle = graphExecutionBridge.getCurrent()!
    const liveGraph = handle.getGraph()!

    handle.scheduler.addEdge(liveGraph, 'task-1', {
      target: 'task-2',
      type: 'simple',
    })

    // task-1 应有出边
    const sourceNode = liveGraph.tasks.find(t => t.id === 'task-1') as GraphNode
    expect(sourceNode.edges).toBeDefined()
    expect(sourceNode.edges!.some(e => e.target === 'task-2')).toBe(true)
  })

  it('静态图（graphVersion=1）调用 addNode 抛错', () => {
    const graph = makeGraph([makeNode({ id: 'task-1' })], { graphVersion: 1 })
    mockPlans['g1'] = graph

    graphExecutionBridge.register({ planId: 'g1', scheduler: graphScheduler, workspacePath: '/tmp' })
    const handle = graphExecutionBridge.getCurrent()!
    const liveGraph = handle.getGraph()!

    const newNode = makeNode({ id: 'task-2' })
    expect(() => handle.scheduler.addNode(liveGraph, newNode)).toThrow(/dynamic expansion/)
  })

  it('未注册时 getCurrent 返回 null（工具据此返回友好错误）', () => {
    expect(graphExecutionBridge.getCurrent()).toBeNull()
  })
})
