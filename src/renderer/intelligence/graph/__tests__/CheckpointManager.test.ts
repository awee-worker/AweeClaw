/**
 * CheckpointManager 单元测试
 *
 * 验证：
 * - checkpoint 创建（含状态快照 + 已完成节点列表）
 * - restore 恢复（重置 running 节点为 pending + 注入状态）
 * - restoreLatest 恢复到最新
 * - listCheckpoints 按时间排序
 * - clearGraph / clearAll 清理
 *
 * @module GraphRuntime
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@toolkit/LogEngine', () => ({
  logger: {
    agent: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

// Mock IntelligenceStore
const mockStore = {
  getPlan: vi.fn<(planId: string) => any>(),
  updateTask: vi.fn(),
}
vi.mock('../../state/IntelligenceStore', () => ({
  useAgentStore: { getState: () => mockStore },
}))

import { CheckpointManager } from '../CheckpointManager'
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

describe('CheckpointManager', () => {
  let manager: CheckpointManager
  let stateAdapter: StoreGraphStateAdapter

  beforeEach(() => {
    manager = new CheckpointManager()
    stateAdapter = new StoreGraphStateAdapter('g1')
    vi.clearAllMocks()
  })

  describe('checkpoint 创建', () => {
    it('创建检查点并返回 id', () => {
      const node = makeNode({ id: 'n1', status: 'pending' })
      const completed = makeNode({ id: 'n0', status: 'completed' })
      const graph = makeGraph([completed, node])

      // 注入状态
      stateAdapter.setMetadata('key', 'value')
      stateAdapter.writeChannel('ch', 'data')

      const ckptId = manager.checkpoint(graph, node, stateAdapter, 'trace-1')

      expect(ckptId).toMatch(/^ckpt-g1-/)
      const ckpt = manager.getCheckpoint(ckptId)
      expect(ckpt).toBeDefined()
      expect(ckpt!.nodeId).toBe('n1')
      expect(ckpt!.graphId).toBe('g1')
      expect(ckpt!.traceId).toBe('trace-1')
      expect(ckpt!.completedNodes).toEqual(['n0']) // 已完成节点记录
    })

    it('快照包含 channels / metadata', () => {
      const node = makeNode({ id: 'n1' })
      const graph = makeGraph([node])

      stateAdapter.setMetadata('retry', 2)
      stateAdapter.writeChannel('output:n1', 'partial')

      const ckptId = manager.checkpoint(graph, node, stateAdapter)
      const ckpt = manager.getCheckpoint(ckptId)!

      expect(ckpt.stateSnapshot.metadata).toEqual({ retry: 2 })
      expect(ckpt.stateSnapshot.channels).toHaveProperty('output:n1', 'partial')
    })

    it('多次 checkpoint 计数递增', () => {
      const node = makeNode({ id: 'n1' })
      const graph = makeGraph([node])

      const id1 = manager.checkpoint(graph, node, stateAdapter)
      const id2 = manager.checkpoint(graph, node, stateAdapter)

      expect(id1).not.toBe(id2)
    })
  })

  describe('restore 恢复', () => {
    it('恢复时重置 running 节点为 pending', () => {
      const running = makeNode({ id: 'n1', status: 'running' })
      const completed = makeNode({ id: 'n0', status: 'completed' })
      const graph = makeGraph([completed, running])

      // mock store 返回图（含 running 节点）
      mockStore.getPlan.mockReturnValue(graph)

      // 先打 checkpoint
      const ckptId = manager.checkpoint(graph, running, stateAdapter)

      // 恢复
      const result = manager.restore(ckptId, stateAdapter)

      expect(result).not.toBeNull()
      expect(result!.resumeFrom).toBe('n1')
      // running 节点应被重置为 pending
      expect(mockStore.updateTask).toHaveBeenCalledWith('g1', 'n1', expect.objectContaining({ status: 'pending' }))
    })

    it('恢复时注入状态快照', () => {
      const node = makeNode({ id: 'n1', status: 'pending' })
      const graph = makeGraph([node])
      mockStore.getPlan.mockReturnValue(graph)

      // 打 checkpoint 前注入状态
      stateAdapter.setMetadata('phase', 'analysis')
      stateAdapter.writeChannel('data', { x: 1 })

      const ckptId = manager.checkpoint(graph, node, stateAdapter)

      // 用新 adapter 恢复（模拟重启后）
      const newAdapter = new StoreGraphStateAdapter('g1')
      manager.restore(ckptId, newAdapter)

      expect(newAdapter.getMetadata('phase')).toBe('analysis')
      expect(newAdapter.readChannel('data')).toEqual({ x: 1 })
    })

    it('检查点不存在 → 返回 null', () => {
      const result = manager.restore('nonexistent', stateAdapter)
      expect(result).toBeNull()
    })

    it('图不在 store → 返回 null', () => {
      const node = makeNode({ id: 'n1' })
      const graph = makeGraph([node])
      const ckptId = manager.checkpoint(graph, node, stateAdapter)

      // store 返回 null（图不存在）
      mockStore.getPlan.mockReturnValue(null)

      const result = manager.restore(ckptId, stateAdapter)
      expect(result).toBeNull()
    })
  })

  describe('restoreLatest', () => {
    it('恢复到图最新检查点', () => {
      const node = makeNode({ id: 'n1', status: 'running' })
      const graph = makeGraph([node])
      mockStore.getPlan.mockReturnValue(graph)

      manager.checkpoint(graph, node, stateAdapter)
      // 等待确保时间戳不同
      manager.checkpoint(graph, node, stateAdapter)

      const result = manager.restoreLatest('g1', stateAdapter)
      expect(result).not.toBeNull()
      expect(result!.resumeFrom).toBe('n1')
    })

    it('图无检查点 → 返回 null', () => {
      const result = manager.restoreLatest('no-graph', stateAdapter)
      expect(result).toBeNull()
    })
  })

  describe('listCheckpoints', () => {
    it('按时间排序返回图的所有检查点', async () => {
      const node = makeNode({ id: 'n1' })
      const graph = makeGraph([node])

      const id1 = manager.checkpoint(graph, node, stateAdapter)
      // 确保时间戳递增
      await new Promise(r => setTimeout(r, 5))
      manager.checkpoint(graph, node, stateAdapter)
      await new Promise(r => setTimeout(r, 5))
      const id3 = manager.checkpoint(graph, node, stateAdapter)

      const list = manager.listCheckpoints('g1')
      expect(list).toHaveLength(3)
      expect(list[0].checkpointId).toBe(id1)
      expect(list[2].checkpointId).toBe(id3)
    })

    it('其他图的检查点不返回', () => {
      const node = makeNode({ id: 'n1' })
      const graph1 = makeGraph([node], { id: 'g1' })
      const graph2 = makeGraph([node], { id: 'g2' })

      manager.checkpoint(graph1, node, stateAdapter)
      manager.checkpoint(graph2, node, stateAdapter)

      expect(manager.listCheckpoints('g1')).toHaveLength(1)
      expect(manager.listCheckpoints('g2')).toHaveLength(1)
    })
  })

  describe('清理', () => {
    it('clearGraph 清理指定图的检查点', () => {
      const node = makeNode({ id: 'n1' })
      const graph1 = makeGraph([node], { id: 'g1' })
      const graph2 = makeGraph([node], { id: 'g2' })

      manager.checkpoint(graph1, node, stateAdapter)
      manager.checkpoint(graph2, node, stateAdapter)

      manager.clearGraph('g1')

      expect(manager.listCheckpoints('g1')).toHaveLength(0)
      expect(manager.listCheckpoints('g2')).toHaveLength(1) // 其他图不受影响
    })

    it('clearAll 清理所有检查点', () => {
      const node = makeNode({ id: 'n1' })
      const graph1 = makeGraph([node], { id: 'g1' })
      const graph2 = makeGraph([node], { id: 'g2' })

      manager.checkpoint(graph1, node, stateAdapter)
      manager.checkpoint(graph2, node, stateAdapter)

      manager.clearAll()

      expect(manager.listCheckpoints('g1')).toHaveLength(0)
      expect(manager.listCheckpoints('g2')).toHaveLength(0)
    })
  })

  // ============================================
  // 阶段五：磁盘持久化支持
  // ============================================
  describe('磁盘持久化支持', () => {
    describe('serializeLatest', () => {
      it('返回最新 checkpoint 的深拷贝', () => {
        const node = makeNode({ id: 'n1' })
        const graph = makeGraph([node])

        stateAdapter.setMetadata('iter', 3)
        stateAdapter.writeChannel('output:n1', 'result')
        manager.checkpoint(graph, node, stateAdapter)

        const serialized = manager.serializeLatest('g1')

        expect(serialized).not.toBeNull()
        expect(serialized!.graphId).toBe('g1')
        expect(serialized!.nodeId).toBe('n1')
        expect(serialized!.stateSnapshot.metadata).toEqual({ iter: 3 })
        expect(serialized!.stateSnapshot.channels).toHaveProperty('output:n1', 'result')
      })

      it('返回深拷贝（修改不影响内存）', () => {
        const node = makeNode({ id: 'n1' })
        const graph = makeGraph([node])

        stateAdapter.setMetadata('key', 'original')
        manager.checkpoint(graph, node, stateAdapter)

        const serialized = manager.serializeLatest('g1')!
        // 篡改序列化结果
        serialized.stateSnapshot.metadata.key = 'tampered'
        serialized.completedNodes.push('fake-node')

        // 内存中的 checkpoint 不应受影响
        const latestId = (manager as any).latestByGraph.get('g1') as string
        const inMemory = (manager as any).checkpoints.get(latestId)
        expect(inMemory.stateSnapshot.metadata.key).toBe('original')
        expect(inMemory.completedNodes).not.toContain('fake-node')
      })

      it('多次 checkpoint 返回最新', () => {
        const node1 = makeNode({ id: 'n1' })
        const node2 = makeNode({ id: 'n2' })
        const graph = makeGraph([node1, node2])

        manager.checkpoint(graph, node1, stateAdapter)
        // 确保时间戳不同
        const earlier = manager.serializeLatest('g1')
        manager.checkpoint(graph, node2, stateAdapter)
        const later = manager.serializeLatest('g1')

        expect(earlier!.nodeId).toBe('n1')
        expect(later!.nodeId).toBe('n2')
      })

      it('图无 checkpoint 返回 null', () => {
        expect(manager.serializeLatest('no-such-graph')).toBeNull()
      })
    })

    describe('loadPersistedCheckpoint', () => {
      function makePersistedCheckpoint(overrides: Partial<any> = {}): any {
        return {
          checkpointId: 'ckpt-g1-restored-xyz',
          graphId: 'g1',
          nodeId: 'n2',
          stateSnapshot: {
            channels: { 'output:n1': 'prev' },
            metadata: { 'loop:n2:iteration': 2 },
            artifacts: ['/tmp/a.txt'],
            nodeOutputs: { n1: 'prev' },
          },
          timestamp: 1700000000000,
          completedNodes: ['n1'],
          traceId: 'trace-restored',
          ...overrides,
        }
      }

      it('注入持久化 checkpoint 后可被 getCheckpoint/restoreLatest 访问', () => {
        const persisted = makePersistedCheckpoint()

        const ok = manager.loadPersistedCheckpoint(persisted)

        expect(ok).toBe(true)
        // getCheckpoint 可访问
        const ckpt = manager.getCheckpoint('ckpt-g1-restored-xyz')
        expect(ckpt).toBeDefined()
        expect(ckpt!.nodeId).toBe('n2')
        expect(ckpt!.traceId).toBe('trace-restored')
        expect(ckpt!.timestamp).toBe(1700000000000)
        // restoreLatest 指向恢复的 checkpoint
        const latest = (manager as any).latestByGraph.get('g1')
        expect(latest).toBe('ckpt-g1-restored-xyz')
      })

      it('恢复后 restoreLatest 可正常恢复', () => {
        const running = makeNode({ id: 'n2', status: 'running' })
        const completed = makeNode({ id: 'n1', status: 'completed' })
        const graph = makeGraph([completed, running])
        mockStore.getPlan.mockReturnValue(graph)

        const persisted = makePersistedCheckpoint()
        manager.loadPersistedCheckpoint(persisted)

        const result = manager.restoreLatest('g1', stateAdapter)

        expect(result).not.toBeNull()
        expect(result!.resumeFrom).toBe('n2')
      })

      it('状态快照被深拷贝注入（修改外部不影响内存）', () => {
        const persisted = makePersistedCheckpoint()
        manager.loadPersistedCheckpoint(persisted)

        // 篡改原始 persisted 对象
        persisted.stateSnapshot.metadata['loop:n2:iteration'] = 999
        persisted.completedNodes.push('tampered')

        // 内存中应保持注入时的快照
        const ckpt = manager.getCheckpoint('ckpt-g1-restored-xyz')!
        expect(ckpt.stateSnapshot.metadata['loop:n2:iteration']).toBe(2)
        expect(ckpt.completedNodes).toEqual(['n1'])
      })

      it('同 checkpointId 重复注入返回 false（幂等）', () => {
        const persisted = makePersistedCheckpoint()

        const first = manager.loadPersistedCheckpoint(persisted)
        const second = manager.loadPersistedCheckpoint(persisted)

        expect(first).toBe(true)
        expect(second).toBe(false) // 幂等跳过
      })

      it('缺 graphId 拒绝注入', () => {
        const invalid = makePersistedCheckpoint({ graphId: '' })
        expect(manager.loadPersistedCheckpoint(invalid)).toBe(false)
        expect(manager.getCheckpoint('ckpt-g1-restored-xyz')).toBeUndefined()
      })

      it('缺 checkpointId 拒绝注入', () => {
        const invalid = makePersistedCheckpoint({ checkpointId: '' })
        expect(manager.loadPersistedCheckpoint(invalid)).toBe(false)
      })

      it('缺 nodeId 拒绝注入', () => {
        const invalid = makePersistedCheckpoint({ nodeId: '' })
        expect(manager.loadPersistedCheckpoint(invalid)).toBe(false)
      })

      it('stateSnapshot 字段缺失时 fallback 为空（不崩溃）', () => {
        const partial = makePersistedCheckpoint({
          stateSnapshot: {
            channels: { a: 1 },
            // metadata / artifacts / nodeOutputs 缺失
          },
        })

        const ok = manager.loadPersistedCheckpoint(partial)
        expect(ok).toBe(true)

        const ckpt = manager.getCheckpoint('ckpt-g1-restored-xyz')!
        expect(ckpt.stateSnapshot.metadata).toEqual({})
        expect(ckpt.stateSnapshot.artifacts).toEqual([])
        expect(ckpt.stateSnapshot.nodeOutputs).toEqual({})
      })
    })

    describe('serializeLatest + loadPersistedCheckpoint 往返', () => {
      it('serialize 后 load 可恢复等价状态', () => {
        const node = makeNode({ id: 'n1' })
        const graph = makeGraph([node])

        stateAdapter.setMetadata('counter', 5)
        stateAdapter.writeChannel('ch1', { deep: { value: 1 } })
        stateAdapter.addArtifact('/path/file.txt')
        const originalId = manager.checkpoint(graph, node, stateAdapter, 'trace-1')

        // 序列化
        const serialized = manager.serializeLatest('g1')!

        // 模拟重启：新 manager 实例
        const newManager = new CheckpointManager()
        newManager.loadPersistedCheckpoint(serialized)

        const restored = newManager.getCheckpoint(originalId)!
        expect(restored.nodeId).toBe('n1')
        expect(restored.traceId).toBe('trace-1')
        expect(restored.stateSnapshot.metadata).toEqual({ counter: 5 })
        expect(restored.stateSnapshot.artifacts).toEqual(['/path/file.txt'])
        expect(restored.stateSnapshot.channels).toHaveProperty('ch1')
      })
    })
  })
})
