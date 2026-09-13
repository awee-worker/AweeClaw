/**
 * 外部智能体（External Agent）共享类型与定义
 *
 * 设计说明：
 * - Claude Code / Codex / Cursor 是「自主编码智能体」，不是 LLM 服务商，
 *   因此不走 BUILTIN_PROVIDERS，而是作为工具类别（external_agent_*）暴露给 LLM。
 * - 本文件是主进程（ExternalAgentService）与渲染进程（工具执行器 / 设置面板）
 *   共用的单一数据源。
 */

// ============================================
// Agent 标识
// ============================================

/** 支持的外部智能体 ID */
export type ExternalAgentId = 'claude-code' | 'codex' | 'cursor'

/** 全部外部智能体 ID */
export const EXTERNAL_AGENT_IDS: readonly ExternalAgentId[] = ['claude-code', 'codex', 'cursor']

/** 权限模式（适配各 Agent 的非交互权限控制） */
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'planOnly' | 'bypass'

/** 运行时状态 */
export type AgentRunStatus = 'running' | 'done' | 'error' | 'aborted'

// ============================================
// Agent 元信息（设置面板 / 工具描述用）
// ============================================

export interface ExternalAgentDef {
  id: ExternalAgentId
  /** 显示名称 */
  displayName: string
  /** 用途简述 */
  description: string
  /** 检测用可执行文件（按序尝试） */
  binaryNames: string[]
  /** API Key 环境变量名（密钥可通过设置面板配置，写入该环境变量） */
  keyEnvVar: string
  /** 安装指引（渲染在设置面板） */
  installHint: string
  /** 是否支持 headless / 非交互运行（P1 仅 true 的 Agent 可被工具调用） */
  headless: boolean
}

export const EXTERNAL_AGENT_DEFS: Record<ExternalAgentId, ExternalAgentDef> = {
  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code',
    description: 'Anthropic 官方编码智能体 CLI，支持非交互 stream-json 协议，集成等级最高',
    binaryNames: ['claude'],
    keyEnvVar: 'ANTHROPIC_API_KEY',
    installHint: 'npm install -g @anthropic-ai/claude-code，或通过 npx @anthropic-ai/claude-code 临时使用',
    headless: true,
  },
  codex: {
    id: 'codex',
    displayName: 'Codex CLI',
    description: 'OpenAI Codex 编码智能体 CLI，codex exec 非交互模式运行',
    binaryNames: ['codex'],
    keyEnvVar: 'OPENAI_API_KEY',
    installHint: 'npm install -g @openai/codex',
    headless: true,
  },
  cursor: {
    id: 'cursor',
    displayName: 'Cursor Agent',
    description: 'Cursor 官方 headless 编码智能体 CLI（agent -p 非交互 + stream-json 协议）',
    binaryNames: ['agent', 'cursor-agent'],
    keyEnvVar: 'CURSOR_API_KEY',
    installHint:
      'macOS/Linux：curl https://cursor.com/install -fsS | bash；Windows：irm \'https://cursor.com/install?win32=true\' | iex。'
      + 'CLI 安装在 ~/.local/bin（命令名 agent，可能不在 PATH 中，检测不到请手动加入 PATH）；需 Cursor 订阅或 CURSOR_API_KEY',
    headless: true,
  },
}

// ============================================
// 运行请求 / 结果
// ============================================

/** 外部智能体运行请求（主进程侧） */
export interface ExternalAgentRunRequest {
  /** 会话 ID（handler 侧预生成，保证推流频道可预测；缺省由服务生成） */
  requestId?: string
  agent: ExternalAgentId
  /** 自然语言任务描述 */
  task: string
  /** 受控工作目录（必须在用户工作区内） */
  workdir: string
  /** 权限模式（缺省由各 Agent 默认值决定） */
  permissionMode?: AgentPermissionMode
  /** 会话 ID（断点续接） */
  resumeSession?: string
  /** 超时毫秒数（缺省 30 分钟） */
  maxDurationMs?: number
}

/** 外部智能体运行结果 */
export interface ExternalAgentRunResult {
  success: boolean
  agent: ExternalAgentId
  status: AgentRunStatus
  /** 最终输出 / 结果摘要 */
  output: string
  /** 会话 ID（用于断点续接） */
  session?: string
  error?: string
}

/** 最近运行记录（主进程持久化，供「继续上次任务」UI 使用） */
export interface RecentAgentRun {
  requestId: string
  agent: ExternalAgentId
  task: string
  workdir: string
  /** 会话 ID（续接用；Agent 未产出 session 时为空） */
  session?: string
  status: 'done' | 'error' | 'aborted'
  success: boolean
  finishedAt: number
  /** 耗时（毫秒） */
  durationMs?: number
}

// ============================================
// 流式进度事件（主进程 → 渲染进程推送）
// ============================================

export type AgentStreamEvent =
  | { type: 'status'; stage: 'spawning' | 'thinking' | 'tool_call' | 'writing' | 'running_test' | 'done' }
  | { type: 'text'; content: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; result: ExternalAgentRunResult }

/** 流式事件推送载荷（含请求归属） */
export interface AgentStreamPayload {
  requestId: string
  event: AgentStreamEvent
}

// ============================================
// 可用性检测
// ============================================

export interface AgentPreflightResult {
  agent: ExternalAgentId
  available: boolean
  /** 检测到的可执行文件路径 */
  binaryPath?: string
  version?: string
  /** 不可用原因（缺失 / 未安装 / 不支持 headless） */
  reason?: string
  headlessSupported: boolean
}

// ============================================
// 配置（electron-store 持久化）
// ============================================

export interface ExternalAgentConfig {
  /** 是否向 LLM 暴露 external_agent_* 工具（缺省关闭） */
  toolsExposed: boolean
  /** 各 Agent 启用开关（启用才允许被调用） */
  enabled: Record<ExternalAgentId, boolean>
  /** 各 Agent API Key（主进程 safeStorage 加密后存 electron-store，getConfig 返回明文，注入子进程环境变量） */
  apiKeys: Partial<Record<ExternalAgentId, string>>
  /** 默认权限模式 */
  defaultPermissionMode?: AgentPermissionMode
  /** 默认超时毫秒（缺省 30 分钟） */
  defaultTimeoutMs?: number
}

export const DEFAULT_EXTERNAL_AGENT_CONFIG: ExternalAgentConfig = {
  toolsExposed: false,
  enabled: { 'claude-code': false, codex: false, cursor: false },
  apiKeys: {},
  defaultPermissionMode: 'acceptEdits',
  defaultTimeoutMs: 30 * 60 * 1000,
}
