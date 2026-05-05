import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Orchestrator, MessageBus } from '@renderer/agent/multiAgent/Orchestrator'
import type { AgentRole } from '@shared/types/multiAgent'

const coordinatorRole: AgentRole = {
  id: 'coordinator',
  name: 'Coordinator',
  nameZh: '协调者',
  description: 'Orchestrates tasks',
  descriptionZh: '编排任务',
  systemPrompt: 'You are a coordinator.',
  toolPacks: ['code'],
  contextTypes: ['File'],
}

const implementerRole: AgentRole = {
  id: 'implementer',
  name: 'Implementer',
  nameZh: '实现者',
  description: 'Implements code',
  descriptionZh: '实现代码',
  systemPrompt: 'You are an implementer.',
  toolPacks: ['code'],
  contextTypes: ['File'],
}

const reviewerRole: AgentRole = {
  id: 'reviewer',
  name: 'Reviewer',
  nameZh: '审查者',
  description: 'Reviews code',
  descriptionZh: '审查代码',
  systemPrompt: 'You are a reviewer.',
  toolPacks: ['code'],
  contextTypes: ['File'],
}

function makeExecutor(responses: Map<string, string>) {
  return vi.fn(async (agentId: string, _role: AgentRole, task: string, _context: string) => {
    const key = `${agentId}-${task.slice(0, 30)}`
    if (responses.has(key)) return responses.get(key)!

    if (task.includes('Break down')) {
      return JSON.stringify([
        { assignTo: 'implementer', description: 'Implement the feature' },
      ])
    }
    if (task.includes('Synthesize')) {
      return 'Synthesized final result'
    }
    if (task.includes('APPROVED')) {
      return 'APPROVED - Great implementation!'
    }
    return `Result from ${agentId}: ${task.slice(0, 50)}`
  })
}

describe('MessageBus', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus()
  })

  it('delivers messages to the target agent', () => {
    let received: string | null = null
    bus.on('agent-1', (msg) => { received = msg.content })
    bus.send({
      id: 'msg-1',
      from: 'agent-2',
      to: 'agent-1',
      type: 'task',
      content: 'Hello',
      timestamp: Date.now(),
    })
    expect(received).toBe('Hello')
  })

  it('delivers broadcast messages', () => {
    let count = 0
    bus.on('broadcast', () => { count++ })
    bus.send({
      id: 'msg-1',
      from: 'orchestrator',
      to: 'broadcast',
      type: 'task',
      content: 'Broadcast',
      timestamp: Date.now(),
    })
    expect(count).toBe(1)
  })

  it('supports unsubscribe', () => {
    let count = 0
    const unsub = bus.on('agent-1', () => { count++ })
    bus.send({
      id: 'msg-1',
      from: 'agent-2',
      to: 'agent-1',
      type: 'task',
      content: 'Hello',
      timestamp: Date.now(),
    })
    expect(count).toBe(1)
    unsub()
    bus.send({
      id: 'msg-2',
      from: 'agent-2',
      to: 'agent-1',
      type: 'task',
      content: 'Hello again',
      timestamp: Date.now(),
    })
    expect(count).toBe(1)
  })
})

describe('Orchestrator', () => {
  let orch: Orchestrator

  beforeEach(() => {
    orch = new Orchestrator()
  })

  describe('session management', () => {
    it('creates a session with agents', () => {
      const session = orch.createSession({
        pattern: 'orchestrator',
        agents: [coordinatorRole, implementerRole],
      })
      expect(session.status).toBe('active')
      expect(session.agents.size).toBe(2)
    })

    it('aborts an active session', () => {
      const session = orch.createSession({
        pattern: 'orchestrator',
        agents: [coordinatorRole],
      })
      orch.abortSession(session.id)
      expect(session.status).toBe('aborted')
    })
  })

  describe('orchestrator pattern', () => {
    it('executes orchestrator pattern with task decomposition', async () => {
      const session = orch.createSession({
        pattern: 'orchestrator',
        agents: [coordinatorRole, implementerRole],
      })

      const executor = makeExecutor(new Map())
      const result = await orch.execute(session.id, 'Build a hello world app', executor)

      expect(result).toBeTruthy()
      expect(session.status).toBe('completed')
      expect(executor.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('pipeline pattern', () => {
    it('executes pipeline pattern sequentially', async () => {
      const session = orch.createSession({
        pattern: 'pipeline',
        agents: [coordinatorRole, implementerRole],
      })

      const callOrder: string[] = []
      const executor = vi.fn(async (_agentId: string, role: AgentRole) => {
        callOrder.push(role.id)
        return `Output from ${role.id}`
      })

      const result = await orch.execute(session.id, 'Process data', executor)

      expect(result).toBeTruthy()
      expect(session.status).toBe('completed')
      expect(callOrder).toEqual(['coordinator', 'implementer'])
    })
  })

  describe('review pattern', () => {
    it('executes review pattern and approves when reviewer approves', async () => {
      const session = orch.createSession({
        pattern: 'review',
        agents: [implementerRole, reviewerRole],
        maxRounds: 3,
      })

      const executor = vi.fn(async (_agentId: string, role: AgentRole, _task: string) => {
        if (role.id === 'reviewer') return 'APPROVED - Looks good!'
        return 'Implementation code here'
      })

      const result = await orch.execute(session.id, 'Implement feature X', executor)
      expect(result).toBeTruthy()
      expect(session.status).toBe('completed')
    })

    it('goes through multiple review rounds when not approved', async () => {
      const session = orch.createSession({
        pattern: 'review',
        agents: [implementerRole, reviewerRole],
        maxRounds: 2,
      })

      let reviewCount = 0
      const executor = vi.fn(async (agentId: string, role: AgentRole) => {
        if (role.id === 'reviewer') {
          reviewCount++
          if (reviewCount < 2) return 'Needs improvement: add error handling'
          return 'APPROVED'
        }
        return 'Implementation code'
      })

      await orch.execute(session.id, 'Implement feature X', executor)
      expect(reviewCount).toBe(2)
    })
  })

  describe('debate pattern', () => {
    it('executes debate pattern with multiple rounds', async () => {
      const session = orch.createSession({
        pattern: 'debate',
        agents: [coordinatorRole, implementerRole],
        maxRounds: 2,
      })

      const executor = vi.fn(async (agentId: string, _role: AgentRole, task: string) => {
        if (task.includes('Synthesize')) return 'Final synthesis'
        return `Position from ${agentId}`
      })

      const result = await orch.execute(session.id, 'Should we use microservices?', executor)
      expect(result).toBe('Final synthesis')
      expect(session.status).toBe('completed')
    })
  })

  describe('events', () => {
    it('emits session lifecycle events', async () => {
      const events: string[] = []
      orch.onEvent((e) => events.push(e.type))

      const session = orch.createSession({
        pattern: 'pipeline',
        agents: [coordinatorRole],
      })

      const executor = vi.fn(async () => 'Done')
      await orch.execute(session.id, 'Test task', executor)

      expect(events).toContain('session:start')
      expect(events).toContain('session:end')
    })
  })
})
