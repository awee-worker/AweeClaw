/**
 * Electron API 类型定义
 *
 * 通用类型直接从 @protocols 导入使用，这里只定义 Electron 专用类型
 */

/**
 * 语音模型配置（自定义模式，STT + TTS 合并存储但分别启用）
 * 与本地 SQLite voice_model_config 表对应（已解密、字段已规范化）
 */
export interface VoiceModelConfig {
  sttEnabled: boolean
  sttProvider: string
  sttModel: string
  sttApiKey: string
  sttBaseUrl: string
  sttLanguage: string         // 'auto' | 'zh' | 'en' | ...
  sttTimeout: number
  ttsEnabled: boolean
  ttsProvider: string
  ttsModel: string
  ttsVoice: string
  ttsApiKey: string
  ttsBaseUrl: string
  ttsSpeed: number
  ttsTimeout: number
  updatedAt: number
}

/** 语音唤醒配置 */
export interface WakeWordConfig {
  enabled: boolean
  keyword: string
  sensitivity: 'strict' | 'balanced' | 'loose'
  cooldownMs: number
  minSpeechMs: number
  updatedAt: number
}

/** 悬浮头像语音上下文（主窗口 push，头像窗口 get） */
export interface VoiceContextPayload {
  llmConfig: unknown | null
  cloudMode: 'cloud' | 'local'
  serverUrl: string | null
  accessToken: string | null
  refreshToken: string | null
  voiceModelConfig: unknown | null
  language: 'zh' | 'en'
  workspacePath: string | null
  /** 工具执行授权方式（every-step / dangerous-only / never），同步主窗口 authorizationMode */
  authorizationMode?: 'every-step' | 'dangerous-only' | 'never'
  /** 工作模式（chat/agent/plan），同步主窗口 useModeStore.currentMode */
  workMode?: 'chat' | 'agent' | 'plan' | null
  /** 自定义智能体配置（同步主窗口 store.agentConfig，供迷你聊天选择/生效） */
  agentConfig?: AvatarAgentConfig | null
  updatedAt: number
}

/** 迷你聊天可用的自定义智能体配置（与主窗口 store.agentConfig 结构对齐） */
export interface AvatarAgentConfig {
  /** 当前激活的智能体 id（未选择为 undefined） */
  activeCustomAgentId?: string | null
  /** 自定义智能体列表（含完整 systemPrompt/工具白名单，供迷你聊天生效） */
  customAgentProfiles?: AvatarAgentProfile[]
}

/** 迷你聊天用的自定义智能体摘要（完整字段，与 customAgentTools.CustomAgentProfile 对齐） */
export interface AvatarAgentProfile {
  id: string
  name: string
  description: string
  systemPrompt: string
  capabilities: string[]
  priority: number
  enabled: boolean
  icon?: string
  identifier?: string
  callable?: boolean
  triggerMode?: 'always' | 'on_request' | 'manual'
  /** 关联的内置工具 ID 列表（UI 分类 ID） */
  builtinTools?: string[]
  /** 关联的 MCP 服务 ID 列表 */
  mcpServices?: string[]
  /** 关联的插件 ID 列表 */
  plugins?: string[]
  createdAt?: number
  updatedAt?: number
}

/** 主窗口当前对话快照（主窗口→main→头像窗口，供迷你聊天同步显示主窗口对话） */
export interface MainConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 推理内容（思考模型的 reasoning_content） */
  reasoning?: string
  timestamp: number
}

export interface MainConversationSnapshot {
  /** 当前线程 id（无线程为 null） */
  threadId: string | null
  messages: MainConversationMessage[]
  updatedAt: number
}

/** 悬浮头像语音状态变化载荷（头像→main→主窗口 + 托盘） */
export interface VoiceStateChangedPayload {
  state: 'idle' | 'listening' | 'recording' | 'processing' | 'speaking' | 'error'
  volume: number
}

/** 悬浮头像保存对话历史载荷（头像→main→主窗口） */
export interface SaveConversationPayload {
  userText: string
  aiText: string
  toolCallRecords?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
    success: boolean
    resultSummary: string
  }>
}

/** 可用模型选项（扁平化，供头像窗口渲染模型选择器） */
export interface AvatarModelOption {
  id: string
  name: string
  provider: string
  providerName: string
  isCloud: boolean
}

/** 项目执行状态摘要（主窗口→main→头像窗口，用于悬浮球上方显示执行状态） */
export interface ExecutionStatusSummary {
  /** 活跃会话数（running + queued） */
  activeCount: number
  /** 运行中会话数 */
  runningCount: number
  /** 排队中会话数 */
  queuedCount: number
  /** 会话详情列表（最多显示前 5 个） */
  sessions: Array<{
    id: string
    projectName: string
    status: 'running' | 'queued' | 'completed' | 'failed' | 'aborted'
    kind: 'task' | 'batch'
    batchTotal?: number
    batchCompleted?: number
  }>
}

interface AuditEntry {
  pipelineId: string
  action: string
  resource: string
  outcome: 'allow' | 'deny' | 'error'
  timestamp: number
  details?: Record<string, unknown>
}

export interface ClipboardFileAttachment {
  path: string
  name: string
  ext: string
  mimeType: string
  base64: string
  isImage: boolean
  size: number
}

export interface AuditQueryFilter {
  pipelineId?: string
  action?: string
  outcome?: AuditEntry['outcome']
  since?: number
  limit?: number
}

// 从 @protocols 重新导出，供其他文件使用
export type {
  FileItem,
  SearchFilesOptions,
  SearchFileResult,
  IndexStatus,
  IndexSearchResult,
  IndexMode,
  SymbolInfo,
  ProjectSummary,
  EmbeddingProvider,
  LspPosition,
  LspRange,
  LspLocation,
  LspDiagnostic,
  LspHover,
  LspCompletionItem,
  LspCompletionList,
  LspTextEdit,
  LspWorkspaceEdit,
  LspSignatureHelp,
  LspDocumentSymbol,
  LspSymbolInformation,
  LspCodeAction,
  LspFormattingOptions,
  LspDocumentHighlight,
  LspFoldingRange,
  LspInlayHint,
  LspPrepareRename,
} from '@protocols'

// 从 @shared/protocols/llm 重新导出
export type {
  LLMStreamChunk,
  LLMToolCall,
  LLMResult,
  LLMError,
  LLMConfig,
  LLMSendMessageParams,
} from '@shared/protocols/modelGateway'

// LLM 响应类型
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export interface ResponseMetadata {
  id: string
  modelId: string
  timestamp: Date
  finishReason?: string
}

export interface LLMResponse<T> {
  data: T
  usage?: TokenUsage
  metadata?: ResponseMetadata
}

// 结构化输出类型
export interface CodeAnalysis {
  issues: Array<{
    severity: 'error' | 'warning' | 'info' | 'hint'
    message: string
    line: number
    column: number
    endLine?: number
    endColumn?: number
    code?: string
    source?: string
  }>
  suggestions: Array<{
    title: string
    description: string
    priority: 'high' | 'medium' | 'low'
    changes?: Array<{
      line: number
      oldText: string
      newText: string
    }>
  }>
  summary: string
}

export interface Refactoring {
  refactorings: Array<{
    title: string
    description: string
    confidence: 'high' | 'medium' | 'low'
    changes: Array<{
      type: 'replace' | 'insert' | 'delete'
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      newText?: string
    }>
    explanation: string
  }>
}

export interface CodeFix {
  fixes: Array<{
    diagnosticIndex: number
    title: string
    description: string
    changes: Array<{
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      newText: string
    }>
    confidence: 'high' | 'medium' | 'low'
  }>
}

export interface TestCase {
  testCases: Array<{
    name: string
    description: string
    code: string
    type: 'unit' | 'integration' | 'edge-case'
  }>
  setup?: string
  teardown?: string
}

// 从 @shared/protocols/mcp 重新导出
export type {
  McpServerState,
  McpTool,
  McpToolCallRequest,
  McpToolCallResult,
  McpResourceReadRequest,
  McpResourceReadResult,
  McpPromptGetRequest,
  McpPromptGetResult,
  McpServerStatusEvent,
  McpToolsUpdatedEvent,
  McpResourcesUpdatedEvent,
} from '@shared/protocols/toolProtocolBridge'

// ============================================
// Electron 专用类型
// ============================================

export interface McpToolWithServer extends McpTool {
  serverId: string
}


export interface SecureCommandRequest {
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
  requireConfirm?: boolean
}

export interface WorkspaceConfig {
  configPath: string | null
  roots: string[]
  restoreError?: 'missing-workspace'
  missingRoots?: string[]
  workspaceId?: string
}

export interface RemoteShellEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifyTime?: number
}

export interface RemoteShellServer {
  host: string
  port?: number
  username?: string
  password?: string
  privateKeyPath?: string
  remotePath?: string
}

export interface RemoteShellUploadResult {
  canceled: boolean
  uploaded: string[]
}

export interface RemoteShellDownloadResult {
  canceled: boolean
  localPath?: string
}

export interface EmbeddingConfigInput {
  provider?: 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'custom'
  apiKey?: string
  model?: string
  baseUrl?: string
  dimensions?: number
}

// ============================================
// Updater 类型
// ============================================

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  releaseDate?: string
  downloadUrl?: string
  progress?: number
  error?: string
  requiresManualDownload: boolean
  isPortable: boolean
}

// ============================================
// Debug 类型
// ============================================

export interface DebugConfig {
  type: string
  name: string
  request: 'launch' | 'attach'
  program?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  port?: number
  host?: string
  stopOnEntry?: boolean
  console?: 'internalConsole' | 'integratedTerminal' | 'externalTerminal'
  [key: string]: unknown
}

export interface DebugBreakpointInput {
  line: number
  column?: number
  condition?: string
}

export interface DebugBreakpoint {
  id: string
  file: string
  line: number
  column?: number
  condition?: string
  hitCount?: number
  enabled: boolean
}

export interface DebugStackFrame {
  id: number
  name: string
  line: number
  column: number
  file?: string
  source?: {
    name?: string
    path?: string
    sourceReference?: number
  }
}

export interface DebugScope {
  name: string
  variablesReference: number
  expensive: boolean
}

export interface DebugVariable {
  name: string
  value: string
  type: string
  variablesReference: number
  children?: DebugVariable[]
}

export type DebuggerState = 'idle' | 'running' | 'paused' | 'stopped'

export interface DebugSessionState {
  id: string
  config: DebugConfig
  state: DebuggerState
}

export type DebugEvent =
  | { type: 'started' }
  | { type: 'stopped'; reason: string; threadId?: number }
  | { type: 'continued'; threadId?: number }
  | { type: 'exited'; exitCode: number }
  | { type: 'terminated' }
  | { type: 'breakpoint'; breakpoint: DebugBreakpoint; reason: 'new' | 'changed' | 'removed' }
  | { type: 'output'; category: 'console' | 'stdout' | 'stderr'; output: string }
  | { type: 'error'; message: string }

// ============================================
// Electron API 接口
// ============================================

export interface ElectronAPI {
  // App
  appReady: () => void
  getAppVersion: () => Promise<string>
  respondToShutdownRequest: (requestId: string, success: boolean) => Promise<boolean>
  onShutdownRequested: (callback: (event: { requestId: string; reason: 'window-close' | 'app-quit' }) => void) => () => void

