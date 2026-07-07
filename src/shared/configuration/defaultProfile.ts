/**
 * 全局默认配置值 - 单一真相来源 (Single Source of Truth)
 * 
 * 架构说明：
 * - 此文件包含所有可配置参数的默认值
 * - 主进程和渲染进程都可以安全导入
 * - 只包含纯数据，不包含任何副作用或 IO 操作
 * - 其他配置文件应从此处导入默认值，而非重复定义
 */

// ============================================
// LLM 配置默认值
// ============================================

export const LLM_DEFAULTS = {
  temperature: 0.7,
  topP: 1,
  maxTokens: 8192,
  timeout: 120000,
  frequencyPenalty: 0,
  presencePenalty: 0,
  defaultProvider: 'openai',
  defaultModel: 'gpt-4o',
  topK: 0,
  seed: undefined,
  // AI SDK 高级参数默认值
  maxRetries: 2,  // AI SDK 默认是 2 次重试
  toolChoice: 'auto' as const,  // 默认自动选择工具
  parallelToolCalls: true,  // OpenAI 默认允许并行工具调用
  headers: undefined,  // 默认无自定义请求头
  logitBias: undefined,  // 默认无 logit bias
  stopSequences: undefined,  // 默认无停止序列
} as const

// ============================================
// AI 补全配置默认值
// ============================================

export const AI_COMPLETION_DEFAULTS = {
  enabled: true,
  maxTokens: 256,
  temperature: 0.1,
  triggerChars: ['.', '(', '{', '[', '"', "'", '/', ' '],
} as const

// ============================================
// LSP 配置默认值
// ============================================

export const LSP_DEFAULTS = {
  timeoutMs: 30000,
  completionTimeoutMs: 2000,
  crashCooldownMs: 5000,
} as const

// ============================================
// 终端配置默认值
// ============================================

export const TERMINAL_DEFAULTS = {
  fontSize: 13,
  fontFamily: "'Menlo', 'Monaco', 'Consolas', 'Courier New', '宋体', 'SimSun', '黑体', 'Microsoft YaHei', monospace",
  lineHeight: 1.2,
  cursorBlink: true,
  scrollback: 1000,
  maxOutputLines: 1000,
} as const

// ============================================
// 编辑器配置默认值
// ============================================

export const EDITOR_DEFAULTS = {
  fontSize: 13,
  chatFontSize: 15,
  fontFamily: "'Menlo', 'Monaco', 'Consolas', 'Courier New', '宋体', 'SimSun', '黑体', 'Microsoft YaHei', monospace",
  tabSize: 2,
  wordWrap: 'on' as const,
  lineHeight: 1.5,
  minimap: true,
  minimapScale: 1,
  lineNumbers: 'on' as const,
  bracketPairColorization: true,
  enableInlineDiff: true,
  formatOnSave: false,
  autoSave: 'off' as const,
  autoSaveDelay: 1000,
} as const

// ============================================
// Git 配置默认值
// ============================================

export const GIT_DEFAULTS = {
  autoRefresh: true,
} as const

// ============================================
// 性能配置默认值
// ============================================

export const PERFORMANCE_DEFAULTS = {
  // 文件扫描
  maxProjectFiles: 500,
  maxFileTreeDepth: 5,

  // 防抖延迟 (ms)
  fileChangeDebounceMs: 300,
  completionDebounceMs: 300,
  searchDebounceMs: 200,
  saveDebounceMs: 2000,

  // 刷新间隔 (ms)
  indexStatusIntervalMs: 10000,
  fileWatchIntervalMs: 5000,
  flushIntervalMs: 5000,

  // 超时 (ms)
  requestTimeoutMs: 120000,
  commandTimeoutMs: 30000,
  workerTimeoutMs: 30000,
  healthCheckTimeoutMs: 10000,

  // 缓冲区大小
  terminalBufferSize: 500,
  maxResultLength: 2000,

  // 文件大小限制
  largeFileWarningThresholdMB: 5,
  largeFileLineCount: 10000,
  veryLargeFileLineCount: 50000,

  // 搜索限制
  maxSearchResults: 1000,
} as const

// ============================================
// Agent 运行时配置默认值
// ============================================

