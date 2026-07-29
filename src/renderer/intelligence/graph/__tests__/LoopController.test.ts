/**
 * LoopController 单元测试
 *
 * 验证循环回流的核心逻辑：
 * - 失败节点 + loop 边 + 未超 maxIterations → 回流
 * - 成功节点 → 不回流
 * - 无 loop 边 → 不回流
 * - 超 maxIterations → 不回流（防无限循环）
 * - 反思上下文正确注入 GraphState.metadata
 *
 * @module GraphRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@toolkit/LogEngine', () => ({
  logger: {
    agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import { LoopController } from '../LoopController'
import { StoreGraphStateAdapter } from '../GraphStateAdapter'
import type { GraphNode, ExecutionGraph } from '../graphTypes'
import type { PlanTask } from '../../planner/planTypes'

// Mock IntelligenceStore（GraphStateAdapter 依赖）
const mockStore = {
  getPlan: vi.fn(() => null),
  markTaskCompleted: vi.fn(),
}
vi.mock('../../state/IntelligenceStore', () => ({
  useAgentStore: { getState: () => mockStore },
}))

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'n1',
    title: 'Test Node',
    description: '',
    provider: 'openai',
    model: 'gpt-4',
    role: 'default',
    dependencies: [],
    status: 'failed',
    ...overrides,
  } as GraphNode
}

function makeGraph(nodes: GraphNode[]): ExecutionGraph {
  return {
    id: 'g1',
    name: 'test-graph',
    createdAt: 0,
    updatedAt: 0,
    requirementsDoc: '',
    executionMode: 'parallel',
    status: 'executing',
    tasks: nodes as PlanTask[],
  } as ExecutionGraph
}

describe('LoopController', () => {
  let controller: LoopController
  let state: StoreGraphStateAdapter

  beforeEach(() => {
    controller = new LoopController()
    state = new StoreGraphStateAdapter('g1')
    vi.clearAllMocks()
  })

  describe('回流触发条件', () => {
    it('失败节点 + loop 边 + 未超限 → 回流', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        error: 'timeout',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([node])

      const targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(1)
      expect(targets[0].id).toBe('n1')
    })

    it('成功节点 → 不回流', () => {
      const node = makeNode({
        status: 'completed',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([node])

      const targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(0)
    })

    it('无 loop 边 → 不回流', () => {
      const node = makeNode({
        status: 'failed',
        edges: [{ target: 'n2', type: 'simple' }],
      })
      const graph = makeGraph([node])

      const targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(0)
    })

    it('failed 但无 edges → 不回流', () => {
      const node = makeNode({ status: 'failed', edges: undefined })
      const graph = makeGraph([node])

      const targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(0)
    })
  })

  describe('maxIterations 上限保护', () => {
    it('超 maxIterations → 不回流（防无限循环）', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        edges: [{ target: 'n1', type: 'loop', maxIterations: 2 }],
      })
      const graph = makeGraph([node])

      // 第 1 次回流（iteration=1，未超 2）
      let targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(1)

      // 第 2 次回流（iteration=2，未超 2）
      node.status = 'failed'
      targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(1)

      // 第 3 次回流（iteration=3，超 2）→ 不回流
      node.status = 'failed'
      targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(0)
    })

    it('节点 maxIterations 覆盖边 maxIterations', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        maxIterations: 1,
        edges: [{ target: 'n1', type: 'loop', maxIterations: 5 }],
      })
      const graph = makeGraph([node])

      // 边 maxIterations=5，应优先用边的 5
      let targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(1) // iteration=1，未超 5

      // 继续直到超 5
      for (let i = 2; i <= 5; i++) {
        node.status = 'failed'
        targets = controller.tryLoopBack(graph, node, state)
        expect(targets).toHaveLength(1) // 2-5 都未超
      }
      // 第 6 次超限
      node.status = 'failed'
      targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(0)
    })

    it('无显式 maxIterations 时默认 2', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([node])

      controller.tryLoopBack(graph, node, state) // iter=1
      node.status = 'failed'
      controller.tryLoopBack(graph, node, state) // iter=2
      node.status = 'failed'
      const targets = controller.tryLoopBack(graph, node, state) // iter=3，超 2
      expect(targets).toHaveLength(0)
    })
  })

  describe('反思上下文注入', () => {
    it('回流后 GraphState 包含 lastError / reflection / iteration', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        error: 'connection refused',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([node])

      controller.tryLoopBack(graph, node, state)

      expect(state.getMetadata('loop:n1:lastError')).toBe('connection refused')
      expect(state.getMetadata('loop:n1:iteration')).toBe(1)
      const reflection = state.getMetadata('loop:n1:reflection') as string
      expect(reflection).toContain('反思重试')
      expect(reflection).toContain('connection refused')
      expect(reflection).toContain('第 1 次重试')
    })

    it('迭代次数累加', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        edges: [{ target: 'n1', type: 'loop', maxIterations: 5 }],
      })
      const graph = makeGraph([node])

      controller.tryLoopBack(graph, node, state)
      expect(state.getMetadata('loop:n1:iteration')).toBe(1)

      node.status = 'failed'
      controller.tryLoopBack(graph, node, state)
      expect(state.getMetadata('loop:n1:iteration')).toBe(2)
    })

    it('反思包含失败原因与任务标题', () => {
      const node = makeNode({
        id: 'n1',
        title: '部署服务',
        status: 'failed',
        error: 'port 8080 in use',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([node])

      controller.tryLoopBack(graph, node, state)
      const reflection = state.getMetadata('loop:n1:reflection') as string
      expect(reflection).toContain('port 8080 in use')
      expect(reflection).toContain('部署服务')
    })
  })

  describe('回流目标查找', () => {
    it('loop 边 target 指向其他节点（上游修复节点）', () => {
      const failed = makeNode({
        id: 'n2',
        status: 'failed',
        edges: [{ target: 'n1', type: 'loop' }], // 回流到上游 n1
      })
      const upstream = makeNode({ id: 'n1', status: 'completed' })
      const graph = makeGraph([failed, upstream])

      const targets = controller.tryLoopBack(graph, failed, state)
      expect(targets).toHaveLength(1)
      expect(targets[0].id).toBe('n1')
    })

    it('loop 边 target 不存在 → 跳过并返回空', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        edges: [{ target: 'nonexistent', type: 'loop' }],
      })
      const graph = makeGraph([node])

      const targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(0)
    })

    it('多条 loop 边 → 返回多个回流目标', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        edges: [
          { target: 'n1', type: 'loop' },
          { target: 'n2', type: 'loop' },
        ],
      })
      const other = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([node, other])

      const targets = controller.tryLoopBack(graph, node, state)
      expect(targets).toHaveLength(2)
      expect(targets.map(t => t.id).sort()).toEqual(['n1', 'n2'])
    })
  })

  describe('reset 重置', () => {
    it('resetNode 清除迭代计数与反思', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([node])
      controller.tryLoopBack(graph, node, state)
      expect(state.getMetadata('loop:n1:iteration')).toBe(1)

      controller.resetNode('n1', state)
      expect(state.getMetadata('loop:n1:iteration')).toBe(0)
      expect(state.getMetadata('loop:n1:reflection')).toBeUndefined()
    })

    it('resetAll 清除图中所有 loop 节点', () => {
      const n1 = makeNode({ id: 'n1', status: 'failed', edges: [{ target: 'n1', type: 'loop' }] })
      const n2 = makeNode({ id: 'n2', status: 'failed', edges: [{ target: 'n2', type: 'loop' }] })
      const graph = makeGraph([n1, n2])

      controller.tryLoopBack(graph, n1, state)
      n1.status = 'failed'
      controller.tryLoopBack(graph, n2, state)

      controller.resetAll(graph, state)
      expect(state.getMetadata('loop:n1:iteration')).toBe(0)
      expect(state.getMetadata('loop:n2:iteration')).toBe(0)
    })
  })

  describe('getIteration / getReflection 读取', () => {
    it('getIteration 优先读 GraphState', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([node])
      controller.tryLoopBack(graph, node, state)

      expect(controller.getIteration('n1', state)).toBe(1)
    })

    it('getReflection 返回注入的反思', () => {
      const node = makeNode({
        id: 'n1',
        status: 'failed',
        error: 'oops',
        edges: [{ target: 'n1', type: 'loop' }],
      })
      const graph = makeGraph([node])
      controller.tryLoopBack(graph, node, state)

      const reflection = controller.getReflection('n1', state)
      expect(reflection).toContain('oops')
    })

    it('未回流时 getIteration 返回 0', () => {
      expect(controller.getIteration('unknown', state)).toBe(0)
    })
  })
})
