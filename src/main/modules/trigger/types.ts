/**
 * 事件触发器 — 类型定义
 *
 * 数据流：
 *   TriggerSource（事件源，push）
 *     → TriggerEvent
 *     → TriggerRegistry（规则漏斗 + 冷却去重 + 语义漏斗）
 *     → TriggerHit
 *     → 订阅者（任务账本 / 主动提案）
 *
 * 与 automation/CronScheduler 的分工：
 *   CronScheduler 处理"时间到点"的触发；本模块处理"事情发生"的触发。
 *   两者互补，不互相替代。
 *
 * @module trigger/types
 */

/** 事件源类型 */
export type TriggerSourceType = 'file' | 'hook' | 'channel' | 'mail' | 'custom'

/** 触发器命中后的动作类型 */
export type TriggerActionType = 'notify' | 'suggest' | 'task'

/** 事件源 push 上来的原始事件 */
export interface TriggerEvent {
  /** 事件源类型 */
  sourceType: TriggerSourceType
  /** 事件源实例 id（同一类型可能存在多个实例，如多个监听目录） */
  sourceId: string
  /** 细分事件类型，如 'modified' | 'created' | 'message' | 'tool-call' */
  eventType: string
  /** 事件主体，用于规则匹配（文件路径、频道 id 等） */
  subject: string
  /** 附加载荷（由事件源决定结构） */
  payload: Record<string, unknown>
  /** 事件产生时间戳（ms） */
  timestamp: number
}

/** 触发器规则 */
export interface TriggerRule {
  /** 规则 id */
  id: string
  /** 规则名（展示用） */
  name: string
  /** 是否启用 */
  enabled: boolean
  /** 只接收该类型事件源的事件 */
  sourceType: TriggerSourceType
  /**
   * subject 必须命中的模式（glob 或前缀），空数组表示不限。
   * 任一命中即通过。
   */
  include: string[]
  /** subject 命中的排除模式，任一命中即丢弃 */
  ignore: string[]
  /** 只接收这些 eventType，空数组表示不限 */
  eventTypes: string[]
  /** 冷却窗口（ms）：同 dedupKey 在窗口内只触发一次 */
  cooldownMs: number
  /** 命中后的动作描述，由订阅者解释 */
  action: { type: TriggerActionType; payload: string }
  /** 创建时间戳（ms） */
  createdAt: number
}

/** 触发器命中结果 */
export interface TriggerHit {
  ruleId: string
  ruleName: string
  event: TriggerEvent
  /** 去重键：同一规则 + 同一事件主体 */
  dedupKey: string
  /** 命中后的动作描述（透传自规则） */
  action: { type: TriggerActionType; payload: string }
  /** 命中时间戳（ms） */
  timestamp: number
}

/** 语义判定结果 */
export interface SemanticVerdict {
  accept: boolean
  /** 拒绝原因（用于审计） */
  reason?: string
}

/**
 * 语义判定器（第二道漏斗）
 *
 * 规则漏斗只能判断"形式是否匹配"，无法判断"这条消息是真要处理还是随口吐槽"。
 * 该注入点预留给模型判定，未注入时全部放行。
 */
export type SemanticChecker = (hit: TriggerHit) => SemanticVerdict | Promise<SemanticVerdict>

/** 事件源接口 */
export interface TriggerSource {
  /** 源实例 id */
  readonly id: string
  /** 源类型 */
  readonly type: TriggerSourceType
  /** 启动监听，通过 onEvent 上抛事件 */
  start(onEvent: (event: TriggerEvent) => void): void | Promise<void>
  /** 停止监听并释放资源 */
  stop(): void | Promise<void>
}

/**
 * 触发器运行统计
 *
 * 漏斗口径以「成对计数」保证可校验，而不是靠估算：
 *
 *   passedRules = suppressedByCooldown + rejectedBySemantic + dispatchedHits + unaccountedDrops
 *
 * 同一事件命中多条规则时，每条规则各通过一次、各走一个出口，两侧同步累加，
 * 因此该等式与命中规则数无关。unaccountedDrops 正常恒为 0。
 */
export interface TriggerStats {
  /** 已注册规则数 */
  ruleCount: number
  /** 已注册事件源数 */
  sourceCount: number
  /** 本次进程内收到的事件总数 */
  receivedEvents: number
  /** 通过规则漏斗的（事件 × 规则）次数 */
  passedRules: number
  /** 通过语义漏斗并最终派发的命中数 */
  dispatchedHits: number
  /** 被冷却窗口丢弃的命中数 */
  suppressedByCooldown: number
  /** 被语义漏斗拒绝的命中数 */
  rejectedBySemantic: number
  /**
   * 通过规则漏斗却未落到任何出口的次数
   *
   * 派生值：每次读取时按上述等式重算，不参与累加，因此不会随时间漂移。
   * 恒为 0；不为 0 说明新增了漏斗分支却漏了计数，属于代码缺陷而非运行时波动。
   * 为负数说明某个出口被重复计数。
   */
  unaccountedDrops: number
}

/** 默认配置 */
export const DEFAULT_TRIGGER_CONFIG = Object.freeze({
  /** 默认冷却窗口：5 分钟（同一文件反复变更不重复触发） */
  defaultCooldownMs: 5 * 60 * 1000,
  /** 冷却表清理间隔（ms） */
  cooldownCleanupIntervalMs: 10 * 60 * 1000,
})

/** 触发相关日志前缀（统一便于排查） */
export const TRIGGER_LOG_PREFIX = '[Trigger]'
