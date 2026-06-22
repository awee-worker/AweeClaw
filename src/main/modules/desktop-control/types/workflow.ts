/**
 * 工作流引擎类型定义（L5 智能工作流层）
 *
 * 定义工作流步骤、触发器、执行上下文等数据结构
 *
 * @module desktop-control/types/workflow
 */

// ============================================
// 工作流步骤
// ============================================

/** 步骤类型 */
export enum WorkflowStepType {
  /** 桌面操作（调用 DesktopControlManager API） */
  DesktopAction = 'desktop_action',
  /** 执行录制脚本 */
  ReplayRecording = 'replay_recording',
  /** 视觉闭环单步 */
  VisualAgentStep = 'visual_agent_step',
  /** 执行 Agent 指令 */
  AgentCommand = 'agent_command',
  /** 条件判断 */
  Condition = 'condition',
  /** 循环 */
  Loop = 'loop',
  /** 等待 */
  Wait = 'wait',
  /** 设置变量 */
  SetVariable = 'set_variable',
  /** 发送通知 */
  Notify = 'notify',
  /** 子工作流调用 */
  SubWorkflow = 'sub_workflow',
}

/** 桌面操作动作类型 */
export type DesktopActionType =
  | 'launch_app'
  | 'quit_app'
  | 'focus_window'
  | 'close_window'
  | 'minimize_window'
  | 'maximize_window'
  | 'mouse_click'
  | 'mouse_move'
  | 'mouse_scroll'
  | 'type_text'
  | 'press_key'
  | 'key_combo'
  | 'capture_screen'
  | 'get_system_info'
  | 'set_volume'

/** 工作流步骤基础结构 */
export interface WorkflowStepBase {
  /** 步骤 ID（工作流内唯一） */
  id: string
  /** 步骤类型 */
  type: WorkflowStepType
  /** 显示名称 */
  name: string
  /** 描述 */
  description?: string
  /** 是否启用 */
  enabled: boolean
  /** 超时（ms），0 表示不限制 */
  timeout: number
  /** 失败时的处理策略 */
  onError: OnErrorStrategy
  /** 重试配置 */
  retry?: RetryConfig
}

/** 失败处理策略 */
export type OnErrorStrategy =
  | 'stop' // 停止整个工作流
  | 'continue' // 继续下一步
  | 'retry' // 重试当前步骤
  | 'goto' // 跳转到指定步骤
  | 'ask_user' // 询问用户

/** 重试配置 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxAttempts: number
  /** 重试间隔（ms） */
  interval: number
  /** 指数退避倍率 */
  backoffMultiplier: number
}

/** 桌面操作步骤 */
export interface DesktopActionStep extends WorkflowStepBase {
  type: WorkflowStepType.DesktopAction
  action: DesktopActionType
  /** 动作参数（JSON） */
  params: Record<string, unknown>
}

/** 回放录制步骤 */
export interface ReplayRecordingStep extends WorkflowStepBase {
  type: WorkflowStepType.ReplayRecording
  /** 录制脚本 ID */
  recordingId: string
  /** 回放配置 */
  replayConfig?: {
    speed?: 'realtime' | 'fast' | 'instant' | 'custom'
    speedMultiplier?: number
    stopOnError?: boolean
  }
}

/** 视觉闭环步骤 */
export interface VisualAgentStepConfig extends WorkflowStepBase {
  type: WorkflowStepType.VisualAgentStep
  /** 任务描述 */
  task: string
  /** 最大循环次数 */
  maxSteps: number
  /** 使用视觉模型 */
  visionModel?: string
}

/** Agent 指令步骤 */
export interface AgentCommandStep extends WorkflowStepBase {
  type: WorkflowStepType.AgentCommand
  /** 自然语言指令 */
  command: string
  /** Agent ID */
  agentId?: string
}

/** 条件步骤 */
export interface ConditionStep extends WorkflowStepBase {
  type: WorkflowStepType.Condition
  /** 条件表达式 */
  expression: string
  /** 满足时跳转的步骤 ID */
  trueStepId?: string
  /** 不满足时跳转的步骤 ID */
  falseStepId?: string
}

/** 循环步骤 */
export interface LoopStep extends WorkflowStepBase {
  type: WorkflowStepType.Loop
  /** 循环次数（0 = 无限，需配合 break 条件） */
  count: number
  /** 循环体步骤 IDs */
  bodyStepIds: string[]
  /** 退出条件表达式 */
  breakCondition?: string
}