  // Perception（感知层）
  perception: {
    // 阶段1：配置与查询
    getPrivacyConfig: () => Promise<{ success: boolean; data?: unknown; error?: string }>
    updatePrivacyConfig: (config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
    getRecentScenes: (limit?: number) => Promise<{ success: boolean; data?: unknown[]; error?: string }>
    searchSimilarScenes: (embedding: number[], topK?: number) => Promise<{ success: boolean; data?: unknown[]; error?: string }>
    searchSimilarBehaviors: (embedding: number[], topK?: number) => Promise<{ success: boolean; data?: unknown[]; error?: string }>
    clearAllData: () => Promise<{ success: boolean; error?: string }>
    cleanupExpiredData: () => Promise<{ success: boolean; error?: string }>
    updatePredictionOutcome: (
      predictionId: string,
      actualAction: unknown,
      feedback?: 'accepted' | 'rejected' | 'ignored',
    ) => Promise<{ success: boolean; error?: string }>

    // 阶段2：行为预测
    predictAction: (req: {
      sceneText: string
      app: string
      activity: string
      openFiles?: string[]
      terminalCmds?: string[]
      topK?: number
      confidenceThreshold?: number
    }) => Promise<{
      success: boolean
      predictions: Array<{
        id: string
        predictedAction: { type: string; target: string; durationMs?: number }
        confidence: number
        basedOnBehaviors: string[]
        reason: string
        modelVersion: string
      }>
      embedding: number[]
      sampleCount: number
      error?: string
    }>
    recordBehavior: (params: {
      sceneId?: string
      sceneText: string
      app: string
      activity: string
      action: { type: string; target: string; durationMs?: number }
      outcome?: 'success' | 'failure' | 'abandoned'
      openFiles?: string[]
      terminalCmds?: string[]
    }) => Promise<{ success: boolean; error?: string }>
    submitFeedback: (
      predictionId: string,
      feedback: 'accepted' | 'rejected' | 'ignored',
      actualAction?: { type: string; target: string; durationMs?: number },
    ) => Promise<{ success: boolean; error?: string }>

    // 阶段2：代码影响分析
    analyzeImpact: (req: {
      projectPath: string
      language?: 'typescript' | 'javascript' | 'python'
      changedFiles: Array<{
        filePath: string
        relativePath: string
        changeType: 'modified' | 'added' | 'deleted' | 'renamed'
        additions?: number
        deletions?: number
      }>
      forceRebuild?: boolean
      maxDepth?: number
      /** 是否启用 Git 伴随修改分析（阶段9 s9-09，默认 true） */
      enableCoModification?: boolean
      /** 伴随修改分析返回的 Top-K（默认 5） */
      coModificationTopK?: number
      /** 是否强制刷新伴随修改缓存（阶段9 s9-09） */
      forceRefreshCoModification?: boolean
    }) => Promise<{
      success: boolean
      projectPath: string
      overallImpact: 'high' | 'medium' | 'low' | 'none'
      totalImpactedFiles: number
      results: Array<{
        changedFile: string
        relativePath: string
        changeType: 'modified' | 'added' | 'deleted' | 'renamed'
        impactedFiles: Array<{
          filePath: string
          relativePath: string
          depth: number
          isTest: boolean
        }>
        impactedCount: number
        nonTestCount: number
        testCount: number
        impactLevel: 'high' | 'medium' | 'low' | 'none'
        maxDepth: number
        /** Git 伴随修改文件列表（阶段9 s9-09） */
        coModifiedFiles?: Array<{
          relativePath: string
          coOccurrence: number
          frequency: number
        }>
        /** 该文件在 git 历史中出现的 commit 数（阶段9 s9-09） */
        coModifiedTotalCommits?: number
      }>
      graphStats: { fileCount: number; edgeCount: number; builtAt: number }
      highRiskFiles: Array<{
        filePath: string
        relativePath: string
        impactedByCount: number
      }>
      /** Git 伴随修改分析统计（阶段9 s9-09，未启用时为 null） */
      coModificationStats?: {
        totalCommits: number
        uniqueFiles: number
        uniqueFilePairs: number
        analyzedAt: number
        fromCache: boolean
      } | null
      error?: string
    }>

    // ===== 阶段9 s9-09：Git 伴随修改分析 =====
    /** 分析项目的 git 历史伴随修改模式 */
    analyzeCoModification: (
      projectPath: string,
      options?: {
        maxCommits?: number
        forceRefresh?: boolean
        excludedDirs?: string[]
      },
    ) => Promise<{
      success: boolean
      data?: {
        projectPath: string
        totalCommits: number
        uniqueFiles: number
        uniqueFilePairs: number
        analysisDurationMs: number
        analyzedAt: number
        cachePath: string
        fromCache: boolean
      }
      error?: string
    }>
    /** 查询单个文件的伴随修改文件列表 */
    getCoModifiedFiles: (
      projectPath: string,
      relativeFilePath: string,
      topK?: number,
    ) => Promise<{
      success: boolean
      data?: {
        filePath: string
        totalCommits: number
        coModifiedFiles: Array<{
          relativePath: string
          coOccurrence: number
          frequency: number
        }>
      }
      error?: string
    }>
    /** 获取已分析项目的伴随修改统计信息 */
    getCoModificationStats: (projectPath: string) => Promise<{
      success: boolean
      data?: {
        projectPath: string
        totalCommits: number
        uniqueFiles: number
        uniqueFilePairs: number
        analysisDurationMs: number
        analyzedAt: number
        cachePath: string
        fromCache: boolean
      } | null
      error?: string
    }>
    /** 清空指定项目的伴随修改缓存 */
    clearCoModificationCache: (projectPath: string) => Promise<{
      success: boolean
      error?: string
    }>

    // 阶段2：统计
    getPredictionStats: (days?: number) => Promise<{ success: boolean; data?: unknown; error?: string }>

    // 阶段2：场景时间轴与热力图
    getSceneTimeline: (startDate: number, endDate: number, limit?: number) => Promise<{
      success: boolean
      data?: Array<{
        id: string
        timestamp: number
        app: string
        windowTitle: string
        activity: 'coding' | 'browsing' | 'chatting' | 'reading' | 'writing' | 'debugging' | 'idle' | 'unknown'
        textSummary: string
      }>
      error?: string
    }>
    getBehaviorHeatmap: (days?: number) => Promise<{
      success: boolean
      data?: Array<{
        date: string
        hour: number
        count: number
        topActivity: string
      }>
      error?: string
    }>
    getBehaviorsByTimeRange: (startTime: number, endTime: number, limit?: number) => Promise<{
      success: boolean
      data?: unknown[]
      error?: string
    }>

    // ===== 阶段3：摄像头权限 =====
    /** 查询摄像头权限状态 */
    getCameraPermissionStatus: () => Promise<{
      success: boolean
      data?: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
      error?: string
    }>
    /**
     * 请求摄像头权限
     * - data=true: 已授权
     * - data=false + redirectToSettings=true: 用户曾拒绝，需引导到系统设置
     */
    requestCameraPermission: () => Promise<{
      success: boolean
      data?: boolean
      redirectToSettings?: boolean
      error?: string
    }>
    /** 打开系统设置中的摄像头权限页面 */
    openCameraSettings: () => Promise<{
      success: boolean
      error?: string
    }>

    // ===== 阶段9：LLM 双模式行为预测 =====
    /** 初始化 LLM 行为预测器（启用双模式融合） */
    initLlmPredictor: (config: {
      model: string
      apiKey?: string
      baseUrl?: string
      temperature?: number
    }) => Promise<{ success: boolean; data?: boolean; error?: string }>
    /** 查询 LLM 预测器是否已就绪 */
    isLlmPredictorReady: () => Promise<{ success: boolean; data?: boolean; error?: string }>
    /** 重置 LLM 预测器（恢复纯统计模式） */
    resetLlmPredictor: () => Promise<{ success: boolean; error?: string }>

    // ===== D-步骤5：场景模式感知策略切换 =====
    /**
     * 设置场景模式感知过滤器
     *
     * 场景模式切换时由渲染进程调用，将新模式的 perceptionFilter 同步到
     * PerceptionFusionService，控制各感知通道的启停。
     *
     * @param filter 感知过滤器（null 表示清除过滤，全部启用）
     */
    setSceneFilter: (
      filter: Record<string, boolean> | null,
    ) => Promise<{ success: boolean; error?: string }>
  }

  // PerceptionFusion（多模态融合感知层 - 阶段9 s9-05）
  perceptionFusion: {
    /** 获取当前环境上下文（4 通道融合） */
    getEnvironmentContext: () => Promise<{
      success: boolean
      data?: {
        timestamp: number
        channels: Array<{
          name: 'scene' | 'iot' | 'causal' | 'monitoring'
          running: boolean
          lastUpdateAt: number | null
          anomalyCount: number
          summary: string
          stale: boolean
          data?: unknown
        }>
        totalAnomalyCount: number
        attentionScore: number
        insights: Array<{
          type: string
          description: string
          severity: 'info' | 'warning' | 'critical'
          channels: Array<'scene' | 'iot' | 'causal' | 'monitoring'>
        }>
        staleChannels: Array<'scene' | 'iot' | 'causal' | 'monitoring'>
        scene: unknown
        iot: unknown
        causal: unknown
        monitoring: unknown
      }
      error?: string
    }>
    /** 获取融合历史（最近 N 次） */
    getFusionHistory: (limit?: number) => Promise<{
      success: boolean
      data?: unknown[]
      error?: string
    }>
    /** 获取最近一次融合结果（从缓存读取） */
    getLastContext: () => Promise<{
      success: boolean
      data?: unknown
      error?: string
    }>
    /** 清空融合历史 */
    clearHistory: () => Promise<{ success: boolean; error?: string }>
  }

  // Monitoring（监控层 - 阶段3）
  monitoring: {
    // 配置
    getConfig: () => Promise<{
      success: boolean
      data?: {
        enabled: boolean
        sampleIntervalSec: number
        retentionDays: number
        anomalyDetectionEnabled: boolean
        predictiveAlertEnabled: boolean
        predictiveWindowMin: number
        thresholds: {
          cpuWarning: number
          cpuCritical: number
          memoryWarning: number
          memoryCritical: number
          diskWarning: number
          diskCritical: number
          temperatureWarning: number
          temperatureCritical: number
          batteryLow: number
          processExplosion: number
        }
        notificationsEnabled: boolean
        cloudReportingEnabled: boolean
      }
      error?: string
    }>
    updateConfig: (config: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>

    // 状态查询
    isRunning: () => Promise<{ success: boolean; data?: boolean; error?: string }>
    getLatestMetrics: () => Promise<{
      success: boolean
      data?: {
        timestamp: number
        cpuUsage: number
        cpuLoadAvg1: number
        cpuLoadAvg5: number
        cpuLoadAvg15: number
        memoryUsage: number
        memoryAvailableMB: number
        memoryTotalMB: number
        diskUsage: number
        diskIoReadKBps: number
        diskIoWriteKBps: number
        networkRxKBps: number
        networkTxKBps: number
        processCount: number
        cpuTemperature: number
        batteryPercent: number
        batteryCharging: boolean
      } | null
      error?: string
    }>
    getMetricsByTimeRange: (
      startTime: number,
      endTime: number,
      limit?: number,
    ) => Promise<{ success: boolean; data?: unknown[]; error?: string }>

    // 异常查询
    getActiveAnomalies: () => Promise<{ success: boolean; data?: unknown[]; error?: string }>
    getRecentAnomalies: (limit?: number) => Promise<{ success: boolean; data?: unknown[]; error?: string }>
    getAnomaliesByTimeRange: (
      startTime: number,
      endTime: number,
      limit?: number,
    ) => Promise<{ success: boolean; data?: unknown[]; error?: string }>

    // 异常管理
    acknowledgeAnomaly: (anomalyId: string) => Promise<{ success: boolean; error?: string }>
    resolveAnomaly: (anomalyId: string) => Promise<{ success: boolean; error?: string }>

    // 事件订阅
    subscribe: () => Promise<{ success: boolean; error?: string }>
    onAnomalyEvent: (callback: (event: unknown) => void) => () => void

    // 诊断
    getDetectorStats: () => Promise<{
      success: boolean
      data?: {
        forestTrained: boolean
        forestTreeCount: number
        trainingSampleCount: number
        lastTrainedAt: number
        activeAnomalyCount: number
      }
      error?: string
    }>
    clearAllData: () => Promise<{ success: boolean; error?: string }>
  }

  // Causal Reasoning（因果推理 - 阶段4）
  causal: {
    // 配置
    getConfig: () => Promise<{
      success: boolean
      data?: {
        enabled: boolean
        autoExtractionEnabled: boolean
        cloudReportingEnabled: boolean
        extractionMinConfidence: number
        counterfactualEnabled: boolean
        maxNodes: number
        retentionDays: number
        updatedAt: number
      }
      error?: string
    }>
    updateConfig: (
      updates: Record<string, unknown>,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>

    // 节点 CRUD
    listNodes: (filter?: Record<string, unknown>) => Promise<{
      success: boolean
      data?: Array<{
        id: string
        type: string
        name: string
        description?: string
        source: string
        metadata?: Record<string, unknown>
        enabled: boolean
        createdAt: number
        updatedAt: number
      }>
      error?: string
    }>
    createNode: (input: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>
    updateNode: (
      nodeId: string,
      updates: Record<string, unknown>,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    deleteNode: (nodeId: string) => Promise<{ success: boolean; error?: string }>

    // 边 CRUD
    listEdges: (filter?: Record<string, unknown>) => Promise<{
      success: boolean
      data?: Array<{
        id: string
        fromNodeId: string
        toNodeId: string
        relation: string
        strength: number
        evidence?: string
        source: string
        enabled: boolean
        createdAt: number
        updatedAt: number
      }>
      error?: string
    }>
    createEdge: (input: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>
    createEdgeByNames: (input: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>
    updateEdge: (
      edgeId: string,
      updates: Record<string, unknown>,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    deleteEdge: (edgeId: string) => Promise<{ success: boolean; error?: string }>

    // 断言管理
    listAssertions: (filter?: Record<string, unknown>) => Promise<{
      success: boolean
      data?: Array<{
        id: string
        sourceText: string
        causeName: string
        effectName: string
        relation: string
        strength: number
        extractor: string
        extractMeta?: Record<string, unknown>
        reviewStatus: string
        reviewedBy?: string
        reviewedAt?: number
        reviewNote?: string
        mergedEdgeId?: string
        createdAt: number
      }>
      error?: string
    }>
    reportAssertion: (input: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>
    batchReportAssertions: (
      inputs: Array<Record<string, unknown>>,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    reviewAssertion: (
      assertionId: string,
      review: { status: string; reviewedBy?: string; reviewNote?: string },
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    extractAssertions: (
      sourceText: string,
      minConfidence?: number,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>

    // LLM 抽取（阶段5新增）
    extractWithLlm: (
      sourceText: string,
      minConfidence?: number,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    registerLlmCallback: () => Promise<{
      success: boolean
      data?: boolean
      error?: string
    }>
    unregisterLlmCallback: () => Promise<{
      success: boolean
      data?: boolean
      error?: string
    }>
    /**
     * 初始化 LLM 抽取器（阶段9 s9-03 新增）
     *
     * 传入 LLM 配置，主进程直接持有 LLMService 调用 LLM。
     * 调用后需再调用 registerLlmCallback() 启用自动抽取。
     */
    initLlmExtractor: (config: {
      model: string
      apiKey?: string
      baseUrl?: string
      temperature?: number
    }) => Promise<{ success: boolean; data?: boolean; error?: string }>

    // 干预/反事实查询
    // 阶段5新增：所有查询方法均支持可选 sceneKey 参数，用于场景级阈值覆盖
    intervention: (
      interventionVar: string,
      interventionValue: unknown,
      observedVar: string,
      sceneKey?: string,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    counterfactual: (
      interventionVar: string,
      interventionValue: unknown,
      observedVar: string,
      observedValue: unknown,
      sceneKey?: string,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    /** 后门调整查询（识别混淆变量 Z，计算调整后因果效应） */
    backdoorAdjustment: (
      interventionVar: string,
      observedVar: string,
      sceneKey?: string,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    /** 前门调整查询（识别中介变量 M，通过中介路径计算因果效应） */
    frontdoorAdjustment: (
      interventionVar: string,
      observedVar: string,
      sceneKey?: string,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    /** 敏感性分析（评估未观测混淆变量对反事实结论的影响） */
    sensitivityAnalysis: (
      interventionVar: string,
      observedVar: string,
      sceneKey?: string,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
    listQueries: (filter?: Record<string, unknown>) => Promise<{
      success: boolean
      data?: Array<{
        id: string
        queryType: string
        interventionVar: string
        interventionValue: unknown
        observedVar: string
        result: unknown
        engine: string
        durationMs: number
        success: boolean
        error?: string
        createdAt: number
      }>
      error?: string
    }>

    // 场景级阈值配置（阶段5新增）
    /** 列出所有场景阈值配置 */
    listSceneConfigs: () => Promise<{
      success: boolean
      data?: Array<{
        sceneKey: string
        strongThreshold: number
        moderateThreshold: number
        weakThreshold: number
        enabled: boolean
        description: string | null
        updatedAt: number
      }>
      error?: string
    }>
    /** 获取指定场景的阈值配置（未配置或被禁用时返回 null） */
    getSceneConfig: (
      sceneKey: string,
    ) => Promise<{
      success: boolean
      data?: {
        sceneKey: string
        strongThreshold: number
        moderateThreshold: number
        weakThreshold: number
        enabled: boolean
        description: string | null
        updatedAt: number
      } | null
      error?: string
    }>
    /** 创建或更新场景阈值配置 */
    upsertSceneConfig: (
      sceneKey: string,
      updates: {
        strongThreshold?: number
        moderateThreshold?: number
        weakThreshold?: number
        enabled?: boolean
        description?: string
      },
    ) => Promise<{
      success: boolean
      data?: {
        sceneKey: string
        strongThreshold: number
        moderateThreshold: number
        weakThreshold: number
        enabled: boolean
        description: string | null
        updatedAt: number
      }
      error?: string
    }>
    /** 删除场景阈值配置 */
    deleteSceneConfig: (
      sceneKey: string,
    ) => Promise<{ success: boolean; data?: boolean; error?: string }>

    // 图统计
    getStats: () => Promise<{
      success: boolean
      data?: {
        nodeCount: number
        edgeCount: number
        density: number
        componentCount: number
        avgOutDegree: number
        avgInDegree: number
        hasCycle: boolean
      }
      error?: string
    }>

    // 事件流
    collectEvent: (event: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
    flushEvents: () => Promise<{ success: boolean; data?: { extracted: number }; error?: string }>

    // 数据维护
    cleanupExpired: () => Promise<{ success: boolean; data?: { deleted: number }; error?: string }>
    clearAllData: () => Promise<{ success: boolean; error?: string }>
  }

  // IoT Bridge（IoT 融合 - 阶段5）
  iot: {
    // Bridge 生命周期
    start: () => Promise<{ success: boolean; data?: boolean; error?: string }>
    stop: () => Promise<{ success: boolean; error?: string }>
    isRunning: () => Promise<{ success: boolean; data?: boolean; error?: string }>
    getStatus: () => Promise<{
      success: boolean
      data?: {
        running: boolean
        startedAt?: number
        providers: Array<{
          providerId: string
          providerName: string
          protocol: string
          state: 'disconnected' | 'connecting' | 'connected' | 'error' | 'disabled'
          entityCount: number
          lastError?: string
          lastConnectedAt?: number
          lastDataAt?: number
          receivedReadings: number
          staleThresholdMs?: number
        }>
        totalEntities: number
        totalReadings: number
      }
      error?: string
    }>

    // Provider 连接管理
    connectProvider: (providerId: string) => Promise<{ success: boolean; error?: string }>
    disconnectProvider: (providerId: string) => Promise<{ success: boolean; error?: string }>
    testProviderConnection: (
      providerId: string,
    ) => Promise<{
      success: boolean
      data?: { success: boolean; latencyMs?: number; message: string }
      error?: string
    }>
    /**
     * 向指定 Provider 的 broker 发布消息（阶段9 s9-10，仅 MQTT 协议支持）
     *
     * 用于向设备发送控制命令，例如开关设备、设置亮度等。
     */
    publishMessage: (
      providerId: string,
      topic: string,
      payload: string,
      options?: { qos?: 0 | 1 | 2; retain?: boolean },
    ) => Promise<{
      success: boolean
      data?: { success: boolean; message: string }
      error?: string
    }>

    // 实体查询
    listEntitySnapshots: () => Promise<{
      success: boolean
      data?: Array<{
        id: string
        deviceId: string
        externalId: string
        entityType: string
        deviceClass?: string | null
        unitOfMeasurement?: string | null
        state: string | number | boolean | null
        attributes: Record<string, unknown>
        lastStateChangedAt: number
      }>
      error?: string
    }>
    listEntitySnapshotsByProvider: (
      providerId: string,
    ) => Promise<{ success: boolean; data?: unknown[]; error?: string }>

    // 适配器查询
    hasAdapter: (
      protocol: 'homeassistant' | 'mqtt' | 'ble' | 'custom',
    ) => Promise<{ success: boolean; data?: boolean; error?: string }>

    // 渲染层回调注入
    setRendererCallbacks: (callbacks: {
      fetchProviderConfig: (
        providerId: string,
      ) => Promise<{ success: boolean; data?: unknown; error?: string }>
      reportReadings: (
        readings: Array<{
          entityExternalId: string
          value?: number
          stringValue?: string
          unit?: string
          source?: string
          recordedAt: number
        }>,
      ) => Promise<{ success: boolean; error?: string }>
    }) => Promise<{ success: boolean; data?: boolean; error?: string }>

    // 性能指标（阶段8 s8-08）
    getMetrics: () => Promise<{
      success: boolean
      data?: {
        collectedAt: number
        startedAt: number | null
        uptimeSeconds: number
        totalReadings: number
        totalErrors: number
        totalStateChanges: number
        windowReadings: number
        windowErrors: number
        globalReadingsPerMinute: number
        globalErrorRate: number
        connectedProviders: number
        totalProviders: number
        totalEntities: number
        providers: Array<{
          providerId: string
          providerName: string
          protocol: string
          state: 'disconnected' | 'connecting' | 'connected' | 'error' | 'disabled'
          totalReadings: number
          totalErrors: number
          totalStateChanges: number
          lastReadingAt: number | null
          lastErrorAt: number | null
          lastConnectedAt: number | null
          windowReadings: number
          windowErrors: number
          readingsPerMinute: number
          errorRate: number
          uptimeSeconds: number
          secondsSinceLastReading: number | null
        }>
        protocols: Array<{
          protocol: string
          providerCount: number
          connectedCount: number
          errorCount: number
          totalReadings: number
          totalErrors: number
        }>
      }
      error?: string
    }>
    setMetricsWindow: (
      window: '1m' | '5m' | '1h',
    ) => Promise<{ success: boolean; data?: string; error?: string }>

    // 性能指标历史趋势（阶段9 s9-08）
    getMetricsHistory: (
      durationMs?: number,
    ) => Promise<{
      success: boolean
      data?: Array<{
        timestamp: number
        globalReadingsPerMinute: number
        globalErrorRate: number
        connectedProviders: number
        totalProviders: number
        totalEntities: number
        uptimeSeconds: number
        windowReadings: number
        windowErrors: number
      }>
      error?: string
    }>

    // 事件订阅
    onBridgeEvent: (
      callback: (event: {
        type: 'provider:connected' | 'provider:disconnected' | 'provider:error' | 'entity:update' | 'reading:received'
        providerId?: string
        entity?: {
          providerId: string
          entityId: string
          externalId: string
          entityType: string
          state: string | number | boolean | null
          attributes: Record<string, unknown>
          timestamp: number
        }
        error?: string
        timestamp: number
      }) => void,
    ) => () => void
  }

  // SensorFusion（传感器数据融合 - 阶段5）
  sensorFusion: {
    // 生命周期
    start: () => Promise<{ success: boolean; data?: boolean; error?: string }>
    stop: () => Promise<{ success: boolean; error?: string }>
    isRunning: () => Promise<{ success: boolean; data?: boolean; error?: string }>

    // 配置管理
    getConfig: () => Promise<{
      success: boolean
      data?: {
        enabled: boolean
        windowSize: number
        zscoreThreshold: number
        rateOfChangeThreshold: number
        stuckValueTimeoutMs: number
        stuckMinReadings: number
        causalIntegrationEnabled: boolean
        counterfactualOnAnomaly: boolean
        monitoringIntegrationEnabled: boolean
        cooldownMs: number
        retentionDays: number
      }
      error?: string
    }>
    updateConfig: (
      patch: Partial<{
        enabled: boolean
        windowSize: number
        zscoreThreshold: number
        rateOfChangeThreshold: number
        stuckValueTimeoutMs: number
        stuckMinReadings: number
        causalIntegrationEnabled: boolean
        counterfactualOnAnomaly: boolean
        monitoringIntegrationEnabled: boolean
        cooldownMs: number
        retentionDays: number
      }>,
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>

    // 状态与窗口统计查询
    getStatus: () => Promise<{
      success: boolean
      data?: {
        running: boolean
        startedAt?: number
        trackedEntityCount: number
        totalReadingsProcessed: number
        totalAnomaliesDetected: number
        activeAnomalyCount: number
      }
      error?: string
    }>
    listEntityWindowStats: () => Promise<{
      success: boolean
      data?: Array<{
        externalId: string
        count: number
        mean: number
        std: number
        min: number
        max: number
        lastTimestamp: number
        lastValue: number | null
      }>
      error?: string
    }>
    getEntityWindowStats: (
      externalId: string,
    ) => Promise<{
      success: boolean
      data?:
        | {
            externalId: string
            count: number
            mean: number
            std: number
            min: number
            max: number
            lastTimestamp: number
            lastValue: number | null
          }
        | null
      error?: string
    }>

    // 事件订阅
    onAnomaly: (
      callback: (event: {
        id: string
        timestamp: number
        type: 'zscore_outlier' | 'rate_of_change' | 'stuck_value' | 'out_of_range'
        severity: 'info' | 'warning' | 'critical'
        providerId: string
        entityId: string
        externalId: string
        entityType: string
        currentValue: number
        unit?: string
        windowStats: {
          externalId: string
          count: number
          mean: number
          std: number
          min: number
          max: number
          lastTimestamp: number
          lastValue: number | null
        }
        description: string
        recommendation: string
        zscore?: number
        rateOfChange?: number
        stuckDurationMs?: number
      }) => void,
    ) => () => void

    // 异常事件历史查询（阶段7 s7-07）
    queryAnomalies: (
      filter: {
        providerId?: string
        entityType?: string
        severity?: string
        type?: string
        startTime?: number
        endTime?: number
        limit?: number
        offset?: number
        sort?: 'asc' | 'desc'
      },
    ) => Promise<{
      success: boolean
      data?: {
        items: Array<{
          id: string
          timestamp: number
          type: 'zscore_outlier' | 'rate_of_change' | 'stuck_value' | 'out_of_range'
          severity: 'info' | 'warning' | 'critical'
          providerId: string
          entityId: string
          externalId: string
          entityType: string
          currentValue: number
          unit?: string
          windowStats: {
            externalId: string
            count: number
            mean: number
            std: number
            min: number
            max: number
            lastTimestamp: number
            lastValue: number | null
          }
          description: string
          recommendation: string
          zscore?: number
          rateOfChange?: number
          stuckDurationMs?: number
        }>
        total: number
      }
      error?: string
    }>
    getRecentAnomalies: (
      limit: number,
    ) => Promise<{
      success: boolean
      data?: Array<{
        id: string
        timestamp: number
        type: 'zscore_outlier' | 'rate_of_change' | 'stuck_value' | 'out_of_range'
        severity: 'info' | 'warning' | 'critical'
        providerId: string
        entityId: string
        externalId: string
        entityType: string
        currentValue: number
        unit?: string
        windowStats: {
          externalId: string
          count: number
          mean: number
          std: number
          min: number
          max: number
          lastTimestamp: number
          lastValue: number | null
        }
        description: string
        recommendation: string
        zscore?: number
        rateOfChange?: number
        stuckDurationMs?: number
      }>
      error?: string
    }>
  }

  // Window
  minimize: () => void
  maximize: () => void
  close: () => void
  toggleDevTools: () => void
  newWindow: () => void
  getWindowId: () => Promise<number>
  resizeWindow: (width: number, height: number, minWidth?: number, minHeight?: number) => Promise<void>
  setTheme: (theme: 'light' | 'dark' | 'system', bgColor?: string) => Promise<boolean>
  setLanguage?: (language: Language) => void,
  // File
  openFile: () => Promise<{ path: string; content: string } | null>
  openKnowledgeFiles: () => Promise<string[] | null>
  readKnowledgeFile: (filePath: string) => Promise<string | null>
  extractKnowledgeDocxText: (filePath: string) => Promise<string | null>
  extractKnowledgeDocText: (filePath: string) => Promise<string | null>
  extractKnowledgeXlsxText: (filePath: string) => Promise<string | null>
  extractKnowledgePptText: (filePath: string) => Promise<string | null>
  extractKnowledgePdfText: (filePath: string) => Promise<string | null>
  openFolder: () => Promise<string | null>
  selectFolder: () => Promise<string | null>
  selectForImport: (options: { title?: string; allowFiles?: boolean; allowDirs?: boolean; multiSelection?: boolean }) => Promise<string[]>
  selectForExport: (options: { title?: string; defaultPath?: string }) => Promise<string | null>
  importIntoWorkspace: (sourcePaths: string[], targetDir: string) => Promise<{ success: boolean; error?: string; results?: Array<{ source: string; target: string; success: boolean; error?: string }> }>
  exportFromWorkspace: (sourcePath: string, targetDir: string) => Promise<{ success: boolean; error?: string; target?: string }>
  shareItem: (filePaths: string[]) => Promise<{ success: boolean; error?: string }>
  openWorkspace: () => Promise<WorkspaceConfig | null>
  addFolderToWorkspace: () => Promise<string | null>
  saveWorkspace: (configPath: string, roots: string[]) => Promise<boolean>
  restoreWorkspace: () => Promise<WorkspaceConfig | null>
  setActiveWorkspace: (roots: string[]) => Promise<boolean | { redirected: true; roots: string[] }>
  getRecentWorkspaces: () => Promise<string[]>
  workspaceExists: (path: string) => Promise<boolean>
  clearRecentWorkspaces: () => Promise<boolean>
  removeFromRecentWorkspaces: (path: string) => Promise<boolean>
  readDir: (path: string) => Promise<FileItem[]>
  getFileTree: (path: string, maxDepth?: number) => Promise<string>
  readFile: (path: string) => Promise<string | null>
  readBinaryFile: (path: string) => Promise<string | null>
  extractDocText: (path: string) => Promise<string | null>
  extractPptText: (path: string) => Promise<string | null>
  extractDocxText: (path: string) => Promise<string | null>
  extractXlsxText: (path: string) => Promise<string | null>
  extractPdfText: (path: string) => Promise<string | null>
  writeFile: (path: string, content: string) => Promise<boolean>
  writeBinaryFile: (path: string, base64Data: string) => Promise<boolean>
  ensureDir: (path: string) => Promise<boolean>
  saveFile: (content: string, path?: string) => Promise<string | null>
  fileExists: (path: string) => Promise<boolean>
  showItemInFolder: (path: string) => Promise<void>
  openInBrowser: (path: string) => Promise<boolean>
  openExternalUrl: (url: string) => Promise<boolean>
  mkdir: (path: string) => Promise<boolean>
  deleteFile: (path: string) => Promise<boolean>
  copyFile: (sourcePath: string, destinationPath: string) => Promise<boolean>
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>
  searchFiles: (query: string, rootPath: string | string[], options?: SearchFilesOptions) => Promise<SearchFileResult[]>
  searchStream: (query: string, rootPath: string | string[], options: SearchFilesOptions, searchId: string) => Promise<void>
  onSearchResults: (callback: (searchId: string, results: SearchFileResult[]) => void) => () => void
  onSearchDone: (callback: (searchId: string) => void) => () => void
  onFileChanged: (callback: (event: { event: 'create' | 'update' | 'delete'; path: string }) => void) => () => void

  // Clipboard
  getClipboardFilePaths: () => Promise<string[]>
  hasClipboardFiles: () => Promise<boolean>
  getClipboardFileAttachments: () => Promise<ClipboardFileAttachment[]>

  // Settings
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<boolean>
  getConfigPath: () => Promise<string>
  setConfigPath: (path: string) => Promise<boolean>
  onSettingsChanged: (callback: (event: { key: string; value: unknown }) => void) => () => void
  getWhitelist: () => Promise<{ shell: string[]; git: string[] }>
  resetWhitelist: () => Promise<{ shell: string[]; git: string[] }>
  getBlacklist: () => Promise<{ shell: string[] }>
  resetBlacklist: () => Promise<{ shell: string[] }>
  getUserDataPath: () => Promise<string>
  getAppConfig: () => Promise<{ serverUrl: string } | null>
  getRecentLogs: () => Promise<string>
  // Settings DB (SQLite)
  settingsDbInitialize: () => Promise<{ success: boolean; dbPath?: string; error?: string }>
  settingsDbLoadAll: () => Promise<{ providerConfigs: Record<string, any>; llmBehavior: Record<string, any>; appSettings: Record<string, any>; currentProviderId: string | null }>
  settingsDbSaveAll: (params: any) => Promise<{ success: boolean; error?: string }>
  settingsDbGetProvider: (providerId: string) => Promise<any>
  settingsDbDeleteProvider: (providerId: string) => Promise<{ success: boolean; error?: string }>
  settingsDbGetPath: () => Promise<string>
  // 视觉模型配置（自定义模式）
  settingsDbGetVisionModelConfig: () => Promise<any | null>
  settingsDbSaveVisionModelConfig: (config: any) => Promise<{ success: boolean; error?: string }>
  settingsDbSetVisionModelEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  // 语音模型配置（自定义模式，STT + TTS 合并存储但分别启用）
  // 配置结构：{ sttEnabled, sttProvider, sttModel, sttApiKey, sttBaseUrl, sttLanguage, sttTimeout,
  //           ttsEnabled, ttsProvider, ttsModel, ttsVoice, ttsApiKey, ttsBaseUrl, ttsSpeed, ttsTimeout }
  settingsDbGetVoiceModelConfig: () => Promise<VoiceModelConfig | null>
  settingsDbSaveVoiceModelConfig: (config: Partial<VoiceModelConfig>) => Promise<{ success: boolean; error?: string }>
  settingsDbSetVoiceModelEnabled: (payload: { sttEnabled: boolean; ttsEnabled: boolean }) => Promise<{ success: boolean; error?: string }>
  // 语音唤醒配置（唤醒开关 + 唤醒词 + 灵敏度 + 冷却）
  // 配置结构：{ enabled, keyword, sensitivity('strict'|'balanced'|'loose'), cooldownMs, minSpeechMs }
  settingsDbGetWakeWordConfig: () => Promise<WakeWordConfig | null>
  settingsDbSaveWakeWordConfig: (config: Partial<WakeWordConfig>) => Promise<{ success: boolean; error?: string }>
  settingsDbSetWakeWordEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  // LLM
  sendMessage: (params: LLMSendMessageParams) => Promise<void>
  compactContext: (params: LLMSendMessageParams) => Promise<{
    content?: string
    usage?: TokenUsage
    metadata?: ResponseMetadata
    error?: string
    code?: string
  }>
  abortMessage: () => void
  onLLMStream: (requestId: string, callback: (chunk: LLMStreamChunk) => void) => () => void
  onLLMToolCall: (callback: (toolCall: LLMToolCall) => void) => () => void
  onLLMError: (requestId: string, callback: (error: LLMError) => void) => () => void
  onLLMDone: (requestId: string, callback: (result: LLMResult) => void) => () => void
  onCloudTokenRefreshed: (callback: (data: { accessToken: string; refreshToken?: string }) => void) => () => void
  onCloudAuthFailed: (callback: () => void) => () => void
  // LLM - Structured Output
  analyzeCode: (params: {
    config: LLMConfig
    code: string
    language: string
    filePath: string
  }) => Promise<LLMResponse<CodeAnalysis>>
  analyzeCodeStream: (params: {
    config: LLMConfig
    code: string
    language: string
    filePath: string
  }) => Promise<LLMResponse<CodeAnalysis>>
  suggestRefactoring: (params: {
    config: LLMConfig
    code: string
    language: string
    intent: string
  }) => Promise<LLMResponse<Refactoring>>
  suggestFixes: (params: {
    config: LLMConfig
    code: string
    language: string
    diagnostics: Array<{
      message: string
      line: number
      column: number
      severity: number
    }>
  }) => Promise<LLMResponse<CodeFix>>
  generateTests: (params: {
    config: LLMConfig
    code: string
    language: string
    framework?: string
  }) => Promise<LLMResponse<TestCase>>
  generateObject: (params: {
    config: LLMConfig
    schema: any
    system: string
    prompt: string
  }) => Promise<{ object: any; usage?: any; metadata?: any; error?: string }>
  // LLM - Embeddings
  embedText: (params: {
    text: string
    config: LLMConfig
  }) => Promise<LLMResponse<number[]>>
  embedMany: (params: {
    texts: string[]
    config: LLMConfig
  }) => Promise<LLMResponse<number[][]>>
  findSimilar: (params: {
    query: string
    candidates: string[]
    config: LLMConfig
    topK?: number
  }) => Promise<Array<{ text: string; similarity: number; index: number }>>

  // Terminal
  createTerminal: (options: { id: string; cwd?: string; shell?: string; backend?: 'pty' | 'pipe'; remote?: RemoteShellServer }) => Promise<{ success: boolean; error?: string }>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id?: string) => void
  getAvailableShells: () => Promise<{ label: string; path: string }[]>
  onTerminalData: (callback: (event: { id: string; data: string; seq: number; occurredAt: number }) => void) => () => void
  onTerminalExit: (callback: (event: { id: string; exitCode: number; signal?: number; seq: number; occurredAt: number; reason: 'process_exit' | 'killed_by_user' | 'remote_close' }) => void) => () => void
  onTerminalError: (callback: (event: { id: string; error: string; seq: number; occurredAt: number; fatal?: boolean; reason: 'process_error' | 'spawn_error' | 'unknown' }) => void) => () => void

  // Remote Shell / SFTP
  remoteShellList: (server: RemoteShellServer, remotePath?: string) => Promise<RemoteShellEntry[]>
  remoteShellReadText: (server: RemoteShellServer, remotePath: string) => Promise<string | null>
  remoteShellWriteText: (server: RemoteShellServer, remotePath: string, content: string) => Promise<boolean>
  remoteShellMkdir: (server: RemoteShellServer, remotePath: string) => Promise<boolean>
  remoteShellRename: (server: RemoteShellServer, oldPath: string, newPath: string) => Promise<boolean>
  remoteShellDelete: (server: RemoteShellServer, remotePath: string) => Promise<boolean>
  remoteShellTestConnection: (server: RemoteShellServer) => Promise<{ success: boolean; error?: string }>
  remoteShellUpload: (server: RemoteShellServer, remoteDirectory: string) => Promise<RemoteShellUploadResult>
  remoteShellDownload: (server: RemoteShellServer, remotePath: string) => Promise<RemoteShellDownloadResult>

  // Shell
  executeBackground: (params: { command: string; cwd?: string; timeout?: number; shell?: string }) => Promise<{
    success: boolean; output: string; exitCode: number; error?: string
  }>
  onShellOutput: (callback: (event: { command: string; type: 'stdout' | 'stderr'; data: string; timestamp: number }) => void) => () => void
  executeSecureCommand: (request: SecureCommandRequest) => Promise<{
    success: boolean; output?: string; errorOutput?: string; exitCode?: number; error?: string
  }>

  // Git
  gitExecSecure: (args: string[], cwd: string) => Promise<{
    success: boolean; stdout?: string; stderr?: string; exitCode?: number; error?: string
  }>

  // Security
  getPermissions: () => Promise<Record<string, string>>
  resetPermissions: () => Promise<boolean>

  // Index
  indexInitialize: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexStart: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexStatus: (workspacePath: string) => Promise<IndexStatus>
  indexHasIndex: (workspacePath: string) => Promise<boolean>
  indexSearch: (workspacePath: string, query: string, topK?: number) => Promise<IndexSearchResult[]>
  indexHybridSearch: (workspacePath: string, query: string, topK?: number) => Promise<IndexSearchResult[]>
  indexSearchSymbols: (workspacePath: string, query: string, topK?: number) => Promise<SymbolInfo[]>
  indexGetProjectSummary: (workspacePath: string) => Promise<ProjectSummary | null>
  indexGetProjectSummaryText: (workspacePath: string) => Promise<string>
  indexSetMode: (workspacePath: string, mode: 'structural' | 'semantic') => Promise<{ success: boolean; error?: string }>
  indexUpdateFile: (workspacePath: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  indexClear: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexUpdateEmbeddingConfig: (workspacePath: string, config: EmbeddingConfigInput) => Promise<{ success: boolean; error?: string }>
  indexTestConnection: (workspacePath: string) => Promise<{ success: boolean; error?: string; latency?: number }>
  indexGetProviders: () => Promise<EmbeddingProvider[]>
  indexParseCallGraph: (filePath: string, content: string) => Promise<any[]>
  onIndexProgress: (callback: (status: IndexStatus) => void) => () => void

  // LSP
  lspStart: (workspacePath: string) => Promise<{ success: boolean }>
  lspStop: () => Promise<{ success: boolean }>
  lspDidOpen: (params: { uri: string; languageId: string; version: number; text: string; workspacePath?: string | null }) => Promise<{ success: boolean; serverName: string | null }>
  lspDidChange: (params: { uri: string; version: number; text: string; workspacePath?: string | null }) => Promise<void>
  lspDidClose: (params: { uri: string; workspacePath?: string | null }) => Promise<void>
  lspDidSave: (params: { uri: string; text?: string; workspacePath?: string | null }) => Promise<void>
  lspDefinition: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspTypeDefinition: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspImplementation: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspReferences: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspHover: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspHover | null>
  lspCompletion: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspCompletionList | null>
  lspCompletionResolve: (item: LspCompletionItem) => Promise<LspCompletionItem>
  lspSignatureHelp: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspSignatureHelp | null>
  lspRename: (params: { uri: string; line: number; character: number; newName: string; workspacePath?: string | null }) => Promise<LspWorkspaceEdit | null>
  lspPrepareRename: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspPrepareRename | null>
  lspDocumentSymbol: (params: { uri: string; workspacePath?: string | null }) => Promise<LspDocumentSymbol[] | null>
  lspWorkspaceSymbol: (params: { query: string }) => Promise<LspSymbolInformation[] | null>
  lspCodeAction: (params: { uri: string; range: LspRange; diagnostics?: LspDiagnostic[]; workspacePath?: string | null }) => Promise<LspCodeAction[] | null>
  lspFormatting: (params: { uri: string; options?: LspFormattingOptions; workspacePath?: string | null }) => Promise<LspTextEdit[] | null>
  lspRangeFormatting: (params: { uri: string; range: LspRange; options?: LspFormattingOptions; workspacePath?: string | null }) => Promise<LspTextEdit[] | null>
  lspDocumentHighlight: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspDocumentHighlight[] | null>
  lspFoldingRange: (params: { uri: string; workspacePath?: string | null }) => Promise<LspFoldingRange[] | null>
  lspInlayHint: (params: { uri: string; range: LspRange; workspacePath?: string | null }) => Promise<LspInlayHint[] | null>
  getLspDiagnostics: (filePath: string) => Promise<LspDiagnostic[]>
  onLspDiagnostics: (callback: (params: { uri: string; diagnostics: LspDiagnostic[] }) => void) => () => void
  lspPrepareCallHierarchy: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<unknown[] | null>
  lspIncomingCalls: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<unknown[] | null>
  lspOutgoingCalls: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<unknown[] | null>
  lspWaitForDiagnostics: (params: { uri: string }) => Promise<{ success: boolean }>
  lspFindBestRoot: (params: { filePath: string; languageId: string; workspacePath: string }) => Promise<string>
  lspEnsureServerForFile: (params: { filePath: string; languageId: string; workspacePath: string }) => Promise<{ success: boolean; serverName?: string }>
  lspDidChangeWatchedFiles: (params: { changes: Array<{ uri: string; type: number }>; workspacePath?: string | null }) => Promise<void>
  lspGetSupportedLanguages: () => Promise<string[]>
  lspGetServerStatus: () => Promise<Record<string, { installed: boolean; path?: string }>>
  lspGetBinDir: () => Promise<string>
  lspGetDefaultBinDir: () => Promise<string>
  lspSetCustomBinDir: (customPath: string | null) => Promise<{ success: boolean }>
  lspInstallServer: (serverType: string) => Promise<{ success: boolean; path?: string; error?: string }>
  lspInstallBasicServers: () => Promise<{ success: boolean; error?: string }>

  // HTTP
  httpReadUrl: (url: string, timeout?: number) => Promise<{
    success: boolean; content?: string; title?: string; error?: string; contentType?: string; statusCode?: number
  }>
  httpWebSearch: (query: string, maxResults?: number, timeout?: number) => Promise<{
    success: boolean; results?: Array<{ title: string; url: string; snippet: string; content?: string; publishedDate?: string; engine?: string; score?: number }>; error?: string
  }>
  httpSmartSearch: (query: string, maxResults?: number) => Promise<{
    success: boolean
    domain: string
    domainClassification: { primary: string; secondary: string | null; hits: Array<{ domain: string; count: number; matchedKeywords: string[] }>; isVertical: boolean }
    results: Array<{
      title: string
      url: string
      snippet: string
      content?: string
      sourceType: 'general' | 'vertical-site' | 'encyclopedia' | 'academic' | 'image-stock' | 'image-search' | 'video-search'
      sourceName?: string
      publishedDate?: string
      score?: number
      imageUrl?: string
      thumbnailUrl?: string
      videoLength?: string
      videoAuthor?: string
    }>
    sources: string[]
    error?: string
  }>
  httpImageSearch: (query: string, maxResults?: number, timeout?: number) => Promise<{
    success: boolean; results?: Array<{ title: string; url: string; imgSrc: string; thumbnailSrc?: string; source?: string; imgSize?: string }>; error?: string
  }>
  httpVideoSearch: (query: string, maxResults?: number, timeout?: number) => Promise<{
    success: boolean; results?: Array<{ title: string; url: string; thumbnail?: string; length?: string; author?: string; source?: string; publishedDate?: string }>; error?: string
  }>
  httpSetSearchEngineState: (state: unknown) => Promise<{ success: boolean }>

  // Health Check
  healthCheckProvider: (provider: string, apiKey: string, baseUrl?: string, timeout?: number, protocol?: string) => Promise<{
    provider: string
    status: 'healthy' | 'unhealthy' | 'unknown'
    latency?: number
    error?: string
    checkedAt: Date
  }>
  testModel: (config: LLMConfig) => Promise<{
    success: boolean
    content?: string
    latency?: number
    error?: string
  }>
  fetchModels: (provider: string, apiKey: string, baseUrl?: string, protocol?: string) => Promise<{
    success: boolean
    models?: string[]
    error?: string
  }>

  // MCP
  mcpInitialize: (workspaceRoots: string[]) => Promise<{ success: boolean; error?: string }>
  mcpGetServersState: () => Promise<{ success: boolean; servers?: McpServerState[]; error?: string }>
  mcpGetAllTools: () => Promise<{ success: boolean; tools?: McpToolWithServer[]; error?: string }>
  mcpConnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpDisconnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpReconnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpCallTool: (request: McpToolCallRequest) => Promise<McpToolCallResult>
  mcpReadResource: (request: McpResourceReadRequest) => Promise<McpResourceReadResult>
  mcpGetPrompt: (request: McpPromptGetRequest) => Promise<McpPromptGetResult>
  mcpRefreshCapabilities: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpGetConfigPaths: () => Promise<{ success: boolean; paths?: { user: string; workspace: string[] }; error?: string }>
  mcpReloadConfig: () => Promise<{ success: boolean; error?: string }>
  mcpAddServer: (config: {
    type: 'local' | 'remote' | 'builtin'
    id: string
    name: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    oauth?: { clientId?: string; clientSecret?: string; scope?: string } | false
    builtin?: string
    autoApprove?: string[]
    disabled?: boolean
  }, level?: 'user' | 'workspace') => Promise<{ success: boolean; error?: string }>
  mcpRemoveServer: (serverId: string, level?: 'user' | 'workspace') => Promise<{ success: boolean; error?: string }>
  mcpToggleServer: (serverId: string, disabled: boolean, level?: 'user' | 'workspace') => Promise<{ success: boolean; error?: string }>
  mcpSetAutoConnect: (enabled: boolean) => Promise<{ success: boolean; error?: string }>

  // Email
  emailTestConnection: (config: { host: string; port: number; secure: boolean; user: string; pass: string }) => Promise<{ success: boolean; error?: string }>
  emailSend: (params: { to: string | string[]; subject: string; body: string; html?: boolean; cc?: string[]; bcc?: string[]; attachments?: Array<{ filename: string; content: string; encoding?: string }> }) => Promise<{ success: boolean; error?: string }>
  mcpRegistrySearch: (query?: string) => Promise<{ success: boolean; servers?: any[]; error?: string }>
  mcpRegistryGetDetails: (serverName: string) => Promise<{ success: boolean; server?: any; requiredEnvVars?: any[]; localConfig?: any; error?: string }>
  mcpRegistryInstall: (serverName: string, envValues?: Record<string, string>) => Promise<{ success: boolean; config?: any; error?: string }>
  mcpStartOAuth: (serverId: string) => Promise<{ success: boolean; authorizationUrl?: string; error?: string }>
  mcpFinishOAuth: (serverId: string, authorizationCode: string) => Promise<{ success: boolean; error?: string }>
  mcpRefreshOAuthToken: (serverId: string) => Promise<{ success: boolean; error?: string }>
  onMcpServerStatus: (callback: (event: McpServerStatusEvent & { authUrl?: string }) => void) => () => void
  onMcpToolsUpdated: (callback: (event: McpToolsUpdatedEvent) => void) => () => void
  onMcpResourcesUpdated: (callback: (event: McpResourcesUpdatedEvent) => void) => () => void
  onMcpStateChanged: (callback: (servers: McpServerState[]) => void) => () => void

  // Resources
  resourcesReadJson: <T = unknown>(relativePath: string) => Promise<{ success: boolean; data?: T; error?: string }>
  resourcesReadText: (relativePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
  resourcesExists: (relativePath: string) => Promise<boolean>
  resourcesClearCache: (prefix?: string) => Promise<{ success: boolean }>

  // Debug
  debugCreateSession: (config: DebugConfig) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  debugLaunch: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugAttach: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStop: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugContinue: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStepOver: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStepInto: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStepOut: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugPause: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugSetBreakpoints: (sessionId: string, file: string, breakpoints: DebugBreakpointInput[]) => Promise<{ success: boolean; breakpoints?: DebugBreakpoint[]; error?: string }>
  debugGetStackTrace: (sessionId: string, threadId: number) => Promise<{ success: boolean; frames?: DebugStackFrame[]; error?: string }>
  debugGetScopes: (sessionId: string, frameId: number) => Promise<{ success: boolean; scopes?: DebugScope[]; error?: string }>
  debugGetVariables: (sessionId: string, variablesReference: number) => Promise<{ success: boolean; variables?: DebugVariable[]; error?: string }>
  debugEvaluate: (sessionId: string, expression: string, frameId?: number) => Promise<{ success: boolean; result?: { result: string; type: string }; error?: string }>
  debugGetSessionState: (sessionId: string) => Promise<DebugSessionState | null>
  debugGetAllSessions: () => Promise<DebugSessionState[]>
  debugGetSupportedTypes: () => Promise<Array<{ type: string; label: string; languages: string[]; configurationSnippets: any[] }>>
  debugGetConfigSnippets: (type: string) => Promise<any[]>
  debugConfigurationDone: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugGetThreads: (sessionId: string) => Promise<{ success: boolean; threads?: any[]; error?: string }>
  debugGetCapabilities: (sessionId: string) => Promise<any>
  onDebugEvent: (callback: (event: { sessionId: string; event: DebugEvent }) => void) => () => void

  // Updater
  updaterCheck: () => Promise<UpdateStatus>
  updaterGetStatus: () => Promise<UpdateStatus>
  updaterDownload: () => Promise<UpdateStatus>
  updaterInstall: () => void
  updaterOpenDownloadPage: (url?: string) => void
  onUpdaterStatus: (callback: (status: UpdateStatus) => void) => () => void

  // App Error (from main process)
  onAppError: (callback: (error: { title: string; message: string; variant?: string }) => void) => () => void

  // Skills
  skillsGetGlobalDir: () => Promise<string>
  skillsList: (workspacePaths?: string[]) => Promise<{
    success: boolean
    skills?: Array<{ name: string; description: string; scope: 'global' | 'workspace' }>
    error?: string
  }>
  skillsRead: (
    name: string,
    workspacePaths?: string[],
  ) => Promise<{
    success: boolean
    skill?: { name: string; content: string; scope: 'global' | 'workspace' } | null
    error?: string
  }>

  // Channel 多渠道
  channelInitialize: () => Promise<{ success: boolean; error?: string }>
  channelShutdown: () => Promise<{ success: boolean; error?: string }>
  channelGetRegisteredChannels: () => Promise<{ success: boolean; channels?: any[]; error?: string }>
  channelGetSecretSchema: (channelId: string) => Promise<{ success: boolean; schema?: any[]; error?: string }>
  channelValidateCredentials: (channelId: string, credentials: Record<string, string>) => Promise<{ success: boolean; valid?: boolean; error?: string }>
  channelAddAccount: (channelId: string, account: any) => Promise<{ success: boolean; error?: string }>
  channelRemoveAccount: (channelId: string, accountId: string) => Promise<{ success: boolean; error?: string }>
  channelUpdateAccount: (channelId: string, account: any) => Promise<{ success: boolean; error?: string }>
  channelConnectAccount: (channelId: string, accountId: string) => Promise<{ success: boolean; error?: string }>
  channelDisconnectAccount: (channelId: string, accountId: string) => Promise<{ success: boolean; error?: string }>
  channelSendMessage: (message: any) => Promise<{ success: boolean; messageId?: string; error?: string }>
  channelGetAccountStatus: (channelId: string, accountId: string) => Promise<{ success: boolean; status?: any; error?: string }>
  channelGetAllAccountStatuses: () => Promise<{ success: boolean; statuses?: any[]; error?: string }>
  channelGetConfig: (channelId: string) => Promise<{ success: boolean; config?: any; error?: string }>
  channelGetAllConfigs: () => Promise<{ success: boolean; configs?: any[]; error?: string }>
  channelSetChannelEnabled: (channelId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
  channelGetWebhookInfo: () => Promise<{ success: boolean; running: boolean; port: number; url: string; error?: string }>
  channelFetchQRCode: (channelId: string) => Promise<{ success: boolean; qrcode?: string; qrcode_img_content?: string; error?: string }>
  channelPollQRStatus: (channelId: string, qrcode: string) => Promise<{ success: boolean; status?: string; bot_token?: string; ilink_bot_id?: string; baseurl?: string; error?: string }>
  channelSendReply: (conversationKey: string, text: string, replyToId?: string) => Promise<{ success: boolean; error?: string; messageId?: string }>
  channelSendFile: (conversationKey: string, filePath: string, fileName?: string, mediaType?: 'file' | 'image' | 'audio' | 'video', replyToId?: string) => Promise<{ success: boolean; error?: string; messageId?: string }>
  channelUpdateReaction: (accountId: string, messageId: string, status: string) => Promise<{ success: boolean }>
  channelStreamReply: (accountId: string, to: string, fullText: string, replyToId?: string) => Promise<{ success: boolean; error?: string; messageId?: string }>
  channelRendererReply: (messageId: string, replyText: string) => Promise<{ success: boolean }>
  onChannelMessage: (callback: (message: any) => void) => () => void
  onChannelInboundMessage: (callback: (message: any) => void) => () => void
  onChannelStatusChange: (callback: (snapshot: any) => void) => () => void
  onChannelImProcessingStatus: (callback: (status: any) => void) => () => void

  // Command
  onExecuteCommand: (callback: (commandId: string, payload?: unknown) => void) => () => void

  // Menu Scenario Sync
  syncScenarios: (data: { scenarios: Array<{ id: string; name: string; description?: string; category?: string }>; activeId: string | null }) => void
  onScenarioRequest: (callback: () => void) => () => void

  // Audit
  auditAppend: (entries: AuditEntry | AuditEntry[]) => Promise<{ success: boolean }>
  auditQuery: (filter?: AuditQueryFilter) => Promise<{ success: boolean; entries: AuditEntry[] }>
  auditFlush: () => Promise<{ success: boolean }>

  // Cron 调度器
  cronRegister: (config: any) => Promise<any>
  cronUpdate: (taskId: string, updates: any) => Promise<any>
  cronUnregister: (taskId: string) => Promise<{ success: boolean }>
  cronPause: (taskId: string) => Promise<{ success: boolean }>
  cronResume: (taskId: string) => Promise<{ success: boolean }>
  cronGetAllTasks: () => Promise<{ success: boolean; tasks: any[] }>
  cronGetTasksForAgent: (agentId: string) => Promise<{ success: boolean; tasks: any[] }>
  cronStart: () => Promise<{ success: boolean }>
  cronStop: () => Promise<{ success: boolean }>
  // 按 ruleId 操作（自动化规则同步用）
  cronUnregisterByRuleId: (ruleId: string) => Promise<{ success: boolean }>
  cronPauseByRuleId: (ruleId: string) => Promise<{ success: boolean }>
  cronResumeByRuleId: (ruleId: string) => Promise<{ success: boolean }>
  cronPauseByRuleIdPrefix: (prefix: string) => Promise<{ success: boolean; count: number }>
  cronResumeByRuleIdPrefix: (prefix: string) => Promise<{ success: boolean; count: number }>
  cronGetTaskByRuleId: (ruleId: string) => Promise<{ success: boolean; task: any | null }>
  cronUpsertByRuleId: (
    ruleId: string,
    updates: { name?: string; description?: string; expression?: string; command?: string; maxCalls?: number },
    active?: boolean,
  ) => Promise<{ success: boolean; task?: any; error?: string }>
  onCronTaskStateChanged: (callback: (taskData: any) => void) => () => void
  onCronTaskExecute: (callback: (event: any) => void) => () => void

  // System
  onSystemResume: (callback: () => void) => () => void

  // ============ Desktop Control ============
  desktopLaunchApp: (name: string, args?: string[]) => Promise<{ success: boolean; data: any }>
  desktopQuitApp: (name: string) => Promise<{ success: boolean; data: any }>
  desktopListInstalledApps: () => Promise<{ success: boolean; data: any[] }>
  desktopFindApp: (name: string) => Promise<{ success: boolean; data: any | null }>
  desktopOpenUrl: (url: string) => Promise<{ success: boolean; data: any }>
  desktopOpenFile: (filePath: string) => Promise<{ success: boolean; data: any }>
  desktopGetSystemInfo: () => Promise<{ success: boolean; data: any }>
  desktopSetVolume: (volume: number) => Promise<{ success: boolean; data: any }>
  desktopSetBrightness: (level: number) => Promise<{ success: boolean; data: any }>
  desktopListProcesses: () => Promise<{ success: boolean; data: any[] }>
  desktopFindProcess: (query: string | number) => Promise<{ success: boolean; data: any[] }>
  desktopKillProcess: (pid: number, force?: boolean) => Promise<{ success: boolean; data: any }>
  desktopIsProcessRunning: (name: string) => Promise<{ success: boolean; data: boolean }>

  // ============ Desktop Control Phase 2: 窗口控制 ============
  desktopListWindows: () => Promise<{ success: boolean; data: any[] }>
  desktopFindWindow: (query: string) => Promise<{ success: boolean; data: any[] }>
  desktopFocusWindow: (windowId: string) => Promise<{ success: boolean; data: any }>
  desktopMinimizeWindow: (windowId: string) => Promise<{ success: boolean; data: any }>
  desktopMaximizeWindow: (windowId: string) => Promise<{ success: boolean; data: any }>
  desktopRestoreWindow: (windowId: string) => Promise<{ success: boolean; data: any }>
  desktopCloseWindow: (windowId: string) => Promise<{ success: boolean; data: any }>
  desktopBringWindowToFront: (windowId: string) => Promise<{ success: boolean; data: any }>
  desktopSetWindowBounds: (windowId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean; data: any }>

  // ============ Desktop Control Phase 2: 屏幕截图 ============
  desktopCaptureScreen: (displayId?: number) => Promise<{ success: boolean; data: any }>
  desktopCaptureRegion: (region: { x: number; y: number; width: number; height: number }, displayId?: number) => Promise<{ success: boolean; data: any }>
  desktopCaptureAllScreens: () => Promise<{ success: boolean; data: any[] }>

  // ============ Desktop Control Phase 2: 输入模拟 ============
  desktopMouseClick: (params: { x: number; y: number; button: 'left' | 'right' | 'middle'; clickType: 'single' | 'double' }) => Promise<{ success: boolean; data: any }>
  desktopMouseMove: (params: { x: number; y: number; smooth?: boolean; duration?: number }) => Promise<{ success: boolean; data: any }>
  desktopMouseScroll: (params: { x: number; y: number; amount: number }) => Promise<{ success: boolean; data: any }>
  desktopMouseDrag: (params: { fromX: number; fromY: number; toX: number; toY: number; button: 'left' | 'right' | 'middle'; duration?: number }) => Promise<{ success: boolean; data: any }>
  desktopTypeText: (text: string, delayMs?: number) => Promise<{ success: boolean; data: any }>
  desktopPressKey: (key: string) => Promise<{ success: boolean; data: any }>
  desktopKeyCombo: (keys: string[]) => Promise<{ success: boolean; data: any }>

  // ============ Desktop Control Phase 2: 文件操作 ============
  desktopCopyFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; data: any }>
  desktopMoveFile: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; data: any }>
  desktopDeleteFile: (targetPath: string) => Promise<{ success: boolean; data: any }>
  desktopRenameFile: (sourcePath: string, newName: string) => Promise<{ success: boolean; data: any }>
  desktopGetFileInfo: (targetPath: string) => Promise<{ success: boolean; data: any }>
  desktopFileExists: (targetPath: string) => Promise<{ success: boolean; data: boolean }>
  desktopCreateDirectory: (targetPath: string) => Promise<{ success: boolean; data: any }>
  desktopListDirectory: (targetPath: string) => Promise<{ success: boolean; data: any[] }>

  // Phase 3: 紧急停止
  desktopEmergencyStopGetState: () => Promise<{ success: boolean; data: any }>
  desktopEmergencyStopTrigger: (params: { source: string; reason?: string }) => Promise<{ success: boolean }>
  desktopEmergencyStopReset: () => Promise<{ success: boolean }>
  onDesktopEmergencyStopStateChange: (callback: (state: any) => void) => () => void

  // Phase 3: 辅助功能权限
  desktopAccessibilityCheck: (type?: string, forceRefresh?: boolean) => Promise<{ success: boolean; data: any }>
  desktopAccessibilityCheckAll: (forceRefresh?: boolean) => Promise<{ success: boolean; data: any[] }>
  desktopAccessibilityOpenPreferences: (type?: string) => Promise<{ success: boolean; data: boolean }>
  desktopAccessibilityRequestPermission: (type?: string) => Promise<{ success: boolean; data: any }>
  onDesktopAccessibilityPermissionChange: (callback: (type: string, status: string) => void) => () => void

  // ============ Plugin System ============
  /** 安装插件（下载 + 校验 + 解压 + 注册 + MCP 连接） */
  pluginInstall: (params: {
    pluginId: string
    version: string
    backendUrl: string
    authToken?: string
    /** 预取的下载信息（渲染进程已通过 backendApi 获取时传入，主进程跳过网络请求） */
    preloadedDownloadInfo?: {
      downloadUrl: string
      checksum: string
      packageSize: number
      manifest?: unknown
      configOnly?: boolean
    }
    /** 预取的插件详情（渲染进程已通过市场列表项构建时传入，主进程跳过网络请求） */
    preloadedPluginDetail?: {
      pluginId: string
      pluginKey: string
      name: string
      nameZh: string
      description: string
      descriptionZh: string
      type: string
      icon?: string
      category: string
      tags: string[]
      developerId?: string
      source: string
      isFree: boolean
      price: number
      latestVersion?: string
      totalDownloads: number
      rating: number
      ratingCount: number
      featured: boolean
      minAppVersion?: string
      platforms: string[]
      screenshotUrls: string[]
      homepage?: string
      repository?: string
      license: string
      enabled: boolean
    }
    /** 用户填写的插件配置值（覆盖 defaultValue，用于 {{config.KEY}} 模板替换） */
    userConfig?: Record<string, string>
  }) => Promise<{
    success: boolean
    pluginId: string
    pluginKey: string
    version: string
    pluginDir: string
    manifest?: unknown
    mcpServerId?: string
    error?: string
  }>
  /** 卸载插件 */
  pluginUninstall: (pluginKey: string) => Promise<{ success: boolean; error?: string }>
  /** 启用插件 */
  pluginEnable: (pluginKey: string) => Promise<{ success: boolean; error?: string }>
  /** 禁用插件 */
  pluginDisable: (pluginKey: string) => Promise<{ success: boolean; error?: string }>
  /** 获取已安装插件列表 */
  pluginGetInstalled: () => Promise<Array<{
    pluginId: string
    pluginKey: string
    version: string
    installedAt: string
    enabled: boolean
    types: string[]
    manifest: unknown
    mcpServerId?: string
  }>>
  /** 检查是否已安装 */
  pluginIsInstalled: (pluginKey: string) => Promise<boolean>
  /** 检查插件更新 */
  pluginCheckUpdate: (
    pluginKey: string,
    backendUrl: string,
    authToken?: string,
  ) => Promise<{
    hasUpdate: boolean
    currentVersion?: string
    latestVersion?: string
  }>
  /** 读取插件用户配置（用于 {{config.KEY}} 模板替换） */
  pluginGetConfig: (pluginKey: string) => Promise<Record<string, string>>
  /** 获取已安装插件的 UI 贡献列表（用于扩展点加载器） */
  pluginGetUiContributions: () => Promise<Array<{
    pluginKey: string
    version: string
    uiEntryAbsPath: string
    contributes: {
      ui?: { entry: string }
      sidebarPanels?: Array<{
        id: string
        icon: string
        label: string
        labelZh: string
        component: string
        position?: number
        wideMode?: boolean
      }>
      topActions?: Array<{
        id: string
        component: string
        position?: number
      }>
    }
    mcpServerId?: string
  }>>
  /** 保存插件用户配置（并触发 MCP 重连，若该插件是 MCP 型且已注册） */
  pluginSaveConfig: (
    pluginKey: string,
    values: Record<string, string>,
  ) => Promise<{ success: boolean; reconnected: boolean; error?: string }>
  /** 订阅插件安装进度事件 */
  onPluginInstallProgress: (callback: (progress: {
    pluginId: string
    phase: 'pending' | 'downloading' | 'verifying' | 'extracting' | 'registering' | 'mcp_connecting' | 'done' | 'error'
    bytesDownloaded: number
    bytesTotal: number
    percent: number
    message?: string
  }) => void) => () => void

  // ============================================
  // 悬浮头像（语音唤醒 + 系统级悬浮头像 + 托盘）
  // ============================================
  /** 语音上下文（主窗口 push，头像窗口 get） */
  floatingAvatar: {
    /** 显示头像窗口 */
    show: () => Promise<{ success: boolean; error?: string }>
    /** 隐藏头像窗口（不销毁） */
    hide: () => Promise<{ success: boolean; error?: string }>
    /** 切换显示/隐藏 */
    toggle: () => Promise<{ success: boolean; visible: boolean; error?: string }>
    /** 查询头像是否可见 */
    isVisible: () => Promise<{ success: boolean; visible: boolean; error?: string }>
    /** 读取头像偏好配置（持久化） */
    getConfig: () => Promise<{
      success: boolean
      data?: {
        enabled: boolean
        showOnStartup: boolean
        size: number
        positionX: number | null
        positionY: number | null
      }
      error?: string
    }>
    /** 增量更新头像偏好配置并持久化 */
    updateConfig: (config: Partial<{
      enabled: boolean
      showOnStartup: boolean
      size: number
      positionX: number | null
      positionY: number | null
    }>) => Promise<{
      success: boolean
      data?: {
        enabled: boolean
        showOnStartup: boolean
        size: number
        positionX: number | null
        positionY: number | null
      }
      error?: string
    }>
    /** 读取头像窗口当前位置 */
    getPosition: () => Promise<{ success: boolean; data?: { x: number; y: number } | null; error?: string }>
    /** 设置头像窗口位置并持久化 */
    setPosition: (x: number, y: number) => Promise<{ success: boolean; error?: string }>
    /** 读取语音上下文缓存（头像窗口启动时调用） */
    getVoiceContext: () => Promise<{
      success: boolean
      data?: VoiceContextPayload
      error?: string
    }>
    /** 主窗口 push 语音上下文到缓存（并转发给头像窗口） */
    updateVoiceContext: (partial: Partial<VoiceContextPayload>) => Promise<{
      success: boolean
      data?: VoiceContextPayload
      error?: string
    }>
    /** 头像→main：唤醒词命中通知 */
    wakeWordDetected: (info: unknown) => Promise<{ success: boolean; error?: string }>
    /** 头像→main：语音状态变化（转发主窗口 + 托盘） */
    voiceStateChanged: (payload: VoiceStateChangedPayload) => Promise<{ success: boolean; error?: string }>
    /** 头像→main→主窗口：保存对话历史 */
    saveConversation: (payload: SaveConversationPayload) => Promise<{ success: boolean; error?: string }>
    /** 头像→main：打开/创建并聚焦主窗口 */
    openMainWindow: () => Promise<{ success: boolean; error?: string }>
    /** 头像→main：请求麦克风权限（macOS） */
    requestMicPermission: () => Promise<{
      success: boolean
      data?: { granted: boolean; platform: string }
      error?: string
    }>
    /** 头像/托盘→main：触发完整退出 */
    quitApp: () => Promise<{ success: boolean; error?: string }>
    /** 头像→main：获取拖拽 IPC 频道对象（含窗口 id，启动时调用一次）
     *  返回 { start, end } 两个频道，主进程在 start 时自取鼠标+窗口坐标 */
    getDragChannel: () => Promise<{ success: boolean; data?: { start: string; end: string }; error?: string }>
    /** 头像→main→主窗口：获取可用模型列表（主窗口从 store 构建后返回） */
    getAvailableModels: () => Promise<{ success: boolean; data?: AvatarModelOption[]; error?: string }>
    /** 头像→main→主窗口：切换模型（主窗口更新 store + save + 重新 push voiceContext） */
    selectModel: (payload: { provider: string; model: string; isCloud: boolean }) => Promise<{ success: boolean; error?: string }>
    /** 主窗口→main：返回模型列表（内部中转，主窗口监听 onRequestModels 后调用） */
    sendModelsResponse: (requestId: string, models: AvatarModelOption[]) => void
    /** 事件：主窗口收到模型列表请求（main→主窗口监听） */
    onRequestModels: (callback: (requestId: string) => void) => () => void
    /** 事件：头像窗口请求切换模型（main→主窗口监听） */
    onSelectModel: (callback: (payload: { provider: string; model: string; isCloud: boolean }) => void) => () => void
    /** 头像→main→主窗口：切换授权方式 */
    selectAuthorizationMode: (mode: 'every-step' | 'dangerous-only' | 'never') => Promise<{ success: boolean; error?: string }>
    /** 事件：头像窗口请求切换授权方式（main→主窗口监听） */
    onSelectAuthorizationMode: (callback: (mode: 'every-step' | 'dangerous-only' | 'never') => void) => () => void
    /** 头像→main→主窗口：切换工作模式 */
    selectWorkMode: (mode: 'chat' | 'agent' | 'plan') => Promise<{ success: boolean; error?: string }>
    /** 事件：头像窗口请求切换工作模式（main→主窗口监听） */
    onSelectWorkMode: (callback: (mode: 'chat' | 'agent' | 'plan') => void) => () => void
    /** 头像→main→主窗口：切换自定义智能体（agentId 为 null 表示不使用智能体） */
    selectAgent: (agentId: string | null) => Promise<{ success: boolean; error?: string }>
    /** 事件：头像窗口请求切换自定义智能体（main→主窗口监听） */
    onSelectAgent: (callback: (agentId: string | null) => void) => () => void
    /** 头像→main：打开主窗口设置页（迷你聊天「创建智能体」入口） */
    openSettings: () => Promise<{ success: boolean; error?: string }>
    /** 主窗口→main→头像：推送主窗口当前对话快照（单向 send） */
    pushMainConversation: (snapshot: MainConversationSnapshot) => void
    /** 事件：主窗口对话快照更新（main→头像窗口） */
    onMainConversation: (callback: (snapshot: MainConversationSnapshot) => void) => () => void
    /** 主窗口→main→头像窗口：推送主题色更新 */
    updateTheme: (payload: { themeColor: string; themeMode: string }) => void
    /** 事件：主题更新（main→头像窗口监听） */
    onUpdateTheme: (callback: (payload: { themeColor: string; themeMode: string }) => void) => () => void
    /** 头像→main：展开窗口以显示对话面板 */
    expand: () => Promise<{ success: boolean; expanded: boolean; error?: string }>
    /** 头像→main：收起窗口到仅显示球体 */
    collapse: () => Promise<{ success: boolean; expanded: boolean; error?: string }>
    /** 头像→main：查询当前是否展开 */
    isExpanded: () => Promise<{ success: boolean; expanded: boolean; error?: string }>
    /** 主窗口→main→头像：通知主窗口全功能语音对话是否激活（单向 send） */
    notifyMainConversationActive: (active: boolean) => void
    /** 主窗口→main→头像：推送项目执行状态摘要（单向 send） */
    pushExecutionStatus: (status: ExecutionStatusSummary | null) => void
    /** 事件：项目执行状态更新（main→头像窗口） */
    onExecutionStatus: (callback: (status: ExecutionStatusSummary | null) => void) => () => void
    /** 事件：状态栏边缘方向（main→头像窗口，'left' | 'right' | null） */
    onStatusEdge: (callback: (edge: 'left' | 'right' | null) => void) => () => void
    /** 头像→main：扩展窗口高度以显示执行状态栏（球体上方） */
    expandForStatus: () => void
    /** 头像→main：收起执行状态栏（恢复原始球体尺寸） */
    collapseForStatus: () => void
    /** 头像→main：扩展窗口宽度以显示 tooltip（鼠标悬停时） */
    expandForTooltip: () => void
    /** 头像→main：收起 tooltip 扩展（鼠标离开时恢复窗口宽度） */
    collapseForTooltip: () => void
    /** 事件：语音上下文已更新（main→头像窗口） */
    onVoiceContextUpdated: (callback: (payload: VoiceContextPayload) => void) => () => void
    /** 事件：主窗口全功能语音对话状态变化（main→头像窗口） */
    onMainConversationActive: (callback: (active: boolean) => void) => () => void
    /** 事件：唤醒开关被托盘/菜单切换（main→头像窗口） */
    onWakeWordToggled: (callback: (enabled: boolean) => void) => () => void
    /** 事件：对话历史保存请求（main→主窗口，头像对话完成后转发） */
    onSaveConversation: (callback: (payload: SaveConversationPayload) => void) => () => void
    /** 事件：语音状态变化转发（main→主窗口，用于 UI 联动） */
    onVoiceStateChanged: (callback: (payload: VoiceStateChangedPayload) => void) => () => void
    /** 事件：右键菜单/托盘「设置」点击（main→主窗口，打开设置页指定 tab） */
    onOpenSettings: (callback: (tab?: string) => void) => () => void
    /** 事件：截图提问完成（main→头像窗口，截图 base64 + 落盘路径，作为附件添加到输入框，由用户输入问题后手动发送） */
    onScreenshotResult: (callback: (payload: { base64: string; mediaType: string; width: number; height: number; filePath: string; fileName: string }) => void) => () => void
    /** 启动截图提问（与右键菜单「截图提问」共用同一流程：全屏区域选择 → 截图 → 作为附件添加到输入框） */
    startScreenshotAsk: () => Promise<{ success: boolean; error?: string }>
    /** 拖拽：发送拖拽开始信号（主进程接管鼠标追踪，自取坐标） */
    sendDragStart: (channel: string) => void
    /** 拖拽：发送拖拽结束信号（触发边缘吸附 + 位置持久化） */
    sendDragEnd: (channel: string) => void
  }

  // 主窗口截图（聊天输入框截图按钮，与悬浮球截图完全独立）
  screenshot: {
    /** 启动截图：触发全屏区域选择覆盖窗口，用户框选确认后截图并推送给主窗口 */
    start: () => Promise<{ success: boolean; error?: string }>
    /** 截图完成事件订阅（main→主窗口：截图 base64 + 落盘路径，主窗口作为附件添加到输入框） */
    onResult: (callback: (payload: { base64: string; mediaType: string; width: number; height: number; filePath: string; fileName: string }) => void) => () => void
  }

  // Proactive（主动式助手 - 阶段10 s10-02）
  proactive: {
    /** 主动提案来源场景 */
    // type ProactiveSource = 'coding' | 'iot' | 'system' | 'time' | 'fusion'

    /** 提案查询过滤条件 */
    // interface ProposalQueryFilter { ... }

    /** 分页查询提案历史 */
    listProposals: (filter?: {
      source?: 'coding' | 'iot' | 'system' | 'time' | 'fusion'
      severity?: 'info' | 'low' | 'medium' | 'high' | 'critical'
      status?: 'pending' | 'notified' | 'suggested' | 'acted' | 'dismissed' | 'accepted' | 'rejected'
      startTime?: number
      endTime?: number
      limit?: number
      offset?: number
      sort?: 'asc' | 'desc'
    }) => Promise<{
      success: boolean
      data?: {
        items: Array<{
          id: string
          source: 'coding' | 'iot' | 'system' | 'time' | 'fusion'
          trigger: string
          severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
          title: string
          description: string
          action: {
            type: 'notify' | 'suggest' | 'chat' | 'execute'
            payload: string
          }
          confidence: number
          reason: string
          signals: string[]
          dedupKey: string
          createdAt: number
        }>
        total: number
      }
      error?: string
    }>

    /** 记录用户反馈 */
    recordFeedback: (
      proposalId: string,
      feedback: 'accepted' | 'rejected' | 'later' | 'ignored',
      actualAction?: string,
    ) => Promise<{ success: boolean; error?: string }>

    /** 获取采纳率统计 */
    getStats: (
      startTime?: number,
      endTime?: number,
    ) => Promise<{
      success: boolean
      data?: {
        total: number
        accepted: number
        rejected: number
        later: number
        ignored: number
        adoptionRate: number
        bySource: Record<'coding' | 'iot' | 'system' | 'time' | 'fusion', {
          total: number
          accepted: number
          rate: number
        }>
        bySeverity: Record<'info' | 'low' | 'medium' | 'high' | 'critical', {
          total: number
          accepted: number
          rate: number
        }>
      }
      error?: string
    }>

    /** 清空所有历史数据 */
    clearHistory: () => Promise<{ success: boolean; error?: string }>

    /** 查询某提案的反馈列表 */
    listFeedback: (proposalId: string) => Promise<{
      success: boolean
      data?: Array<{
        feedback: 'accepted' | 'rejected' | 'later' | 'ignored'
        actualAction: string | null
        createdAt: number
      }>
      error?: string
    }>

    /** 查询某提案的审计日志 */
    listAuditLogs: (proposalId: string) => Promise<{
      success: boolean
      data?: Array<{
        id: string
        proposalId: string
        event: 'created' | 'permitted' | 'blocked' | 'dispatched' | 'failed' | 'feedback'
        detail: Record<string, unknown>
        createdAt: number
      }>
      error?: string
    }>

    /** 清理过期数据（按 30 天保留期） */
    cleanupExpired: () => Promise<{
      success: boolean
      data?: { removed: number }
      error?: string
    }>

    // ===== 权限配置（s10-05） =====
    /** 获取权限配置（含引擎运行状态 + 频率窗口状态） */
    getPermissionConfig: () => Promise<{
      success: boolean
      data?: {
        config: {
          enabled: boolean
          level: 'off' | 'notify' | 'suggest' | 'act'
          categories: {
            coding: boolean
            iot: boolean
            system: boolean
            time: boolean
          }
          quietHours: {
            enabled: boolean
            start: string
            end: string
          }
          maxDisturbPerHour: number
          criticalWhitelist: string[]
        }
        engineRunning: boolean
        frequency: {
          count: number
          maxPerHour: number
          windowMs: number
        }
      }
      error?: string
    }>

    /** 更新权限配置（部分更新） */
    updatePermissionConfig: (
      patch: Partial<{
        enabled: boolean
        level: 'off' | 'notify' | 'suggest' | 'act'
        categories: {
          coding: boolean
          iot: boolean
          system: boolean
          time: boolean
        }
        quietHours: {
          enabled: boolean
          start: string
          end: string
        }
        maxDisturbPerHour: number
        criticalWhitelist: string[]
      }>,
    ) => Promise<{
      success: boolean
      data?: {
        config: {
          enabled: boolean
          level: 'off' | 'notify' | 'suggest' | 'act'
          categories: {
            coding: boolean
            iot: boolean
            system: boolean
            time: boolean
          }
          quietHours: {
            enabled: boolean
            start: string
            end: string
          }
          maxDisturbPerHour: number
          criticalWhitelist: string[]
        }
        engineRunning: boolean
      }
      error?: string
    }>

    /** 重置权限配置为默认值 */
    resetPermissionConfig: () => Promise<{
      success: boolean
      data?: {
        config: {
          enabled: boolean
          level: 'off' | 'notify' | 'suggest' | 'act'
          categories: {
            coding: boolean
            iot: boolean
            system: boolean
            time: boolean
          }
          quietHours: {
            enabled: boolean
            start: string
            end: string
          }
          maxDisturbPerHour: number
          criticalWhitelist: string[]
        }
        engineRunning: boolean
      }
      error?: string
    }>

    // ===== LLM 决策增强器（s10-03） =====
    /** 初始化 LLM 决策增强器 */
    initLlmRefiner: (config: {
      model: string
      apiKey?: string
      baseUrl?: string
      temperature?: number
    }) => Promise<{ success: boolean; data?: boolean; error?: string }>

    /** 查询 LLM 决策增强器是否已就绪 */
    isLlmRefinerReady: () => Promise<{ success: boolean; data?: boolean; error?: string }>

    /** 重置 LLM 决策增强器（恢复纯规则模式） */
    resetLlmRefiner: () => Promise<{ success: boolean; error?: string }>

    /**
     * 订阅 medium 级主动提案推送（s10-06）
     * 主进程通过 'proactive:proposal' 频道推送，渲染层展示 SuggestionCard
     * @returns 取消订阅函数
     */
    onProposal: (
      callback: (proposal: {
        id: string
        source: 'coding' | 'iot' | 'system' | 'time' | 'fusion'
        trigger: string
        severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
        title: string
        description: string
        action: {
          type: 'notify' | 'suggest' | 'chat' | 'execute'
          payload: string
        }
        confidence: number
        reason: string
        signals: string[]
        dedupKey: string
        createdAt: number
      }) => void,
    ) => () => void

    /**
     * 订阅 high 级主动对话请求（s10-06）
     * 主进程通过 'proactive:invoke-agent' 频道推送，渲染层调用 Agent.send
     * @returns 取消订阅函数
     */
    onInvokeAgent: (
      callback: (payload: {
        proposalId: string
        message: string
        source: 'coding' | 'iot' | 'system' | 'time' | 'fusion'
        title: string
        reason: string
      }) => void,
    ) => () => void

    /**
     * 订阅 critical 级主动执行请求（s10-06）
     * 主进程通过 'proactive:execute-action' 频道推送，渲染层执行预授权动作
     * @returns 取消订阅函数
     */
    onExecuteAction: (
      callback: (payload: {
        proposalId: string
        action: {
          type: 'notify' | 'suggest' | 'chat' | 'execute'
          payload: string
        }
        source: 'coding' | 'iot' | 'system' | 'time' | 'fusion'
        title: string
        reason: string
      }) => void,
    ) => () => void

    /**
     * 设置场景模式主动行为规则（D-步骤4）
     *
     * 场景模式切换时由渲染进程调用，将新模式的 proactiveRules 同步到决策引擎。
     * 决策引擎内部注册场景探测器，在节拍中评估规则条件并生成提案。
     */
    setSceneRules: (rules: Array<{
      id: string
      name: string
      condition: string
      action: string
      payload: string
    }>) => Promise<{ success: boolean; data?: boolean; error?: string }>
  }

  // ============================================
  // 会议纪要窗口（独立常驻窗口）
  // ============================================
  meetingNotes: {
    /** 显示/聚焦会议纪要窗口 */
    show: () => Promise<{ success: boolean; error?: string }>
    /** 获取当前工作区路径（用于显示保存位置预览） */
    getWorkspace: () => Promise<{
      success: boolean
      data?: { workspacePath: string }
      error?: string
    }>
    /** 保存录音原文 txt 到工作区/会议纪要/YYYY-MM-DD/ */
    saveTranscript: (
      payload: import('@protocols/meetingNotes').SaveTranscriptPayload,
    ) => Promise<import('@protocols/meetingNotes').SaveTranscriptResult>
    /** 生成并保存 docx 到工作区/会议纪要/YYYY-MM-DD/ */
    generateDocx: (
      payload: import('@protocols/meetingNotes').GenerateDocxPayload,
    ) => Promise<import('@protocols/meetingNotes').GenerateDocxResult>
    /** 整理进度推送订阅（预留，当前整理在渲染层） */
    onOrganizeProgress: (
      callback: (progress: import('@protocols/meetingNotes').OrganizeProgress) => void,
    ) => () => void
  }

  // ============================================
  // PPT 预览窗口（独立常驻窗口，供 mcp-pptx 插件实时预览）
  // ============================================
  pptPreview: {
    /** 隐藏预览窗口（不销毁，便于下次快速显示） */
    close: () => Promise<{ success: boolean; error?: string }>
    /** 在系统文件管理器中显示已保存的 .pptx 文件 */
    export: (filePath: string) => Promise<{ success: boolean; error?: string }>
    /** 会话打开事件订阅：初始化预览（清空旧数据，设置标题） */
    onOpen: (
      callback: (meta: import('@protocols/pptPreviewProtocol').PptPresentationMeta) => void,
    ) => () => void
    /** 幻灯片数据推送事件订阅：新增/更新一张幻灯片 */
    onPushSlide: (
      callback: (slide: import('@protocols/pptPreviewProtocol').PptSlideData) => void,
    ) => () => void
    /** 生成完成事件订阅：附带保存路径 */
    onMarkComplete: (
      callback: (payload: { sessionId: string; filePath: string }) => void,
    ) => () => void
  }

  // ============================================
  // 项目执行窗口（独立窗口 + 主窗口调用）
  // ============================================
  /** 打开执行窗口参数 */
  projectExecution: {
    /** 最小化到悬浮球（执行窗口调用） */
    minimize: () => void
    /** 关闭窗口（执行窗口调用） */
    close: () => void
    /** 获取悬浮球位置（执行窗口计算动画方向） */
    getAvatarPosition: () => Promise<{
      success: boolean
      data?: { x: number; y: number } | null
      error?: string
    }>
    /** 获取初始任务消息（一次性消费，执行窗口调用） */
    getInitialMessage: (messageKey: string) => Promise<{
      message: string
      silent: boolean
      taskContext?: { taskIds: string[]; kind: 'task' | 'batch' }
    } | null>
    /**
     * 回传 threadId 给主窗口（执行窗口调用）
     * 当主窗口传空 threadId 时，执行窗口创建线程后通过此接口上报。
     */
    reportThreadId: (sessionId: string, threadId: string) => void
    /**
     * 监听 threadId 回传事件（主窗口调用）
     * 执行窗口创建线程后上报，主窗口监听后更新对应任务的 threadId。
     */
    onThreadIdReported: (
      callback: (payload: { sessionId: string; threadId: string }) => void,
    ) => () => void
    /** 推送执行状态（执行窗口 → 主进程 → 主窗口/悬浮球） */
    pushStatus: (
      status: {
        activeCount: number
        runningCount: number
        queuedCount: number
        sessions: Array<{
          id: string
          projectName: string
          status: 'running' | 'queued' | 'completed' | 'failed' | 'aborted'
          kind: 'task' | 'batch'
          batchTotal?: number
          batchCompleted?: number
        }>
      } | null,
    ) => void
    /** 请求打开执行窗口（主窗口调用） */
    open: (params: {
      projectId: string
      projectName: string
      sessionId: string
      threadId: string
      /** 初始任务消息（执行窗口打开后自动发送给 AI 的首条消息） */
      initialMessage?: string
      /** 是否静默注入（不显示为用户消息气泡，但仍发送给 LLM） */
      silent?: boolean
      /** 任务执行上下文（批量执行时用于自动推进 + 同步任务状态） */
      taskContext?: { taskIds: string[]; kind: 'task' | 'batch' }
    }) => void
    /** 请求恢复执行窗口（悬浮球调用） */
    restore: () => void
    /** 查询执行窗口是否存在（含最小化/隐藏状态） */
    exists: () => Promise<boolean>
    /** 新增 Tab 事件（主进程 → 执行窗口） */
    onNewTab: (
      callback: (params: {
        projectId: string
        projectName: string
        sessionId: string
        threadId: string
        /** 初始任务消息（执行窗口打开后自动发送给 AI 的首条消息） */
        initialMessage?: string
        /** 是否静默注入（不显示为用户消息气泡，但仍发送给 LLM） */
        silent?: boolean
        /** 任务执行上下文（批量执行时用于自动推进 + 同步任务状态） */
        taskContext?: { taskIds: string[]; kind: 'task' | 'batch' }
      }) => void,
    ) => () => void
    /** 开始最小化动画事件（主进程 → 执行窗口） */
    onStartMinimizeAnimation: (callback: () => void) => () => void
    /** 开始恢复动画事件（主进程 → 执行窗口） */
    onStartRestoreAnimation: (callback: () => void) => () => void
    /** 执行状态广播事件（主进程 → 主窗口） */
    onStatusBroadcast: (
      callback: (
        status: {
          activeCount: number
          runningCount: number
          queuedCount: number
          sessions: Array<{
            id: string
            projectName: string
            status: 'running' | 'queued' | 'completed' | 'failed' | 'aborted'
            kind: 'task' | 'batch'
            batchTotal?: number
            batchCompleted?: number
          }>
        } | null,
      ) => void,
    ) => () => void
  }

  // ============================================
  // 视频转码（ffmpeg-static 转码不支持的视频编码）
  // ============================================
  videoTranscode: {
    /** 探测视频编码信息 */
    probe: (filePath: string) => Promise<{
      videoCodec: string | null
      audioCodec: string | null
      width: number | null
      height: number | null
      duration: number | null
      fileSize: number | null
      fps: number | null
      bitrate: number | null
      format: string | null
    }>
    /** 判断编码是否被 Chromium 原生支持 */
    isSupported: (probe: {
      videoCodec: string | null
      audioCodec: string | null
      width: number | null
      height: number | null
      duration: number | null
      fileSize: number | null
      fps: number | null
      bitrate: number | null
      format: string | null
    }) => Promise<{ supported: boolean; reason: string }>
    /** 转码为 H.264（进度通过 onProgress 订阅） */
    transcode: (filePath: string) => Promise<{
      outputPath: string
      fromCache: boolean
      elapsedMs: number
    }>
    /** 取消正在进行的转码 */
    cancel: (filePath: string) => Promise<void>
    /** 转码进度事件订阅 */
    onProgress: (
      callback: (payload: {
        filePath: string
        currentTime: number
        duration: number
        percent: number
        speed: string | null
      }) => void,
    ) => () => void
  }

  /** 运行时环境检测与安装 */
  environment: {
    /** 检测全部核心运行时状态（只读，秒级返回，不触发安装） */
    environmentCheck: () => Promise<{
      success: boolean
      status: {
        python: { ready: boolean; path?: string; version?: string; source: string }
        uv: { ready: boolean; path?: string; source: string }
        node: { ready: boolean; path?: string; version?: string; source: string }
        allReady: boolean
      }
    }>
    /** 安装指定运行时（推送进度事件） */
    environmentInstall: (id: 'python' | 'uv' | 'node') => Promise<{ success: boolean }>
    /** 一键安装所有缺失项（按 uv→python→node 顺序串行） */
    environmentInstallAll: () => Promise<{
      success: boolean
      status: {
        python: { ready: boolean; path?: string; version?: string; source: string }
        uv: { ready: boolean; path?: string; source: string }
        node: { ready: boolean; path?: string; version?: string; source: string }
        allReady: boolean
      }
    }>
    /** 订阅安装进度事件（返回取消订阅函数） */
    onEnvironmentProgress: (
      callback: (payload: {
        id: 'python' | 'uv' | 'node'
        stage: 'downloading' | 'installing' | 'configuring' | 'done' | 'error'
        percent: number
        message: string
      }) => void,
    ) => () => void
  }

  /** 设备联动（移动端 ↔ 桌面端）API */
  deviceLink: {
    /** 推送登录凭据，触发或重置 WebSocket 连接 */
    pushCredentials: (payload: {
      serverUrl: string
      accessToken: string
      /** 设备显示名（可选，主进程会用 hostname+OS 自动填充） */
      deviceName?: string
      workspacePath?: string
      workspaceName?: string
    }) => Promise<{ ok: boolean }>
    /** 用户登出：清除凭据并断开 WS 连接 */
    clearCredentials: () => Promise<{ ok: boolean }>
    /** 更新偏好策略 */
    setPreferences: (patch: {
      allowRemoteCommand?: boolean
      allowClipboardPush?: boolean
      allowScreenshot?: boolean
      allowPowerControl?: boolean
    }) => Promise<{ ok: boolean }>
    /** 查询连接状态 */
    getStatus: () => Promise<{
      started: boolean
      deviceId: string
      connected: boolean
      reconnectAttempts: number
      credentialsValid: boolean
    }>
    /** 查询设备 ID */
    getDeviceId: () => Promise<string>
    /** 订阅任务接续事件（来自其他设备） */
    onTaskTransfer: (
      callback: (payload: {
        fromDeviceId: string
        threadId: string
        snippet: string
      }) => void,
    ) => () => void
    onAiTask: (
      callback: (payload: {
        requestId: string
        prompt: string
        scenarioId?: string
        needResult?: boolean
      }) => void,
    ) => () => void
    onRunScenario: (
      callback: (payload: {
        requestId: string
        scenarioId?: string
        prompt?: string
      }) => void,
    ) => () => void
    replyResult: (
      requestId: string,
      result: {
        success: boolean
        output?: string
        error?: string
      },
    ) => void

    // ===== 方向4：场景模式跨端协同 =====
    /** 推送场景模式切换到移动端（PC→移动端） */
    pushSceneMode: (mode: string) => Promise<boolean>
    /** 订阅场景模式同步事件（移动端→PC） */
    onSceneModeSync: (
      callback: (payload: { mode: string }) => void,
    ) => () => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export { }
