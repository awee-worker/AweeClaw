/**
 * Workflow Engine - 多智体协作工作流引擎
 *
 * 核心设计：
 * - 每个工作流步骤可以指定一个"角色"（Agent Role），角色决定了系统提示词和可用工具
 * - agent_message 步骤真正调用 Agent.send()，获取 AI 响应
 * - 支持上下文传递：前一步骤的输出自动作为后续步骤的输入变量
 * - 支持人工审批、条件分支、并行执行
 * - 工作流可手动创建、编辑、保存
 */

// ============================================
// 智能体角色定义
// ============================================

export interface AgentRole {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  systemPrompt: string
  systemPromptZh?: string
  chatMode: 'chat' | 'agent' | 'plan'
  icon?: string
  color?: string
  allowedTools?: string[]
  temperature?: number
}

export const BUILTIN_AGENT_ROLES: AgentRole[] = [
  {
    id: 'analyst',
    name: 'Requirements Analyst',
    nameZh: '需求分析师',
    description: 'Analyzes requirements, clarifies scope, and breaks down tasks',
    descriptionZh: '分析需求，明确范围，拆解任务',
    systemPrompt: 'You are a requirements analyst. Your job is to understand user requirements, ask clarifying questions, and produce a clear, structured requirements document. Focus on: 1) Core functionality 2) Edge cases 3) Acceptance criteria',
    systemPromptZh: '你是一个需求分析师。你的工作是理解用户需求，提出澄清问题，并产出清晰、结构化的需求文档。重点关注：1）核心功能 2）边界情况 3）验收标准',
    chatMode: 'chat',
    icon: 'Search',
    color: '#3b82f6',
  },
  {
    id: 'architect',
    name: 'Solution Architect',
    nameZh: '方案架构师',
    description: 'Designs technical architecture, selects patterns and technologies',
    descriptionZh: '设计技术架构，选择模式和方案',
    systemPrompt: 'You are a solution architect. Design the technical architecture based on the requirements. Provide: 1) Component diagram 2) Data flow 3) API design 4) Technology choices with rationale',
    systemPromptZh: '你是一个方案架构师。根据需求设计技术架构。提供：1）组件图 2）数据流 3）API 设计 4）技术选型及理由',
    chatMode: 'chat',
    icon: 'LayoutGrid',
    color: '#8b5cf6',
  },
  {
    id: 'developer',
    name: 'Senior Developer',
    nameZh: '高级开发工程师',
    description: 'Implements code following the architecture design',
    descriptionZh: '按照架构设计实现代码',
    systemPrompt: 'You are a senior developer. Implement the code based on the architecture design. Follow best practices, write clean code with proper error handling. Use the available tools to create and edit files.',
    systemPromptZh: '你是一个高级开发工程师。按照架构设计实现代码。遵循最佳实践，编写整洁的代码并正确处理错误。使用可用工具创建和编辑文件。',
    chatMode: 'agent',
    icon: 'Code2',
    color: '#10b981',
  },
  {
    id: 'reviewer',
    name: 'Code Reviewer',
    nameZh: '代码审查员',
    description: 'Reviews code for quality, security, and best practices',
    descriptionZh: '审查代码质量、安全性和最佳实践',
    systemPrompt: 'You are a code reviewer. Review the code changes and provide feedback on: 1) Code quality 2) Security vulnerabilities 3) Performance issues 4) Best practice violations 5) Suggested improvements. Be constructive and specific.',
    systemPromptZh: '你是一个代码审查员。审查代码变更并提供反馈：1）代码质量 2）安全漏洞 3）性能问题 4）最佳实践违反 5）改进建议。提供建设性和具体的意见。',
    chatMode: 'chat',
    icon: 'Shield',
    color: '#f59e0b',
  },
  {
    id: 'tester',
    name: 'QA Engineer',
    nameZh: '测试工程师',
    description: 'Writes and runs tests, validates functionality',
    descriptionZh: '编写和运行测试，验证功能',
    systemPrompt: 'You are a QA engineer. Write comprehensive tests for the implemented code. Include: 1) Unit tests 2) Integration tests 3) Edge case tests 4) Error handling tests. Use the available tools to create test files and run them.',
    systemPromptZh: '你是一个测试工程师。为已实现的代码编写全面的测试。包括：1）单元测试 2）集成测试 3）边界测试 4）错误处理测试。使用可用工具创建测试文件并运行。',
    chatMode: 'agent',
    icon: 'FlaskConical',
    color: '#ef4444',
  },
  {
    id: 'doc-writer',
    name: 'Technical Writer',
    nameZh: '技术文档工程师',
    description: 'Writes documentation, API docs, and README',
    descriptionZh: '编写文档、API 文档和 README',
    systemPrompt: 'You are a technical writer. Create clear, comprehensive documentation. Include: 1) Overview 2) Installation guide 3) Usage examples 4) API reference 5) Configuration options',
    systemPromptZh: '你是一个技术文档工程师。创建清晰、全面的文档。包括：1）概述 2）安装指南 3）使用示例 4）API 参考 5）配置选项',
    chatMode: 'chat',
    icon: 'FileText',
    color: '#06b6d4',
  },
  {
    id: 'custom',
    name: 'Custom Agent',
    nameZh: '自定义智能体',
    description: 'A custom agent with user-defined role and instructions',
    descriptionZh: '用户自定义角色和指令的智能体',
    systemPrompt: '',
    chatMode: 'agent',
    icon: 'User',
    color: '#6b7280',
  },
]

