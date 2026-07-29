/**
 * EdgeRouter 单元测试
 *
 * 验证条件边路由核心逻辑：
 * - simple 边无条件激活
 * - conditional 边按 condition 求值，短路
 * - loop 边交给 LoopController（本路由器跳过）
 * - rule 表达式安全求值（白名单/黑名单）
 * - 求值失败保守返回 false
 *
 * @module GraphRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@toolkit/LogEngine', () => ({
  logger: {
    agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

// Mock IntelligenceStore（GraphStateAdapter 依赖）
const mockStore = {
  getPlan: vi.fn(() => null),
  markTaskCompleted: vi.fn(),
}
vi.mock('../../state/IntelligenceStore', () => ({
  useAgentStore: { getState: () => mockStore },
}))

import { EdgeRouter } from '../EdgeRouter'
import { StoreGraphStateAdapter } from '../GraphStateAdapter'
import type { GraphNode, ExecutionGraph } from '../graphTypes'
import type { PlanTask } from '../../planner/planTypes'

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'n1',
    title: 'Source',
    description: '',
    provider: 'openai',
    model: 'gpt-4',
    role: 'default',
    dependencies: [],
    status: 'completed',
    output: 'done',
    ...overrides,
  } as GraphNode
}

function makeGraph(nodes: GraphNode[]): ExecutionGraph {
  return {
    id: 'g1',
    name: 'test',
    createdAt: 0,
    updatedAt: 0,
    requirementsDoc: '',
    executionMode: 'parallel',
    status: 'executing',
    tasks: nodes as PlanTask[],
  } as ExecutionGraph
}

describe('EdgeRouter', () => {
  let router: EdgeRouter
  let state: StoreGraphStateAdapter

  beforeEach(() => {
    router = new EdgeRouter()
    state = new StoreGraphStateAdapter('g1')
  })

  describe('simple 边', () => {
    it('无条件激活 target', async () => {
      const source = makeNode({ edges: [{ target: 'n2', type: 'simple' }] })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n2')
    })

    it('target 不存在 → 跳过', async () => {
      const source = makeNode({ edges: [{ target: 'nonexistent', type: 'simple' }] })
      const graph = makeGraph([source])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })
  })

  describe('conditional 边', () => {
    it('rule 表达式为真 → 激活', async () => {
      const source = makeNode({
        status: 'failed',
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: 'failed === true' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n2')
    })

    it('rule 表达式为假 → 不激活', async () => {
      const source = makeNode({
        status: 'completed',
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: 'failed === true' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('短路：多个 conditional 仅首个为真者激活', async () => {
      const source = makeNode({
        status: 'completed',
        output: 'success',
        edges: [
          { target: 'n2', type: 'conditional', condition: { kind: 'rule', expression: 'success === true' } },
          { target: 'n3', type: 'conditional', condition: { kind: 'rule', expression: 'true' } },
        ],
      })
      const n2 = makeNode({ id: 'n2', status: 'pending' })
      const n3 = makeNode({ id: 'n3', status: 'pending' })
      const graph = makeGraph([source, n2, n3])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n2') // 首个为真即止
    })

    it('无条件视为满足', async () => {
      const source = makeNode({
        edges: [{ target: 'n2', type: 'conditional' }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
    })

    it('node 字段访问求值', async () => {
      const source = makeNode({
        status: 'completed',
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: "node.status === 'completed'" },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
    })

    it('output 字符串包含判断', async () => {
      const source = makeNode({
        output: 'error: file not found',
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: "output === 'error: file not found'" },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
    })

    it('state.metadata 字段访问求值（修复 peekMetadata bug）', async () => {
      // 写入 metadata（模拟 LoopController 注入循环计数等）
      state.setMetadata('retryCount', 3)
      state.setMetadata('phase', 'retry')

      const source = makeNode({
        status: 'failed',
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: "state.metadata.retryCount === 3" },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      // 修复前：peekMetadata 返回 { iteration: undefined }，表达式恒为 false
      // 修复后：peekMetadata 返回完整快照，retryCount===3 命中
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n2')
    })

    it('state.metadata 字段不匹配 → 不激活', async () => {
      state.setMetadata('retryCount', 1)

      const source = makeNode({
        status: 'failed',
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: "state.metadata.retryCount === 3" },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })
  })

  describe('loop 边', () => {
    it('loop 边被跳过（交给 LoopController）', async () => {
      const source = makeNode({
        status: 'failed',
        edges: [
          { target: 'n2', type: 'loop' }, // 应被跳过
          { target: 'n3', type: 'simple' }, // 应激活
        ],
      })
      const n2 = makeNode({ id: 'n2', status: 'pending' })
      const n3 = makeNode({ id: 'n3', status: 'pending' })
      const graph = makeGraph([source, n2, n3])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n3')
    })
  })

  describe('安全求值（防注入）', () => {
    it('黑名单关键词 function → 拒绝', async () => {
      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: 'function() { return true }()' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0) // 拒绝执行，视为 false
    })

    it('黑名单 this → 拒绝', async () => {
      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: 'this.constructor' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('危险符号分号 → 拒绝', async () => {
      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: 'true; return false' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('属性访问方括号 → 拒绝', async () => {
      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: 'node["status"]' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('语法错误 → 保守返回 false', async () => {
      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'rule', expression: '=== invalid ===' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })
  })

  describe('llm 条件求值（阶段四接入）', () => {
    it('未注入 evaluator → 保守返回 false（阶段二行为回退）', async () => {
      // beforeEach 中 router = new EdgeRouter() 未注入 evaluator
      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'llm', prompt: '判断是否需要重试' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('注入 evaluator 返回 true → 激活 target', async () => {
      const evaluator = vi.fn(
        async (_prompt: string, _ctx: { node: GraphNode; state: unknown }): Promise<boolean> => true,
      )
      router.setLlmEvaluator(evaluator)

      const source = makeNode({
        id: 'src',
        status: 'failed',
        output: 'error: timeout',
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'llm', prompt: '判断上游错误是否需要重试' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n2')
      // 验证 evaluator 收到 condition.prompt 与上下文
      expect(evaluator).toHaveBeenCalledTimes(1)
      expect(evaluator.mock.calls[0][0]).toBe('判断上游错误是否需要重试')
      expect(evaluator.mock.calls[0][1].node.id).toBe('src')
      expect(evaluator.mock.calls[0][1].state).toBe(state)
    })

    it('注入 evaluator 返回 false → 不激活', async () => {
      router.setLlmEvaluator(async () => false)

      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'llm', prompt: '判断' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('evaluator 抛错 → 保守返回 false（不向上抛出）', async () => {
      router.setLlmEvaluator(async () => {
        throw new Error('LLM timeout')
      })

      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'llm', prompt: '判断' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      // 不应抛出
      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('evaluator 返回非布尔值 → Boolean 归一化', async () => {
      // 模拟 LLM 返回 truthy 字符串（generateObject 可能返回 'true'）
      router.setLlmEvaluator(async () => 'true' as unknown as boolean)

      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'llm', prompt: '判断' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
    })

    it('condition 缺 prompt → 保守返回 false', async () => {
      router.setLlmEvaluator(async () => true) // 即使 evaluator 说 true

      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'llm' }, // 无 prompt
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('构造函数注入 evaluator 与 setLlmEvaluator 等效', async () => {
      const localRouter = new EdgeRouter(async () => true)

      const source = makeNode({
        edges: [{
          target: 'n2',
          type: 'conditional',
          condition: { kind: 'llm', prompt: '判断' },
        }],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await localRouter.route(graph, source, state)
      expect(result).toHaveLength(1)
    })

    it('LLM 条件与 rule 条件混合：LLM 命中优先短路', async () => {
      router.setLlmEvaluator(async () => true)

      const source = makeNode({
        edges: [
          // LLM 条件在前，命中即短路
          { target: 'n2', type: 'conditional', condition: { kind: 'llm', prompt: '判断A' } },
          // rule 条件在后，不应被求值
          { target: 'n3', type: 'conditional', condition: { kind: 'rule', expression: 'true' } },
        ],
      })
      const n2 = makeNode({ id: 'n2', status: 'pending' })
      const n3 = makeNode({ id: 'n3', status: 'pending' })
      const graph = makeGraph([source, n2, n3])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('n2')
    })
  })

  describe('hasRoutingEdges', () => {
    it('有 simple/conditional 边 → true', () => {
      const node = makeNode({ edges: [{ target: 'n2', type: 'simple' }] })
      expect(router.hasRoutingEdges(node)).toBe(true)
    })

    it('仅有 loop 边 → false', () => {
      const node = makeNode({ edges: [{ target: 'n2', type: 'loop' }] })
      expect(router.hasRoutingEdges(node)).toBe(false)
    })

    it('无 edges → false', () => {
      const node = makeNode({ edges: undefined })
      expect(router.hasRoutingEdges(node)).toBe(false)
    })
  })

  describe('边界情况', () => {
    it('空 edges → 返回空', async () => {
      const source = makeNode({ edges: [] })
      const graph = makeGraph([source])
      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('undefined edges → 返回空', async () => {
      const source = makeNode({ edges: undefined })
      const graph = makeGraph([source])
      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })

    it('无 conditional 命中且无 simple → 返回空（图终止信号）', async () => {
      const source = makeNode({
        status: 'completed',
        edges: [
          { target: 'n2', type: 'conditional', condition: { kind: 'rule', expression: 'failed === true' } },
        ],
      })
      const target = makeNode({ id: 'n2', status: 'pending' })
      const graph = makeGraph([source, target])

      const result = await router.route(graph, source, state)
      expect(result).toHaveLength(0)
    })
  })
})
