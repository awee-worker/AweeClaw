/**
 * 评测双池（tune / holdout）
 *
 * 目的只有一个：防止「拿考题反过来调答案」。调提示词、改工具描述、调工具预选时
 * 只看 tune 池的结果；holdout 只在发版决策时看一眼。holdout 一旦被拿去调过，
 * 就失去意义 —— 约定是把它挪进 tune 池并补新题。
 *
 * 分配是**确定性**的：同一条样本每次跑都落在同一个池，不需要手工维护标注，
 * 也不会因为新增样本顺序变化而让既有分配漂移。分组按 `group` 分层，
 * 每类的 holdout 占比不低于 30%。
 *
 * @module decision/eval/partition
 */

/** 池标识 */
export type EvalPartition = 'tune' | 'holdout'

/** 可参与分池的最小样本结构 */
export interface PartitionableSample {
  id: string
  group: string
  partition?: EvalPartition
}

/** 每类 holdout 的最低占比 */
export const MIN_HOLDOUT_RATIO = 0.3

/** 目标 holdout 占比：略高于下限，给手工维护留余量 */
const TARGET_HOLDOUT_RATIO = 1 / 3

/** 稳定字符串哈希（FNV-1a），用于确定性分池 */
function stableHash(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * 为样本补齐 partition
 *
 * 已显式标注的样本保持不动（人工可以覆盖自动分配）；其余按「组内排序 + 固定步长」
 * 分配，保证每类都有稳定的 holdout 子集。
 */
export function assignPartitions<T extends PartitionableSample>(samples: T[]): Array<T & { partition: EvalPartition }> {
  // 按组归集，组内按 id 排序：排序只依赖 id，不依赖数组顺序
  const byGroup = new Map<string, T[]>()
  for (const sample of samples) {
    const list = byGroup.get(sample.group) ?? []
    list.push(sample)
    byGroup.set(sample.group, list)
  }

  const assigned = new Map<string, EvalPartition>()
  for (const [, list] of byGroup) {
    const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id))
    const holdoutTarget = Math.max(1, Math.ceil(sorted.length * TARGET_HOLDOUT_RATIO))
    // 用哈希选种子再做等距抽取，避免「id 靠前的一律进 holdout」的偏置
    const seed = stableHash(sorted[0].id)
    const picked = new Set<number>()
    for (let k = 0; k < holdoutTarget; k += 1) {
      let idx = (seed + k * 7) % sorted.length
      // 冲突时线性探测
      while (picked.has(idx)) idx = (idx + 1) % sorted.length
      picked.add(idx)
    }
    sorted.forEach((sample, idx) => {
      assigned.set(sample.id, picked.has(idx) ? 'holdout' : 'tune')
    })
  }

  return samples.map((sample) => ({
    ...sample,
    partition: (sample.partition ?? assigned.get(sample.id) ?? 'tune') as EvalPartition,
  }))
}

/** 按池过滤 */
export function filterByPartition<T extends { partition?: EvalPartition }>(
  samples: T[],
  split: EvalPartition,
): T[] {
  return samples.filter((s) => s.partition === split)
}

/** 分池自检结果 */
export interface PartitionAudit {
  ok: boolean
  /** 缺 partition 的样本 id */
  unlabeled: string[]
  /** holdout 占比不足的类别 */
  thinHoldout: Array<{ group: string; total: number; holdout: number; ratio: number }>
}

/**
 * 分池自检
 *
 * 两项检查，任一不通过即 `ok=false`：
 * 1. 所有样本都有 partition（新增题忘了分池，测试必须失败）；
 * 2. 每个类别的 holdout 占比 ≥ 30%。
 */
export function auditPartitions(samples: PartitionableSample[]): PartitionAudit {
  const unlabeled = samples.filter((s) => !s.partition).map((s) => s.id)

  const byGroup = new Map<string, { total: number; holdout: number }>()
  for (const sample of samples) {
    const entry = byGroup.get(sample.group) ?? { total: 0, holdout: 0 }
    entry.total += 1
    if (sample.partition === 'holdout') entry.holdout += 1
    byGroup.set(sample.group, entry)
  }

  const thinHoldout: PartitionAudit['thinHoldout'] = []
  for (const [group, { total, holdout }] of byGroup) {
    const ratio = total > 0 ? holdout / total : 0
    if (ratio < MIN_HOLDOUT_RATIO) {
      thinHoldout.push({ group, total, holdout, ratio })
    }
  }

  return { ok: unlabeled.length === 0 && thinHoldout.length === 0, unlabeled, thinHoldout }
}

/** 报告头部标注用：一眼看出这次跑的是哪个池 */
export function partitionBanner(split: EvalPartition): string {
  return split === 'holdout'
    ? '【保留池 HOLDOUT】结果仅用于发版决策，不得用于调优'
    : '【调优池 TUNE】可用于提示词与工具调优'
}
