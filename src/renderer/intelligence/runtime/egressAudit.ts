/**
 * 网络出口审计（Egress Audit）
 *
 * 职责：把「数据不出本机」从宣传语变成可查证事实。
 *
 * 记录范围：所有会把数据送出本机的通道（模型调用、工具网络请求、检索、
 * 市场、A2A、遥测）。每条记录只保留「发到哪、什么类型、体量多大」，
 * 不保留原文——审计本身不能变成新的泄露面。
 *
 * 诚实性约束：未埋点的通道必须显式暴露为「未覆盖」。
 * 面板只列已记录项而不说明覆盖范围，会让用户产生虚假的安全感。
 */

/** 出口类型 */
export type EgressKind = 'llm' | 'tool' | 'search' | 'marketplace' | 'a2a' | 'telemetry'

/** 全部出口类型 */
export const ALL_EGRESS_CHANNELS: EgressKind[] = [
  'llm',
  'tool',
  'search',
  'marketplace',
  'a2a',
  'telemetry',
]

/**
 * 已埋点的通道
 *
 * 未列出的通道在面板上显式标注为「未覆盖」，不隐瞒盲区。
 */
export const INSTRUMENTED_CHANNELS: EgressKind[] = ['llm', 'search', 'marketplace', 'tool']

/** 出口记录 */
export interface EgressRecord {
  id: string
  timestamp: number
  /** 调用类型 */
  kind: EgressKind
  /** 目标：服务名 / 域名 / 模型标识 */
  target: string
  /** 是否携带用户内容 */
  carriesUserContent: boolean
  /** 内容摘要（脱敏，仅类型与体量，不存原文） */
  payloadOutline?: { tokens?: number; kinds: string[] }
}

/** 记录入参 */
export interface EgressInput {
  kind: EgressKind
  target: string
  carriesUserContent?: boolean
  payloadOutline?: { tokens?: number; kinds: string[] }
  timestamp?: number
}

/** 默认保留的记录条数 */
const DEFAULT_MAX_RECORDS = 500

/**
 * 出口审计日志
 *
 * 定长环形缓冲：审计记录是诊断数据，不能无限增长把存储吃掉。
 */
export class EgressAuditLog {
  private records: EgressRecord[] = []
  private readonly maxRecords: number
  private seq = 0
  private listeners = new Set<() => void>()

  constructor(maxRecords = DEFAULT_MAX_RECORDS) {
    this.maxRecords = maxRecords
  }

  /** 订阅记录变化，返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 单个订阅者出错不影响审计写入
      }
    }
  }

  record(input: EgressInput): EgressRecord {
    const record: EgressRecord = {
      id: `eg-${Date.now().toString(36)}-${(this.seq++).toString(36)}`,
      timestamp: input.timestamp ?? Date.now(),
      kind: input.kind,
      target: input.target,
      carriesUserContent: input.carriesUserContent ?? false,
      payloadOutline: input.payloadOutline,
    }

    this.records.push(record)
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords)
    }

    this.notify()
    return record
  }

  getAll(): EgressRecord[] {
    return [...this.records]
  }

  getByKind(kind: EgressKind): EgressRecord[] {
    return this.records.filter((record) => record.kind === kind)
  }

  /** 携带用户内容的记录：隐私审查时最需要关注的一批 */
  getCarryingUserContent(): EgressRecord[] {
    return this.records.filter((record) => record.carriesUserContent)
  }

  clear(): void {
    this.records = []
    this.notify()
  }

  summary(): {
    total: number
    carryingUserContent: number
    byKind: Array<{ kind: EgressKind; count: number }>
  } {
    const byKind = ALL_EGRESS_CHANNELS.map((kind) => ({
      kind,
      count: this.records.filter((record) => record.kind === kind).length,
    }))

    return {
      total: this.records.length,
      carryingUserContent: this.getCarryingUserContent().length,
      byKind,
    }
  }
}

/** 未埋点的通道：面板需要显式列出 */
export function getUncoveredChannels(): EgressKind[] {
  return ALL_EGRESS_CHANNELS.filter((kind) => !INSTRUMENTED_CHANNELS.includes(kind))
}

export const egressAudit = new EgressAuditLog()

// ============================================================
// 隐私策略
// ============================================================

export interface PrivacyPolicy {
  /** 敏感内容强制走本地模型 */
  forceLocalForSensitive: boolean
  /**
   * 本地模型不可用时是否直接拒绝
   *
   * 为 true 时宁可失败也不静默上云；为 false 时允许回退，但必须在界面上说明。
   */
  denyWhenLocalUnavailable: boolean
}

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicy = {
  forceLocalForSensitive: false,
  denyWhenLocalUnavailable: true,
}

/** 本地模型提供商标识 */
const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'llamacpp', 'localai', 'local']

/** 判断提供商是否为本地部署 */
export function isLocalProvider(provider: string | undefined | null): boolean {
  if (!provider) return false
  const lower = provider.toLowerCase()
  return LOCAL_PROVIDERS.some((name) => lower.includes(name))
}

export interface LocalFirstDecision {
  /** 允许的出口；denied 表示按策略拒绝执行 */
  chosen: 'local' | 'cloud' | 'denied'
  reason: string
  /** 命中的策略名，便于审计回溯 */
  policyApplied?: string
}

/**
 * 本地优先决策
 *
 * 三种结果对应三种处置：
 * - local：敏感内容且本地模型可用，不出本机
 * - denied：敏感内容但本地模型不可用，且策略要求拒绝——宁可失败也不静默外发
 * - cloud：非敏感内容，或用户明确允许回退
 */
export function resolveLocalFirstDecision(input: {
  policy: PrivacyPolicy
  sensitive: boolean
  localModelAvailable: boolean
}): LocalFirstDecision {
  const { policy, sensitive, localModelAvailable } = input

  if (!sensitive) {
    return { chosen: 'cloud', reason: 'task_requires_capability' }
  }

  if (!policy.forceLocalForSensitive) {
    return {
      chosen: 'cloud',
      reason: 'policy_not_enforced',
      policyApplied: 'force_local_for_sensitive=off',
    }
  }

  if (localModelAvailable) {
    return {
      chosen: 'local',
      reason: 'user_policy_sensitive',
      policyApplied: 'force_local_for_sensitive',
    }
  }

  if (policy.denyWhenLocalUnavailable) {
    return {
      chosen: 'denied',
      reason: 'local_unavailable_denied',
      policyApplied: 'deny_when_local_unavailable',
    }
  }

  return {
    chosen: 'cloud',
    reason: 'local_unavailable_fallback_cloud',
    policyApplied: 'deny_when_local_unavailable=off',
  }
}

/**
 * 把决策落到审计记录上
 *
 * 只记目标与体量，不记内容；denied 不产生网络出口，因此不记录。
 */
export function recordRoutingDecision(
  decision: LocalFirstDecision,
  input: { provider: string; model?: string; tokens?: number },
  log: EgressAuditLog = egressAudit,
): EgressRecord | null {
  if (decision.chosen === 'denied') return null

  return log.record({
    kind: 'llm',
    target: input.model ? `${input.provider}/${input.model}` : input.provider,
    carriesUserContent: true,
    payloadOutline: {
      tokens: input.tokens,
      kinds: [decision.chosen === 'local' ? 'local_inference' : 'cloud_inference'],
    },
  })
}
