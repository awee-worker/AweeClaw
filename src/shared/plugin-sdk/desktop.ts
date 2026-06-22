/**
 * Plugin SDK - Desktop 插件扩展接口（Phase 5）
 *
 * 定义桌面控制插件的标准接口，支持：
 * 1. 自定义桌面操作注册（扩展原生操作集）
 * 2. 工作流步骤类型注册（扩展 WorkflowEngine）
 * 3. 录制事件类型扩展（支持自定义事件回放）
 * 4. 视觉分析器注册（扩展 VisualAgentLoop）
 * 5. 平台适配器注册（扩展平台支持）
 *
 * @module plugin-sdk/desktop
 */

import type { PluginManifest, PluginRuntime, PluginContext } from './types'
import type { DesktopOperationType } from './types'

// ============================================
// 桌面操作定义
// ============================================

/** 桌面操作参数 Schema */
export interface DesktopActionParamSchema {
  /** 参数名 */
  name: string
  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  /** 描述 */
  description: string
  /** 是否必填 */
  required: boolean
  /** 默认值 */
  defaultValue?: unknown
}

/** 自定义桌面操作定义 */
export interface DesktopActionDefinition {
  /** 操作唯一标识 */
  id: string
  /** 操作名称（显示用） */
  name: string
  /** 中文名称 */
  nameZh: string
  /** 操作描述 */
  description: string
  /** 中文描述 */
  descriptionZh: string
  /** 操作类型 */
  operationType: DesktopOperationType
  /** 参数 Schema */
  parameters: DesktopActionParamSchema[]
  /** 风险等级 */
  riskLevel: 'safe' | 'moderate' | 'dangerous' | 'critical'
  /** 是否需要用户确认 */
  requiresConfirmation: boolean
  /** 预估执行时间（毫秒），0=未知 */
  estimatedDurationMs: number
  /** 是否为只读操作（不改变系统状态） */
  readonly: boolean
  /** 支持的平台 */
  platforms: Array<'darwin' | 'win32' | 'linux'>
  /** 操作图标（lucide 图标名） */
  icon?: string
}

// ============================================
// 桌面操作执行上下文与结果
// ============================================

/** 桌面操作执行上下文 */
export interface DesktopActionContext {
  /** 调用来源 */
  source: 'user' | 'agent' | 'workflow' | 'replay' | 'visual-agent'
  /** 工作流运行 ID（如果在工作流中） */
  workflowRunId?: string
  /** 录制会话 ID（如果在录制中） */
  recordingSessionId?: string
  /** 是否跳过审批 */
  skipApproval?: boolean
  /** 超时时间（毫秒） */
  timeoutMs?: number
  /** 当前平台 */
  platform: 'darwin' | 'win32' | 'linux'
}

/** 桌面操作执行结果 */
export interface DesktopActionResult {
  /** 是否成功 */
  success: boolean
  /** 输出数据 */
  output?: unknown
  /** 错误消息 */
  error?: string
  /** 执行时长（毫秒） */
  duration: number
  /** 是否被审批拒绝 */
  approvalDenied?: boolean
  /** 产生的副作用描述（用于审计日志） */
  sideEffects?: string[]
}

// ============================================
// 工作流步骤扩展
// ============================================

/** 自定义工作流步骤定义 */
export interface CustomWorkflowStepDef {
  /** 步骤类型标识（在插件范围内唯一） */
  typeId: string
  /** 步骤类型名称 */
  name: string
  /** 中文名称 */
  nameZh: string
  /** 描述 */
  description: string
  /** 中文描述 */
  descriptionZh: string
  /** 步骤参数 Schema */
  parameters: DesktopActionParamSchema[]
  /** 步骤图标 */
  icon?: string
  /** 是否为阻塞步骤（执行中不可中止） */
  blocking: boolean
}

/** 自定义工作流步骤执行上下文 */
export interface WorkflowStepContext {
  /** 工作流运行 ID */
  runId: string
  /** 工作流 ID */
  workflowId: string
  /** 当前步骤 ID */
  stepId: string
  /** 工作流变量 */
  variables: Record<string, unknown>
  /** 中止信号 */
  abortSignal: AbortSignal
  /** 日志函数 */
  log: (level: 'info' | 'warn' | 'error', message: string) => void
}

/** 自定义工作流步骤执行结果 */
export interface WorkflowStepResult {
  /** 是否成功 */
  success: boolean
  /** 输出数据（可设置到变量） */
  output?: unknown
  /** 下一步骤 ID（覆盖默认 nextStepId） */
  nextStepId?: string
  /** 错误消息 */
  error?: string
}

// ============================================
// 录制事件扩展
// ============================================

/** 自定义录制事件定义 */
export interface CustomRecordingEventDef {
  /** 事件类型标识 */
  typeId: string
  /** 事件名称 */
  name: string
  /** 中文名称 */
  nameZh: string
  /** 描述 */
  description: string
  /** 事件数据 Schema */
  dataSchema: DesktopActionParamSchema[]
  /** 是否可在回放中执行 */
  replayable: boolean
}

// ============================================
// 视觉分析器扩展
// ============================================

/** 自定义视觉分析器配置 */
export interface VisualAnalyzerConfig {
  /** 分析器标识 */
  id: string
  /** 分析器名称 */
  name: string
  /** 中文名称 */
  nameZh: string
  /** 支持的任务类型 */
  supportedTasks: string[]
  /** 是否需要 API Key */
  requiresApiKey: boolean
}

