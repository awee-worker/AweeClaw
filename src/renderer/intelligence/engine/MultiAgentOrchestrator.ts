/**
 * 多 Agent 协作编排器
 *
 * 创新设计：
 * 1. 角色化 Agent - 每个 Agent 有特定角色（架构师、开发者、审查员）
 * 2. 任务分解 - 自动将复杂任务分解为子任务
 * 3. 消息总线 - Agent 间通过消息总线通信
 * 4. 共识机制 - 关键决策需要多个 Agent 达成共识
 * 5. 工作流引擎 - 支持顺序、并行、条件分支等执行模式
 */

import { logger } from '@toolkit/LogEngine'
import { EventBus as OldEventBus } from './EventBus'
import type { LLMConfig } from '@intelligence/providerTypes'
import type { WorkMode } from '@protocols/workModeProtocol'

// ===== 类型定义 =====

export type AgentRole =
  | 'architect'      // 架构师：负责技术方案设计
  | 'developer'      // 开发者：负责代码实现
  | 'reviewer'       // 审查员：负责代码审查
  | 'tester'         // 测试员：负责测试用例
  | 'debugger'       // 调试员：负责问题诊断
  | 'planner'        // 规划员：负责任务分解
  | 'coordinator'    // 协调员：负责 Agent 间协调

export interface AgentProfile {
  id: string
  role: AgentRole
  name: string
  description: string
  systemPrompt: string
  capabilities: string[]
  llmConfig: LLMConfig
  priority: number // 1-10，越高越优先
}

export interface SubTask {
  id: string
  title: string
  description: string
  assignedTo: string // Agent ID
  dependencies: string[] // 依赖的其他子任务 ID
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface CollaborationMessage {
  id: string
  from: string // Agent ID
  to: string | 'broadcast' // Agent ID 或广播
  type: 'request' | 'response' | 'delegate' | 'review' | 'consensus'
  content: string
  metadata?: Record<string, unknown>
  timestamp: number
}

export interface CollaborationResult {
  success: boolean
  finalAnswer: string
  subTasks: SubTask[]
  messages: CollaborationMessage[]
  consensusReached: boolean
  duration: number
}

export interface WorkflowNode {
  id: string
  type: 'task' | 'condition' | 'parallel' | 'merge'
  agentId?: string
  task?: Partial<SubTask>
  condition?: (context: WorkflowContext) => boolean
  branches?: { if: boolean; next: string }[]
  parallelNodes?: string[]
  next?: string
}

export interface WorkflowContext {
  variables: Record<string, unknown>
  currentNodeId: string
  results: Record<string, unknown>
  messages: CollaborationMessage[]
}

// ===== Agent 注册表 =====

class AgentRegistry {
  private agents = new Map<string, AgentProfile>()

  register(profile: AgentProfile): void {
    this.agents.set(profile.id, profile)
    logger.agent.info(`[MultiAgent] Registered agent: ${profile.name} (${profile.role})`)
  }

  get(id: string): AgentProfile | undefined {
    return this.agents.get(id)
  }

  getByRole(role: AgentRole): AgentProfile[] {
    return Array.from(this.agents.values()).filter(a => a.role === role)
  }

  getAll(): AgentProfile[] {
    return Array.from(this.agents.values())
  }

  unregister(id: string): void {
    this.agents.delete(id)
  }
}

export const agentRegistry = new AgentRegistry()

// ===== 消息总线 =====

class AgentMessageBus extends OldEventBus {
  private messageHistory: CollaborationMessage[] = []

  send(message: CollaborationMessage): void {
    this.messageHistory.push(message)
    this.emit('message', message)

    if (message.to === 'broadcast') {
      this.emit('broadcast', message)
    } else {
      this.emit(`agent:${message.to}`, message)
    }
  }

  getHistory(filter?: { from?: string; to?: string; type?: string }): CollaborationMessage[] {
    let result = [...this.messageHistory]
    if (filter?.from) result = result.filter(m => m.from === filter.from)
    if (filter?.to) result = result.filter(m => m.to === filter.to || m.to === 'broadcast')
    if (filter?.type) result = result.filter(m => m.type === filter.type)
    return result
  }

