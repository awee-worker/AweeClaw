/**
 * 记忆保留策略（层级 → 保留天数）
 *
 * 层级划分与天数解析收敛在这里；天数的单一来源是 memorySettings，
 * 本模块只负责把「一条记忆」映射到「一个层级」并取回对应天数。
 */

import type { MemorySource, MemoryStatus } from './types'
import {
  DEFAULT_TIER_RETENTION_DAYS,
  getMemorySettings,
  invalidateMemorySettings,
  type MemoryTierKey,
} from './memorySettings'

export type RetentionTier = MemoryTierKey

export { DEFAULT_TIER_RETENTION_DAYS }

/** 各层级保留天数（0 表示不过期） */
export function getRetentionPolicy(): Record<RetentionTier, number> {
  return { ...getMemorySettings().tierRetentionDays }
}

/** 设置变更后使缓存失效（透传给 memorySettings） */
export function invalidateRetentionPolicy(): void {
  invalidateMemorySettings()
}

/**
 * 解析一条记忆适用的保留层级。
 *
 * - 用户显式要求记住的长期记忆 → 永久
 * - 其余长期记忆 → 长期
 * - 已被召回过的短期记忆 → 短期
 * - 从未被召回的短期记忆（会话内残留）→ 工作记忆
 */
export function resolveRetentionTier(entry: {
  status: MemoryStatus
  source: MemorySource
  recallCount: number
  tags: string[]
}): RetentionTier {
  if (entry.status === 'long_term') {
    const userAsserted = entry.source === 'user' || entry.tags.includes('user-stated')
    return userAsserted ? 'permanent' : 'long_term'
  }
  return entry.recallCount > 0 ? 'short_term' : 'working'
}

/**
 * 一条记忆的保留天数。
 *
 * 返回 0 表示不过期（永久层级被配成 0 时同样视为不过期）。
 */
export function resolveRetentionDays(entry: {
  status: MemoryStatus
  source: MemorySource
  recallCount: number
  tags: string[]
}): number {
  return getRetentionPolicy()[resolveRetentionTier(entry)]
}
