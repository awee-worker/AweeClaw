/**
 * GraphStateAdapter 单元测试
 *
 * 验证适配层正确路由到底层 store，以及内存通道/元数据的隔离性。
 * 使用 zustand 的 setState 直接注入 mock store 状态，不依赖真实持久化。
 *
 * @module GraphRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock IntelligenceStore —— 截断真实 store（避免拉起 window 等副作用）
const mockStore = {
  getPlan: vi.fn(),
  markTaskCompleted: vi.fn(),
}

vi.mock('../../state/IntelligenceStore', () => ({
  useAgentStore: {
    getState: () => mockStore,
  },
}))

// Mock logger（避免日志干扰测试）
vi.mock('@toolkit/LogEngine', () => ({
  logger: {
    agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import { StoreGraphStateAdapter, createStateAccessor, readReflection, readIteration, nodeRequiresApproval } from '../GraphStateAdapter'
import type { TaskPlan, PlanTask } from '../../planner/planTypes'

/** 构造测试用 plan */
function makePlan(tasks: Partial<PlanTask>[]): TaskPlan {
  return {
    id: 'plan-1',
    name: 'test-plan',
    createdAt: 0,
    updatedAt: 0,
    requirementsDoc: 'req.md',
    executionMode: 'parallel',
    status: 'executing',
    tasks: tasks.map((t, i) => ({
      id: t.id || `task-${i}`,
      title: t.title || `Task ${i}`,
      description: t.description || '',
      provider: 'openai',
      model: 'gpt-4',
      role: 'default',
      dependencies: t.dependencies || [],
      status: t.status || 'pending',
      ...t,
    })) as PlanTask[],
  }
}