  clear(): void {
    this.messageHistory = []
  }
}

export const messageBus = new AgentMessageBus()

// ===== 任务分解器 =====

export class TaskDecomposer {
  /**
   * 将复杂任务分解为子任务
   * 实际实现中可以使用 LLM 进行智能分解
   */
  async decompose(
    task: string,
    availableAgents: AgentProfile[]
  ): Promise<SubTask[]> {
    const subTasks: SubTask[] = []
    const taskLower = task.toLowerCase()

    // 更智能的关键词匹配
    const hasDesign = /设计|架构|规划|方案|结构/.test(task)
    const hasImplement = /实现|开发|编写|编码|写代码|写|做|完成/.test(task)
    const hasTest = /测试|验证|检查|assert|test/.test(task)

    // 1. 架构设计任务（最优先，无依赖）
    if (hasDesign || hasImplement) {
      const architect = availableAgents.find(a => a.role === 'architect')
      if (architect) {
        subTasks.push({
          id: `task-${Date.now()}-arch`,
          title: '技术方案设计',
          description: `设计 ${task} 的技术方案`,
          assignedTo: architect.id,
          dependencies: [],
          status: 'pending',
        })
      }
    }

    // 2. 代码实现任务（依赖架构设计）
    if (hasImplement) {
      const developers = availableAgents.filter(a => a.role === 'developer')
      const archTask = subTasks.find(t => t.assignedTo === availableAgents.find(a => a.role === 'architect')?.id)

      if (developers.length >= 2 && /前端|后端|client|server|ui|api/.test(task)) {
        // 多模块任务，分配多个开发者并行
        const modules = ['核心模块', '辅助模块']
        developers.slice(0, 2).forEach((dev, idx) => {
          subTasks.push({
            id: `task-${Date.now()}-dev-${idx}`,
            title: `代码实现 - ${modules[idx] || '模块'}`,
            description: `实现 ${task} 的${modules[idx] || ''}代码`,
            assignedTo: dev.id,
            dependencies: archTask ? [archTask.id] : [],
            status: 'pending',
          })
        })
      } else if (developers.length > 0) {
        subTasks.push({
          id: `task-${Date.now()}-dev`,
          title: '代码实现',
          description: `实现 ${task} 的代码`,
          assignedTo: developers[0].id,
          dependencies: archTask ? [archTask.id] : [],
          status: 'pending',
        })
      }
    }

    // 3. 测试验证任务（依赖开发）
    if (hasTest || hasImplement) {
      const tester = availableAgents.find(a => a.role === 'tester')
      const devTasks = subTasks.filter(t => availableAgents.find(a => a.id === t.assignedTo && a.role === 'developer'))
      if (tester && devTasks.length > 0) {
        subTasks.push({
          id: `task-${Date.now()}-test`,
          title: '测试验证',
          description: `为 ${task} 编写并执行测试`,
          assignedTo: tester.id,
          dependencies: devTasks.map(t => t.id),
          status: 'pending',
        })
      }
    }

    // 4. 兜底：如果没有匹配到，分配给协调员或第一个可用 Agent
    if (subTasks.length === 0) {
      const fallback = availableAgents.find(a => a.role === 'coordinator')
        || availableAgents.find(a => a.role === 'developer')
        || availableAgents[0]
      if (fallback) {
        subTasks.push({
          id: `task-${Date.now()}-fallback`,
          title: '任务执行',
          description: task,
          assignedTo: fallback.id,
          dependencies: [],
          status: 'pending',
        })
      }
    }

    return subTasks
  }
}

// ===== 共识机制 =====

export class ConsensusEngine {
  private readonly requiredApprovals: number

  constructor(requiredApprovals = 2) {
    this.requiredApprovals = requiredApprovals
  }

