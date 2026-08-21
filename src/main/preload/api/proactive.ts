/**
 * Proactive API — 主动式助手 IPC 桥接（阶段10 s10-02 新增）
 *
 * 将主进程的 ProactiveStore 能力暴露给渲染进程。
 * 渲染进程通过 window.electronAPI.proactive.* 调用。
 *
 * 接口：
 * - 历史查询：listProposals / listFeedback / listAuditLogs
 * - 反馈记录：recordFeedback
 * - 统计分析：getStats
 * - 数据维护：clearHistory / cleanupExpired
 *
 * 阶段10 后续任务会扩展以下能力（当前仅占位说明，由后续 IPC 文件实现）：
 * - 决策引擎控制：start/stop/status（s10-04 ProactiveActionTrigger 接入后开放）
 * - 权限配置：getPermissionConfig / updatePermissionConfig（s10-05 ProactivePermission 实现后开放）
 * - 事件订阅：onProposal（s10-06 ProactiveSuggestionCard 实现后开放）
 */

import { ipcRenderer, type IpcRendererEvent } from 'electron'

/** 统一的 IPC 响应格式 */
export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 'proactive:invoke-agent' 频道载荷（high 级，触发 Agent.send） */
export interface InvokeAgentPayload {
  proposalId: string
  message: string
  source: ProactiveSource
  title: string
  reason: string
}

/** 'proactive:execute-action' 频道载荷（critical 级，执行预授权动作） */
export interface ExecuteActionPayload {
  proposalId: string
  action: ProactiveAction
  source: ProactiveSource
  title: string
  reason: string
}

/** 主动提案来源场景 */
export type ProactiveSource = 'coding' | 'iot' | 'system' | 'time' | 'fusion'

/** 严重度（5 级） */
export type ProactiveSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'

/** 行动类型 */
export type ProactiveActionType = 'notify' | 'suggest' | 'chat' | 'execute'

/** 提案状态生命周期 */
export type ProposalStatus =
  | 'pending'
  | 'notified'
  | 'suggested'
  | 'acted'
  | 'dismissed'
  | 'accepted'
  | 'rejected'

/** 用户反馈类型 */
export type ProposalFeedback = 'accepted' | 'rejected' | 'later' | 'ignored'

/** 审计事件类型 */
export type AuditEvent =
  | 'created'
  | 'permitted'
  | 'blocked'
  | 'dispatched'
  | 'failed'
  | 'feedback'

/** 主动行动载荷 */
export interface ProactiveAction {
  type: ProactiveActionType
  payload: string
}

/** 主动提案 */
export interface ProactiveProposal {
  id: string
  source: ProactiveSource
  trigger: string
  severity: ProactiveSeverity
  title: string
  description: string
  action: ProactiveAction
  confidence: number
  reason: string
  signals: string[]
  dedupKey: string
  createdAt: number
}

/** 提案查询过滤条件 */
export interface ProposalQueryFilter {
  source?: ProactiveSource
  severity?: ProactiveSeverity
  status?: ProposalStatus
  startTime?: number
  endTime?: number
  limit?: number
  offset?: number
  sort?: 'asc' | 'desc'
}

/** 提案查询结果 */
export interface ProposalQueryResult {
  items: ProactiveProposal[]
  total: number
}

/** 反馈条目 */
export interface FeedbackEntry {
  feedback: ProposalFeedback
  actualAction: string | null
  createdAt: number
}

/** 审计日志条目 */
export interface AuditLogEntry {
  id: string
  proposalId: string
  event: AuditEvent
  detail: Record<string, unknown>
  createdAt: number
}

/** 采纳率统计 */
export interface AdoptionStats {
  total: number
  accepted: number
  rejected: number
  later: number
  ignored: number
  adoptionRate: number
  bySource: Record<ProactiveSource, { total: number; accepted: number; rate: number }>
  bySeverity: Record<ProactiveSeverity, { total: number; accepted: number; rate: number }>
}

/** 主动行动等级（s10-05 权限配置使用） */
export type ProactiveLevel = 'off' | 'notify' | 'suggest' | 'act'

