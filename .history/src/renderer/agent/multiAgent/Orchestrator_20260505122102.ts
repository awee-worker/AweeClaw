import { logger } from '@utils/Logger'
import type {
  AgentRole,
  AgentInstance,
  AgentStatus,
  AgentMessage,
  CollaborationConfig,
  CollaborationTask,
} from '@shared/types/multiAgent'

export interface OrchestratorEvent {
  type: 'session:start' | 'session:end' | 'task:assigned' | 'task:completed' | 'task:failed' | 'agent:created' | 'agent:status' | 'message:sent'
  sessionId: string
  data?: Record<string, unknown>
}

type OrchestratorEventHandler = (event: OrchestratorEvent) => void

export class MessageBus {
  private messages: AgentMessage[] = []
  private listeners = new Map<string, Set<(message: AgentMessage) => void>>()

  send(message: AgentMessage): void {
    this.messages.push(message)
    this.notifyListeners(message)
  }

  on(agentId: string, listener: (message: AgentMessage) => void): () => void {
    if (!this.listeners.has(agentId)) {
      this.listeners.set(agentId, new Set())
    }
    this.listeners.get(agentId)!.add(listener)
    return () => this.listeners.get(agentId)?.delete(listener)
  }

  getMessagesFor(agentId: string): AgentMessage[] {
    return this.messages.filter(
      m => m.to === agentId || m.to === 'broadcast'
    )
  }

  getMessagesBetween(agent1: string, agent2: string): AgentMessage[] {
    return this.messages.filter(
      m => (m.from === agent1 && m.to === agent2) || (m.from === agent2 && m.to === agent1)
    )
  }

  getAllMessages(): AgentMessage[] {
    return [...this.messages]
  }

  clear(): void {
    this.messages = []
    this.listeners.clear()
  }

  private notifyListeners(message: AgentMessage): void {
    const targets = new Set<string>()
    targets.add(message.to)
    if (message.to !== 'broadcast') {
      targets.add('broadcast')
    }
    for (const target of targets) {
      const listeners = this.listeners.get(target)
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(message)
          } catch {
            // ignore listener errors
          }
        }
      }
    }
  }
}

export interface SessionState {
  id: string
  config: CollaborationConfig
  status: 'active' | 'completed' | 'failed' | 'aborted'
  agents: Map<string, AgentInstance>
  tasks: Map<string, CollaborationTask>
  messageBus: MessageBus
  createdAt: number
  completedAt?: number
  result?: string
}

export class Orchestrator {
  private sessions = new Map<string, SessionState>()
  private eventHandlers = new Set<OrchestratorEventHandler>()
  private globalMessageBus = new MessageBus()

