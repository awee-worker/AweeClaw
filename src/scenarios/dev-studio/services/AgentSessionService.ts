/**
 * dev-studio Agent 会话管理服务
 *
 * 管理多 Agent 协作开发会话，包括：
 * - 会话生命周期（创建/激活/暂停/完成/删除）
 * - 任务分配与状态流转
 * - Agent 角色配置与消息记录
 * - 与 ProjectService 的 dev_sessions 表联动
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import { projectService } from './ProjectService'
import type {
  AgentRole,
  DevSession,
  DevSessionMode,
  SessionTask,
} from '../types'
import { DEV_AGENT_ROLES } from '../tools/definitions'

// ==========================================
// 扩展类型
// ==========================================

export interface AgentSessionAgent {
  role: AgentRole
  /** 当前状态 */
  status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'completed' | 'error'
  /** 处理的消息数 */
  messageCount: number
  /** 最后活跃时间 */
  lastActiveAt: number
}

export interface AgentSessionMessage {
  id: string
  from: AgentRole | 'system'
  to: AgentRole | 'broadcast'
  type: 'task' | 'result' | 'review' | 'question' | 'answer' | 'progress' | 'error'
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface AgentSessionState {
  session: DevSession
  agents: AgentSessionAgent[]
  messages: AgentSessionMessage[]
}

export interface CreateSessionOptions {
  projectId: string
  title?: string
  mode: DevSessionMode
  roles: AgentRole[]
}

// ==========================================
// AgentSessionService
// ==========================================

class AgentSessionService {
  private _context: ScenarioModuleContext | null = null
  /** 活跃会话状态缓存 */
  private activeSession: AgentSessionState | null = null
  /** 活跃会话的 Agent 状态 */
  private agentStates = new Map<string, AgentSessionAgent>()

  setContext(ctx: ScenarioModuleContext): void {
    this._context = ctx
  }

  private get context(): ScenarioModuleContext {
    if (!this._context) {
      throw new Error('AgentSessionService: context is not set')
    }
    return this._context
  }

  private get log() {
    return this.context.getLogger()
  }

  // ==========================================
  // 会话管理
  // ==========================================

  /**
   * 创建新的开发会话
   */
  async createSession(options: CreateSessionOptions): Promise<AgentSessionState> {
    const { projectId, title, mode, roles } = options

    if (!roles.length) {
      throw new Error('At least one agent role must be specified')
    }

    const validRoles = roles.filter(r => DEV_AGENT_ROLES.some(dr => dr.id === r))
    if (!validRoles.length) {
      throw new Error('No valid agent roles provided')
    }

    const session = await projectService.createSession(
      projectId,
      title ?? `Dev Session - ${new Date().toLocaleString()}`,
      mode,
    )

    const agents: AgentSessionAgent[] = validRoles.map(role => ({
      role,
      status: 'idle' as const,
      messageCount: 0,
      lastActiveAt: Date.now(),
    }))

    const state: AgentSessionState = {
      session,
      agents,
      messages: this.buildInitMessages(agents),
    }

    this.activeSession = state
    agents.forEach(a => this.agentStates.set(a.role, a))

    this.log.info(`Dev session created: ${session.id} with ${roles.length} agents`)
    return state
  }

  /**
   * 获取当前活跃会话
   */
  getActiveSession(): AgentSessionState | null {
    return this.activeSession
  }

  /**
   * 结束当前会话
   */
  async completeSession(): Promise<void> {
    if (!this.activeSession) return

    await projectService.updateSessionStatus(this.activeSession.session.id, 'completed')

    this.activeSession = null
    this.agentStates.clear()
    this.log.info('Dev session completed')
  }

  /**
   * 暂停当前会话
   */
  async pauseSession(): Promise<void> {
    if (!this.activeSession) return

    await projectService.updateSessionStatus(this.activeSession.session.id, 'paused')

    this.activeSession.session.status = 'paused'
    this.log.info('Dev session paused')
  }

  /**
   * 获取项目历史会话
   */
  async getProjectSessions(projectId: string): Promise<DevSession[]> {
    return projectService.listSessions(projectId)
  }

  // ==========================================
  // 任务管理
  // ==========================================

  /**
   * 添加任务到当前会话
   */
  async addTask(task: Omit<SessionTask, 'id' | 'createdAt'>): Promise<SessionTask> {
    if (!this.activeSession) {
      throw new Error('No active session')
    }
    const trimmedTitle = task.title?.trim()
    if (!trimmedTitle || trimmedTitle.length > 500) {
      throw new Error('Task title must be 1-500 characters')
    }

    const newTask: SessionTask = {
      ...task,
      title: trimmedTitle,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    }

    this.activeSession.session.tasks.push(newTask)
    this.activeSession.session.updatedAt = new Date().toISOString()

    this.log.info(`Task added: ${newTask.id} - ${newTask.title}`)
    return newTask
  }