export const AGENT_DEFAULTS = {
  // 循环控制
  maxToolLoops: 150,
  maxHistoryMessages: 60,

  // 上下文限制
  maxToolResultChars: 10000,
  maxFileContentChars: 15000,
  maxTotalContextChars: 60000,
  maxContextTokens: 128000,
  maxSingleFileChars: 12000,
  maxContextFiles: 6,
  maxSemanticResults: 5,
  maxTerminalChars: 3000,

  // 重试配置
  maxRetries: 3,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 1.5,

  // 工具执行
  toolTimeoutMs: 60000,
  enableAutoFix: true,
  expandThinkingByDefault: true,
  expandToolCallsByDefault: false,
  expandContextByDefault: true,

  // 上下文压缩
  keepRecentTurns: 5,
  deepCompressionTurns: 2,
  maxImportantOldTurns: 3,
  enableLLMSummary: true,
  autoHandoff: true,

  // 摘要生成配置
  summaryMaxContextChars: {
    quick: 8000,      // 快速摘要：8k 字符
    detailed: 12000,  // 详细摘要：12k 字符
    handoff: 16000,   // Handoff 摘要：16k 字符（需要更多上下文）
  },

  // Prune 配置（工具结果清理）
  pruneMinimumTokens: 20000,      // 开始 prune 的最小 token 阈值
  pruneProtectTokens: 40000,      // 保护最近多少 token 的工具调用不被 prune

  // 循环检测
  loopDetection: {
    enabled: true,             // 是否启用循环检测
    maxHistory: 50,            // 历史记录保留数量
    maxExactRepeats: 5,        // 相同参数的精确重复阈值
    maxSameTargetRepeats: 8,   // 同一文件的连续编辑阈值
    patternRepeatHardStop: 3,  // 模式重复硬停止阈值
    dynamicThreshold: true,    // 根据任务复杂度动态调整阈值
  },

  // 动态并发控制
  dynamicConcurrency: {
    enabled: true,
    minConcurrency: 4,
    maxConcurrency: 16,
    cpuMultiplier: 2,
  },

  // 目录排除列表
  ignoredDirectories: [
    'node_modules', '.git', 'dist', 'build', '.next',
    '__pycache__', '.venv', 'venv', '.cache', 'coverage',
    '.nyc_output', 'tmp', 'temp', '.idea', '.vscode',
  ],

  // 多 Agent 协作配置
  multiAgent: {
    enabled: true,
    mode: 'auto',
    threshold: 50,
    requireConsensus: true,
    maxAgents: 5,
  },

  // 自定义 Agent 角色
  customAgentProfiles: [],
} as const

// ============================================
// 自动审批默认值
// ============================================

export const AUTO_APPROVE_DEFAULTS = {
  terminal: false,
  dangerous: false,
} as const


// ============================================
// 安全设置默认值
// ============================================

export const SECURITY_SETTINGS_DEFAULTS = {
  enablePermissionConfirm: true,
  strictWorkspaceMode: true,
  allowedShellCommands: [
    'npm', 'yarn', 'pnpm', 'bun',
    'node', 'npx', 'deno',
    'powershell', 'pwsh', 'bash', 'sh',
    'eslint', 'tsc',
    'git',
    'python', 'python3', 'py', 'pip', 'pip3',
    'java', 'javac', 'mvn', 'gradle',
    'go', 'rust', 'cargo',
    'make', 'gcc', 'clang', 'cmake',
    'pwd', 'ls', 'dir', 'cat', 'type', 'echo', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'cd',
  ],
  allowedGitSubcommands: [
    'status', 'log', 'diff', 'show', 'ls-files', 'rev-parse', 'rev-list', 'blame',
    'add', 'commit', 'reset', 'restore',
    'push', 'pull', 'fetch', 'remote',
    'branch', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick',
    'clone', 'init', 'stash', 'tag', 'config',
  ],
  showSecurityWarnings: true,
} as const

export const PRIVACY_SETTINGS_DEFAULTS: PrivacySettings = {
  knowledgeSyncMode: 'local-only',
  enableLocalGraphExtraction: true,
  enableServerSync: false,
  enableE2EE: false,
  e2eePublicKey: '',
  e2eeEncryptedPrivateKey: '',
  autoSyncIntervalMs: 300000,
  enableOfflineMode: true,
  dataRetentionDays: 0,
}

export interface PrivacySettings {
  knowledgeSyncMode: 'local-only' | 'sync-with-encryption' | 'sync-plain'
  enableLocalGraphExtraction: boolean
  enableServerSync: boolean
  enableE2EE: boolean
  e2eePublicKey: string
  e2eeEncryptedPrivateKey: string
  autoSyncIntervalMs: number
  enableOfflineMode: boolean
  dataRetentionDays: number
}

// ============================================
// 场景默认配置覆盖
// ============================================

export type ScenarioDomain = 'legal' | 'medical' | 'education' | 'general'

