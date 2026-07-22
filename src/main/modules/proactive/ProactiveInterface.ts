/**
 * 主动式 AI 助手 — 类型定义与工具函数
 *
 * 本文件定义阶段 10 主动行动闭环的核心数据结构：
 * - ProactiveProposal：主动提案（决策引擎产出，触发器消费）
 * - ScenarioSignal：场景探测信号（场景探测器产出，决策引擎消费）
 * - ScenarioDetector：场景探测器接口（s10-08/s10-09 实现）
 * - ProactivePermissionConfig：权限配置（s10-05 实现）
 *
 * 数据流向：
 *   场景探测器 → ScenarioSignal[] → ProactiveDecisionEngine → ProactiveProposal[]
 *     → ProactiveActionTrigger → 派发（通知/建议卡片/主动对话/主动执行）
 *
 * @module proactive/ProactiveInterface
 */

// ============================================================
// 基础类型
// ============================================================

/** 主动提案来源场景 */
export type ProactiveSource = 'coding' | 'iot' | 'system' | 'time' | 'fusion'

/** 严重度（5 级，驱动 ActionTrigger 路由） */
export type ProactiveSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'

/** 行动类型（与 severity 解耦，由决策引擎根据场景选择） */
export type ProactiveActionType = 'notify' | 'suggest' | 'chat' | 'execute'

/** 提案状态生命周期 */
export type ProposalStatus =
  | 'pending'       // 已创建待派发
  | 'notified'      // 已通知（low 级 Electron 通知）
  | 'suggested'     // 已建议（medium 级建议卡片）
  | 'acted'         // 已执行（high 级主动对话 / critical 级主动执行）
  | 'dismissed'     // 已忽略（超时无反馈）
  | 'accepted'      // 已采纳
  | 'rejected'      // 已拒绝

/** 用户反馈类型 */
export type ProposalFeedback = 'accepted' | 'rejected' | 'later' | 'ignored'

// ============================================================
// 核心数据结构
// ============================================================

/** 主动行动载荷 */
export interface ProactiveAction {
  /** 行动类型 */
  type: ProactiveActionType
  /**
   * 行动载荷（语义随 type 变化）：
   * - notify：通知正文
   * - suggest：建议详情（展示在卡片上）
   * - chat：发起对话的消息文本（传给 Agent.send）
   * - execute：要执行的命令或 IoT 联动规则 ID
   */
  payload: string
}

/** 主动提案（决策引擎最终产出） */
export interface ProactiveProposal {
  /** 提案唯一 ID */
  id: string
  /** 来源场景 */
  source: ProactiveSource
  /** 触发信号摘要（人类可读，用于审计日志） */
  trigger: string
  /** 严重度 */
  severity: ProactiveSeverity
  /** 建议标题（≤ 30 字，UI 卡片主标题） */
  title: string
  /** 建议描述（1-2 行，UI 卡片副标题） */
  description: string
  /** 行动 */
  action: ProactiveAction
  /** 置信度（0-1，由规则引擎 + LLM 综合给出） */
  confidence: number
  /** 生成理由（用于"查看详情"展开 + 审计） */
  reason: string
  /** 关联信号标签（调试用，如 ['attention:0.82', 'insight:monitoring_anomaly_burst']） */
  signals: string[]
  /** 去重键（同键在 DEDUP_WINDOW_MS 内不重复触发） */
  dedupKey: string
  /** 创建时间戳（ms） */
  createdAt: number
}

/** 场景探测信号（场景探测器产出，决策引擎消费） */
export interface ScenarioSignal {
  /** 来源场景 */
  source: ProactiveSource
  /** 触发信号摘要 */
  trigger: string
  /** 建议严重度（决策引擎可上调/下调） */
  severity: ProactiveSeverity
  /** 建议标题 */
  title: string
  /** 建议描述 */
  description: string
  /** 建议行动 */
  action: ProactiveAction
  /** 置信度（0-1） */
  confidence: number
  /** 生成理由 */
  reason: string
  /** 去重键 */
  dedupKey: string
}

/** 场景探测器接口（s10-08 CodingScenario / s10-09 IotScenario + SystemScenario 实现） */
export interface ScenarioDetector {
  /** 探测器名称（用于日志与注册管理） */
  name: string
  /** 所属场景 */
  source: ProactiveSource
  /**
   * 探测场景信号
   * @returns 候选信号列表（空数组表示当前无信号）
   */
  detect(): Promise<ScenarioSignal[]>
}