describe('StoreGraphStateAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.getPlan.mockReturnValue(null)
    mockStore.markTaskCompleted.mockReset()
  })

  describe('通用读写', () => {
    it('write 默认写入 metadata', () => {
      const adapter = new StoreGraphStateAdapter('plan-1')
      adapter.write('flag', true)
      expect(adapter.getMetadata('flag')).toBe(true)
    })

    it('read 优先读 channels，其次 metadata', () => {
      const adapter = new StoreGraphStateAdapter('plan-1')
      adapter.setMetadata('key', 'from-metadata')
      adapter.writeChannel('key', 'from-channel')
      expect(adapter.read('key')).toBe('from-channel')

      // channels 无此 key 时回退 metadata
      expect(adapter.read('other')).toBeUndefined()
      adapter.setMetadata('other', 'meta')
      expect(adapter.read('other')).toBe('meta')
    })
  })

  describe('节点间数据通道', () => {
    it('writeChannel/readChannel 隔离于 metadata', () => {
      const adapter = new StoreGraphStateAdapter('plan-1')
      adapter.writeChannel('data', { count: 5 })
      adapter.setMetadata('data', 'meta-value')

      expect(adapter.readChannel('data')).toEqual({ count: 5 })
      expect(adapter.getMetadata('data')).toBe('meta-value')
    })
  })

  describe('节点输出代理（getNodeOutput / setNodeOutput）', () => {
    it('getNodeOutput 内存通道优先', () => {
      const adapter = new StoreGraphStateAdapter('plan-1')
      adapter.writeChannel('output:node-1', 'cached-output')

      // 即使 store 无 plan，也应返回内存缓存
      expect(adapter.getNodeOutput('node-1')).toBe('cached-output')
      expect(mockStore.getPlan).not.toHaveBeenCalled()
    })

    it('getNodeOutput 回退到 store PlanTask.output', () => {
      const plan = makePlan([
        { id: 'node-1', output: 'persisted-output', status: 'completed' },
      ])
      mockStore.getPlan.mockReturnValue(plan)

      const adapter = new StoreGraphStateAdapter('plan-1')
      expect(adapter.getNodeOutput('node-1')).toBe('persisted-output')
      expect(mockStore.getPlan).toHaveBeenCalledWith('plan-1')
    })

    it('setNodeOutput 代理到 store.markTaskCompleted 且更新内存缓存', () => {
      const adapter = new StoreGraphStateAdapter('plan-1')
      adapter.setNodeOutput('node-2', 'new-output')

      expect(mockStore.markTaskCompleted).toHaveBeenCalledWith('plan-1', 'node-2', 'new-output')
      // 内存缓存也应更新
      expect(adapter.readChannel('output:node-2')).toBe('new-output')
    })

    it('store 异常时不抛错（降级处理）', () => {
      mockStore.markTaskCompleted.mockImplementation(() => {
        throw new Error('store error')
      })
      const adapter = new StoreGraphStateAdapter('plan-1')

      // 不应抛出
      expect(() => adapter.setNodeOutput('node-3', 'out')).not.toThrow()
      // 内存缓存仍写入
      expect(adapter.readChannel('output:node-3')).toBe('out')
    })
  })

  describe('快照导出/恢复（exportSnapshot / importSnapshot）', () => {
    it('exportSnapshot 包含 channels/metadata/artifacts/nodeOutputs', () => {
      const plan = makePlan([
        { id: 'n1', output: 'out1', status: 'completed' },
        { id: 'n2', output: 'out2', status: 'completed' },
      ])
      mockStore.getPlan.mockReturnValue(plan)

      const adapter = new StoreGraphStateAdapter('plan-1')
      adapter.setMetadata('m', 1)
      adapter.writeChannel('c', 'v')
      adapter.addArtifact('/tmp/a.ts')

      const snap = adapter.exportSnapshot()
      expect(snap.metadata).toEqual({ m: 1 })
      expect(snap.channels).toEqual({ c: 'v' })
      expect(snap.artifacts).toEqual(['/tmp/a.ts'])
      expect(snap.nodeOutputs).toEqual({ n1: 'out1', n2: 'out2' })
    })

    it('importSnapshot 恢复后读写一致', () => {
      const adapter = new StoreGraphStateAdapter('plan-1')
      adapter.importSnapshot({
        channels: { c: 'restored' },
        metadata: { m: 9 },
        artifacts: ['/x.ts'],
        nodeOutputs: { n1: 'out1' },
      })

      expect(adapter.readChannel('c')).toBe('restored')
      expect(adapter.getMetadata('m')).toBe(9)
      expect(adapter.getArtifacts()).toEqual(['/x.ts'])
      expect(adapter.getNodeOutput('n1')).toBe('out1')  // 内存缓存恢复
    })
  })

  describe('工厂函数与辅助函数', () => {
    it('createStateAccessor 返回可用 accessor', () => {
      const accessor = createStateAccessor('plan-1')
      accessor.setMetadata('k', 'v')
      expect(accessor.getMetadata('k')).toBe('v')
    })

    it('readReflection 读取 LoopController 注入的反思', () => {
      const accessor = createStateAccessor('plan-1')
      accessor.setMetadata('loop:n1:reflection', '上次失败：timeout')
      expect(readReflection(accessor, 'n1')).toBe('上次失败：timeout')
    })

    it('readIteration 缺省返回 0', () => {
      const accessor = createStateAccessor('plan-1')
      expect(readIteration(accessor, 'n1')).toBe(0)
      accessor.setMetadata('loop:n1:iteration', 2)
      expect(readIteration(accessor, 'n1')).toBe(2)
    })

    it('nodeRequiresApproval：human 节点或 requireApproval=true', () => {
      expect(nodeRequiresApproval({ nodeType: 'human' } as any)).toBe(true)
      expect(nodeRequiresApproval({ requireApproval: true } as any)).toBe(true)
      expect(nodeRequiresApproval({ nodeType: 'task' } as any)).toBe(false)
      expect(nodeRequiresApproval({} as any)).toBe(false)
    })
  })
})
