/**
 * 压缩预算验收
 *
 * 验收目标：预算与目标水位可由窗口与输出预留稳定推出，边界输入不产生负值。
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_COMPLETION_TOKENS,
  computeCompressionBudget,
  isWithinTarget,
} from '../compressionBudget'

describe('computeCompressionBudget', () => {
  it('按窗口扣除输出预留与安全缓冲', () => {
    const budget = computeCompressionBudget(65_536, 8_192)

    expect(budget.budget).toBe(65_536 - 8_192 - 1_024)
    expect(budget.target).toBe(Math.floor(56_320 / 2))
    expect(budget.triggerAt).toBe(budget.budget)
  })

  it('输出预留缺省时使用默认值', () => {
    const withDefault = computeCompressionBudget(65_536)
    const explicit = computeCompressionBudget(65_536, DEFAULT_MAX_COMPLETION_TOKENS)

    expect(withDefault).toEqual(explicit)
  })

  it('目标水位为预算的一半，向下取整', () => {
    const budget = computeCompressionBudget(10_000, 1_000, 1)

    expect(budget.budget).toBe(8_999)
    expect(budget.target).toBe(4_499)
  })

  it('安全缓冲可显式指定', () => {
    expect(computeCompressionBudget(10_000, 2_000, 0).budget).toBe(8_000)
  })

  it('窗口非法时预算为零，不产生负值', () => {
    expect(computeCompressionBudget(0, 8_192).budget).toBe(0)
    expect(computeCompressionBudget(-100, 8_192).budget).toBe(0)
    expect(computeCompressionBudget(Number.NaN, 8_192).budget).toBe(0)
  })

  it('输出预留大于窗口时预算归零', () => {
    expect(computeCompressionBudget(1_000, 8_192).budget).toBe(0)
  })
})

describe('isWithinTarget', () => {
  const budget = computeCompressionBudget(65_536, 8_192)

  it('等于目标水位即视为到位', () => {
    expect(isWithinTarget(budget.target, budget)).toBe(true)
  })

  it('高于目标水位视为未到位', () => {
    expect(isWithinTarget(budget.target + 1, budget)).toBe(false)
  })
})
