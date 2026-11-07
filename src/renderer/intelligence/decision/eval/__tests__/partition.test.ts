/**
 * 评测分池自检
 *
 * 这个测试的作用是「拦住新增题忘了分池」：数据集里的每一条都必须落在
 * tune 或 holdout 上，且每类 holdout 占比不低于 30%。
 */
import { describe, it, expect } from 'vitest'
import { assignPartitions, auditPartitions, filterByPartition, partitionBanner, MIN_HOLDOUT_RATIO } from '../partition'
import { TASK_EVAL_SAMPLES } from '../dataset'

describe('真实数据集分池', () => {
  it('全部样本都有 partition，且各类 holdout 占比达标', () => {
    const audit = auditPartitions(TASK_EVAL_SAMPLES)
    expect(audit.unlabeled).toEqual([])
    expect(audit.thinHoldout).toEqual([])
    expect(audit.ok).toBe(true)
  })

  it('两个池都不为空，且并集等于全集', () => {
    const tune = filterByPartition(TASK_EVAL_SAMPLES, 'tune')
    const holdout = filterByPartition(TASK_EVAL_SAMPLES, 'holdout')
    expect(tune.length).toBeGreaterThan(0)
    expect(holdout.length).toBeGreaterThan(0)
    expect(tune.length + holdout.length).toBe(TASK_EVAL_SAMPLES.length)
  })
})

describe('assignPartitions', () => {
  const samples = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `a-${i}`, group: 'alpha' })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `b-${i}`, group: 'beta' })),
  ]

  it('确定性：同样的输入两次分配结果一致', () => {
    const first = assignPartitions(samples).map((s) => `${s.id}:${s.partition}`)
    const second = assignPartitions(samples).map((s) => `${s.id}:${s.partition}`)
    expect(first).toEqual(second)
  })

  it('显式标注优先于自动分配', () => {
    const withExplicit = [{ id: 'x-1', group: 'x', partition: 'holdout' as const }]
    expect(assignPartitions(withExplicit)[0].partition).toBe('holdout')
  })

  it('每类 holdout 达到下限', () => {
    const assigned = assignPartitions(samples)
    for (const group of ['alpha', 'beta']) {
      const inGroup = assigned.filter((s) => s.group === group)
      const holdout = inGroup.filter((s) => s.partition === 'holdout')
      expect(holdout.length / inGroup.length).toBeGreaterThanOrEqual(MIN_HOLDOUT_RATIO)
    }
  })
})

describe('auditPartitions 拦截', () => {
  it('有样本缺 partition → 不通过', () => {
    const audit = auditPartitions([
      { id: 'x-1', group: 'x', partition: 'tune' },
      { id: 'x-2', group: 'x' },
    ])
    expect(audit.ok).toBe(false)
    expect(audit.unlabeled).toContain('x-2')
  })

  it(' holdout 占比不足 → 不通过并指出类别', () => {
    const audit = auditPartitions([
      ...Array.from({ length: 9 }, (_, i) => ({ id: `y-${i}`, group: 'y', partition: 'tune' as const })),
      { id: 'y-9', group: 'y', partition: 'holdout' as const },
    ])
    expect(audit.ok).toBe(false)
    expect(audit.thinHoldout[0].group).toBe('y')
  })
})

describe('partitionBanner', () => {
  it('两个池的标注可区分且写明用途限制', () => {
    expect(partitionBanner('holdout')).toContain('HOLDOUT')
    expect(partitionBanner('holdout')).toContain('不得用于调优')
    expect(partitionBanner('tune')).toContain('TUNE')
  })
})
