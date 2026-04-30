/**
 * Workflow Engine - 工作流引擎
 *
 * 支持跨会话的自动化工作流，用户可以定义、保存和执行工作流。
 * 工作流由一系列步骤组成，每个步骤可以调用工具、切换场景、
 * 等待用户输入或触发子工作流。
 *
 * 设计原则：
 * - 声明式定义：工作流以 JSON/YAML 描述
 * - 可视化编辑：支持拖拽式工作流编辑器
 * - 条件分支：支持 if/else、switch、循环
 * - 错误恢复：失败步骤可重试或跳过
 * - 持久化：工作流状态可保存和恢复
 */

// ============================================
// 工作流步骤类型
// ============================================

export type WorkflowStepType =
  | 'tool_call'
  | 'agent_message'
  | 'scenario_switch'
  | 'user_input'
  | 'condition'
  | 'loop'
  | 'parallel'
  | 'sub_workflow'
  | 'delay'
  | 'transform'
  | 'http_request'

// ============================================
// 工作流步骤定义
// ============================================

export interface WorkflowStep {
  id: string
  name: string
  type: WorkflowStepType
  config: WorkflowStepConfig
  next?: string
  onError?: WorkflowErrorHandler
  timeout?: number
  retryPolicy?: WorkflowRetryPolicy
}

export type WorkflowStepConfig =
  | ToolCallConfig
  | AgentMessageConfig
  | ScenarioSwitchConfig
  | UserInputConfig
  | ConditionConfig
  | LoopConfig
  | ParallelConfig
  | SubWorkflowConfig
  | DelayConfig
  | TransformConfig
  | HttpRequestConfig

export interface ToolCallConfig {
  type: 'tool_call'
  tool: string
  args: Record<string, unknown>
  outputVar?: string
}

export interface AgentMessageConfig {
  type: 'agent_message'
  message: string
  outputVar?: string
  waitForResponse?: boolean
}

export interface ScenarioSwitchConfig {
  type: 'scenario_switch'
  scenarioId: string
}

export interface UserInputConfig {
  type: 'user_input'
  prompt: string
  options?: Array<{ id: string; label: string }>
  outputVar: string
}

export interface ConditionConfig {
  type: 'condition'
  expression: string
  thenStep: string
  elseStep?: string
}

export interface LoopConfig {
  type: 'loop'
  itemsVar: string
  itemVar: string
  bodyStep: string
  maxIterations?: number
}

export interface ParallelConfig {
  type: 'parallel'
  steps: string[]
  mergeStrategy?: 'all' | 'first' | 'race'
}

export interface SubWorkflowConfig {
  type: 'sub_workflow'
  workflowId: string
  inputMapping?: Record<string, string>
  outputMapping?: Record<string, string>
}

export interface DelayConfig {
  type: 'delay'
  durationMs: number
}

export interface TransformConfig {
  type: 'transform'
  inputVar: string
  outputVar: string
  expression: string
}

export interface HttpRequestConfig {
  type: 'http_request'
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  outputVar?: string
}

// ============================================
// 错误处理与重试
// ============================================

export interface WorkflowErrorHandler {
  action: 'retry' | 'skip' | 'abort' | 'goto'
  maxRetries?: number
  retryDelayMs?: number
  gotoStep?: string
}

export interface WorkflowRetryPolicy {
  maxAttempts: number
  delayMs: number
  backoffMultiplier?: number
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
  outputSchema?: Record<string, string>
  variables?: Record<string, unknown>
  compatibleScenarios?: string[]
}

export type WorkflowCategory =
  | 'automation'
  | 'data-pipeline'
  | 'code-review'
  | 'deployment'
  | 'testing'
  | 'documentation'
  | 'custom'

export interface WorkflowInputParam {
  type: 'string' | 'number' | 'boolean' | 'select'
  description: string
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
}

export interface WorkflowStepResult {
  stepId: string
  status: 'success' | 'failed' | 'skipped'
  startedAt: number
  completedAt: number
  output?: unknown
  error?: string
  retryCount?: number
}

// ============================================
// Workflow Engine
// ============================================

class WorkflowEngineClass {
  private definitions = new Map<string, WorkflowDefinition>()
  private runs = new Map<string, WorkflowRun>()
  private listeners = new Set<(event: WorkflowEvent) => void>()

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

  /**
   * 启动工作流执行
   */
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
      run.status = 'completed'
      run.completedAt = Date.now()
      this.emit({ type: 'workflow_completed', runId: run.id, workflowId })
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

    const stepResult: WorkflowStepResult = {
      stepId,
      status: 'success',
      startedAt: Date.now(),
      completedAt: Date.now(),
    }

    try {
      const output = await this.executeStepConfig(step, run, definition)
      stepResult.output = output
      run.stepHistory.push(stepResult)

      this.emit({ type: 'step_completed', runId: run.id, workflowId: run.workflowId, stepId, output })

      if (step.next) {
        await this.executeStep(run, step.next, definition)
      }
    } catch (error) {
      stepResult.status = 'failed'
      stepResult.error = error instanceof Error ? error.message : String(error)
      run.stepHistory.push(stepResult)

      this.emit({ type: 'step_failed', runId: run.id, stepId, error: stepResult.error })

      if (step.onError) {
        await this.handleError(run, step, stepResult.error, definition)
      } else {
        throw error
      }
    }
  }

  private async executeStepConfig(
    step: WorkflowStep,
    run: WorkflowRun,
    _definition: WorkflowDefinition
  ): Promise<unknown> {
    const config = step.config

    switch (config.type) {
      case 'delay':
        await new Promise(resolve => setTimeout(resolve, config.durationMs))
        return null

      case 'transform':
        run.variables[config.outputVar] = config.expression
        return run.variables[config.outputVar]

      case 'scenario_switch':
        return { scenarioSwitched: config.scenarioId }

      case 'user_input':
        return { userInputRequired: config.prompt, outputVar: config.outputVar }

      case 'tool_call':
        return { toolCall: config.tool, args: config.args, outputVar: config.outputVar }

      case 'agent_message':
        return { agentMessage: config.message, outputVar: config.outputVar }

      case 'condition':
        return { condition: config.expression }

      case 'parallel':
        return { parallelSteps: config.steps }

      case 'sub_workflow':
        return { subWorkflow: config.workflowId }

      case 'http_request':
        return { httpRequest: config }

      case 'loop':
        return { loop: config }

      default:
        return null
    }
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

  cancelRun(runId: string): boolean {
    const run = this.runs.get(runId)
    if (!run || run.status !== 'running') return false
    run.status = 'cancelled'
    run.completedAt = Date.now()
    return true
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
  type: 'workflow_started' | 'workflow_completed' | 'workflow_failed' | 'step_started' | 'step_completed' | 'step_failed'
  runId: string
  workflowId: string
  stepId?: string
  output?: unknown
  error?: string
}

export const workflowEngine = new WorkflowEngineClass()