  /**
   * 更新任务状态
   */
  async updateTaskStatus(taskId: string, status: SessionTask['status']): Promise<void> {
    if (!this.activeSession) {
      throw new Error('No active session')
    }

    const task = this.activeSession.session.tasks.find(t => t.id === taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    task.status = status
    if (status === 'completed') {
      task.completedAt = new Date().toISOString()
    }

    this.activeSession.session.updatedAt = new Date().toISOString()
    this.log.info(`Task ${taskId} status updated to ${status}`)
  }

  /**
   * 获取当前会话的任务按状态分组
   */
  getTasksByStatus(): Record<SessionTask['status'], SessionTask[]> {
    if (!this.activeSession) return { pending: [], in_progress: [], completed: [], blocked: [] }

    return this.activeSession.session.tasks.reduce(
      (acc, task) => {
        acc[task.status].push(task)
        return acc
      },
      { pending: [] as SessionTask[], in_progress: [] as SessionTask[], completed: [] as SessionTask[], blocked: [] as SessionTask[] },
    )
  }

  // ==========================================
  // Agent 状态管理
  // ==========================================

  /**
   * 更新 Agent 状态
   */
  updateAgentState(role: AgentRole, update: Partial<AgentSessionAgent>): void {
    const agent = this.agentStates.get(role)
    if (agent) {
      Object.assign(agent, update)
      this.agentStates.set(role, agent)
    }
  }

  /**
   * 获取所有 Agent 状态
   */
  getAgentStates(): AgentSessionAgent[] {
    return Array.from(this.agentStates.values())
  }

  // ==========================================
  // 消息管理
  // ==========================================

  /**
   * 发送消息
   */
  sendMessage(message: Omit<AgentSessionMessage, 'id' | 'timestamp'>): AgentSessionMessage {
    if (!this.activeSession) {
      throw new Error('No active session')
    }

    const msg: AgentSessionMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    }

    this.activeSession.messages.push(msg)

    // 更新发送方 Agent 状态
    if (message.from !== 'system') {
      this.updateAgentState(message.from, {
        lastActiveAt: Date.now(),
        messageCount: (this.agentStates.get(message.from)?.messageCount ?? 0) + 1,
      })
    }

    this.log.info(`Message sent: ${message.from} → ${message.to} [${message.type}]`)
    return msg
  }

  /**
   * 获取消息历史
   */
  getMessages(filter?: { from?: string; type?: AgentSessionMessage['type'] }): AgentSessionMessage[] {
    if (!this.activeSession) return []

    let result = [...this.activeSession.messages]
    if (filter?.from) result = result.filter(m => m.from === filter.from)
    if (filter?.type) result = result.filter(m => m.type === filter.type)
    return result
  }

  // ==========================================
  // 工具方法
  // ==========================================

  /**
   * 根据需求推荐 Agent 角色
   */
  recommendRoles(requirement: string): AgentRole[] {
    const lower = requirement.toLowerCase()
    const roles: AgentRole[] = []

    if (lower.includes('ui') || lower.includes('前端') || lower.includes('frontend')) roles.push('pm', 'coder', 'tester')
    else if (lower.includes('api') || lower.includes('后端') || lower.includes('backend')) roles.push('pm', 'coder', 'reviewer', 'devops')
    else if (lower.includes('部署') || lower.includes('deploy') || lower.includes('ci')) roles.push('pm', 'coder', 'reviewer', 'devops')
    else if (lower.includes('重构') || lower.includes('refactor') || lower.includes('优化')) roles.push('pm', 'coder', 'reviewer', 'tester')
    else roles.push('pm', 'coder', 'reviewer')

    return roles
  }

  /**
   * 获取角色定义
   */
  getRoleDefinition(role: AgentRole) {
    return DEV_AGENT_ROLES.find(r => r.id === role) ?? null
  }

  /**
   * 获取所有可用角色
   */
  getAvailableRoles() {
    return DEV_AGENT_ROLES
  }

  private buildInitMessages(agents: AgentSessionAgent[]): AgentSessionMessage[] {
    return [
      {
        id: 'system-init',
        from: 'system',
        to: 'broadcast',
        type: 'result',
        content: `Development session started with ${agents.map(a => a.role).join(', ')} agents`,
        timestamp: Date.now(),
      },
    ]
  }
}

export const agentSessionService = new AgentSessionService()