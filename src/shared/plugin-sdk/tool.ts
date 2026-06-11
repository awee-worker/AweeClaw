/**
 * Plugin SDK - Tool 插件扩展接口
 *
 * 定义工具插件的标准接口，支持：
 * 1. 工具注册与发现
 * 2. 工具参数 Schema（用于 AI 模型调用和 UI 渲染）
 * 3. 工具执行（含审批和沙箱集成）
 * 4. 工具能力声明
 *
 * @module plugin-sdk/tool
 */

import type { PluginManifest, PluginRuntime, PluginContext } from './types'

// ============================================
// Tool 参数 Schema
// ============================================

/** 工具参数类型 */
export type ToolParamType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'enum'

/** 工具参数定义 */
export interface ToolParamSchema {
  /** 参数名 */
  name: string
  /** 参数类型 */
  type: ToolParamType
  /** 参数描述 */
  description: string
  /** 中文描述 */
  descriptionZh?: string
  /** 是否必填 */
  required: boolean
  /** 默认值 */
  defaultValue?: unknown
  /** enum 类型的选项 */
  enumValues?: string[]
  /** 对象类型的属性定义 */
  properties?: Record<string, ToolParamSchema>
  /** 数组元素类型 */
  items?: ToolParamSchema
}

// ============================================
// Tool 定义
// ============================================

/** 工具风险等级 */
export type ToolRiskLevel = 'safe' | 'moderate' | 'dangerous' | 'critical'

/** 工具并发模式 */
export type ToolConcurrency = 'parallel-safe' | 'serialized' | 'approval-gated'

/** 工具定义 - 描述一个可被 AI 调用的工具 */
export interface ToolDefinition {
  /** 工具唯一标识（在插件范围内唯一） */
  id: string
  /** 工具名称（显示用） */
  name: string
  /** 中文名称 */
  nameZh: string
  /** 工具描述（AI 可读） */
  description: string
  /** 中文描述 */
  descriptionZh: string
  /** 参数 Schema */
  parameters: ToolParamSchema[]
  /** 风险等级 */
  riskLevel: ToolRiskLevel
  /** 并发模式 */
  concurrency: ToolConcurrency
  /** 是否需要沙箱执行 */
  sandboxed: boolean
  /** 是否需要审批 */
  requiresApproval: boolean
  /** 工具分类 */
  category: ToolCategory
  /** 工具图标（lucide 图标名） */
  icon?: string
  /** 是否为只读工具 */
  readonly: boolean
  /** 预估执行时间（毫秒），0=未知 */
  estimatedDurationMs: number
}

/** 工具分类 */
export type ToolCategory =
  | 'filesystem'      // 文件系统操作
  | 'shell'           // Shell 命令执行
  | 'search'          // 搜索
  | 'code'            // 代码操作
  | 'network'         // 网络请求
  | 'database'        // 数据库操作
  | 'ai'              // AI 相关
  | 'communication'   // 通信（发消息等）
  | 'automation'      // 自动化
  | 'utility'         // 通用工具
  | 'custom'          // 自定义

// ============================================
// Tool 执行结果
// ============================================

/** 工具执行结果 */
export interface ToolExecutionResult {
  /** 是否成功 */
  success: boolean
  /** 输出数据 */
  output: unknown
  /** 错误消息 */
  error?: string
  /** 执行时长（毫秒） */
  duration: number
  /** 是否被审批拒绝 */
  approvalDenied?: boolean
  /** 是否在沙箱中执行 */
  sandboxed: boolean
}

// ============================================
// Tool 插件 Manifest 扩展
// ============================================

/** Tool 插件 Manifest - 在基础 Manifest 上扩展工具特有字段 */
export interface ToolPluginManifest extends PluginManifest {
  type: 'tool'
  /** 提供的工具列表 */
  tools: ToolDefinition[]
  /** 工具分类标签 */
  category?: ToolCategory
}

// ============================================
// Tool 插件运行时接口
// ============================================

/** Tool 插件运行时 */
export interface ToolPluginRuntime extends PluginRuntime {
  /** 插件 Manifest */
  readonly manifest: ToolPluginManifest
  /** 执行工具 */
  execute(
    toolId: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>
  /** 获取工具定义列表 */
  getToolDefinitions(): ToolDefinition[]
  /** 验证工具参数 */
  validateArgs?(toolId: string, args: Record<string, unknown>): ToolValidationResult
}

/** 工具执行上下文 */
export interface ToolExecutionContext {
  /** 调用者 Agent ID */
  agentId: string
  /** 工作目录 */
  cwd: string
  /** 会话 ID */
  sessionId: string
  /** 是否跳过审批（内部调用时） */
  skipApproval?: boolean
  /** 是否跳过沙箱（内部调用时） */
  skipSandbox?: boolean
  /** 超时时间（毫秒） */
  timeoutMs?: number
}

/** 参数验证结果 */
export interface ToolValidationResult {
  valid: boolean
  errors?: Array<{
    param: string
    message: string
  }>
}

// ============================================
// Tool 插件工厂
// ============================================

/** Tool 插件工厂 */
export interface ToolPluginFactory {
  /** 创建 Tool 插件实例 */
  create(context: PluginContext): ToolPluginRuntime
  /** 获取 Manifest */
  getManifest(): ToolPluginManifest
}
