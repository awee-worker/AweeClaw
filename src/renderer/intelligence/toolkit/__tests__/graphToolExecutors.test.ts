/**
 * add_node / add_edge 工具执行器测试（阶段三）
 *
 * 验证工具层的校验逻辑与桥接器联动：
 * - 无活跃图时返回友好错误
 * - 静态图（graphVersion=1）拒绝动态扩展
 * - 依赖节点不存在时拒绝
 * - 成功时调用 scheduler.addNode / addEdge
 * - 条件边校验（conditionKind 必填、expression/prompt 配对）
 * - 节点 id 自动递增（generateUniqueNodeId）
 *
 * 直接测试 graphToolExecutors（独立模块，依赖最小化），
 * 通过 mock GraphExecutionBridge 隔离工具执行器。
 *
 * @module GraphRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock LogEngine
vi.mock('@toolkit/LogEngine', () => ({
  logger: {
    agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

// Mock errorCatalog
vi.mock('@shared/toolkit/errorCatalog', () => ({ toAppError: (e: any) => ({ message: e instanceof Error ? e.message : String(e) }) }))

// Mock intelligenceTextUtils（resolveAgentLanguage / pickLocalizedText）
vi.mock('@intelligence/utils/intelligenceTextUtils', () => ({
  resolveAgentLanguage: () => 'en',
  pickLocalizedText: (_zh: string, en: string) => en,
  translateAgentText: (k: string) => k,
}))

// Mock GraphExecutionBridge：可控返回当前活跃图句柄
const mockAddNode = vi.fn()
const mockAddEdge = vi.fn()
let mockCurrentHandle: any = null

vi.mock('../../graph/GraphExecutionBridge', () => ({
  graphExecutionBridge: {
    getCurrent: () => mockCurrentHandle,
  },
}))

import { executeAddNode, executeAddEdge, generateUniqueNodeId } from '../graphToolExecutors'
import type { GraphNode, ExecutionGraph } from '../../graph/graphTypes'
import type { PlanTask } from '../../planner/planTypes'
import type { ToolExecutionContext } from '@intelligence/providerTypes'

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'task-1',
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

const ctx = { workspacePath: '/tmp' } as ToolExecutionContext

describe('add_node / add_edge 工具执行器', () => {
  beforeEach(() => {
    mockCurrentHandle = null
    vi.clearAllMocks()
  })

  describe('add_node', () => {
    it('无活跃图 → 返回友好错误', async () => {
      const result = await executeAddNode({ title: 'T', description: 'D' }, ctx)
      expect(result.success).toBe(false)
      expect(result.result).toContain('No active dynamic graph')
    })

    it('静态图（graphVersion=1）→ 拒绝动态扩展', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' })], { graphVersion: 1 })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddNode({ title: 'T', description: 'D' }, ctx)
      expect(result.success).toBe(false)
      expect(result.result).toContain('does not allow dynamic expansion')
      expect(mockAddNode).not.toHaveBeenCalled()
    })

    it('依赖节点不存在 → 拒绝', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddNode({ title: 'T', description: 'D', dependencies: ['nonexistent'] }, ctx)
      expect(result.success).toBe(false)
      expect(result.result).toContain('does not exist')
      expect(mockAddNode).not.toHaveBeenCalled()
    })

    it('缺少 title → 校验失败', async () => {
      const result = await executeAddNode({ description: 'D' }, ctx)
      expect(result.success).toBe(false)
      expect(result.result).toContain('required')
    })

    it('缺少 description → 校验失败', async () => {
      const result = await executeAddNode({ title: 'T' }, ctx)
      expect(result.success).toBe(false)
      expect(result.result).toContain('required')
    })

    it('成功添加 → 调用 scheduler.addNode 并返回节点 id', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddNode(
        { title: 'Dynamic Task', description: 'A new task', nodeType: 'task', dependencies: ['task-1'] },
        ctx,
      )
      expect(result.success).toBe(true)
      expect(mockAddNode).toHaveBeenCalledTimes(1)
      // 节点 id 应为 task-2（基于 task-1 递增）
      expect(result.meta?.nodeId).toBe('task-2')
    })

    it('nodeType 缺省为 task', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      await executeAddNode({ title: 'T', description: 'D' }, ctx)
      const passedNode = mockAddNode.mock.calls[0][1] as GraphNode
      expect(passedNode.nodeType).toBe('task')
    })

    it('自定义 nodeType 正确传递', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      await executeAddNode({ title: 'T', description: 'D', nodeType: 'decision' }, ctx)
      const passedNode = mockAddNode.mock.calls[0][1] as GraphNode
      expect(passedNode.nodeType).toBe('decision')
    })

    it('provider/model/role 缺省值正确', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      await executeAddNode({ title: 'T', description: 'D' }, ctx)
      const passedNode = mockAddNode.mock.calls[0][1] as GraphNode
      expect(passedNode.provider).toBe('anthropic')
      expect(passedNode.model).toBe('claude-sonnet-4-20250514')
      expect(passedNode.role).toBe('coder')
    })

    it('requireApproval / maxIterations 正确传递', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      await executeAddNode({ title: 'T', description: 'D', requireApproval: true, maxIterations: 5 }, ctx)
      const passedNode = mockAddNode.mock.calls[0][1] as GraphNode
      expect(passedNode.requireApproval).toBe(true)
      expect(passedNode.maxIterations).toBe(5)
    })
  })

  describe('add_edge', () => {
    it('无活跃图 → 返回友好错误', async () => {
      const result = await executeAddEdge({ sourceId: 'task-1', targetId: 'task-2', type: 'simple' }, ctx)
      expect(result.success).toBe(false)
      expect(result.result).toContain('No active dynamic graph')
    })

    it('静态图 → 拒绝', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' }), makeNode({ id: 'task-2' })], { graphVersion: 1 })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddEdge({ sourceId: 'task-1', targetId: 'task-2', type: 'simple' }, ctx)
      expect(result.success).toBe(false)
      expect(result.result).toContain('does not allow dynamic expansion')
    })

    it('缺少 sourceId → 校验失败', async () => {
      const result = await executeAddEdge({ targetId: 'task-2', type: 'simple' }, ctx)
      expect(result.success).toBe(false)
      expect(result.result).toContain('required')
    })

    it('条件边缺 conditionKind → 校验失败', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' }), makeNode({ id: 'task-2' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddEdge({ sourceId: 'task-1', targetId: 'task-2', type: 'conditional' }, ctx)
      expect(result.success).toBe(false)
      expect(result.result).toContain('conditionKind')
    })

    it('条件边 rule 缺 expression → 校验失败', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' }), makeNode({ id: 'task-2' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddEdge(
        { sourceId: 'task-1', targetId: 'task-2', type: 'conditional', conditionKind: 'rule' },
        ctx,
      )
      expect(result.success).toBe(false)
      expect(result.result).toContain('conditionExpression')
    })

    it('条件边 llm 缺 prompt → 校验失败', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' }), makeNode({ id: 'task-2' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddEdge(
        { sourceId: 'task-1', targetId: 'task-2', type: 'conditional', conditionKind: 'llm' },
        ctx,
      )
      expect(result.success).toBe(false)
      expect(result.result).toContain('conditionPrompt')
    })

    it('成功添加 simple 边', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' }), makeNode({ id: 'task-2' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddEdge({ sourceId: 'task-1', targetId: 'task-2', type: 'simple' }, ctx)
      expect(result.success).toBe(true)
      expect(mockAddEdge).toHaveBeenCalledTimes(1)
      const [_graph, sourceId, edge] = mockAddEdge.mock.calls[0]
      expect(sourceId).toBe('task-1')
      expect(edge.target).toBe('task-2')
      expect(edge.type).toBe('simple')
    })

    it('成功添加 loop 边并设置 maxIterations', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' }), makeNode({ id: 'task-2' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddEdge(
        { sourceId: 'task-1', targetId: 'task-1', type: 'loop', maxIterations: 5 },
        ctx,
      )
      expect(result.success).toBe(true)
      const edge = mockAddEdge.mock.calls[0][2]
      expect(edge.type).toBe('loop')
      expect(edge.maxIterations).toBe(5)
    })

    it('成功添加 conditional rule 边', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' }), makeNode({ id: 'task-2' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddEdge(
        {
          sourceId: 'task-1',
          targetId: 'task-2',
          type: 'conditional',
          conditionKind: 'rule',
          conditionExpression: 'state.retryCount < 3',
        },
        ctx,
      )
      expect(result.success).toBe(true)
      const edge = mockAddEdge.mock.calls[0][2]
      expect(edge.type).toBe('conditional')
      expect(edge.condition.kind).toBe('rule')
      expect(edge.condition.expression).toBe('state.retryCount < 3')
    })

    it('成功添加 conditional llm 边', async () => {
      const graph = makeGraph([makeNode({ id: 'task-1' }), makeNode({ id: 'task-2' })], {
        graphVersion: 2,
        allowDynamicExpansion: true,
      })
      mockCurrentHandle = {
        planId: 'g1',
        scheduler: { addNode: mockAddNode, addEdge: mockAddEdge },
        workspacePath: '/tmp',
        getGraph: () => graph,
      }

      const result = await executeAddEdge(
        {
          sourceId: 'task-1',
          targetId: 'task-2',
          type: 'conditional',
          conditionKind: 'llm',
          conditionPrompt: '上游输出是否包含错误，需要重试？',
        },
        ctx,
      )
      expect(result.success).toBe(true)
      const edge = mockAddEdge.mock.calls[0][2]
      expect(edge.type).toBe('conditional')
      expect(edge.condition.kind).toBe('llm')
      expect(edge.condition.prompt).toContain('重试')
    })
  })

  describe('generateUniqueNodeId', () => {
    it('基于 task-N 模式递增', () => {
      const graph = makeGraph([makeNode({ id: 'task-1' }), makeNode({ id: 'task-3' })])
      expect(generateUniqueNodeId(graph)).toBe('task-4')
    })

    it('空图返回 task-1', () => {
      const graph = makeGraph([])
      expect(generateUniqueNodeId(graph)).toBe('task-1')
    })

    it('忽略非 task-N 格式的 id', () => {
      const graph = makeGraph([makeNode({ id: 'custom-node' }), makeNode({ id: 'task-5' })])
      expect(generateUniqueNodeId(graph)).toBe('task-6')
    })
  })
})