/** 等待步骤 */
export interface WaitStep extends WorkflowStepBase {
  type: WorkflowStepType.Wait
  /** 等待时长（ms） */
  duration: number
}

/** 设置变量步骤 */
export interface SetVariableStep extends WorkflowStepBase {
  type: WorkflowStepType.SetVariable
  /** 变量名 */
  variableName: string
  /** 变量值（支持模板插值） */
  value: string
}

/** 通知步骤 */
export interface NotifyStep extends WorkflowStepBase {
  type: WorkflowStepType.Notify
  /** 通知消息 */
  message: string
  /** 通知级别 */
  level: 'info' | 'warn' | 'error'
  /** 通知渠道 */
  channels?: ('system' | 'webhook' | 'email')[]
}

/** 子工作流步骤 */
export interface SubWorkflowStep extends WorkflowStepBase {
  type: WorkflowStepType.SubWorkflow
  /** 子工作流 ID */
  subWorkflowId: string
  /** 传入子工作流的变量 */
  inputs?: Record<string, unknown>
}

/** 工作流步骤联合类型 */
export type WorkflowStep =
  | DesktopActionStep
  | ReplayRecordingStep
  | VisualAgentStepConfig
  | AgentCommandStep
  | ConditionStep
  | LoopStep
  | WaitStep
  | SetVariableStep
  | NotifyStep
  | SubWorkflowStep

// ============================================
// 工作流定义
// ============================================

/** 触发类型 */
export type WorkflowTrigger =
  | { type: 'manual' }
  | { type: 'cron'; expression: string }
  | { type: 'event'; eventName: string }
  | { type: 'webhook'; path: string }
  | { type: 'desktop_event'; eventType: string }

/** 工作流定义 */
export interface WorkflowDefinition {
  /** 工作流 ID */
  id: string
  /** 名称 */
  name: string
  /** 描述 */
  description: string
  /** 版本 */
  version: string
  /** 触发器 */
  triggers: WorkflowTrigger[]
  /** 步骤列表（按顺序执行，条件/循环可跳转） */
  steps: WorkflowStep[]
  /** 入口步骤 ID */
  entryStepId: string
  /** 变量定义 */
  variables: Record<string, WorkflowVariableDef>
  /** 超时（ms），0 表示不限制 */
  timeout: number
  /** 标签 */
  tags: string[]
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
  /** 是否启用 */
  enabled: boolean
}

/** 变量定义 */
export interface WorkflowVariableDef {
  type: 'string' | 'number' | 'boolean' | 'object'
  defaultValue: unknown
  description?: string
}

// ============================================
// 执行上下文与结果
// ============================================

/** 工作流执行状态 */
export type WorkflowRunState = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted'

/** 步骤执行状态 */
export type StepRunState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** 步骤执行记录 */
export interface StepRunRecord {
  /** 步骤 ID */
  stepId: string
  /** 步骤名称 */
  stepName: string
  /** 状态 */
  state: StepRunState
  /** 开始时间 */
  startedAt: number
  /** 结束时间 */
  endedAt?: number
  /** 耗时（ms） */
  duration?: number
  /** 输出结果 */
  output?: unknown
  /** 错误信息 */
  error?: string
  /** 重试次数 */
  retryCount: number
}

/** 工作流执行上下文 */
export interface WorkflowContext {
  /** 运行 ID */
  runId: string
  /** 工作流 ID */
  workflowId: string
  /** 工作流名称 */
  workflowName: string
  /** 触发来源 */
  trigger: WorkflowTrigger
  /** 变量值 */
  variables: Record<string, unknown>
  /** 步骤执行记录 */
  stepRecords: Map<string, StepRunRecord>
  /** 当前步骤 ID */
  currentStepId?: string
  /** 开始时间 */
  startedAt: number
  /** AbortSignal */
  abortSignal: AbortSignal
  /** 日志 */
  logs: WorkflowLogEntry[]
}

/** 工作流日志条目 */
export interface WorkflowLogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  stepId?: string
  message: string
  data?: unknown
}

/** 工作流执行结果 */
export interface WorkflowResult {
  runId: string
  workflowId: string
  state: WorkflowRunState
  startedAt: number
  endedAt: number
  duration: number
  stepRecords: StepRunRecord[]
  variables: Record<string, unknown>
  error?: string
  logs: WorkflowLogEntry[]
}