// ============================================
// 工作流步骤类型
// ============================================

export type WorkflowStepType =
  | 'agent_message'
  | 'user_input'
  | 'condition'
  | 'parallel'
  | 'delay'

// ============================================
// 工作流步骤定义
// ============================================

export interface WorkflowStep {
  id: string
  name: string
  nameZh?: string
  type: WorkflowStepType
  config: WorkflowStepConfig
  roleId?: string
  next?: string
  onError?: WorkflowErrorHandler
  timeout?: number
}

export type WorkflowStepConfig =
  | AgentMessageConfig
  | UserInputConfig
  | ConditionConfig
  | ParallelConfig
  | DelayConfig

export interface AgentMessageConfig {
  type: 'agent_message'
  message: string
  outputVar?: string
  waitForResponse: true
}

export interface UserInputConfig {
  type: 'user_input'
  prompt: string
  options?: Array<{ id: string; label: string }>
  outputVar: string
  approvalMode?: boolean
}

export interface ConditionConfig {
  type: 'condition'
  expression: string
  safeConditions?: SafeCondition[]
  thenStep: string
  elseStep?: string
}

export interface ParallelConfig {
  type: 'parallel'
  steps: string[]
}

export interface DelayConfig {
  type: 'delay'
  durationMs: number
}

// ============================================
// 错误处理
// ============================================

export interface WorkflowErrorHandler {
  action: 'retry' | 'skip' | 'abort' | 'goto'
  maxRetries?: number
  retryDelayMs?: number
  gotoStep?: string
}

// ============================================
// 工作流定义
// ============================================

export interface WorkflowDefinition {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  version: string
  author: string
  category: WorkflowCategory
  tags: string[]
  icon?: string
  steps: Record<string, WorkflowStep>
  startStep: string
  inputSchema?: Record<string, WorkflowInputParam>
  variables?: Record<string, unknown>
  isCustom?: boolean
}

export type WorkflowCategory =
  | 'automation'
  | 'code-review'
  | 'development'
  | 'documentation'
  | 'testing'
  | 'custom'

export interface WorkflowInputParam {
  type: 'string' | 'number' | 'boolean' | 'select'
  description: string
  descriptionZh?: string
  required?: boolean
  default?: unknown
  enum?: string[]
}

// ============================================
// 工作流执行状态
// ============================================

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface WorkflowRun {
  id: string
  workflowId: string
  status: WorkflowRunStatus
  startedAt: number
  completedAt?: number
  currentStepId?: string
  variables: Record<string, unknown>
  stepHistory: WorkflowStepResult[]
  error?: string
  threadId?: string
}

export interface WorkflowStepResult {
  stepId: string
  status: 'success' | 'failed' | 'skipped' | 'rolled_back'
  startedAt: number
  completedAt: number
  output?: unknown
  error?: string
  snapshot?: WorkflowStateSnapshot
}

export interface WorkflowStateSnapshot {
  variables: Record<string, unknown>
  stepHistoryLength: number
  currentStepId?: string
  threadId?: string
  timestamp: number
}

export interface DAGValidationResult {
  valid: boolean
  errors: DAGValidationError[]
  warnings: DAGValidationWarning[]
}

export interface DAGValidationError {
  type: 'cycle' | 'orphan' | 'missing_step' | 'invalid_config'
  stepId?: string
  message: string
}

