/**
 * Multi-Agent Collaboration Framework - 多智能体协作框架
 *
 * 支持多个 Agent 实例协同工作，每个 Agent 可以有不同的角色、
 * 工具集和上下文。通过消息传递和共享状态实现协作。
 *
 * 设计原则：
 * - 每个 Agent 有独立的身份、工具集和上下文
 * - Agent 之间通过消息总线通信
 * - 支持编排模式：主从、对等、流水线
 * - 共享工作区状态，避免冲突
 */

// ============================================
// Agent 角色定义
// ============================================

export interface AgentRole {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  systemPrompt: string
  toolPacks: string[]
  contextTypes: string[]
  maxIterations?: number
}

// ============================================
// Agent 实例定义
// ============================================

export interface AgentInstance {
  id: string
  role: AgentRole
  status: AgentStatus
  createdAt: number
  lastActiveAt: number
  messageCount: number
}

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'completed' | 'error'

// ============================================
// 消息定义
// ============================================

export interface AgentMessage {
  id: string
  from: string
  to: string | 'broadcast'
  type: AgentMessageType
  content: string
  metadata?: Record<string, unknown>
  timestamp: number
}

export type AgentMessageType =
  | 'task'
  | 'result'
  | 'question'
  | 'answer'
  | 'progress'
  | 'error'
  | 'handoff'
  | 'sync'

// ============================================
// 协作模式
// ============================================

export type CollaborationPattern =
  | 'orchestrator'
  | 'peer-to-peer'
  | 'pipeline'
  | 'debate'
  | 'review'

export interface CollaborationConfig {
  pattern: CollaborationPattern
  agents: AgentRole[]
  maxRounds?: number
  timeout?: number
  sharedContext?: boolean
}

// ============================================
// 任务定义
// ============================================

export interface CollaborationTask {
  id: string
  description: string
  assignedTo: string[]
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  result?: string
  subtasks?: CollaborationTask[]
  dependencies?: string[]
}

// ============================================
// 消息总线
// ============================================

class MessageBus {
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
  }

  private notifyListeners(message: AgentMessage): void {
    const targets = [message.to, 'broadcast']
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

// ============================================
// Agent 编排器
// ============================================

class AgentOrchestrator {
  private agents = new Map<string, AgentInstance>()
  private messageBus = new MessageBus()
  private tasks = new Map<string, CollaborationTask>()

  createAgent(role: AgentRole): AgentInstance {
    const id = `agent-${role.id}-${Date.now()}`
    const instance: AgentInstance = {
      id,
      role,
      status: 'idle',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messageCount: 0,
    }
    this.agents.set(id, instance)
    return instance
  }

  removeAgent(agentId: string): boolean {
    return this.agents.delete(agentId)
  }

  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId)
  }

  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values())
  }

  getMessageBus(): MessageBus {
    return this.messageBus
  }

  assignTask(task: CollaborationTask): void {
    this.tasks.set(task.id, task)
    for (const agentId of task.assignedTo) {
      this.messageBus.send({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: 'orchestrator',
        to: agentId,
        type: 'task',
        content: task.description,
        metadata: { taskId: task.id },
        timestamp: Date.now(),
      })
    }
  }

  getTask(taskId: string): CollaborationTask | undefined {
    return this.tasks.get(taskId)
  }

  getAllTasks(): CollaborationTask[] {
    return Array.from(this.tasks.values())
  }

  /**
   * 编排器模式：主 Agent 分配任务给子 Agent
   */
  async orchestrate(
    config: CollaborationConfig,
    mainTask: string
  ): Promise<CollaborationTask[]> {
    const tasks: CollaborationTask[] = []

    if (config.pattern === 'orchestrator') {
      const orchestrator = config.agents[0]
      if (!orchestrator) return tasks

      const mainTaskObj: CollaborationTask = {
        id: `task-${Date.now()}`,
        description: mainTask,
        assignedTo: [orchestrator.id],
        status: 'in_progress',
        subtasks: config.agents.slice(1).map((agent, i) => ({
          id: `subtask-${i}-${Date.now()}`,
          description: `Subtask assigned to ${agent.name}`,
          assignedTo: [agent.id],
          status: 'pending',
        })),
      }
      this.assignTask(mainTaskObj)
      tasks.push(mainTaskObj)
    }

    if (config.pattern === 'pipeline') {
      for (let i = 0; i < config.agents.length; i++) {
        const agent = config.agents[i]
        const task: CollaborationTask = {
          id: `pipeline-${i}-${Date.now()}`,
          description: `Pipeline stage ${i + 1}: ${agent.name}`,
          assignedTo: [agent.id],
          status: i === 0 ? 'in_progress' : 'pending',
          dependencies: i > 0 ? [`pipeline-${i - 1}-${Date.now()}`] : [],
        }
        this.assignTask(task)
        tasks.push(task)
      }
    }

    if (config.pattern === 'debate') {
      for (const agent of config.agents) {
        const task: CollaborationTask = {
          id: `debate-${agent.id}-${Date.now()}`,
          description: mainTask,
          assignedTo: [agent.id],
          status: 'in_progress',
        }
        this.assignTask(task)
        tasks.push(task)
      }
    }

    return tasks
  }

  reset(): void {
    this.agents.clear()
    this.tasks.clear()
    this.messageBus.clear()
  }
}

export const agentOrchestrator = new AgentOrchestrator()

// ============================================
// 预定义角色
// ============================================

export const PREDEFINED_ROLES: AgentRole[] = [
  {
    id: 'coordinator',
    name: 'Coordinator',
    nameZh: '协调者',
    description: 'Orchestrates tasks and delegates to specialized agents',
    descriptionZh: '编排任务并分配给专业智能体',
    systemPrompt: 'You are a task coordinator. Break down complex tasks and delegate to appropriate agents. Synthesize results.',
    toolPacks: ['code'],
    contextTypes: ['File', 'Folder', 'Web'],
  },
  {
    id: 'researcher',
    name: 'Researcher',
    nameZh: '研究员',
    description: 'Gathers information and performs research',
    descriptionZh: '收集信息并执行研究',
    systemPrompt: 'You are a research specialist. Find relevant information, analyze sources, and provide comprehensive summaries.',
    toolPacks: ['code'],
    contextTypes: ['File', 'Web', 'Codebase'],
  },
  {
    id: 'implementer',
    name: 'Implementer',
    nameZh: '实现者',
    description: 'Writes code and implements solutions',
    descriptionZh: '编写代码并实现解决方案',
    systemPrompt: 'You are an implementation specialist. Write clean, efficient code following project conventions.',
    toolPacks: ['code'],
    contextTypes: ['File', 'CodeSelection', 'Codebase', 'Symbols', 'Problems'],
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    nameZh: '审查者',
    description: 'Reviews code quality, security, and best practices',
    descriptionZh: '审查代码质量、安全性和最佳实践',
    systemPrompt: 'You are a code reviewer. Focus on quality, security, maintainability, and best practices. Provide constructive feedback.',
    toolPacks: ['code'],
    contextTypes: ['File', 'CodeSelection', 'Problems'],
  },
  {
    id: 'analyst',
    name: 'Data Analyst',
    nameZh: '数据分析师',
    description: 'Analyzes data and creates visualizations',
    descriptionZh: '分析数据并创建可视化',
    systemPrompt: 'You are a data analyst. Process data, perform statistical analysis, and create visualizations.',
    toolPacks: ['data'],
    contextTypes: ['File', 'Folder'],
  },
]