  onEvent(handler: OrchestratorEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  private emitEvent(event: OrchestratorEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event)
      } catch {
        // ignore
      }
    }
  }

  createSession(config: CollaborationConfig): SessionState {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: SessionState = {
      id: sessionId,
      config,
      status: 'active',
      agents: new Map(),
      tasks: new Map(),
      messageBus: new MessageBus(),
      createdAt: Date.now(),
    }

    this.sessions.set(sessionId, session)

    for (const role of config.agents) {
      this.createAgentInSession(session, role)
    }

    this.emitEvent({ type: 'session:start', sessionId, data: { pattern: config.pattern, agentCount: config.agents.length } })

    return session
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  getAllSessions(): SessionState[] {
    return Array.from(this.sessions.values())
  }

  private createAgentInSession(session: SessionState, role: AgentRole): AgentInstance {
    const id = `agent-${role.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const instance: AgentInstance = {
      id,
      role,
      status: 'idle',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messageCount: 0,
    }
    session.agents.set(id, instance)

    session.messageBus.on(id, (message) => {
      instance.messageCount++
      instance.lastActiveAt = Date.now()
    })

    this.emitEvent({ type: 'agent:created', sessionId: session.id, data: { agentId: id, role: role.id } })
    return instance
  }

  async executeOrchestratorPattern(
    session: SessionState,
    mainTask: string,
    executor: (agentId: string, role: AgentRole, task: string, context: string) => Promise<string>
  ): Promise<string> {
    const agents = Array.from(session.agents.values())
    const coordinator = agents[0]
    const workers = agents.slice(1)

    if (!coordinator) throw new Error('No coordinator agent defined')

    this.updateAgentStatus(session, coordinator.id, 'thinking')

    const decompositionPrompt = `Break down the following task into subtasks for your team members. Each subtask should be assigned to one of these roles: ${workers.map(w => `${w.role.name} (${w.role.id})`).join(', ')}. Return a JSON array of {assignTo, description} objects.\n\nTask: ${mainTask}`

    const decompositionResult = await executor(coordinator.id, coordinator.role, decompositionPrompt, '')
    this.updateAgentStatus(session, coordinator.id, 'idle')

    let subtasks: Array<{ assignTo: string; description: string }>
    try {
      const jsonMatch = decompositionResult.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('No JSON array found in decomposition')
      subtasks = JSON.parse(jsonMatch[0])
    } catch {
      logger.agent.warn('[Orchestrator] Failed to parse decomposition, running task directly')
      const result = await executor(coordinator.id, coordinator.role, mainTask, '')
      session.result = result
      session.status = 'completed'
      session.completedAt = Date.now()
      return result
    }

    const workerMap = new Map(workers.map(w => [w.role.id, w]))
    const taskResults = new Map<string, string>()

    const taskObjects: CollaborationTask[] = subtasks.map((st, i) => ({
      id: `task-${i}-${Date.now()}`,
      description: st.description,
      assignedTo: [st.assignTo],
      status: 'pending' as const,
    }))

    for (const task of taskObjects) {
      session.tasks.set(task.id, task)
    }

    for (const task of taskObjects) {
      const workerRole = task.assignedTo[0]
      const worker = workerMap.get(workerRole) || workers[0]
      if (!worker) continue

      this.updateAgentStatus(session, worker.id, 'thinking')
      task.status = 'in_progress'
      this.emitEvent({ type: 'task:assigned', sessionId: session.id, data: { taskId: task.id, agentId: worker.id } })

      const previousResults = Array.from(taskResults.entries())
        .map(([tid, result]) => {
          const t = session.tasks.get(tid)
          return t ? `--- ${t.description} ---\n${result}` : ''
        })
        .join('\n\n')

      try {
        const result = await executor(
          worker.id,
          worker.role,
          task.description,
          previousResults
        )
        task.status = 'completed'
        task.result = result
        taskResults.set(task.id, result)
        this.updateAgentStatus(session, worker.id, 'idle')
        this.emitEvent({ type: 'task:completed', sessionId: session.id, data: { taskId: task.id } })

        session.messageBus.send({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          from: worker.id,
          to: coordinator.id,
          type: 'result',
          content: result,
          metadata: { taskId: task.id },
          timestamp: Date.now(),
        })
      } catch (error) {
        task.status = 'failed'
        task.result = error instanceof Error ? error.message : String(error)
        this.updateAgentStatus(session, worker.id, 'error')
        this.emitEvent({ type: 'task:failed', sessionId: session.id, data: { taskId: task.id, error: task.result } })
      }
    }

    this.updateAgentStatus(session, coordinator.id, 'thinking')
    const synthesisPrompt = `You are the coordinator. Synthesize the following results from your team into a final answer:\n\n${Array.from(taskResults.entries()).map(([tid, result]) => {
      const t = session.tasks.get(tid)
      return t ? `## ${t.description}\n${result}` : result
    }).join('\n\n')}`

    const finalResult = await executor(coordinator.id, coordinator.role, synthesisPrompt, '')
    this.updateAgentStatus(session, coordinator.id, 'completed')

    session.result = finalResult
    session.status = 'completed'
    session.completedAt = Date.now()
    this.emitEvent({ type: 'session:end', sessionId: session.id, data: { status: 'completed' } })

    return finalResult
  }

  async executePipelinePattern(
    session: SessionState,
    mainTask: string,
    executor: (agentId: string, role: AgentRole, task: string, context: string) => Promise<string>
  ): Promise<string> {
    const agents = Array.from(session.agents.values())
    let currentInput = mainTask
    let lastResult = ''

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      this.updateAgentStatus(session, agent.id, 'thinking')

      const task: CollaborationTask = {
        id: `pipeline-${i}-${Date.now()}`,
        description: i === 0 ? mainTask : `Process the output from the previous stage (${agents[i - 1]?.role.name || 'unknown'})`,
        assignedTo: [agent.id],
        status: 'in_progress',
        dependencies: i > 0 ? [`pipeline-${i - 1}-${Date.now()}`] : [],
      }
      session.tasks.set(task.id, task)
      this.emitEvent({ type: 'task:assigned', sessionId: session.id, data: { taskId: task.id, agentId: agent.id } })

      try {
        const result = await executor(agent.id, agent.role, currentInput, lastResult)
        task.status = 'completed'
        task.result = result
        lastResult = result
        currentInput = result
        this.updateAgentStatus(session, agent.id, 'idle')
        this.emitEvent({ type: 'task:completed', sessionId: session.id, data: { taskId: task.id } })
      } catch (error) {
        task.status = 'failed'
        task.result = error instanceof Error ? error.message : String(error)
        this.updateAgentStatus(session, agent.id, 'error')
        this.emitEvent({ type: 'task:failed', sessionId: session.id, data: { taskId: task.id } })

        session.status = 'failed'
        session.completedAt = Date.now()
        throw error
      }
    }

    session.result = lastResult
    session.status = 'completed'
    session.completedAt = Date.now()
    this.emitEvent({ type: 'session:end', sessionId: session.id, data: { status: 'completed' } })

    return lastResult
  }

  async executeReviewPattern(
    session: SessionState,
    mainTask: string,
    executor: (agentId: string, role: AgentRole, task: string, context: string) => Promise<string>
  ): Promise<string> {
    const agents = Array.from(session.agents.values())
    const implementer = agents[0]
    const reviewer = agents[1]

    if (!implementer || !reviewer) throw new Error('Review pattern requires at least 2 agents')

    const maxRounds = session.config.maxRounds || 3
    let implementation = ''
    let reviewFeedback = ''
    let approved = false

    for (let round = 0; round < maxRounds; round++) {
      this.updateAgentStatus(session, implementer.id, 'thinking')
      const implTask: CollaborationTask = {
        id: `impl-${round}-${Date.now()}`,
        description: round === 0 ? mainTask : `Revise based on review feedback:\n${reviewFeedback}`,
        assignedTo: [implementer.id],
        status: 'in_progress',
      }
      session.tasks.set(implTask.id, implTask)
      this.emitEvent({ type: 'task:assigned', sessionId: session.id, data: { taskId: implTask.id, round } })

      implementation = await executor(
        implementer.id,
        implementer.role,
        implTask.description,
        round === 0 ? '' : `Previous implementation:\n${implementation}\n\nReview feedback:\n${reviewFeedback}`
      )
      implTask.status = 'completed'
      implTask.result = implementation
      this.updateAgentStatus(session, implementer.id, 'idle')
      this.emitEvent({ type: 'task:completed', sessionId: session.id, data: { taskId: implTask.id } })

      this.updateAgentStatus(session, reviewer.id, 'thinking')
      const reviewTask: CollaborationTask = {
        id: `review-${round}-${Date.now()}`,
        description: `Review the following implementation. If it's good, respond with "APPROVED". Otherwise, provide specific feedback for improvement.\n\n${implementation}`,
        assignedTo: [reviewer.id],
        status: 'in_progress',
      }
      session.tasks.set(reviewTask.id, reviewTask)
      this.emitEvent({ type: 'task:assigned', sessionId: session.id, data: { taskId: reviewTask.id, round } })

      reviewFeedback = await executor(reviewer.id, reviewer.role, reviewTask.description, implementation)
      reviewTask.status = 'completed'
      reviewTask.result = reviewFeedback
      this.updateAgentStatus(session, reviewer.id, 'idle')
      this.emitEvent({ type: 'task:completed', sessionId: session.id, data: { taskId: reviewTask.id } })

      if (reviewFeedback.trim().toUpperCase().startsWith('APPROVED')) {
        approved = true
        break
      }
    }

    const result = approved
      ? implementation
      : `Implementation (after ${maxRounds} review rounds):\n${implementation}\n\nFinal review:\n${reviewFeedback}`

    session.result = result
    session.status = 'completed'
    session.completedAt = Date.now()
    this.emitEvent({ type: 'session:end', sessionId: session.id, data: { status: 'completed', approved, rounds: maxRounds } })

    return result
  }

  async executeDebatePattern(
    session: SessionState,
    mainTask: string,
    executor: (agentId: string, role: AgentRole, task: string, context: string) => Promise<string>
  ): Promise<string> {
    const agents = Array.from(session.agents.values())
    const maxRounds = session.config.maxRounds || 3
    const positions = new Map<string, string>()

    for (const agent of agents) {
      this.updateAgentStatus(session, agent.id, 'thinking')
      const position = await executor(agent.id, agent.role, mainTask, '')
      positions.set(agent.id, position)
      this.updateAgentStatus(session, agent.id, 'idle')

      session.messageBus.send({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        from: agent.id,
        to: 'broadcast',
        type: 'progress',
        content: position,
        timestamp: Date.now(),
      })
    }

    for (let round = 0; round < maxRounds; round++) {
      for (const agent of agents) {
        this.updateAgentStatus(session, agent.id, 'thinking')

        const otherPositions = Array.from(positions.entries())
          .filter(([id]) => id !== agent.id)
          .map(([id, pos]) => {
            const a = session.agents.get(id)
            return `${a?.role.name || id}: ${pos}`
          })
          .join('\n\n')

        const response = await executor(
          agent.id,
          agent.role,
          `This is round ${round + 1} of debate. Respond to the other positions and strengthen or revise your argument.\n\nOther positions:\n${otherPositions}`,
          positions.get(agent.id) || ''
        )
        positions.set(agent.id, response)
        this.updateAgentStatus(session, agent.id, 'idle')
      }
    }

    const debateSummary = Array.from(positions.entries())
      .map(([id, pos]) => {
        const agent = session.agents.get(id)
        return `## ${agent?.role.name || id}\n${pos}`
      })
      .join('\n\n')

    const synthesizer = agents[0]
    this.updateAgentStatus(session, synthesizer.id, 'thinking')
    const result = await executor(
      synthesizer.id,
      synthesizer.role,
      `Synthesize the following debate into a balanced conclusion:\n\n${debateSummary}`,
      ''
    )
    this.updateAgentStatus(session, synthesizer.id, 'completed')

    session.result = result
    session.status = 'completed'
    session.completedAt = Date.now()
    this.emitEvent({ type: 'session:end', sessionId: session.id, data: { status: 'completed' } })

    return result
  }

  async execute(
    sessionId: string,
    mainTask: string,
    executor: (agentId: string, role: AgentRole, task: string, context: string) => Promise<string>
  ): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (session.status !== 'active') throw new Error(`Session ${sessionId} is not active (status: ${session.status})`)

    switch (session.config.pattern) {
      case 'orchestrator':
        return this.executeOrchestratorPattern(session, mainTask, executor)
      case 'pipeline':
        return this.executePipelinePattern(session, mainTask, executor)
      case 'review':
        return this.executeReviewPattern(session, mainTask, executor)
      case 'debate':
        return this.executeDebatePattern(session, mainTask, executor)
      case 'peer-to-peer':
        return this.executeOrchestratorPattern(session, mainTask, executor)
      default:
        throw new Error(`Unknown collaboration pattern: ${session.config.pattern}`)
    }
  }

  abortSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.status = 'aborted'
      session.completedAt = Date.now()
      for (const [agentId, agent] of session.agents) {
        if (agent.status === 'thinking' || agent.status === 'executing') {
          agent.status = 'idle'
        }
      }
      this.emitEvent({ type: 'session:end', sessionId, data: { status: 'aborted' } })
    }
  }

  cleanup(): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'active') {
        this.abortSession(sessionId)
      }
    }
    this.sessions.clear()
    this.eventHandlers.clear()
    this.globalMessageBus.clear()
  }

  private updateAgentStatus(session: SessionState, agentId: string, status: AgentStatus): void {
    const agent = session.agents.get(agentId)
    if (agent) {
      agent.status = status
      agent.lastActiveAt = Date.now()
      this.emitEvent({ type: 'agent:status', sessionId: session.id, data: { agentId, status } })
    }
  }
}

export const orchestrator = new Orchestrator()
