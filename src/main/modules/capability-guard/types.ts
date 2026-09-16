/**
 * 能力一致性收敛 — 类型定义
 *
 * @module capability-guard/types
 */

/**
 * 受套餐约束的客户端能力键。
 *
 * ⚠️ 必须与以下三处保持一致：
 *   - 后端 `PlanFeatures`（payment/feature-guard.service.ts）
 *   - 客户端 `renderer/adapters/featureGuardService.ts` 的 CLIENT_CAPABILITY_KEYS
 *   - 设置页 PreferencesDialog 的 tab.featureKey
 */
export const GUARDED_CAPABILITY_KEYS = [
  'liveInteraction',
  'vts',
  'vmc',
  'a2a',
  'externalApi',
  'iot',
  'perception',
  'proactive',
] as const

export type GuardedCapabilityKey = (typeof GUARDED_CAPABILITY_KEYS)[number]

/**
 * 授权快照（由渲染层从后端 FeatureService 取回后传入）。
 *
 * 只表达「能力是否被授权」，不携带其它套餐信息 —— 收敛逻辑不应依赖
 * 套餐 ID 之类的间接信号，避免两处判断标准漂移。
 */
export interface CapabilityEntitlement {
  /** 有效套餐 ID（仅用于日志与报告展示） */
  planId?: string
  /** 逐能力授权结果；缺省（undefined）视为未授权 */
  allowed: Partial<Record<GuardedCapabilityKey, boolean>>
}

/** 单个能力的收敛结果 */
export interface CapabilityConvergeResult {
  key: GuardedCapabilityKey
  /** 是否真的执行了关闭动作（false = 收敛前就已关闭，未做任何写入） */
  revoked: boolean
  /** 关闭动作是否成功（revoked=false 时恒为 true） */
  ok: boolean
  /** 人类可读的结果说明（写入日志与报告，便于排障） */
  detail: string
  error?: string
}

/** 一次收敛的完整报告 */
export interface CapabilityConvergeReport {
  /** 收敛依据的套餐 ID */
  planId: string
  /** 收敛时间戳（毫秒） */
  convergedAt: number
  /** 本次被关闭的能力键（供 UI 提示用户） */
  revokedKeys: GuardedCapabilityKey[]
  results: CapabilityConvergeResult[]
}
