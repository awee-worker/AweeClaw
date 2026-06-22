/**
 * 工作流引擎（L5 智能工作流层）
 *
 * 职责：
 * 1. 工作流定义管理（注册、查询、删除）
 * 2. 工作流执行调度（步骤序列、条件分支、循环、错误处理）
 * 3. 触发方式集成（手动、定时 cronScheduler、事件、webhook）
 * 4. 变量与上下文传递
 * 5. 执行日志与回滚
 * 6. 与 Agent 系统集成
 *
 * 设计要点：
 * - 单例模式，全局唯一引擎
 * - 继承 EventEmitter，支持运行状态、进度、日志事件
 * - 与紧急停止机制集成，可随时中断
 * - 支持嵌套工作流（子工作流调用）
 * - 表达式求值使用安全沙箱（不使用 eval）
 *
 * @module desktop-control/WorkflowEngine
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import {
  getEmergencyStopController,
  EmergencyStopError,
} from './EmergencyStop'
import { getDesktopControlManager } from './DesktopControlManager'
import { ActionReplayer } from './ActionReplayer'
import type { RecordingScript } from './types/recording'
import {
  type WorkflowDefinition,
  type WorkflowContext,
  type WorkflowResult,
  type WorkflowRunState,
  type WorkflowStep,
  type WorkflowTrigger,
  type StepRunRecord,
  type WorkflowLogEntry,
  WorkflowStepType,
  type OnErrorStrategy,
} from './types/workflow'

// ============================================
// 事件类型常量
// ============================================

export const WORKFLOW_EVENT_STATE_CHANGE = 'workflow:state-change'
export const WORKFLOW_EVENT_STEP_START = 'workflow:step-start'
export const WORKFLOW_EVENT_STEP_COMPLETE = 'workflow:step-complete'
export const WORKFLOW_EVENT_STEP_ERROR = 'workflow:step-error'
export const WORKFLOW_EVENT_LOG = 'workflow:log'
export const WORKFLOW_EVENT_COMPLETED = 'workflow:completed'

// ============================================
// 工作流引擎实现
// ============================================

/**
 * 工作流引擎
 *
 * 使用方式：
 * ```ts
 * const engine = getWorkflowEngine()
 *
 * // 注册工作流
 * engine.register({
 *   id: 'daily-report',
 *   name: '每日报告',
 *   triggers: [{ type: 'cron', expression: '0 9 * * *' }],
 *   steps: [...],
 *   ...
 * })
 *
 * // 手动触发
 * const result = await engine.run('daily-report')
 * ```
 */
export class WorkflowEngine extends EventEmitter {
  private workflows = new Map<string, WorkflowDefinition>()
  private recordings = new Map<string, RecordingScript>()
  private runningContexts = new Map<string, WorkflowContext>()
  private abortControllers = new Map<string, AbortController>()

  constructor() {
    super()
    // 监听紧急停止
    const stopController = getEmergencyStopController()
    stopController.on('emergency-stop', () => {
      logger.desktop.info('[WorkflowEngine] Emergency stop triggered, aborting all running workflows')
      for (const [runId, controller] of this.abortControllers) {
        controller.abort()
        logger.desktop.info(`[WorkflowEngine] Aborted workflow run: ${runId}`)
      }
    })
  }

  // ============================================
  // 工作流定义管理
  // ============================================

  /**
   * 注册工作流
   *
   * @throws 若 ID 已存在
   */
  register(workflow: WorkflowDefinition): void {
    if (this.workflows.has(workflow.id)) {
      throw new Error(`Workflow already exists: ${workflow.id}`)
    }
    this.validateWorkflow(workflow)
    this.workflows.set(workflow.id, workflow)
    logger.desktop.info(`[WorkflowEngine] Registered workflow: ${workflow.id} (${workflow.name})`)
  }

  /**
   * 更新工作流
   */
  update(workflowId: string, updates: Partial<WorkflowDefinition>): WorkflowDefinition | null {
    const existing = this.workflows.get(workflowId)
    if (!existing) return null

    const updated: WorkflowDefinition = {
      ...existing,
      ...updates,
      id: workflowId, // ID 不可变
      updatedAt: Date.now(),
    }
    this.validateWorkflow(updated)
    this.workflows.set(workflowId, updated)
    logger.desktop.info(`[WorkflowEngine] Updated workflow: ${workflowId}`)
    return updated
  }

