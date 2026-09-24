/**
 * EffectMetrics API — 会话效果 IPC 桥接
 *
 * 将主进程的 EffectMetricsService 能力暴露给渲染进程。
 * 渲染进程通过 window.electronAPI.effectMetrics.* 调用。
 *
 * 调用方向有两类：
 * - 上行：会话结束时提交轨迹指标、工具调用后上报插件质量
 * - 下行：面板查询效果报告、按插件或场景跑质量门、结清未落库窗口、清空数据
 */

import { ipcRenderer } from 'electron'

/** 统一的 IPC 响应格式 */
export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 会话轨迹指标 */
export interface SessionMetricsPayload {
  totalSteps: number
  futileRetries: number
  futileRetryRatio: number
  loopDetections: number
  firstUsefulStep: number | null
  compressionEvents: number
}

/** 会话结束时的提交体 */
export interface RecordSessionInput {
  sessionId: string
  scenarioId?: string
  startedAt: number
  endedAt: number
  metrics: SessionMetricsPayload
  approvalTotal?: number
  interventions?: number
  inputTokens?: number
  outputTokens?: number
}

/** 一次插件工具调用 */
export interface RecordToolCallInput {
  pluginId: string
  toolName: string
  success: boolean
  invalidArgs: boolean
  timedOut: boolean
  durationMs: number
}

/** 查询范围 */
export interface EffectMetricsQuery {
  scope: 'session' | 'project' | 'period'
  scopeId: string
  since?: number
  until?: number
}

/** 轨迹指标摘要 */
export interface SessionEffectSummary {
  totalSteps: number
  futileRetries: number
  futileRetryRatio: number
  loopDetections: number
  firstUsefulStep: number | null
  compressionEvents: number
  durationMs: number
  sessionCount: number
}

/** 审批开销摘要 */
export interface ApprovalEffect {
  total: number
  byType: Record<string, number>
  interventions: number
}

/** 操作审计摘要 */
export interface AuditEffect {
  allow: number
  deny: number
  error: number
}

/** 资源开销摘要 */
export interface ResourceEffect {
  avgCpuPercent: number | null
  peakMemoryMB: number | null
  eventLoopDelayMs: number | null
}

/** 价值换算摘要 */
export interface ValueEffect {
  savedMinutes: number
  roiPercent: number
}

/** 效果报告 */
export interface EffectReport {
  generatedAt: string
  scope: 'session' | 'project' | 'period'
  scopeId: string
  session?: SessionEffectSummary
  approval?: ApprovalEffect
  audit?: AuditEffect
  resource?: ResourceEffect
  baseline?: unknown
  value?: ValueEffect
  notes: string[]
}

// ============================================================
// 质量门
// ============================================================

/** 质量门作用维度 */
export type QualityGateScope = 'plugin' | 'scenario'

/** 单条指标变化 */
export interface QualityMetricDelta {
  metric: string
  /** 面向人的指标名 */
  label: string
  baseline: number
  current: number
  /** 变化量：比率类为绝对增量，相对类为相对增幅 */
  delta: number
}

/** 参与比对的指标快照 */
export interface QualitySnapshot {
  metrics: Record<string, number>
  /** 样本数：插件维度为调用次数，场景维度为会话数 */
  sampleCount: number
  windowStart: number
  windowEnd: number
}

/** 门禁结论 */
export interface QualityGateResult {
  passed: boolean
  scope: QualityGateScope
  targetId: string
  metrics: Record<string, number>
  sampleSize: number
  baselineSampleSize: number | null
  /** 触发阻断的原因 */
  regressions: QualityMetricDelta[]
  /** 不阻断但需留意的变化 */
  warnings: Array<QualityMetricDelta & { reason: string }>
  /** 有改善的指标 */
  improvements: QualityMetricDelta[]
  /** 结论说明 */
  notes: string[]
}

/** 门禁配置覆盖，未给的字段取主进程默认值 */
export interface QualityGateConfigOverride {
  minPluginCalls?: number
  minScenarioSessions?: number
  tolerances?: Record<string, number>
}

/** 质量门调用选项 */
export interface QualityGateOptions {
  since?: number
  until?: number
  /** 显式指定基线；传 null 表示按无基线处理，不传则自动取前一个等长窗口 */
  baseline?: QualitySnapshot | null
  config?: QualityGateConfigOverride
}

/** 会话效果 API 接口 */
export interface EffectMetricsApi {
  /** 提交一次会话的轨迹指标 */
  recordSession: (input: RecordSessionInput) => Promise<IpcResponse<boolean>>
  /** 上报一次插件工具调用 */
  recordToolCall: (input: RecordToolCallInput) => Promise<IpcResponse<boolean>>
  /** 查询效果报告 */
  query: (query: EffectMetricsQuery) => Promise<IpcResponse<EffectReport>>
  /** 按插件或场景跑质量门，与基线比对给出阻断/告警结论 */
  qualityGate: (
    scope: QualityGateScope,
    targetId: string,
    options?: QualityGateOptions,
  ) => Promise<IpcResponse<QualityGateResult>>
  /** 结清未落库的插件质量窗口 */
  flush: () => Promise<IpcResponse<boolean>>
  /** 清空全部效果数据 */
  clearAll: () => Promise<IpcResponse<boolean>>
}

/** 创建会话效果 API */
export function createEffectMetricsApi(): EffectMetricsApi {
  return {
    recordSession: (input) => ipcRenderer.invoke('effect-metrics:recordSession', input),

    recordToolCall: (input) => ipcRenderer.invoke('effect-metrics:recordToolCall', input),

    query: (query) => ipcRenderer.invoke('effect-metrics:query', query),

    qualityGate: (scope, targetId, options) =>
      ipcRenderer.invoke('effect-metrics:qualityGate', scope, targetId, options),

    flush: () => ipcRenderer.invoke('effect-metrics:flush'),

    clearAll: () => ipcRenderer.invoke('effect-metrics:clearAll'),
  }
}