/** 权限配置（s10-05 新增） */
export interface ProactivePermissionConfig {
  enabled: boolean
  level: ProactiveLevel
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

/** 权限配置查询结果（含运行时状态） */
export interface PermissionConfigResult {
  config: ProactivePermissionConfig
  engineRunning: boolean
  frequency?: {
    count: number
    maxPerHour: number
    windowMs: number
  }
}

/** 主动式助手 API 接口 */
export interface ProactiveApi {
  /** 分页查询提案历史 */
  listProposals: (filter?: ProposalQueryFilter) => Promise<IpcResponse<ProposalQueryResult>>
  /** 记录用户反馈 */
  recordFeedback: (
    proposalId: string,
    feedback: ProposalFeedback,
    actualAction?: string,
  ) => Promise<IpcResponse<boolean>>
  /** 获取采纳率统计 */
  getStats: (startTime?: number, endTime?: number) => Promise<IpcResponse<AdoptionStats>>
  /** 清空所有历史数据 */
  clearHistory: () => Promise<IpcResponse<boolean>>
  /** 查询某提案的反馈列表 */
  listFeedback: (proposalId: string) => Promise<IpcResponse<FeedbackEntry[]>>
  /** 查询某提案的审计日志 */
  listAuditLogs: (proposalId: string) => Promise<IpcResponse<AuditLogEntry[]>>
  /** 清理过期数据（按 30 天保留期） */
  cleanupExpired: () => Promise<IpcResponse<{ removed: number }>>
  /** 获取权限配置（含引擎运行状态 + 频率窗口状态） */
  getPermissionConfig: () => Promise<IpcResponse<PermissionConfigResult>>
  /** 更新权限配置（部分更新，自动持久化 + 同步引擎启停） */
  updatePermissionConfig: (
    patch: Partial<ProactivePermissionConfig>,
  ) => Promise<IpcResponse<{ config: ProactivePermissionConfig; engineRunning: boolean }>>
  /** 重置权限配置为默认值 */
  resetPermissionConfig: () => Promise<IpcResponse<{ config: ProactivePermissionConfig; engineRunning: boolean }>>
  /** 初始化 LLM 决策增强器（s10-03） */
  initLlmRefiner: (config: {
    model: string
    apiKey?: string
    baseUrl?: string
    temperature?: number
  }) => Promise<IpcResponse<boolean>>
  /** 查询 LLM 决策增强器是否已就绪 */
  isLlmRefinerReady: () => Promise<IpcResponse<boolean>>
  /** 重置 LLM 决策增强器（恢复纯规则模式） */
  resetLlmRefiner: () => Promise<IpcResponse<boolean>>
  /**
   * 订阅 medium 级主动提案推送（s10-06）
   * 主进程通过 'proactive:proposal' 频道推送，渲染层展示 SuggestionCard
   * @returns 取消订阅函数
   */
  onProposal: (callback: (proposal: ProactiveProposal) => void) => () => void
  /**
   * 订阅 high 级主动对话请求（s10-06）
   * 主进程通过 'proactive:invoke-agent' 频道推送，渲染层调用 Agent.send
   * @returns 取消订阅函数
   */
  onInvokeAgent: (callback: (payload: InvokeAgentPayload) => void) => () => void
  /**
   * 订阅 critical 级主动执行请求（s10-06）
   * 主进程通过 'proactive:execute-action' 频道推送，渲染层执行预授权动作
   * @returns 取消订阅函数
   */
  onExecuteAction: (callback: (payload: ExecuteActionPayload) => void) => () => void

  /**
   * 设置场景模式主动行为规则（D-步骤4）
   *
   * 场景模式切换时由渲染进程调用，将新模式的 proactiveRules 同步到决策引擎。
   * 决策引擎内部注册场景探测器，在节拍中评估规则条件并生成提案。
   *
   * @param rules 场景规则集（已过滤 enabled=true 的规则）
   */
  setSceneRules: (rules: Array<{
    id: string
    name: string
    condition: string
    action: string
    payload: string
  }>) => Promise<IpcResponse<boolean>>
}

/** 创建主动式助手 API */
export function createProactiveApi(): ProactiveApi {
  return {
    listProposals: (filter = {}) =>
      ipcRenderer.invoke('proactive:listProposals', filter),

    recordFeedback: (proposalId, feedback, actualAction) =>
      ipcRenderer.invoke('proactive:recordFeedback', proposalId, feedback, actualAction),

    getStats: (startTime, endTime) =>
      ipcRenderer.invoke('proactive:getStats', startTime, endTime),

    clearHistory: () => ipcRenderer.invoke('proactive:clearHistory'),

    listFeedback: (proposalId) =>
      ipcRenderer.invoke('proactive:listFeedback', proposalId),

    listAuditLogs: (proposalId) =>
      ipcRenderer.invoke('proactive:listAuditLogs', proposalId),

    cleanupExpired: () => ipcRenderer.invoke('proactive:cleanupExpired'),

    getPermissionConfig: () => ipcRenderer.invoke('proactive:getPermissionConfig'),

    updatePermissionConfig: (patch) => ipcRenderer.invoke('proactive:updatePermissionConfig', patch),

    resetPermissionConfig: () => ipcRenderer.invoke('proactive:resetPermissionConfig'),

    initLlmRefiner: (config) => ipcRenderer.invoke('proactive:initLlmRefiner', config),

    isLlmRefinerReady: () => ipcRenderer.invoke('proactive:isLlmRefinerReady'),

    resetLlmRefiner: () => ipcRenderer.invoke('proactive:resetLlmRefiner'),

    // ===== 事件订阅（s10-06 新增）=====
    onProposal: (callback) => {
      const handler = (
        _event: IpcRendererEvent,
        proposal: ProactiveProposal,
      ): void => {
        callback(proposal)
      }
      ipcRenderer.on('proactive:proposal', handler)
      return () => {
        ipcRenderer.removeListener('proactive:proposal', handler)
      }
    },

    onInvokeAgent: (callback) => {
      const handler = (
        _event: IpcRendererEvent,
        payload: InvokeAgentPayload,
      ): void => {
        callback(payload)
      }
      ipcRenderer.on('proactive:invoke-agent', handler)
      return () => {
        ipcRenderer.removeListener('proactive:invoke-agent', handler)
      }
    },

    onExecuteAction: (callback) => {
      const handler = (
        _event: IpcRendererEvent,
        payload: ExecuteActionPayload,
      ): void => {
        callback(payload)
      }
      ipcRenderer.on('proactive:execute-action', handler)
      return () => {
        ipcRenderer.removeListener('proactive:execute-action', handler)
      }
    },

    // ===== 场景模式规则同步（D-步骤4）=====
    setSceneRules: (rules) =>
      ipcRenderer.invoke('proactive:setSceneRules', rules),
  }
}
