/**
 * 外部智能体适配器 — 主进程侧类型
 *
 * 每个外部智能体（Claude Code / Codex / Cursor）实现 ExternalAgentAdapter，
 * 由 ExternalAgentService 统一编排：preflight 检测 → spawn 子进程 → 解析输出 →
 * 推流事件 → 超时看门狗 → 结果收集。
 */

import type {
  ExternalAgentId,
  ExternalAgentRunRequest,
  ExternalAgentRunResult,
  AgentStreamEvent,
  AgentPreflightResult,
  AgentPermissionMode,
  ExternalAgentConfig,
} from '@shared/externalAgents'

/** 运行上下文（Service 传给 Adapter 的已解析参数） */
export interface AgentRunContext {
  request: ExternalAgentRunRequest
  /** 最终选定的命令与参数（由 Adapter.buildCommand 生成） */
  command: string
  args: string[]
  /** 注入子进程的环境变量（PATH 增强 + API Key） */
  env: Record<string, string>
  config: ExternalAgentConfig
  permissionMode: AgentPermissionMode
}

/** 运行中间状态（Adapter 解析 stdout 时维护） */
export interface AgentRunState {
  /** 捕获到的会话 ID（Claude Code stream-json system 事件） */
  sessionId?: string
  /** 收集的关键输出（result 事件文本 / codex 最终回复） */
  capturedOutput: string[]
  /** 工具调用记录（用于结果摘要） */
  toolCalls: string[]
  /** 最后的状态事件 */
  lastStage: 'spawning' | 'thinking' | 'tool_call' | 'writing' | 'running_test' | 'done'
}

/** 外部智能体适配器接口 */
export interface ExternalAgentAdapter {
  readonly id: ExternalAgentId

  /** 可用性 + 版本检测（快速，不启动长任务） */
  preflight(config: ExternalAgentConfig): Promise<AgentPreflightResult>

  /**
   * 构建 CLI 命令与参数
   * @returns null 表示当前环境无法运行（调用方应返回友好错误）
   */
  buildCommand(task: string, options: {
    workdir: string
    permissionMode: AgentPermissionMode
    resumeSession?: string
  }, config: ExternalAgentConfig): { command: string; args: string[]; env: Record<string, string> } | null

  /** 解析一行 stdout，映射为流式事件（可产出 0..n 个事件） */
  parseLine(line: string, state: AgentRunState): AgentStreamEvent[]

  /** 进程退出：判定成败并生成最终结果 */
  finalize(state: AgentRunState, exitCode: number, stderrTail: string): ExternalAgentRunResult
}