export interface ScenarioProfileOverride {
    domain: ScenarioDomain
    displayName: string
    llm: {
        temperature: number
        topP: number
        maxTokens: number
        timeout: number
    }
    agent: {
        maxToolLoops: number
        maxToolResultChars: number
        maxTotalContextChars: number
        enableAutoFix: boolean
        toolTimeoutMs: number
    }
    security: {
        enablePermissionConfirm: boolean
        strictWorkspaceMode: boolean
        allowedShellCommands: readonly string[]
    }
    performance: {
        largeFileWarningThresholdMB: number
        maxSearchResults: number
    }
    autoApprove: {
        terminal: boolean
        dangerous: boolean
    }
}

export const SCENARIO_PROFILE_DEFAULTS: Record<ScenarioDomain, ScenarioProfileOverride> = {
    legal: {
        domain: 'legal',
        displayName: 'Legal Assistant',
        llm: {
            temperature: 0.3,
            topP: 0.9,
            maxTokens: 16384,
            timeout: 180000,
        },
        agent: {
            maxToolLoops: 90,
            maxToolResultChars: 15000,
            maxTotalContextChars: 80000,
            enableAutoFix: false,
            toolTimeoutMs: 90000,
        },
        security: {
            enablePermissionConfirm: true,
            strictWorkspaceMode: true,
            allowedShellCommands: [
                'git', 'npm', 'node', 'tsc', 'eslint',
                'pwd', 'ls', 'cat', 'echo', 'mkdir',
            ] as const,
        },
        performance: {
            largeFileWarningThresholdMB: 2,
            maxSearchResults: 2000,
        },
        autoApprove: {
            terminal: false,
            dangerous: false,
        },
    },
    medical: {
        domain: 'medical',
        displayName: 'Medical Assistant',
        llm: {
            temperature: 0.2,
            topP: 0.85,
            maxTokens: 12288,
            timeout: 180000,
        },
        agent: {
            maxToolLoops: 60,
            maxToolResultChars: 12000,
            maxTotalContextChars: 60000,
            enableAutoFix: false,
            toolTimeoutMs: 90000,
        },
        security: {
            enablePermissionConfirm: true,
            strictWorkspaceMode: true,
            allowedShellCommands: [
                'git', 'node', 'python',
                'pwd', 'ls', 'cat',
            ] as const,
        },
        performance: {
            largeFileWarningThresholdMB: 2,
            maxSearchResults: 1500,
        },
        autoApprove: {
            terminal: false,
            dangerous: false,
        },
    },
    education: {
        domain: 'education',
        displayName: 'Education Assistant',
        llm: {
            temperature: 0.8,
            topP: 1,
            maxTokens: 8192,
            timeout: 120000,
        },
        agent: {
            maxToolLoops: 150,
            maxToolResultChars: 10000,
            maxTotalContextChars: 60000,
            enableAutoFix: true,
            toolTimeoutMs: 60000,
        },
        security: {
            enablePermissionConfirm: true,
            strictWorkspaceMode: false,
            allowedShellCommands: SECURITY_SETTINGS_DEFAULTS.allowedShellCommands,
        },
        performance: {
            largeFileWarningThresholdMB: 5,
            maxSearchResults: 1000,
        },
        autoApprove: {
            terminal: false,
            dangerous: false,
        },
    },
    general: {
        domain: 'general',
        displayName: 'General Assistant',
        llm: {
            temperature: LLM_DEFAULTS.temperature,
            topP: LLM_DEFAULTS.topP,
            maxTokens: LLM_DEFAULTS.maxTokens,
            timeout: LLM_DEFAULTS.timeout,
        },
        agent: {
            maxToolLoops: AGENT_DEFAULTS.maxToolLoops,
            maxToolResultChars: AGENT_DEFAULTS.maxToolResultChars,
            maxTotalContextChars: AGENT_DEFAULTS.maxTotalContextChars,
            enableAutoFix: AGENT_DEFAULTS.enableAutoFix,
            toolTimeoutMs: AGENT_DEFAULTS.toolTimeoutMs,
        },
        security: {
            enablePermissionConfirm: SECURITY_SETTINGS_DEFAULTS.enablePermissionConfirm,
            strictWorkspaceMode: SECURITY_SETTINGS_DEFAULTS.strictWorkspaceMode,
            allowedShellCommands: SECURITY_SETTINGS_DEFAULTS.allowedShellCommands,
        },
        performance: {
            largeFileWarningThresholdMB: PERFORMANCE_DEFAULTS.largeFileWarningThresholdMB,
            maxSearchResults: PERFORMANCE_DEFAULTS.maxSearchResults,
        },
        autoApprove: {
            terminal: AUTO_APPROVE_DEFAULTS.terminal,
            dangerous: AUTO_APPROVE_DEFAULTS.dangerous,
        },
    },
} as const

export function getScenarioProfileOverride(domain: ScenarioDomain): ScenarioProfileOverride {
    return SCENARIO_PROFILE_DEFAULTS[domain]
}