export interface DAGValidationWarning {
  type: 'unreachable' | 'no_error_handler' | 'deep_nesting'
  stepId?: string
  message: string
}

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'is_truthy'
  | 'is_falsy'

export interface SafeCondition {
  variable: string
  operator: ConditionOperator
  value?: unknown
}

// ============================================
// 执行回调接口 - 由 UI 层注入
// ============================================

export interface WorkflowExecutionCallbacks {
  sendMessageToAgent: (
    message: string,
    roleId: string | undefined,
    threadId: string | undefined,
    customSystemPrompt?: string,
  ) => Promise<{ response: string; threadId: string }>
  requestUserInput: (
    prompt: string,
    options?: Array<{ id: string; label: string }>,
  ) => Promise<unknown>
}

// ============================================
// Workflow Engine
// ============================================

class WorkflowEngineClass {
  private definitions = new Map<string, WorkflowDefinition>()
  private runs = new Map<string, WorkflowRun>()
  private listeners = new Set<(event: WorkflowEvent) => void>()
  private pauseResolvers = new Map<string, (value: unknown) => void>()
  private callbacks: WorkflowExecutionCallbacks | null = null

  setCallbacks(callbacks: WorkflowExecutionCallbacks): void {
    this.callbacks = callbacks
  }

  validateDAG(definition: WorkflowDefinition): DAGValidationResult {
    const errors: DAGValidationError[] = []
    const warnings: DAGValidationWarning[] = []
    const steps = definition.steps
    const stepIds = new Set(Object.keys(steps))

    if (!steps[definition.startStep]) {
      errors.push({ type: 'missing_step', stepId: definition.startStep, message: `Start step '${definition.startStep}' does not exist` })
    }

    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const detectCycle = (stepId: string): void => {
      if (recursionStack.has(stepId)) {
        errors.push({ type: 'cycle', stepId, message: `Cycle detected at step '${stepId}'` })
        return
      }
      if (visited.has(stepId)) return

      visited.add(stepId)
      recursionStack.add(stepId)

      const step = steps[stepId]
      if (!step) return

      const nextSteps = this.getNextStepIds(step, step.config)
      for (const nextId of nextSteps) {
        if (stepIds.has(nextId)) {
          detectCycle(nextId)
        } else {
          errors.push({ type: 'missing_step', stepId, message: `Step '${stepId}' references non-existent step '${nextId}'` })
        }
      }

      if (step.onError?.gotoStep && !stepIds.has(step.onError.gotoStep)) {
        errors.push({ type: 'missing_step', stepId, message: `Error handler in '${stepId}' references non-existent step '${step.onError.gotoStep}'` })
      }

      recursionStack.delete(stepId)
    }

    detectCycle(definition.startStep)

    for (const stepId of stepIds) {
      if (!visited.has(stepId)) {
        warnings.push({ type: 'unreachable', stepId, message: `Step '${stepId}' is unreachable from start` })
      }
    }

    for (const [stepId, step] of Object.entries(steps)) {
      if (step.type === 'agent_message' && !step.onError) {
        warnings.push({ type: 'no_error_handler', stepId, message: `Agent step '${stepId}' has no error handler` })
      }
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  private getNextStepIds(step: WorkflowStep, config: WorkflowStepConfig): string[] {
    const next: string[] = []
    if (step.next) next.push(step.next)
    if (config.type === 'condition') {
      const cond = config as ConditionConfig
      if (cond.thenStep) next.push(cond.thenStep)
      if (cond.elseStep) next.push(cond.elseStep)
    }
    if (config.type === 'parallel') {
      const parallel = config as ParallelConfig
      next.push(...parallel.steps)
    }
    return next
  }

  private createSnapshot(run: WorkflowRun): WorkflowStateSnapshot {
    return {
      variables: JSON.parse(JSON.stringify(run.variables)),
      stepHistoryLength: run.stepHistory.length,
      currentStepId: run.currentStepId,
      threadId: run.threadId,
      timestamp: Date.now(),
    }
  }

  private restoreSnapshot(run: WorkflowRun, snapshot: WorkflowStateSnapshot): void {
    run.variables = JSON.parse(JSON.stringify(snapshot.variables))
    run.stepHistory.splice(snapshot.stepHistoryLength)
    run.currentStepId = snapshot.currentStepId
    if (snapshot.threadId) run.threadId = snapshot.threadId
  }

  private evaluateSafeConditions(conditions: SafeCondition[], variables: Record<string, unknown>): boolean {
    for (const cond of conditions) {
      const varValue = variables[cond.variable]
      let result: boolean

      switch (cond.operator) {
        case 'eq':
          result = varValue === cond.value
          break
        case 'neq':
          result = varValue !== cond.value
          break
        case 'gt':
          result = typeof varValue === 'number' && typeof cond.value === 'number' && varValue > cond.value
          break
        case 'gte':
          result = typeof varValue === 'number' && typeof cond.value === 'number' && varValue >= cond.value
          break
        case 'lt':
          result = typeof varValue === 'number' && typeof cond.value === 'number' && varValue < cond.value
          break
        case 'lte':
          result = typeof varValue === 'number' && typeof cond.value === 'number' && varValue <= cond.value
          break
        case 'contains':
          result = typeof varValue === 'string' && typeof cond.value === 'string' && varValue.includes(cond.value)
          break
        case 'not_contains':
          result = typeof varValue === 'string' && typeof cond.value === 'string' && !varValue.includes(cond.value)
          break
        case 'is_truthy':
          result = !!varValue
          break
        case 'is_falsy':
          result = !varValue
          break
        default:
          result = false
      }

      if (!result) return false
    }
    return true
  }

  register(definition: WorkflowDefinition): void {
    this.definitions.set(definition.id, definition)
  }

  unregister(workflowId: string): boolean {
    return this.definitions.delete(workflowId)
  }

  get(workflowId: string): WorkflowDefinition | undefined {
    return this.definitions.get(workflowId)
  }

  getAll(): WorkflowDefinition[] {
    return Array.from(this.definitions.values())
  }

  getByCategory(category: WorkflowCategory): WorkflowDefinition[] {
    return this.getAll().filter(w => w.category === category)
  }

  updateDefinition(definition: WorkflowDefinition): void {
    this.definitions.set(definition.id, definition)
  }

  private resolveTemplate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = variables[key]
      if (value === undefined) return `{{${key}}}`
      if (typeof value === 'string') return value
      return JSON.stringify(value)
    })
  }

  private resolveConfigTemplates(config: WorkflowStepConfig, variables: Record<string, unknown>): WorkflowStepConfig {
    const resolve = (obj: unknown): unknown => {
      if (typeof obj === 'string') return this.resolveTemplate(obj, variables)
      if (Array.isArray(obj)) return obj.map(resolve)
      if (obj && typeof obj === 'object') {
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
          result[k] = resolve(v)
        }
        return result
      }
      return obj
    }
    return resolve(config) as WorkflowStepConfig
  }

  createRun(workflowId: string): WorkflowRun {
    const definition = this.definitions.get(workflowId)
    if (!definition) throw new Error(`Workflow not found: ${workflowId}`)

    const run: WorkflowRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workflowId,
      status: 'pending',
      startedAt: Date.now(),
      variables: { ...definition.variables },
      stepHistory: [],
    }

    this.runs.set(run.id, run)
    return run
  }

  async startRun(runId: string, input?: Record<string, unknown>): Promise<WorkflowRun> {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    if (run.status !== 'pending') throw new Error(`Run ${runId} is not in pending state`)

    const definition = this.definitions.get(run.workflowId)
    if (!definition) throw new Error(`Workflow not found: ${run.workflowId}`)

    run.variables = { ...definition.variables, ...input }
    run.status = 'running'
    this.emit({ type: 'workflow_started', runId: run.id, workflowId: run.workflowId })

    try {
      await this.executeStep(run, definition.startStep, definition)
      if (run.status === 'running') {
        run.status = 'completed'
        run.completedAt = Date.now()
        this.emit({ type: 'workflow_completed', runId: run.id, workflowId: run.workflowId })
      }
    } catch (error) {
      run.status = 'failed'
      run.error = error instanceof Error ? error.message : String(error)
      run.completedAt = Date.now()
      this.emit({ type: 'workflow_failed', runId: run.id, workflowId: run.workflowId, error: run.error })
    }

    return run
  }

  async start(
    workflowId: string,
    input?: Record<string, unknown>
  ): Promise<WorkflowRun> {
    const definition = this.definitions.get(workflowId)
    if (!definition) throw new Error(`Workflow not found: ${workflowId}`)

    const run: WorkflowRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workflowId,
      status: 'running',
      startedAt: Date.now(),
      variables: { ...definition.variables, ...input },
      stepHistory: [],
    }

    this.runs.set(run.id, run)
    this.emit({ type: 'workflow_started', runId: run.id, workflowId })

    try {
      await this.executeStep(run, definition.startStep, definition)
      if (run.status === 'running') {
        run.status = 'completed'
        run.completedAt = Date.now()
        this.emit({ type: 'workflow_completed', runId: run.id, workflowId })
      }
    } catch (error) {
      run.status = 'failed'
      run.error = error instanceof Error ? error.message : String(error)
      run.completedAt = Date.now()
      this.emit({ type: 'workflow_failed', runId: run.id, workflowId, error: run.error })
    }

    return run
  }

  private async executeStep(
    run: WorkflowRun,
    stepId: string,
    definition: WorkflowDefinition
  ): Promise<void> {
    const step = definition.steps[stepId]
    if (!step) throw new Error(`Step not found: ${stepId}`)

    if (run.status !== 'running') return

    run.currentStepId = stepId
    this.emit({ type: 'step_started', runId: run.id, workflowId: run.workflowId, stepId })

    const snapshot = this.createSnapshot(run)

    const stepResult: WorkflowStepResult = {
      stepId,
      status: 'success',
      startedAt: Date.now(),
      completedAt: Date.now(),
      snapshot,
    }

    try {
      const resolvedConfig = this.resolveConfigTemplates(step.config, run.variables)
      const output = await this.executeStepConfig(step, resolvedConfig, run, definition)

      if (step.config.type === 'agent_message') {
        const agentConfig = step.config as AgentMessageConfig
        if (agentConfig.outputVar && output !== undefined) {
          run.variables[agentConfig.outputVar] = output
        }
      } else if (step.config.type === 'user_input') {
        const userInputConfig = step.config as UserInputConfig
        if (userInputConfig.outputVar && output !== undefined) {
          run.variables[userInputConfig.outputVar] = output
        }
      }

      stepResult.output = output
      run.stepHistory.push(stepResult)
      this.emit({ type: 'step_completed', runId: run.id, workflowId: run.workflowId, stepId, output })

      if (step.config.type === 'user_input') {
        run.status = 'paused'
        this.emit({ type: 'workflow_paused', runId: run.id, workflowId: run.workflowId, stepId, reason: 'user_input' })

        const userInput = await new Promise<unknown>((resolve) => {
          this.pauseResolvers.set(run.id, resolve)
        })

        run.status = 'running'
        this.emit({ type: 'workflow_resumed', runId: run.id, workflowId: run.workflowId })

        const uiConfig = step.config as UserInputConfig
        if (uiConfig.outputVar) {
          run.variables[uiConfig.outputVar] = userInput
        }
      }

      if (step.config.type === 'condition') {
        const condConfig = resolvedConfig as ConditionConfig
        let shouldGoThen: boolean
        if (condConfig.safeConditions && condConfig.safeConditions.length > 0) {
          shouldGoThen = this.evaluateSafeConditions(condConfig.safeConditions, run.variables)
        } else {
          shouldGoThen = this.evaluateCondition(condConfig.expression, run.variables)
        }
        const nextStepId = shouldGoThen ? condConfig.thenStep : condConfig.elseStep
        if (nextStepId && run.status === 'running') {
          await this.executeStep(run, nextStepId, definition)
        }
        return
      }

      if (step.config.type === 'parallel') {
        const parallelConfig = resolvedConfig as ParallelConfig
        await this.executeParallelSteps(run, parallelConfig, definition)
      }

      if (run.status === 'running' && step.next) {
        await this.executeStep(run, step.next, definition)
      }
    } catch (error) {
      stepResult.status = 'failed'
      stepResult.error = error instanceof Error ? error.message : String(error)
      stepResult.completedAt = Date.now()
      run.stepHistory.push(stepResult)
      this.emit({ type: 'step_failed', runId: run.id, workflowId: run.workflowId, stepId, error: stepResult.error })

      if (step.onError) {
        await this.handleError(run, step, stepResult.error, definition)
      } else {
        throw error
      }
    }
  }

  private async executeStepConfig(
    step: WorkflowStep,
    config: WorkflowStepConfig,
    run: WorkflowRun,
    _definition: WorkflowDefinition
  ): Promise<unknown> {
    switch (config.type) {
      case 'delay':
        await new Promise(resolve => setTimeout(resolve, config.durationMs))
        return null

      case 'user_input':
        return { userInputRequired: config.prompt, outputVar: config.outputVar }

      case 'condition':
        return null

      case 'parallel':
        return null

      case 'agent_message': {
        if (!this.callbacks) {
          return { agentMessage: config.message, outputVar: config.outputVar }
        }

        const role = step.roleId
          ? BUILTIN_AGENT_ROLES.find(r => r.id === step.roleId)
          : undefined

        const customPrompt = role?.systemPrompt

        const result = await this.callbacks.sendMessageToAgent(
          config.message,
          step.roleId,
          run.threadId,
          customPrompt,
        )

        run.threadId = result.threadId

        return result.response
      }

      default:
        return null
    }
  }

  private evaluateCondition(expression: string, variables: Record<string, unknown>): boolean {
    try {
      const keys = Object.keys(variables)
      const values = Object.values(variables)
      const fn = new Function(...keys, `return !!(${expression})`)
      return fn(...values)
    } catch {
      return false
    }
  }

  private async executeParallelSteps(
    run: WorkflowRun,
    config: ParallelConfig,
    definition: WorkflowDefinition
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {}
    const promises = config.steps.map(async (stepId) => {
      const step = definition.steps[stepId]
      if (!step) return

      const resolvedConfig = this.resolveConfigTemplates(step.config, run.variables)
      const output = await this.executeStepConfig(step, resolvedConfig, run, definition)

      results[stepId] = output

      if (step.config.type === 'agent_message') {
        const agentConfig = step.config as AgentMessageConfig
        if (agentConfig.outputVar) run.variables[agentConfig.outputVar] = output
      }
    })

    await Promise.all(promises)
    return results
  }

  resume(runId: string, userInput?: unknown): boolean {
    const run = this.runs.get(runId)
    if (!run || run.status !== 'paused') return false

    if (userInput !== undefined) {
      const currentStepId = run.currentStepId
      if (currentStepId) {
        const lastHistory = run.stepHistory[run.stepHistory.length - 1]
        if (lastHistory && lastHistory.output && typeof lastHistory.output === 'object') {
          const outputObj = lastHistory.output as { outputVar?: string }
          if (outputObj.outputVar) {
            run.variables[outputObj.outputVar] = userInput
          }
        }
      }
    }

    const resolver = this.pauseResolvers.get(runId)
    if (resolver) {
      this.pauseResolvers.delete(runId)
      resolver(userInput)
      return true
    }
    return false
  }

  private async handleError(
    run: WorkflowRun,
    step: WorkflowStep,
    error: string,
    definition: WorkflowDefinition
  ): Promise<void> {
    if (!step.onError) throw new Error(error)

    switch (step.onError.action) {
      case 'skip':
        break
      case 'abort':
        run.status = 'failed'
        run.error = error
        break
      case 'retry':
        if (step.onError.maxRetries && step.onError.maxRetries > 0) {
          await this.executeStep(run, step.id, definition)
        }
        break
      case 'goto':
        if (step.onError.gotoStep) {
          await this.executeStep(run, step.onError.gotoStep, definition)
        }
        break
    }
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId)
  }

  getActiveRuns(): WorkflowRun[] {
    return Array.from(this.runs.values()).filter(r => r.status === 'running')
  }

  getAllRuns(): WorkflowRun[] {
    return Array.from(this.runs.values())
  }

  cancelRun(runId: string): boolean {
    const run = this.runs.get(runId)
    if (!run || (run.status !== 'running' && run.status !== 'paused')) return false
    run.status = 'cancelled'
    run.completedAt = Date.now()
    const resolver = this.pauseResolvers.get(runId)
    if (resolver) {
      this.pauseResolvers.delete(runId)
      resolver(null)
    }
    return true
  }

  deleteRun(runId: string): boolean {
    this.pauseResolvers.delete(runId)
    return this.runs.delete(runId)
  }

  onEvent(listener: (event: WorkflowEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: WorkflowEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // ignore
      }
    }
  }
}

export interface WorkflowEvent {
  type: 'workflow_started' | 'workflow_completed' | 'workflow_failed' | 'workflow_cancelled' | 'workflow_paused' | 'workflow_resumed' | 'step_started' | 'step_completed' | 'step_failed'
  runId: string
  workflowId: string
  stepId?: string
  output?: unknown
  error?: string
  reason?: string
}

export const workflowEngine = new WorkflowEngineClass()
