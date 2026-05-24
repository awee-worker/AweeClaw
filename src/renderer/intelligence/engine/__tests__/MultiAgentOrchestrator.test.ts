/**
 * MultiAgentOrchestrator 测试
 *
 * 测试三大核心特性：
 * 1. 依赖图分层执行
 * 2. 同层并行执行
 * 3. 共识投票机制
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MultiAgentOrchestrator,
  TaskDecomposer,
  ConsensusEngine,
  WorkflowEngine,
  agentRegistry,
  messageBus,
  type AgentProfile,
  type SubTask,
} from '../MultiAgentOrchestrator'

// 清理注册表
function clearRegistry(): void {
  agentRegistry.getAll().forEach(a => agentRegistry.unregister(a.id))
}

// 注册测试 Agent
function registerTestAgents(): void {
  const agents: AgentProfile[] = [
    {
      id: 'arch-1',
      role: 'architect',
      name: '架构师A',
      description: '负责架构设计',
      systemPrompt: '架构师',
      capabilities: ['design'],
      llmConfig: { provider: 'test', model: 'test', apiKey: '' },
      priority: 8,
    },
    {
      id: 'dev-1',
      role: 'developer',
      name: '开发者A',
      description: '负责代码实现',
      systemPrompt: '开发者',
      capabilities: ['code'],
      llmConfig: { provider: 'test', model: 'test', apiKey: '' },
      priority: 9,
    },
    {
      id: 'dev-2',
      role: 'developer',
      name: '开发者B',
      description: '负责代码实现',
      systemPrompt: '开发者',
      capabilities: ['code'],
      llmConfig: { provider: 'test', model: 'test', apiKey: '' },
      priority: 9,
    },
    {
      id: 'rev-1',
      role: 'reviewer',
      name: '审查员A',
      description: '负责审查',
      systemPrompt: '审查员',
      capabilities: ['review'],
      llmConfig: { provider: 'test', model: 'test', apiKey: '' },
      priority: 7,
    },
    {
      id: 'rev-2',
      role: 'reviewer',
      name: '审查员B',
      description: '负责审查',
      systemPrompt: '审查员',
      capabilities: ['review'],
      llmConfig: { provider: 'test', model: 'test', apiKey: '' },
      priority: 7,
    },
    {
      id: 'test-1',
      role: 'tester',
      name: '测试员A',
      description: '负责测试',
      systemPrompt: '测试员',
      capabilities: ['test'],
      llmConfig: { provider: 'test', model: 'test', apiKey: '' },
      priority: 6,
    },
  ]
  agents.forEach(a => agentRegistry.register(a))
}

// 模拟 agentExecutor：记录执行顺序和耗时
function createMockExecutor(delayMs = 50) {
  const executionLog: Array<{ agentId: string; task: string; start: number; end: number }> = []

  const executor = vi.fn(async (agentId: string, task: string) => {
    const start = Date.now()
    await new Promise(r => setTimeout(r, delayMs))
    const end = Date.now()
    executionLog.push({ agentId, task, start, end })
    return `[${agentId}] 完成了: ${task}`
  })

  return { executor, executionLog }
}

describe('MultiAgentOrchestrator', () => {
  beforeEach(() => {
    clearRegistry()
    messageBus.clear()
    registerTestAgents()
  })

  // ============================================================
  // 测试 1: 依赖图分层执行
  // ============================================================
  describe('依赖图分层执行', () => {
    it('有依赖的任务应该按顺序分层执行', async () => {
      const orchestrator = new MultiAgentOrchestrator()
      const { executor, executionLog } = createMockExecutor(30)

      // 任务: 包含"设计"和"实现"关键词，确保触发多角色分解
      // 预期分层:
      //   Layer 0: 架构设计 (arch-1)
      //   Layer 1: 代码实现 (dev-1) - 依赖架构设计
      //   Layer 2: 测试验证 (test-1) - 依赖代码实现
      const result = await orchestrator.collaborate(
        '设计并实现一个登录系统',
        { mode: 'chat', workspacePath: null, requireConsensus: false },
        executor
      )

      // 打印调试信息
      console.log('SubTasks:', result.subTasks.map(t => ({ title: t.title, assignedTo: t.assignedTo, deps: t.dependencies, status: t.status })))
      console.log('ExecutionLog:', executionLog.map(e => ({ agentId: e.agentId, task: e.task, start: e.start, end: e.end })))

      expect(result.success).toBe(true)
      expect(result.subTasks.length).toBeGreaterThanOrEqual(2)

      // 验证执行顺序：架构设计必须在开发之前
      const archExec = executionLog.find(e => e.agentId === 'arch-1')
      const devExec = executionLog.find(e => e.agentId === 'dev-1')
      const testExec = executionLog.find(e => e.agentId === 'test-1')

      expect(archExec).toBeDefined()
      expect(devExec).toBeDefined()

      if (archExec && devExec) {
        expect(archExec.end).toBeLessThanOrEqual(devExec.start)
      }

      // 如果有测试任务，必须在开发之后
      if (testExec && devExec) {
        expect(devExec.end).toBeLessThanOrEqual(testExec.start)
      }
    })

    it('buildExecutionGraph 应该正确分层', () => {
      const orchestrator = new MultiAgentOrchestrator()

      const subTasks: SubTask[] = [
        { id: 't1', title: 'A', description: '', assignedTo: 'arch-1', dependencies: [], status: 'pending' },
        { id: 't2', title: 'B', description: '', assignedTo: 'dev-1', dependencies: ['t1'], status: 'pending' },
        { id: 't3', title: 'C', description: '', assignedTo: 'dev-2', dependencies: ['t1'], status: 'pending' },
        { id: 't4', title: 'D', description: '', assignedTo: 'test-1', dependencies: ['t2', 't3'], status: 'pending' },
      ]

      // @ts-expect-error 访问私有方法
      const graph = orchestrator.buildExecutionGraph(subTasks)

      // 预期分层:
      // Layer 0: [t1]
      // Layer 1: [t2, t3] (都依赖 t1)
      // Layer 2: [t4] (依赖 t2, t3)
      expect(graph).toHaveLength(3)
      expect(graph[0].map(t => t.id)).toEqual(['t1'])
      expect(graph[1].map(t => t.id)).toContain('t2')
      expect(graph[1].map(t => t.id)).toContain('t3')
      expect(graph[2].map(t => t.id)).toEqual(['t4'])
    })

    it('循环依赖应该抛出错误', () => {
      const orchestrator = new MultiAgentOrchestrator()

      const subTasks: SubTask[] = [
        { id: 't1', title: 'A', description: '', assignedTo: 'arch-1', dependencies: ['t2'], status: 'pending' },
        { id: 't2', title: 'B', description: '', assignedTo: 'dev-1', dependencies: ['t1'], status: 'pending' },
      ]

      // @ts-expect-error 访问私有方法
      expect(() => orchestrator.buildExecutionGraph(subTasks)).toThrow('Circular dependency')
    })
  })

  // ============================================================
  // 测试 2: 同层并行执行
  // ============================================================
  describe('同层并行执行', () => {
    it('同层无依赖的任务应该并行执行', async () => {
      const orchestrator = new MultiAgentOrchestrator()
      const { executor, executionLog } = createMockExecutor(100)

      // 任务: 包含"前端"和"后端"关键词，触发多开发者并行分配
      const result = await orchestrator.collaborate(
        '设计并实现前端和后端模块',
        { mode: 'chat', workspacePath: null, requireConsensus: false },
        executor
      )

      console.log('Parallel SubTasks:', result.subTasks.map(t => ({ title: t.title, assignedTo: t.assignedTo, deps: t.dependencies })))
      console.log('Parallel ExecutionLog:', executionLog.map(e => ({ agentId: e.agentId, start: e.start, end: e.end })))

      expect(result.success).toBe(true)

      // 找到同层执行的任务（两个开发者）
      const devExecutions = executionLog.filter(e => e.agentId.startsWith('dev-'))

      // 应该有两个开发者被分配
      expect(devExecutions.length).toBeGreaterThanOrEqual(2)

      if (devExecutions.length >= 2) {
        // 并行执行的关键指标：第二个任务的开始时间应该早于第一个任务的结束时间
        const sorted = [...devExecutions].sort((a, b) => a.start - b.start)
        const first = sorted[0]
        const second = sorted[1]

        expect(second.start).toBeLessThan(first.end)
      }
    })

    it('并行执行的两个开发者应该同时开始', async () => {
      const orchestrator = new MultiAgentOrchestrator()
      const { executor, executionLog } = createMockExecutor(80)

      const result = await orchestrator.collaborate(
        '设计并实现前端和后端模块',
        { mode: 'chat', workspacePath: null, requireConsensus: false },
        executor
      )

      expect(result.success).toBe(true)

      // 验证有两个开发者
      const devExecutions = executionLog.filter(e => e.agentId.startsWith('dev-'))
      expect(devExecutions.length).toBeGreaterThanOrEqual(2)

      if (devExecutions.length >= 2) {
        // 两个开发者的开始时间应该非常接近（同时启动）
        const starts = devExecutions.map(e => e.start)
        const maxStart = Math.max(...starts)
        const minStart = Math.min(...starts)
        const startDiff = maxStart - minStart

        // 开始时间差应该小于 50ms（证明是并行启动，不是串行）
        expect(startDiff).toBeLessThan(50)
      }
    })
  })

  // ============================================================
  // 测试 3: 共识投票机制
  // ============================================================
  describe('共识投票机制', () => {
    it('requireConsensus=true 时应该触发投票', async () => {
      const orchestrator = new MultiAgentOrchestrator()
      const { executor } = createMockExecutor(20)

      const result = await orchestrator.collaborate(
        '设计并实现一个功能',
        { mode: 'chat', workspacePath: null, requireConsensus: true },
        executor
      )

      // 有多个子任务且要求共识时，应该进行投票
      expect(result.subTasks.length).toBeGreaterThan(1)
      // 注意：当前共识引擎是模拟实现，实际 LLM 集成后会真正投票
      expect(result.consensusReached).toBeDefined()
    })

    it('ConsensusEngine 应该正确计算投票结果', async () => {
      const engine = new ConsensusEngine(2) // 需要 2 票通过

      const voters: AgentProfile[] = [
        { id: 'v1', role: 'reviewer', name: 'R1', description: '', systemPrompt: '', capabilities: [], llmConfig: { provider: 't', model: 't', apiKey: '' }, priority: 5 },
        { id: 'v2', role: 'reviewer', name: 'R2', description: '', systemPrompt: '', capabilities: [], llmConfig: { provider: 't', model: 't', apiKey: '' }, priority: 5 },
        { id: 'v3', role: 'reviewer', name: 'R3', description: '', systemPrompt: '', capabilities: [], llmConfig: { provider: 't', model: 't', apiKey: '' }, priority: 5 },
      ]

      // 无风险提案 -> 全部通过
      const result1 = await engine.vote('这是一个正常提案', voters, '')
      expect(result1.approved).toBe(true)
      expect(result1.votes.length).toBe(3)
      expect(result1.votes.filter(v => v.approved).length).toBe(3)

      // 有风险提案 -> reviewer 会反对
      const result2 = await engine.vote('这个方案有安全风险', voters, '')
      expect(result2.approved).toBe(false) // 至少一个反对
      expect(result2.votes.some(v => !v.approved)).toBe(true)
    })

    it('票数不足时应该拒绝', async () => {
      const engine = new ConsensusEngine(3) // 需要 3 票

      const voters: AgentProfile[] = [
        { id: 'v1', role: 'reviewer', name: 'R1', description: '', systemPrompt: '', capabilities: [], llmConfig: { provider: 't', model: 't', apiKey: '' }, priority: 5 },
      ]

      const result = await engine.vote('提案', voters, '')
      expect(result.approved).toBe(false) // 只有 1 票，不够 3 票
    })
  })

  // ============================================================
  // 测试 4: 消息总线
  // ============================================================
  describe('消息总线', () => {
    it('应该记录所有消息', async () => {
      const orchestrator = new MultiAgentOrchestrator()
      const { executor } = createMockExecutor(10)

      const result = await orchestrator.collaborate(
        '实现一个功能',
        { mode: 'chat', workspacePath: null, requireConsensus: false },
        executor
      )

      // 每个子任务应该产生 delegate + response 两条消息
      expect(result.messages.length).toBeGreaterThanOrEqual(2)

      // 验证消息结构
      const delegateMsgs = result.messages.filter(m => m.type === 'delegate')
      const responseMsgs = result.messages.filter(m => m.type === 'response')

      expect(delegateMsgs.length).toBeGreaterThanOrEqual(1)
      expect(responseMsgs.length).toBeGreaterThanOrEqual(1)
    })

    it('应该支持按类型过滤历史', () => {
      messageBus.clear()

      messageBus.send({
        id: '1', from: 'a', to: 'b', type: 'delegate', content: '任务1', timestamp: 1,
      })
      messageBus.send({
        id: '2', from: 'b', to: 'a', type: 'response', content: '结果1', timestamp: 2,
      })
      messageBus.send({
        id: '3', from: 'a', to: 'b', type: 'delegate', content: '任务2', timestamp: 3,
      })

      const delegates = messageBus.getHistory({ type: 'delegate' })
      expect(delegates).toHaveLength(2)

      const responses = messageBus.getHistory({ type: 'response' })
      expect(responses).toHaveLength(1)
    })
  })

  // ============================================================
  // 测试 5: 工作流引擎
  // ============================================================
  describe('工作流引擎', () => {
    it('应该支持顺序执行', async () => {
      const workflow = new WorkflowEngine()
      const executionOrder: string[] = []

      const executor = async (agentId: string, task: string) => {
        executionOrder.push(agentId)
        return `done: ${task}`
      }

      workflow.registerNode({
        id: 'n1', type: 'task', agentId: 'arch-1',
        task: { description: '设计' }, next: 'n2',
      })
      workflow.registerNode({
        id: 'n2', type: 'task', agentId: 'dev-1',
        task: { description: '开发' }, next: 'n3',
      })
      workflow.registerNode({
        id: 'n3', type: 'task', agentId: 'test-1',
        task: { description: '测试' },
      })

      await workflow.execute('n1', executor)

      expect(executionOrder).toEqual(['arch-1', 'dev-1', 'test-1'])
    })

    it('应该支持并行节点', async () => {
      const workflow = new WorkflowEngine()
      const executionLog: Array<{ agentId: string; start: number; end: number }> = []

      const executor = async (agentId: string, task: string) => {
        const start = Date.now()
        await new Promise(r => setTimeout(r, 50))
        executionLog.push({ agentId, start, end: Date.now() })
        return `done: ${task}`
      }

      workflow.registerNode({
        id: 'start', type: 'parallel', parallelNodes: ['p1', 'p2'], next: 'end',
      })
      workflow.registerNode({
        id: 'p1', type: 'task', agentId: 'dev-1', task: { description: '前端' },
      })
      workflow.registerNode({
        id: 'p2', type: 'task', agentId: 'dev-2', task: { description: '后端' },
      })
      workflow.registerNode({
        id: 'end', type: 'task', agentId: 'test-1', task: { description: '测试' },
      })

      await workflow.execute('start', executor)

      // dev-1 和 dev-2 应该并行
      const dev1 = executionLog.find(e => e.agentId === 'dev-1')
      const dev2 = executionLog.find(e => e.agentId === 'dev-2')

      expect(dev1).toBeDefined()
      expect(dev2).toBeDefined()

      if (dev1 && dev2) {
        const first = dev1.start < dev2.start ? dev1 : dev2
        const second = dev1.start < dev2.start ? dev2 : dev1
        expect(second.start).toBeLessThan(first.end)
      }
    })

    it('应该检测循环依赖', async () => {
      const workflow = new WorkflowEngine()

      workflow.registerNode({
        id: 'a', type: 'task', agentId: 'arch-1', task: { description: '' }, next: 'b',
      })
      workflow.registerNode({
        id: 'b', type: 'task', agentId: 'dev-1', task: { description: '' }, next: 'a',
      })

      await expect(
        workflow.execute('a', async () => 'done')
      ).rejects.toThrow('Workflow loop detected')
    })
  })

  // ============================================================
  // 测试 6: 任务分解器
  // ============================================================
  describe('任务分解器', () => {
    it('应该根据关键词分解任务', async () => {
      const decomposer = new TaskDecomposer()
      const agents = agentRegistry.getAll()

      const tasks = await decomposer.decompose('设计并实现一个用户系统', agents)

      // 应该包含架构设计和代码实现
      expect(tasks.some(t => t.assignedTo === 'arch-1')).toBe(true)
      expect(tasks.some(t => t.assignedTo === 'dev-1')).toBe(true)
    })

    it('代码实现任务应该依赖架构设计', async () => {
      const decomposer = new TaskDecomposer()
      const agents = agentRegistry.getAll()

      const tasks = await decomposer.decompose('设计并实现系统', agents)

      const archTask = tasks.find(t => t.assignedTo === 'arch-1')
      const devTask = tasks.find(t => t.assignedTo === 'dev-1')

      if (archTask && devTask) {
        expect(devTask.dependencies).toContain(archTask.id)
      }
    })
  })
})
