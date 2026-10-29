import { describe, expect, it } from 'vitest'
import { describeMemoryAge, resolveFreshnessTier } from '../memoryLifecycle'

const DAY = 86_400_000
const NOW = new Date('2026-10-29T12:00:00+08:00').getTime()

describe('resolveFreshnessTier', () => {
  it('按天分层，越新层级越高', () => {
    expect(resolveFreshnessTier(NOW - 2 * 3_600_000, NOW)).toBe(5) // 今天
    expect(resolveFreshnessTier(NOW - 1.2 * DAY, NOW)).toBe(4) // 昨天
    expect(resolveFreshnessTier(NOW - 3 * DAY, NOW)).toBe(3) // 本周
    expect(resolveFreshnessTier(NOW - 15 * DAY, NOW)).toBe(2) // 本月
    expect(resolveFreshnessTier(NOW - 200 * DAY, NOW)).toBe(0)
  })

  it('昨天严格高于前天，这是同主题记忆取新弃旧的基础', () => {
    const yesterday = resolveFreshnessTier(NOW - 1.5 * DAY, NOW)
    const dayBefore = resolveFreshnessTier(NOW - 2.5 * DAY, NOW)
    expect(yesterday).toBeGreaterThan(dayBefore)
  })

  it('时间缺失或非法时退回最低层级，不伪造新鲜度', () => {
    expect(resolveFreshnessTier(0, NOW)).toBe(0)
    expect(resolveFreshnessTier(Number.NaN, NOW)).toBe(0)
  })
})

describe('describeMemoryAge', () => {
  it('给出可读的相对时间', () => {
    expect(describeMemoryAge(NOW - 2 * 3_600_000, NOW)).toBe('今天')
    expect(describeMemoryAge(NOW - 1.5 * DAY, NOW)).toBe('昨天')
    expect(describeMemoryAge(NOW - 3 * DAY, NOW)).toBe('3天前')
    expect(describeMemoryAge(NOW - 10 * DAY, NOW)).toBe('1周前')
    expect(describeMemoryAge(NOW - 60 * DAY, NOW)).toBe('2个月前')
  })

  it('时间缺失时明确标注，而不是伪装成新记忆', () => {
    expect(describeMemoryAge(0, NOW)).toBe('时间未知')
  })
})