  /**
   * 对提案进行投票
   */
  async vote(
    proposal: string,
    voters: AgentProfile[],
    context: string
  ): Promise<{ approved: boolean; votes: Array<{ agentId: string; approved: boolean; reason: string }> }> {
    const votes: Array<{ agentId: string; approved: boolean; reason: string }> = []

    // 模拟投票（实际应调用各 Agent 的 LLM 进行判断）
    for (const voter of voters) {
      // 基于角色的投票逻辑
      let approved = true
      let reason = '同意'

      if (voter.role === 'reviewer' && proposal.includes('风险')) {
        approved = false
        reason = '发现潜在风险，需要修改'
      }

      votes.push({ agentId: voter.id, approved, reason })
    }

    const approvalCount = votes.filter(v => v.approved).length
    return {
      approved: approvalCount >= this.requiredApprovals,
      votes,
    }
  }
}

// ===== 工作流引擎 =====

export class WorkflowEngine {
  private nodes = new Map<string, WorkflowNode>()
  private context: WorkflowContext

  constructor() {
    this.context = {
      variables: {},
      currentNodeId: '',
      results: {},
      messages: [],
    }
  }

  registerNode(node: WorkflowNode): void {
    this.nodes.set(node.id, node)
  }

  async execute(
    startNodeId: string,
    agentExecutor: (agentId: string, task: string) => Promise<string>
  ): Promise<WorkflowContext> {
    this.context.currentNodeId = startNodeId
    const visited = new Set<string>()

    while (this.context.currentNodeId) {
      const nodeId = this.context.currentNodeId
      if (visited.has(nodeId)) {
        throw new Error(`Workflow loop detected at node: ${nodeId}`)
      }
      visited.add(nodeId)

      const node = this.nodes.get(nodeId)
      if (!node) break

      await this.executeNode(node, agentExecutor)

      // 确定下一个节点
      if (node.type === 'condition' && node.branches) {
        for (const branch of node.branches) {
          if (branch.if) {
            this.context.currentNodeId = branch.next
            break
          }
        }
      } else if (node.type === 'parallel' && node.parallelNodes) {
        // 并行执行
        await Promise.all(
          node.parallelNodes.map(async parallelId => {
            const parallelNode = this.nodes.get(parallelId)
            if (parallelNode) {
              await this.executeNode(parallelNode, agentExecutor)
            }
          })
        )
        this.context.currentNodeId = node.next || ''
      } else {
        this.context.currentNodeId = node.next || ''
      }
    }

    return this.context
  }

  private async executeNode(
    node: WorkflowNode,
    agentExecutor: (agentId: string, task: string) => Promise<string>
  ): Promise<void> {
    if (node.type === 'task' && node.agentId && node.task) {
      const result = await agentExecutor(node.agentId, node.task.description || '')
      this.context.results[node.id] = result
    }
  }

  getContext(): WorkflowContext {
    return { ...this.context }
  }
}

// ===== 多 Agent 编排器 =====

export class MultiAgentOrchestrator {
  private taskDecomposer: TaskDecomposer
  private consensusEngine: ConsensusEngine
  private workflowEngine: WorkflowEngine

  constructor() {
    this.taskDecomposer = new TaskDecomposer()
    this.consensusEngine = new ConsensusEngine()
    this.workflowEngine = new WorkflowEngine()
  }