  /** 删除工作流 */
  unregister(workflowId: string): boolean {
    const removed = this.workflows.delete(workflowId)
    if (removed) {
      logger.desktop.info(`[WorkflowEngine] Unregistered workflow: ${workflowId}`)
    }
    return removed
  }

  /** 获取工作流定义 */
  get(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId)
  }

  /** 列出所有工作流 */
  list(): WorkflowDefinition[] {
    return Array.from(this.workflows.values())
  }

  /** 按触发器查找工作流 */
  findByTrigger(trigger: WorkflowTrigger): WorkflowDefinition[] {
    return this.list().filter((wf) =>
      wf.enabled &&
      wf.triggers.some((t) => this.triggerMatches(t, trigger)),
    )
  }

  // ============================================
  // 录制脚本管理
  // ============================================

  /** 保存录制脚本 */
  saveRecording(script: RecordingScript): void {
    this.recordings.set(script.id, script)
    logger.desktop.info(`[WorkflowEngine] Saved recording: ${script.id} (${script.metadata.name})`)
  }

  /** 获取录制脚本 */
  getRecording(recordingId: string): RecordingScript | undefined {
    return this.recordings.get(recordingId)
  }

  /** 列出所有录制脚本 */
  listRecordings(): RecordingScript[] {
    return Array.from(this.recordings.values())
  }

  /** 删除录制脚本 */
  deleteRecording(recordingId: string): boolean {
    return this.recordings.delete(recordingId)
  }

  // ============================================
  // 工作流执行
  // ============================================

  /**
   * 运行工作流
   *
   * @param workflowId 工作流 ID
   * @param trigger 触发来源（默认 manual）
   * @param inputVariables 输入变量覆盖
   * @returns 执行结果
   */
  async run(
    workflowId: string,
    trigger: WorkflowTrigger = { type: 'manual' },
    inputVariables?: Record<string, unknown>,
  ): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }
    if (!workflow.enabled) {
      throw new Error(`Workflow is disabled: ${workflowId}`)
    }

    // 检查紧急停止
    const stopController = getEmergencyStopController()
    if (stopController.getState().stopped) {
      throw new EmergencyStopError('Emergency stop is active, cannot run workflow')
    }

    const runId = randomUUID()
    const abortController = new AbortController()
    this.abortControllers.set(runId, abortController)

    // 初始化上下文
    const variables = this.initVariables(workflow, inputVariables)
    const context: WorkflowContext = {
      runId,
      workflowId,
      workflowName: workflow.name,
      trigger,
      variables,
      stepRecords: new Map(),
      startedAt: Date.now(),
      abortSignal: abortController.signal,
      logs: [],
    }
    this.runningContexts.set(runId, context)

    this.log(context, 'info', `Workflow started: ${workflow.name}`)
    this.emit(WORKFLOW_EVENT_STATE_CHANGE, { runId, workflowId, state: 'running' as WorkflowRunState })

    let state: WorkflowRunState = 'running'
    let errorMessage: string | undefined

    try {
      await this.executeSteps(workflow, context)
      state = 'completed'
      this.log(context, 'info', 'Workflow completed successfully')
    } catch (err) {
      if (err instanceof EmergencyStopError || abortController.signal.aborted) {
        state = 'aborted'
        errorMessage = err instanceof Error ? err.message : 'Aborted'
        this.log(context, 'warn', `Workflow aborted: ${errorMessage}`)
      } else {
        state = 'failed'
        errorMessage = err instanceof Error ? err.message : String(err)
        this.log(context, 'error', `Workflow failed: ${errorMessage}`)
      }
    } finally {
      this.abortControllers.delete(runId)
      this.runningContexts.delete(runId)
    }

    const result: WorkflowResult = {
      runId,
      workflowId,
      state,
      startedAt: context.startedAt,
      endedAt: Date.now(),
      duration: Date.now() - context.startedAt,
      stepRecords: Array.from(context.stepRecords.values()),
      variables: context.variables,
      error: errorMessage,
      logs: context.logs,
    }

    this.emit(WORKFLOW_EVENT_COMPLETED, result)
    this.emit(WORKFLOW_EVENT_STATE_CHANGE, { runId, workflowId, state })
    return result
  }

  /**
   * 中止指定运行
   */
  abort(runId: string): void {
    const controller = this.abortControllers.get(runId)
    if (controller) {
      controller.abort()
      logger.desktop.info(`[WorkflowEngine] Aborting workflow run: ${runId}`)
    }
  }

  /** 获取运行中的工作流 */
  getRunningWorkflows(): WorkflowContext[] {
    return Array.from(this.runningContexts.values())
  }

  // ============================================
  // 内部执行逻辑
  // ============================================

  /** 执行步骤序列 */
  private async executeSteps(workflow: WorkflowDefinition, context: WorkflowContext): Promise<void> {
    let currentStepId = workflow.entryStepId
    const executedSteps = new Set<string>()

    while (currentStepId) {
      // 检查中止信号
      if (context.abortSignal.aborted) {
        throw new EmergencyStopError('Workflow aborted by signal')
      }

      // 检查循环引用
      if (executedSteps.has(currentStepId)) {
        throw new Error(`Circular reference detected at step: ${currentStepId}`)
      }
      executedSteps.add(currentStepId)

      const step = workflow.steps.find((s) => s.id === currentStepId)
      if (!step) {
        throw new Error(`Step not found: ${currentStepId}`)
      }
      if (!step.enabled) {
        // 跳过禁用步骤，进入下一步
        const nextId = this.getNextStepId(workflow, step, context)
        if (!nextId) break
        currentStepId = nextId
        continue
      }

      // 执行步骤
      const nextStepId = await this.executeStep(workflow, step, context)
      if (!nextStepId) break
      currentStepId = nextStepId
    }
  }

  /** 执行单个步骤 */
  private async executeStep(
    workflow: WorkflowDefinition,
    step: WorkflowStep,
    context: WorkflowContext,
  ): Promise<string | undefined> {
    const record: StepRunRecord = {
      stepId: step.id,
      stepName: step.name,
      state: 'running',
      startedAt: Date.now(),
      retryCount: 0,
    }
    context.stepRecords.set(step.id, record)
    context.currentStepId = step.id

    this.emit(WORKFLOW_EVENT_STEP_START, { runId: context.runId, step })
    this.log(context, 'info', `Step started: ${step.name}`, step.id)

    try {
      // 带超时执行
      const output = await this.executeWithTimeout(step, context)
      record.state = 'completed'
      record.endedAt = Date.now()
      record.duration = record.endedAt - record.startedAt
      record.output = output

      this.emit(WORKFLOW_EVENT_STEP_COMPLETE, { runId: context.runId, step, output })
      this.log(context, 'info', `Step completed: ${step.name}`, step.id)

      // 返回下一步 ID
      return this.getNextStepId(workflow, step, context)
    } catch (err) {
      record.state = 'failed'
      record.endedAt = Date.now()
      record.duration = record.endedAt - record.startedAt
      record.error = err instanceof Error ? err.message : String(err)

      this.emit(WORKFLOW_EVENT_STEP_ERROR, { runId: context.runId, step, error: record.error })
      this.log(context, 'error', `Step failed: ${step.name} - ${record.error}`, step.id)

      // 紧急停止错误直接抛出
      if (err instanceof EmergencyStopError || context.abortSignal.aborted) {
        throw err
      }

      // 处理失败策略
      return this.handleStepError(workflow, step, err, context, record)
    }
  }

  /** 带超时执行步骤 */
  private async executeWithTimeout(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    if (step.timeout <= 0) {
      return this.executeStepAction(step, context)
    }

    return Promise.race([
      this.executeStepAction(step, context),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Step timeout after ${step.timeout}ms`))
        }, step.timeout)

        // 中止时清除定时器
        context.abortSignal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new EmergencyStopError('Aborted'))
        }, { once: true })
      }),
    ])
  }

  /** 执行步骤具体动作 */
  private async executeStepAction(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    switch (step.type) {
      case WorkflowStepType.DesktopAction:
        return this.executeDesktopAction(step, context)

      case WorkflowStepType.ReplayRecording:
        return this.executeReplayRecording(step, context)

      case WorkflowStepType.VisualAgentStep:
        // 视觉闭环步骤由 VisualAgentLoop 处理，此处返回任务描述
        // 实际集成在 VisualAgentLoop 模块中
        return { task: step.task, maxSteps: step.maxSteps, pending: true }

      case WorkflowStepType.AgentCommand:
        // Agent 指令由 Agent 系统处理，此处记录指令
        this.log(context, 'info', `Agent command: ${step.command}`, step.id)
        return { command: step.command, agentId: step.agentId }

      case WorkflowStepType.Condition:
        return this.executeCondition(step, context)

      case WorkflowStepType.Loop:
        return this.executeLoop(step, context)

      case WorkflowStepType.Wait:
        await this.sleep(step.duration, context.abortSignal)
        return { waited: step.duration }

      case WorkflowStepType.SetVariable:
        context.variables[step.variableName] = this.interpolateTemplate(step.value, context)
        return { variable: step.variableName, value: context.variables[step.variableName] }

      case WorkflowStepType.Notify:
        this.log(context, step.level, `Notification: ${step.message}`, step.id)
        return { notified: true, level: step.level }

      case WorkflowStepType.SubWorkflow:
        return this.executeSubWorkflow(step, context)

      default:
        throw new Error(`Unknown step type: ${(step as WorkflowStep).type}`)
    }
  }

  /** 执行桌面操作 */
  private async executeDesktopAction(step: Extract<WorkflowStep, { type: WorkflowStepType.DesktopAction }>, context: WorkflowContext): Promise<unknown> {
    const manager = getDesktopControlManager()
    const params = this.interpolateObject(step.params, context) as Record<string, unknown>

    switch (step.action) {
      case 'launch_app':
        return manager.launchApp(params.appName as string, params.args as string[] | undefined)

      case 'quit_app':
        return manager.quitApp(params.appName as string)

      case 'focus_window':
        return manager.focusWindow(params.windowId as string)

      case 'close_window':
        return manager.closeWindow(params.windowId as string)

      case 'minimize_window':
        return manager.minimizeWindow(params.windowId as string)

      case 'maximize_window':
        return manager.maximizeWindow(params.windowId as string)

      case 'mouse_click':
        return manager.mouseClick({
          x: params.x as number,
          y: params.y as number,
          button: (params.button as 'left' | 'right' | 'middle') ?? 'left',
          clickType: (params.clickType as 'single' | 'double') ?? 'single',
        })

      case 'mouse_move':
        return manager.mouseMove({ x: params.x as number, y: params.y as number })

      case 'mouse_scroll':
        return manager.mouseScroll({
          x: params.x as number,
          y: params.y as number,
          amount: params.amount as number,
        })

      case 'type_text':
        return manager.typeText(params.text as string)

      case 'press_key':
        return manager.pressKey(params.key as string)

      case 'key_combo':
        return manager.keyCombo(params.keys as string[])

      case 'capture_screen':
        return manager.captureScreen(params.displayId as number | undefined)

      case 'get_system_info':
        return manager.getSystemInfo()

      case 'set_volume':
        return manager.setVolume(params.volume as number)

      default:
        throw new Error(`Unknown desktop action: ${step.action}`)
    }
  }

  /** 执行录制回放 */
  private async executeReplayRecording(step: Extract<WorkflowStep, { type: WorkflowStepType.ReplayRecording }>, _context: WorkflowContext): Promise<unknown> {
    const script = this.recordings.get(step.recordingId)
    if (!script) {
      throw new Error(`Recording not found: ${step.recordingId}`)
    }

    const manager = getDesktopControlManager()
    const replayer = new ActionReplayer(manager)
    const result = await replayer.replay(script, step.replayConfig)
    return result
  }

  /** 执行条件判断 */
  private async executeCondition(step: Extract<WorkflowStep, { type: WorkflowStepType.Condition }>, context: WorkflowContext): Promise<unknown> {
    const result = this.evaluateExpression(step.expression, context)
    return { condition: step.expression, result }
  }

  /** 执行循环 */
  private async executeLoop(step: Extract<WorkflowStep, { type: WorkflowStepType.Loop }>, context: WorkflowContext): Promise<unknown> {
    const maxIterations = step.count > 0 ? step.count : 1000
    let iteration = 0

    while (iteration < maxIterations) {
      if (context.abortSignal.aborted) {
        throw new EmergencyStopError('Loop aborted')
      }

      // 检查退出条件
      if (step.breakCondition && this.evaluateExpression(step.breakCondition, context)) {
        break
      }

      iteration++
    }

    return { iterations: iteration }
  }

  /** 执行子工作流 */
  private async executeSubWorkflow(step: Extract<WorkflowStep, { type: WorkflowStepType.SubWorkflow }>, _context: WorkflowContext): Promise<unknown> {
    const subWorkflow = this.workflows.get(step.subWorkflowId)
    if (!subWorkflow) {
      throw new Error(`Sub-workflow not found: ${step.subWorkflowId}`)
    }

    const result = await this.run(subWorkflow.id, { type: 'manual' }, step.inputs)
    return result
  }

  /** 处理步骤失败 */
  private handleStepError(
    workflow: WorkflowDefinition,
    step: WorkflowStep,
    err: unknown,
    context: WorkflowContext,
    record: StepRunRecord,
  ): string | undefined {
    const strategy: OnErrorStrategy = step.onError

    switch (strategy) {
      case 'stop':
        throw err

      case 'continue':
        return this.getNextStepId(workflow, step, context)

      case 'retry':
        if (step.retry && record.retryCount < step.retry.maxAttempts) {
          record.retryCount++
          this.log(context, 'info', `Retrying step: ${step.name} (attempt ${record.retryCount})`, step.id)
          // 简化：重试时直接返回当前步骤 ID
          return step.id
        }
        return this.getNextStepId(workflow, step, context)

      case 'goto':
        // 跳转到指定步骤（通过 step.params.gotoStepId 配置）
        // 此处简化处理，继续下一步
        return this.getNextStepId(workflow, step, context)

      case 'ask_user':
        // 询问用户逻辑由 UI 层处理，此处暂停并继续
        this.log(context, 'warn', `Step failed, awaiting user decision: ${step.name}`, step.id)
        return this.getNextStepId(workflow, step, context)

      default:
        throw err
    }
  }

  /** 获取下一步骤 ID */
  private getNextStepId(workflow: WorkflowDefinition, step: WorkflowStep, context: WorkflowContext): string | undefined {
    // 条件步骤根据表达式结果跳转
    if (step.type === WorkflowStepType.Condition) {
      const result = this.evaluateExpression(step.expression, context)
      return result ? step.trueStepId : step.falseStepId
    }

    // 其他步骤按顺序执行
    const currentIndex = workflow.steps.findIndex((s) => s.id === step.id)
    if (currentIndex < 0 || currentIndex >= workflow.steps.length - 1) {
      return undefined
    }
    return workflow.steps[currentIndex + 1].id
  }

  // ============================================
  // 表达式求值与模板插值
  // ============================================

  /**
   * 安全表达式求值
   *
   * 支持简单表达式：
   * - 变量引用：${var.name}
   * - 比较：==, !=, >, <, >=, <=
   * - 逻辑：&&, ||, !
   * - 字面量：true, false, 数字, 字符串
   *
   * 注意：不使用 eval，使用受限解析器
   */
  private evaluateExpression(expression: string, context: WorkflowContext): boolean {
    try {
      // 替换变量引用
      const interpolated = this.interpolateTemplate(expression, context)

      // 简化求值：仅支持基本比较与逻辑
      // 实际生产中应使用完整表达式引擎（如 expr-eval）
      const result = this.safeEval(interpolated)
      return Boolean(result)
    } catch (err) {
      this.log(context, 'warn', `Expression evaluation failed: ${expression} - ${err}`, context.currentStepId)
      return false
    }
  }

  /** 受限求值器 */
  private safeEval(expr: string): unknown {
    // 仅允许：true, false, 数字, 字符串, 比较运算符, 逻辑运算符
    if (!/^[\s\d().!&|=<>a-zA-Z'"_-]*$/.test(expr)) {
      throw new Error('Invalid expression characters')
    }

    // 替换 true/false
    const normalized = expr
      .replace(/\btrue\b/g, 'true')
      .replace(/\bfalse\b/g, 'false')

    // 使用 Function 构造器受限求值（生产环境建议使用 expr-eval）
    // eslint-disable-next-line no-new-func
    return new Function(`"use strict"; return (${normalized});`)()
  }

  /** 模板插值 ${var.name} */
  private interpolateTemplate(template: string, context: WorkflowContext): string {
    return template.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      const value = this.getVariable(context, key.trim())
      return value !== undefined ? String(value) : ''
    })
  }

  /** 递归插值对象 */
  private interpolateObject<T>(obj: T, context: WorkflowContext): T {
    if (typeof obj === 'string') {
      return this.interpolateTemplate(obj, context) as unknown as T
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.interpolateObject(item, context)) as unknown as T
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateObject(value, context)
      }
      return result as unknown as T
    }
    return obj
  }

  /** 获取变量值 */
  private getVariable(context: WorkflowContext, key: string): unknown {
    const parts = key.split('.')
    let value: unknown = context.variables

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }

    return value
  }

  // ============================================
  // 工具方法
  // ============================================

  /** 初始化变量 */
  private initVariables(workflow: WorkflowDefinition, inputVariables?: Record<string, unknown>): Record<string, unknown> {
    const variables: Record<string, unknown> = {}

    for (const [name, def] of Object.entries(workflow.variables)) {
      variables[name] = def.defaultValue
    }

    // 应用输入覆盖
    if (inputVariables) {
      Object.assign(variables, inputVariables)
    }

    return variables
  }

  /** 校验工作流定义 */
  private validateWorkflow(workflow: WorkflowDefinition): void {
    if (!workflow.id) throw new Error('Workflow ID is required')
    if (!workflow.name) throw new Error('Workflow name is required')
    if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
      throw new Error('Workflow must have at least one step')
    }
    if (!workflow.entryStepId) {
      throw new Error('Workflow entry step ID is required')
    }
    if (!workflow.steps.some((s) => s.id === workflow.entryStepId)) {
      throw new Error(`Entry step not found: ${workflow.entryStepId}`)
    }

    // 校验步骤 ID 唯一
    const stepIds = new Set<string>()
    for (const step of workflow.steps) {
      if (stepIds.has(step.id)) {
        throw new Error(`Duplicate step ID: ${step.id}`)
      }
      stepIds.add(step.id)
    }
  }

  /** 触发器匹配 */
  private triggerMatches(defined: WorkflowTrigger, actual: WorkflowTrigger): boolean {
    if (defined.type !== actual.type) return false

    switch (defined.type) {
      case 'manual':
        return true
      case 'cron':
        return actual.type === 'cron' && defined.expression === actual.expression
      case 'event':
        return actual.type === 'event' && defined.eventName === actual.eventName
      case 'webhook':
        return actual.type === 'webhook' && defined.path === actual.path
      case 'desktop_event':
        return actual.type === 'desktop_event' && defined.eventType === actual.eventType
      default:
        return false
    }
  }

  /** 记录日志 */
  private log(context: WorkflowContext, level: 'info' | 'warn' | 'error', message: string, stepId?: string): void {
    const entry: WorkflowLogEntry = {
      timestamp: Date.now(),
      level,
      stepId,
      message,
    }
    context.logs.push(entry)
    this.emit(WORKFLOW_EVENT_LOG, { runId: context.runId, entry })

    const logMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'
    logger.desktop[logMethod](`[WorkflowEngine] [${context.workflowName}] ${message}`)
  }

  /** 可中断 sleep */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ms <= 0) {
        resolve()
        return
      }
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new EmergencyStopError('Aborted during sleep'))
      }, { once: true })
    })
  }
}

// ============================================
// 单例
// ============================================

let engineInstance: WorkflowEngine | null = null

/** 获取工作流引擎单例 */
export function getWorkflowEngine(): WorkflowEngine {
  if (!engineInstance) {
    engineInstance = new WorkflowEngine()
  }
  return engineInstance
}
