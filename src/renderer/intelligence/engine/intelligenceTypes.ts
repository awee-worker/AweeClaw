/**
 * Agent 核心类型定义
 */

import type { WorkMode } from '@/renderer/modes/workModeTypes'
import type { ToolCall, TokenUsage } from '@intelligence/providerTypes'
import type { LLMConfig as SharedLLMConfig } from '@shared/protocols/modelGateway'
import type { LLMStreamSource } from '@shared/protocols/modelGateway'

// ===== LLM 配置（扩展 shared 定义，添加 contextLimit） =====

export interface LLMConfig extends SharedLLMConfig {
  /** 模型上下文限制（用于压缩判断） */
  contextLimit?: number
}

// ===== 执行上下文 =====

export interface ExecutionContext {
  workspacePath: string | null
  chatMode: WorkMode
  planPhase?: 'planning' | 'executing'
  /**
   * 任务计划模式（输入区专家弹窗的会话级开关）
   *
   * 为真时本轮按 planning 处理：工具集收窄为计划 + 只读探索工具，
   * 模型必须先 create_task_plan 才能推进任务。
   */
  taskPlanMode?: boolean
  abortSignal?: AbortSignal
  /** 绑定的线程 ID（用于后台任务隔离） */
  threadId?: string | null
  requestId?: string
  planTaskId?: string
  checkpointId?: string
  /** 是否来自外部渠道消息（飞书/微信/WhatsApp等），渠道消息不应暴露客户端内部状态 */
  isChannel?: boolean
  /**
   * 本轮入场时命中的专家角色 id（用户指定或规则匹配）
   *
   * 执行期切换专家时需要知道「当前是谁在干」，避免切到同一个角色，
   * 也用于把切换结果记进日志。
   */
  activeRoleId?: string | null
  /** 本轮是否允许执行期切换专家（用户显式锁定时为 false） */
  executionRoleSwitchAllowed?: boolean
  /**
   * 任务步数预算（工具调用轮次）
   *
   * 用于中途自查（50% / 75%）与最后一轮收窄工具。不传时用默认值 60；
   * 与 MAX_LOOP_ITERATIONS（200，纯安全兜底）职责不同。
   */
  stepBudget?: number
}

// ===== 工具执行上下文（重新导出 shared 定义） =====

export type { ToolExecutionContext } from '@intelligence/providerTypes'

// ===== LLM 调用结果 =====

export interface LLMCallResult {
  content?: string
  reasoning?: string
  toolCalls?: ToolCall[]
  sources?: LLMStreamSource[]
  usage?: TokenUsage
  error?: string
  retryable?: boolean
  errorCode?: string
  errorSuggestion?: string
  /** 流结束原因（stop / length / tool-calls ...）。length 表示被输出上限截断 */
  finishReason?: string
}

// ===== 循环检测结果 =====

export interface LoopCheckResult {
  isLoop: boolean
  reason?: string
  suggestion?: string
  warning?: string
  details?: {
    category: 'exact_repeat' | 'same_tool_warning' | 'same_target_warning' | 'content_cycle' | 'pattern_loop' | 'semantic_loop'
    toolName?: string
    count?: number
    threshold?: number
    target?: string | null
    pattern?: string
    severity?: 'low' | 'medium' | 'high'
  }
}

// ===== 压缩统计（从 CompressionManager 导出） =====

export type { CompressionStats } from '../capabilities/context/ContextCompressor'
export type { CompressionLevel } from '../capabilities/context/compressionUtils'

// ===== 工具执行结果（Agent 内部使用，包含 toolCall 信息） =====

export interface AgentToolExecutionResult {
  toolCall: ToolCall
  result: {
    /** 给模型的通道：进上下文的内容 */
    content: string
    meta?: Record<string, unknown>
    richContent?: import('@protocols').ToolRichContent[]
    /** 工具调用是否失败（区别于业务结果失败）；未设置时由 content 前缀推断 */
    callFailed?: boolean
    /**
     * 只进运行记录的通道：截屏帧、内部编号映射等
     *
     * 打包进模型消息前必须剔除（否则帧会进上下文，token 直接爆）。
     */
    record?: Record<string, unknown>
    /** 给守卫的通道：动作前后界面是否变化；无法核实时为 null */
    changed?: boolean | null
    /** 界面元素全量列表；发给模型时只发与上次的差异 */
    screenElements?: unknown[]
    /** 结构化终止语义（B3）；未迁移的工具仍靠 callFailed + 业务码 */
    outcome?: import('@shared/protocols/toolOutcomeProtocol').ToolOutcome
  }
}

// ===== 重新导出 =====

export type { ToolCall, TokenUsage }
