/**
 * 记忆生命周期计算
 *
 * 保留值、半衰期、有效召回判定统一收敛在这里：
 *  - 保留值按时间和召回情况真实衰减，不再是恒定的 1
 *  - 半衰期按层级与来源区分，不再是所有条目都按 14 天
 *  - 「有效召回」与「被塞进提示词」分开，避免占位式计数把无关记忆推成长期记忆
 */

import type { MemorySource, MemoryStatus } from '@intelligence/providerTypes'

/** 按层级与来源解析半衰期（单位：天） */
export function resolveHalfLifeDays(status: MemoryStatus, source: MemorySource): number {
  if (status === 'forgotten') return 3
  if (status === 'long_term') return source === 'user' ? 365 : 180
  if (source === 'user' || source === 'self_correction') return 30
  return 14
}

/** 各层级对保留值的权重 */
const TIER_RETENTION_FACTOR: Record<MemoryStatus, number> = {
  long_term: 1.15,
  short_term: 1,
  forgotten: 0,
}

/**
 * 计算一条记忆的保留值（0~1）。
 *
 * 越接近 0 越可能被遗忘。每经过一个半衰期衰减一半，
 * 有效召回次数抬升基线，置信度提供一个小幅加成。
 *
 * @param reviewBoostMultiplier 每次复习对保留值的提升倍数（来自「记忆系统设置」）。
 *   只放大召回带来的增益部分（基线 0.6 不动），默认 1 即不改变原有曲线。
 */
export function computeRetention(
  params: {
    status: MemoryStatus
    halfLifeDays: number
    lastRecalledAt: number
    recallCount: number
    confidence: number
  },
  reviewBoostMultiplier = 1,
): number {
  const { status, halfLifeDays, lastRecalledAt, recallCount, confidence } = params
  if (status === 'forgotten') return 0

  const boost = Number.isFinite(reviewBoostMultiplier) && reviewBoostMultiplier > 0
    ? reviewBoostMultiplier
    : 1

  const ageDays = Math.max(0, (Date.now() - lastRecalledAt) / 86_400_000)
  const halfLife = Math.max(1, halfLifeDays)
  const decay = Math.pow(0.5, ageDays / halfLife)
  const recallBase = 0.6 + 0.4 * Math.min(recallCount / 5, 1) * boost

  const retention = decay * recallBase * TIER_RETENTION_FACTOR[status] + confidence * 0.15 * decay
  return Math.max(0, Math.min(1, retention))
}

/**
 * 判断助手回复是否真的用到了某条记忆。
 *
 * 记忆被拼进提示词不等于被使用。这里用片段命中做近似判定：
 * 只有在回复里出现记忆的实质内容，才算一次有效召回。
 */
export function isContentReferenced(content: string, reply: string): boolean {
  const normalize = (s: string) => s.replace(/[\s\p{P}]/gu, '').toLowerCase()
  const target = normalize(content)
  const source = normalize(reply)
  if (!target || !source) return false
  if (target.length <= 8) return source.includes(target)

  const segLen = 8
  const step = Math.max(1, Math.floor((target.length - segLen) / 4))
  for (let i = 0; i + segLen <= target.length; i += step) {
    if (source.includes(target.slice(i, i + segLen))) return true
  }
  return false
}