  /**
   * 执行多 Agent 协作任务
   */
  async collaborate(
    task: string,
    config: {
      mode: WorkMode
      workspacePath: string | null
      requireConsensus?: boolean
      maxRounds?: number
      maxAgents?: number
    },
    agentExecutor: (agentId: string, task: string) => Promise<string>
  ): Promise<CollaborationResult> {
    const startTime = Date.now()
    const availableAgents = agentRegistry.getAll()

    if (availableAgents.length === 0) {
      return {
        success: false,
        finalAnswer: '没有可用的 Agent',
        subTasks: [],
        messages: [],
        consensusReached: false,
        duration: 0,
      }
    }

    logger.agent.info(`[MultiAgent] Starting collaboration for: ${task}`)

    // 1. 任务分解（限制最大 Agent 数量）
    const maxAgents = config.maxAgents ?? availableAgents.length
    const limitedAgents = availableAgents.slice(0, maxAgents)
    const subTasks = await this.taskDecomposer.decompose(task, limitedAgents)
    logger.agent.info(`[MultiAgent] Decomposed into ${subTasks.length} sub-tasks (maxAgents: ${maxAgents})`)

    // 2. 构建执行图
    const executionGraph = this.buildExecutionGraph(subTasks)

    // 3. 执行子任务
    const messages: CollaborationMessage[] = []
    const completedTasks = new Set<string>()

    for (const layer of executionGraph) {
      // 同层任务并行执行
      const layerResults = await Promise.all(
        layer.map(async subTask => {
          const agent = agentRegistry.get(subTask.assignedTo)
          if (!agent) {
            return { ...subTask, status: 'failed' as const, error: 'Agent not found' }
          }

          logger.agent.info(`[MultiAgent] Executing sub-task: ${subTask.title} with ${agent.name}`)

          // 发送任务分配消息
          const assignMsg: CollaborationMessage = {
            id: crypto.randomUUID(),
            from: 'orchestrator',
            to: agent.id,
            type: 'delegate',
            content: subTask.description,
            timestamp: Date.now(),
          }
          messageBus.send(assignMsg)
          messages.push(assignMsg)

          try {
            const result = await agentExecutor(agent.id, subTask.description)

            // 发送完成消息
            const completeMsg: CollaborationMessage = {
              id: crypto.randomUUID(),
              from: agent.id,
              to: 'orchestrator',
              type: 'response',
              content: result,
              timestamp: Date.now(),
            }
            messageBus.send(completeMsg)
            messages.push(completeMsg)

            completedTasks.add(subTask.id)
            return {
              ...subTask,
              status: 'completed' as const,
              result,
              completedAt: Date.now(),
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return {
              ...subTask,
              status: 'failed' as const,
              error: errorMsg,
              completedAt: Date.now(),
            }
          }
        })
      )

      // 更新子任务状态（同步回主数组）
      for (let i = 0; i < layer.length; i++) {
        layer[i] = layerResults[i]
        const idx = subTasks.findIndex(t => t.id === layerResults[i].id)
        if (idx !== -1) {
          subTasks[idx] = layerResults[i]
        }
      }
    }

    // 4. 共识检查（如果需要）
    let consensusReached = true
    if (config.requireConsensus && subTasks.length > 1) {
      const reviewers = availableAgents.filter(a => a.role === 'reviewer')
      if (reviewers.length > 0) {
        const finalResult = subTasks.map(t => t.result).filter(Boolean).join('\n\n')
        const voteResult = await this.consensusEngine.vote(
          finalResult,
          reviewers,
          task
        )
        consensusReached = voteResult.approved
      }
    }

    // 5. 汇总结果
    const finalAnswer = this.aggregateResults(subTasks)
    const duration = Date.now() - startTime

    logger.agent.info(`[MultiAgent] Collaboration completed in ${duration}ms, consensus: ${consensusReached}`)

    return {
      success: subTasks.every(t => t.status === 'completed'),
      finalAnswer,
      subTasks,
      messages,
      consensusReached,
      duration,
    }
  }

  /**
   * 构建执行图（按依赖关系分层）
   */
  private buildExecutionGraph(subTasks: SubTask[]): SubTask[][] {
    const graph: SubTask[][] = []
    const completed = new Set<string>()
    const remaining = new Set(subTasks.map(t => t.id))

    while (remaining.size > 0) {
      const layer: SubTask[] = []

      for (const task of subTasks) {
        if (!remaining.has(task.id)) continue

        // 检查依赖是否已满足
        const depsSatisfied = task.dependencies.every(dep => completed.has(dep))
        if (depsSatisfied) {
          layer.push(task)
        }
      }

      if (layer.length === 0) {
        // 存在循环依赖
        throw new Error('Circular dependency detected in sub-tasks')
      }

      for (const task of layer) {
        remaining.delete(task.id)
        completed.add(task.id)
      }

      graph.push(layer)
    }

    return graph
  }

  /**
   * 汇总子任务结果
   */
  private aggregateResults(subTasks: SubTask[]): string {
    const parts: string[] = []

    for (const task of subTasks) {
      if (task.result) {
        parts.push(`## ${task.title}\n${task.result}`)
      } else if (task.error) {
        parts.push(`## ${task.title}\n**错误**: ${task.error}`)
      }
    }

    return parts.join('\n\n')
  }

  /**
   * 创建工作流
   */
  createWorkflow(): WorkflowEngine {
    return new WorkflowEngine()
  }
}

// ===== 默认 Agent 配置 =====

export const DEFAULT_AGENT_PROFILES: AgentProfile[] = [
  {
    id: 'agent-architect',
    role: 'architect',
    name: '架构师',
    description: '负责技术方案设计和架构决策',
    systemPrompt: '你是一位资深软件架构师。你的职责是分析需求并设计清晰、可扩展的技术方案。关注模块化、性能、安全性和可维护性。',
    capabilities: ['design', 'architecture', 'review_design'],
    llmConfig: { provider: 'default', model: 'default', apiKey: '' },
    priority: 8,
  },
  {
    id: 'agent-developer',
    role: 'developer',
    name: '开发者',
    description: '负责代码实现和功能开发',
    systemPrompt: '你是一位资深软件工程师。你的职责是编写高质量、可维护的代码。遵循最佳实践，编写清晰的注释和文档。',
    capabilities: ['code', 'implement', 'refactor'],
    llmConfig: { provider: 'default', model: 'default', apiKey: '' },
    priority: 9,
  },
  {
    id: 'agent-reviewer',
    role: 'reviewer',
    name: '审查员',
    description: '负责代码审查和质量把控',
    systemPrompt: '你是一位严格的代码审查员。你的职责是发现代码中的潜在问题，包括安全漏洞、性能问题、逻辑错误和代码异味。',
    capabilities: ['review', 'audit', 'security_check'],
    llmConfig: { provider: 'default', model: 'default', apiKey: '' },
    priority: 7,
  },
  {
    id: 'agent-tester',
    role: 'tester',
    name: '测试员',
    description: '负责测试用例设计和执行',
    systemPrompt: '你是一位测试专家。你的职责是设计全面的测试用例，覆盖正常场景、边界条件和异常情况。',
    capabilities: ['test', 'verify', 'edge_cases'],
    llmConfig: { provider: 'default', model: 'default', apiKey: '' },
    priority: 6,
  },
  {
    id: 'agent-coordinator',
    role: 'coordinator',
    name: '协调员',
    description: '负责协调多个 Agent 的工作',
    systemPrompt: '你是一位项目协调员。你的职责是理解复杂需求，协调不同角色的 Agent 协作完成任务。',
    capabilities: ['coordinate', 'plan', 'summarize'],
    llmConfig: { provider: 'default', model: 'default', apiKey: '' },
    priority: 10,
  },
]

// 注册默认 Agent
DEFAULT_AGENT_PROFILES.forEach(profile => agentRegistry.register(profile))

/**
 * 加载用户自定义 Agent 角色
 * 从全局设置中读取自定义角色配置并注册到 AgentRegistry
 */
export function loadCustomAgentProfiles(profiles: Array<{
  id: string
  name: string
  description: string
  systemPrompt: string
  capabilities: string[]
  priority: number
  enabled: boolean
}> | undefined): void {
  if (!profiles || profiles.length === 0) return

  for (const profile of profiles) {
    if (!profile.enabled) {
      // 如果角色被禁用，从注册表中移除（如果存在）
      if (agentRegistry.get(profile.id)) {
        agentRegistry.unregister(profile.id)
      }
      continue
    }

    const agentProfile: AgentProfile = {
      id: profile.id,
      role: 'developer', // 自定义角色统一使用 developer 角色类型
      name: profile.name,
      description: profile.description,
      systemPrompt: profile.systemPrompt,
      capabilities: profile.capabilities,
      llmConfig: { provider: 'default', model: 'default', apiKey: '' },
      priority: profile.priority,
    }

    // 如果已存在则先注销再注册（更新）
    if (agentRegistry.get(profile.id)) {
      agentRegistry.unregister(profile.id)
    }
    agentRegistry.register(agentProfile)
    logger.agent.info(`[MultiAgent] Loaded custom agent profile: ${profile.name} (priority: ${profile.priority})`)
  }
}

// ===== 单例导出 =====

export const multiAgentOrchestrator = new MultiAgentOrchestrator()
