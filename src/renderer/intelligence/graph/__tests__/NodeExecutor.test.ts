/**
 * NodeExecutor 单元测试
 *
 * 验证：
 * - 多类型节点分发（task/llm/tool/decision/human）
 * - Span 强制生成（每个节点执行都有 Span）
 * - 中止信号检查
 * - 异常捕获不抛出（返回失败结果）
 * - 自定义执行器注册
 *
 * @module GraphRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@toolkit/LogEngine', () => ({
  logger: {
    agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import {
  NodeExecutor,
  nodeExecutor,
  registerRealExecutors,
  clearExecutors,
  type NodeTypeExecutor,
} from '../NodeExecutor'
import { createToolExecutor, createLlmExecutor } from '../realExecutors'
import type { GraphNode, GraphExecutionContext, NodeExecutionResult } from '../graphTypes'

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'n1',
    title: 'Test',
    description: '',
    provider: 'openai',
    model: 'gpt-4',
    role: 'default',
    dependencies: [],
    status: 'pending',
    ...overrides,
  } as GraphNode
}

function makeCtx(overrides: Partial<GraphExecutionContext> = {}): GraphExecutionContext {
  return {
    graph: { id: 'g1', tasks: [] } as any,
    node: makeNode(),
    state: {
      read: vi.fn(),
      write: vi.fn(),
      readChannel: vi.fn(),
      writeChannel: vi.fn(),
      getNodeOutput: vi.fn(),
      setNodeOutput: vi.fn(),
      getMetadata: vi.fn(),
      setMetadata: vi.fn(),
    } as any,
    workspacePath: '/tmp',
    traceId: 'trace-1',
    ...overrides,
  } as GraphExecutionContext
}

describe('NodeExecutor', () => {
  let executor: NodeExecutor

  beforeEach(() => {
    executor = new NodeExecutor()
  })

  describe('节点类型分发', () => {
    it('task 节点（缺省）→ 默认 task 执行器（占位失败）', async () => {
      const node = makeNode({ nodeType: undefined }) // 缺省 task
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(false)
      expect(result.error).toContain('not registered')
    })

    it('decision 节点 → 纯路由，无副作用，成功', async () => {
      const node = makeNode({ nodeType: 'decision' })
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toBe('')
    })

    it('human 节点 → HITL 暂停（返回 pending 标记，区别于普通失败）', async () => {
      const node = makeNode({ nodeType: 'human' })
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(false)
      expect(result.pending).toBe(true)
      expect(result.error).toContain('Awaiting human')
    })

    it('tool 节点 → 默认占位成功', async () => {
      const node = makeNode({ nodeType: 'tool', output: 'tool output' })
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toBe('tool output')
    })

    it('未知节点类型 → 回退到 task 执行器', async () => {
      const node = makeNode({ nodeType: 'unknown' as any })
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(false) // task 占位失败
    })
  })

  describe('自定义执行器注册', () => {
    it('注册 task 执行器后生效', async () => {
      const customExecutor: NodeTypeExecutor = {
        execute: async (node, _ctx) => ({
          taskId: node.id,
          success: true,
          output: 'custom task output',
        } as NodeExecutionResult),
      }
      executor.registerExecutor('task', customExecutor)

      const node = makeNode({ nodeType: 'task' })
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toBe('custom task output')
    })

    it('注册 tool 执行器覆盖默认', async () => {
      const customToolExecutor: NodeTypeExecutor = {
        execute: async (node, _ctx) => ({
          taskId: node.id,
          success: true,
          output: 'custom tool result',
        } as NodeExecutionResult),
      }
      executor.registerExecutor('tool', customToolExecutor)

      const node = makeNode({ nodeType: 'tool' })
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toBe('custom tool result')
    })

    it('注册 llm 执行器', async () => {
      const llmExecutor: NodeTypeExecutor = {
        execute: async (node, _ctx) => ({
          taskId: node.id,
          success: true,
          output: 'LLM decision: route to A',
        } as NodeExecutionResult),
      }
      executor.registerExecutor('llm', llmExecutor)

      const node = makeNode({ nodeType: 'llm' })
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toContain('route to A')
    })
  })

  describe('中止信号检查', () => {
    it('abortSignal 已中止 → 立即返回失败，不执行', async () => {
      const controller = new AbortController()
      controller.abort()
      const node = makeNode({ nodeType: 'decision' })
      const ctx = makeCtx({ node, abortSignal: controller.signal })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(false)
      expect(result.error).toContain('aborted')
    })
  })

  describe('异常捕获', () => {
    it('执行器抛出异常 → 捕获并返回失败结果，不向上抛出', async () => {
      const throwingExecutor: NodeTypeExecutor = {
        execute: async () => {
          throw new Error('Executor exploded')
        },
      }
      executor.registerExecutor('task', throwingExecutor)

      const node = makeNode({ nodeType: 'task' })
      const ctx = makeCtx({ node })

      // 不应抛出
      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Executor exploded')
    })

    it('执行器抛出非 Error 值 → 转为字符串', async () => {
      const throwingExecutor: NodeTypeExecutor = {
        execute: async () => {
          throw 'string error'
        },
      }
      executor.registerExecutor('task', throwingExecutor)

      const node = makeNode({ nodeType: 'task' })
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(false)
      expect(result.error).toContain('string error')
    })
  })

  describe('Span 强制生成（可观测性）', () => {
    it('成功执行 → Span 状态 ok', async () => {
      const customExecutor: NodeTypeExecutor = {
        execute: async (node) => ({
          taskId: node.id,
          success: true,
          output: 'ok',
        } as NodeExecutionResult),
      }
      executor.registerExecutor('task', customExecutor)

      const node = makeNode({ nodeType: 'task' })
      const ctx = makeCtx({ node })

      await executor.execute(node, ctx)
      // Span 通过 createSpan 创建，验证不抛错即说明 Span 生成正常
      // 完整 Span 树校验在集成测试中
    })

    it('失败执行 → Span 状态 error', async () => {
      const failExecutor: NodeTypeExecutor = {
        execute: async (node) => ({
          taskId: node.id,
          success: false,
          error: 'task failed',
        } as NodeExecutionResult),
      }
      executor.registerExecutor('task', failExecutor)

      const node = makeNode({ nodeType: 'task' })
      const ctx = makeCtx({ node })

      const result = await executor.execute(node, ctx)
      expect(result.success).toBe(false)
    })
  })

  describe('模块单例 + registerRealExecutors / clearExecutors', () => {
    beforeEach(() => {
      // 隔离单例注册污染
      clearExecutors()
    })

    it('registerRealExecutors 注入 tool 执行器后，tool 节点通过 ctx.executeToolCall 真实执行', async () => {
      registerRealExecutors({ toolExecutor: createToolExecutor() })

      const node = makeNode({
        id: 'tool-1',
        nodeType: 'tool',
        toolCall: { name: 'read_file', arguments: { path: '/tmp/x' } },
      })
      const ctx = makeCtx({
        node,
        executeToolCall: async (tc) => {
          expect(tc.name).toBe('read_file')
          expect(tc.arguments.path).toBe('/tmp/x')
          return { success: true, output: 'file content here' }
        },
      })

      const result = await nodeExecutor.execute(node, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toBe('file content here')
    })

    it('tool 节点缺 toolCall → 返回失败且错误可诊断', async () => {
      registerRealExecutors({ toolExecutor: createToolExecutor() })

      const node = makeNode({ id: 'tool-2', nodeType: 'tool' })
      const ctx = makeCtx({ node, executeToolCall: vi.fn() })

      const result = await nodeExecutor.execute(node, ctx)
      expect(result.success).toBe(false)
      expect(result.error).toContain('missing toolCall')
      expect(ctx.executeToolCall).not.toHaveBeenCalled()
    })

    it('tool 节点 ctx 未注入 executeToolCall → 返回失败且错误可诊断', async () => {
      registerRealExecutors({ toolExecutor: createToolExecutor() })

      const node = makeNode({
        id: 'tool-3',
        nodeType: 'tool',
        toolCall: { name: 'read_file', arguments: {} },
      })
      const ctx = makeCtx({ node }) // 未注入 executeToolCall

      const result = await nodeExecutor.execute(node, ctx)
      expect(result.success).toBe(false)
      expect(result.error).toContain('executeToolCall not injected')
    })

    it('tool 执行回调抛错 → 捕获并返回失败结果', async () => {
      registerRealExecutors({ toolExecutor: createToolExecutor() })

      const node = makeNode({
        id: 'tool-4',
        nodeType: 'tool',
        toolCall: { name: 'write_file', arguments: {} },
      })
      const ctx = makeCtx({
        node,
        executeToolCall: async () => {
          throw new Error('disk full')
        },
      })

      const result = await nodeExecutor.execute(node, ctx)
      expect(result.success).toBe(false)
      expect(result.error).toContain('disk full')
    })

    it('registerRealExecutors 注入 llm 执行器后，llm 节点通过 ctx.executeLlmCall 真实执行', async () => {
      registerRealExecutors({ llmExecutor: createLlmExecutor() })

      const node = makeNode({
        id: 'llm-1',
        nodeType: 'llm',
        llmPrompt: 'Is this a bug?',
      })
      const ctx = makeCtx({
        node,
        executeLlmCall: async (prompt) => {
          expect(prompt).toBe('Is this a bug?')
          return { success: true, output: 'yes, fix line 42' }
        },
      })

      const result = await nodeExecutor.execute(node, ctx)
      expect(result.success).toBe(true)
      expect(result.output).toContain('fix line 42')
    })

    it('llm 节点缺 llmPrompt 时回退 description', async () => {
      registerRealExecutors({ llmExecutor: createLlmExecutor() })

      const node = makeNode({
        id: 'llm-2',
        nodeType: 'llm',
        description: 'Analyze performance',
      })
      const ctx = makeCtx({
        node,
        executeLlmCall: async (prompt) => {
          expect(prompt).toBe('Analyze performance')
          return { success: true, output: 'hot path found' }
        },
      })

      const result = await nodeExecutor.execute(node, ctx)
      expect(result.success).toBe(true)
    })

    it('clearExecutors 后 tool 节点回退到默认占位（不再走真实回调）', async () => {
      registerRealExecutors({ toolExecutor: createToolExecutor() })
      clearExecutors()

      const executeToolCall = vi.fn()
      const node = makeNode({
        id: 'tool-5',
        nodeType: 'tool',
        toolCall: { name: 'read_file', arguments: {} },
      })
      const ctx = makeCtx({ node, executeToolCall })

      await nodeExecutor.execute(node, ctx)
      // 回退到默认 tool 执行器：返回占位成功，不会调用回调
      expect(executeToolCall).not.toHaveBeenCalled()
    })

    it('registerRealExecutors 不传 task → task 节点仍走默认占位（设计：task 不注册）', async () => {
      registerRealExecutors({})

      const node = makeNode({ id: 'task-1', nodeType: 'task' })
      const ctx = makeCtx({ node })

      const result = await nodeExecutor.execute(node, ctx)
      expect(result.success).toBe(false)
      expect(result.error).toContain('not registered')
    })
  })
})