/** 视觉分析请求 */
export interface VisualAnalysisRequest {
  /** 截图数据（base64） */
  screenshot: string
  /** 任务描述 */
  task: string
  /** 历史步骤 */
  history: Array<{
    step: number
    analysis: string
    action?: string
    result?: string
  }>
  /** 自定义参数 */
  params?: Record<string, unknown>
}

/** 视觉分析响应 */
export interface VisualAnalysisResponse {
  /** 屏幕内容分析 */
  analysis: string
  /** 建议的下一步操作 */
  action?: {
    type: string
    params: Record<string, unknown>
    reasoning: string
    confidence: number
  }
  /** 是否已完成任务 */
  completed: boolean
  /** 完成原因 */
  completionReason?: string
}

// ============================================
// Desktop 插件 Manifest
// ============================================

/** Desktop 插件 Manifest - 在基础 Manifest 上扩展桌面控制特有字段 */
export interface DesktopPluginManifest extends PluginManifest {
  type: 'desktop'
  /** 提供的自定义桌面操作列表 */
  actions?: DesktopActionDefinition[]
  /** 提供的自定义工作流步骤类型 */
  workflowSteps?: CustomWorkflowStepDef[]
  /** 提供的自定义录制事件类型 */
  recordingEvents?: CustomRecordingEventDef[]
  /** 提供的视觉分析器 */
  visualAnalyzers?: VisualAnalyzerConfig[]
}

// ============================================
// Desktop 插件运行时接口
// ============================================

/** Desktop 插件运行时 */
export interface DesktopPluginRuntime extends PluginRuntime {
  /** 插件 Manifest */
  readonly manifest: DesktopPluginManifest

  // ---- 桌面操作执行 ----

  /** 执行桌面操作 */
  executeAction?(
    actionId: string,
    args: Record<string, unknown>,
    context: DesktopActionContext
  ): Promise<DesktopActionResult>

  /** 获取操作定义列表 */
  getActionDefinitions?(): DesktopActionDefinition[]

  /** 验证操作参数 */
  validateActionArgs?(actionId: string, args: Record<string, unknown>): {
    valid: boolean
    errors?: Array<{ param: string; message: string }>
  }

  // ---- 工作流步骤执行 ----

  /** 执行自定义工作流步骤 */
  executeWorkflowStep?(
    typeId: string,
    args: Record<string, unknown>,
    context: WorkflowStepContext
  ): Promise<WorkflowStepResult>

  /** 获取工作流步骤定义列表 */
  getWorkflowStepDefinitions?(): CustomWorkflowStepDef[]

  // ---- 录制事件回放 ----

  /** 回放自定义录制事件 */
  replayRecordingEvent?(
    typeId: string,
    data: Record<string, unknown>,
    context: DesktopActionContext
  ): Promise<DesktopActionResult>

  /** 获取录制事件定义列表 */
  getRecordingEventDefinitions?(): CustomRecordingEventDef[]

  // ---- 视觉分析 ----

  /** 执行视觉分析 */
  analyzeVisual?(
    analyzerId: string,
    request: VisualAnalysisRequest,
    apiKey?: string
  ): Promise<VisualAnalysisResponse>

  /** 获取视觉分析器列表 */
  getVisualAnalyzers?(): VisualAnalyzerConfig[]
}

// ============================================
// Desktop 插件工厂
// ============================================

/** Desktop 插件工厂 */
export interface DesktopPluginFactory {
  /** 创建 Desktop 插件实例 */
  create(context: PluginContext): DesktopPluginRuntime
  /** 获取 Manifest */
  getManifest(): DesktopPluginManifest
}

// ============================================
// Desktop 插件注册表扩展接口
// ============================================

/** Desktop 插件注册表 - 提供桌面控制插件的查询能力 */
export interface IDesktopPluginRegistry {
  /** 获取所有桌面操作定义（来自所有已加载的 desktop 插件） */
  getAllActions(): DesktopActionDefinition[]
  /** 按 ID 获取桌面操作定义 */
  getAction(actionId: string): DesktopActionDefinition | undefined
  /** 执行桌面操作 */
  executeAction(
    actionId: string,
    args: Record<string, unknown>,
    context: DesktopActionContext
  ): Promise<DesktopActionResult>
  /** 获取所有自定义工作流步骤定义 */
  getAllWorkflowSteps(): CustomWorkflowStepDef[]
  /** 按 typeId 获取工作流步骤定义 */
  getWorkflowStep(typeId: string): CustomWorkflowStepDef | undefined
  /** 执行自定义工作流步骤 */
  executeWorkflowStep(
    typeId: string,
    args: Record<string, unknown>,
    context: WorkflowStepContext
  ): Promise<WorkflowStepResult>
  /** 获取所有自定义录制事件定义 */
  getAllRecordingEvents(): CustomRecordingEventDef[]
  /** 回放自定义录制事件 */
  replayRecordingEvent(
    typeId: string,
    data: Record<string, unknown>,
    context: DesktopActionContext
  ): Promise<DesktopActionResult>
  /** 获取所有视觉分析器 */
  getAllVisualAnalyzers(): VisualAnalyzerConfig[]
  /** 执行视觉分析 */
  analyzeVisual(
    analyzerId: string,
    request: VisualAnalysisRequest,
    apiKey?: string
  ): Promise<VisualAnalysisResponse>
}