// ============================================================
// 权限配置（s10-05 ProactivePermission 使用）
// ============================================================

/** 全局行动等级（逐级递增） */
export type ProactiveLevel = 'off' | 'notify' | 'suggest' | 'act'

/** 主动助手权限配置 */
export interface ProactivePermissionConfig {
  /** 全局开关 */
  enabled: boolean
  /** 全局等级
   *  off    = 完全关闭
   *  notify = 仅 info/low（通知）
   *  suggest = 加上 medium（建议卡片）
   *  act    = 加上 high/critical（主动对话/执行）
   */
  level: ProactiveLevel
  /** 分类开关 */
  categories: {
    coding: boolean
    iot: boolean
    system: boolean
    time: boolean
  }
  /** 勿扰时段（该时段仅 info 级别静默记录） */
  quietHours: {
    enabled: boolean
    /** 开始时间（24h 制 "HH:MM"） */
    start: string
    /** 结束时间（24h 制 "HH:MM"，可跨日如 22:00-08:00） */
    end: string
  }
  /** 每小时主动打扰上限（含 low/medium/high/critical） */
  maxDisturbPerHour: number
  /** critical 动作预授权列表（命令/规则 ID 白名单） */
  criticalWhitelist: string[]
}

// ============================================================
// 统计与学习（s10-10 ProactiveLearner 使用）
// ============================================================

/** 采纳率统计 */
export interface AdoptionStats {
  /** 统计窗口内的提案总数 */
  total: number
  /** 各反馈计数 */
  accepted: number
  rejected: number
  later: number
  ignored: number
  /** 整体采纳率（accepted / total，total=0 时为 0） */
  adoptionRate: number
  /** 按来源场景细分 */
  bySource: Record<ProactiveSource, { total: number; accepted: number; rate: number }>
  /** 按严重度细分 */
  bySeverity: Record<ProactiveSeverity, { total: number; accepted: number; rate: number }>
}

// ============================================================
// 常量
// ============================================================

/** severity → 数值权重（用于排序与阈值比较） */
export const SEVERITY_WEIGHT: Record<ProactiveSeverity, number> = Object.freeze({
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
})

/** level → 允许的最高 severity 权重 */
export const LEVEL_MAX_SEVERITY: Record<ProactiveLevel, number> = Object.freeze({
  off: 0,
  notify: SEVERITY_WEIGHT.low,
  suggest: SEVERITY_WEIGHT.medium,
  act: SEVERITY_WEIGHT.critical,
})

/** 默认权限配置 */
export const DEFAULT_PERMISSION_CONFIG: ProactivePermissionConfig = Object.freeze({
  enabled: false,
  level: 'suggest',
  categories: {
    coding: true,
    iot: true,
    system: true,
    time: true,
  },
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
  maxDisturbPerHour: 3,
  criticalWhitelist: [],
})

// ============================================================
// 工具函数
// ============================================================

/**
 * 生成主动提案 ID
 * 格式：proactive-{timestamp}-{random}
 */
export function generateProactiveId(): string {
  return `proactive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 比较 severity（返回正数表示 a 更严重）
 */
export function compareSeverity(a: ProactiveSeverity, b: ProactiveSeverity): number {
  return SEVERITY_WEIGHT[a] - SEVERITY_WEIGHT[b]
}

/**
 * 判断目标 severity 是否在允许的 level 范围内
 * @param severity 待校验的严重度
 * @param level 当前配置等级
 * @returns 是否允许
 */
export function isSeverityAllowed(severity: ProactiveSeverity, level: ProactiveLevel): boolean {
  if (level === 'off') return false
  return SEVERITY_WEIGHT[severity] <= LEVEL_MAX_SEVERITY[level]
}

/**
 * 判断当前时间是否处于勿扰时段
 * @param now 当前时间
 * @param quietHours 勿扰配置
 * @returns 是否在勿扰时段内
 */
export function isInQuietHours(
  now: Date,
  quietHours: { enabled: boolean; start: string; end: string },
): boolean {
  if (!quietHours.enabled) return false

  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [startH, startM] = quietHours.start.split(':').map(Number)
  const [endH, endM] = quietHours.end.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  // 跨日（如 22:00-08:00）
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }
  // 同日（如 12:00-14:00）
  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}
