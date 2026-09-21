/**
 * 上下文质量信号验收
 *
 * 验收目标：关键约束丢失可见，可回溯内容常驻比例可量化。
 */

import { describe, expect, it } from 'vitest'
import {
  buildRetrievalPlaceholder,
  computeContextQualitySignal,
  computeResidentStats,
  markCriticalMessages,
  RETRIEVABLE_TOOLS,
  resolveContextQualityLevel,
  type ContextQualityInput,
} from '../contextGauge'

function input(overrides: Partial<ContextQualityInput> = {}): ContextQualityInput {
  return {
    criticalIds: ['1', '2'],
    retainedCriticalIds: ['1', '2'],
    beforeTokens: 10_000,
    afterTokens: 6_000,
    untrustedTokens: 0,
    residentTokens: 6_000,
    residentAvoidableTokens: 0,
    ...overrides,
  }
}

describe('computeContextQualitySignal', () => {
  it('关键约束全部留存时存活率为 1', () => {
    const signal = computeContextQualitySignal(input())

    expect(signal.criticalRetentionRate).toBe(1)
  })

  it('关键约束被挤掉时存活率下降', () => {
    const signal = computeContextQualitySignal(input({ retainedCriticalIds: ['1'] }))

    expect(signal.criticalRetentionRate).toBe(0.5)
  })

  it('无关键约束时不判为退化', () => {
    const signal = computeContextQualitySignal(input({ criticalIds: [], retainedCriticalIds: [] }))

    expect(signal.criticalRetentionRate).toBe(1)
  })

  it('压缩收益比为 token 缩减比例', () => {
    expect(computeContextQualitySignal(input()).compressionGainRatio).toBe(0.4)
    expect(computeContextQualitySignal(input({ beforeTokens: 0 })).compressionGainRatio).toBe(0)
  })

  it('外部内容占比按压缩后体量计算', () => {
    expect(computeContextQualitySignal(input({ untrustedTokens: 3_000 })).untrustedRatio).toBe(0.5)
    expect(computeContextQualitySignal(input({ afterTokens: 0 })).untrustedRatio).toBe(0)
  })

  it('可回溯常驻比例按常驻体量计算', () => {
    const signal = computeContextQualitySignal(
      input({ residentTokens: 4_000, residentAvoidableTokens: 3_000 }),
    )

    expect(signal.residentAvoidableRatio).toBe(0.75)
  })
})

describe('resolveContextQualityLevel', () => {
  it('关键约束丢失判为 poor', () => {
    const signal = computeContextQualitySignal(input({ retainedCriticalIds: ['1'] }))

    expect(resolveContextQualityLevel(signal)).toBe('poor')
  })

  it('外部内容占比过高判为 poor', () => {
    const signal = computeContextQualitySignal(input({ untrustedTokens: 4_000 }))

    expect(resolveContextQualityLevel(signal)).toBe('poor')
  })

  it('可回溯内容常驻过多判为 fair', () => {
    const signal = computeContextQualitySignal(
      input({ residentTokens: 4_000, residentAvoidableTokens: 3_000 }),
    )

    expect(resolveContextQualityLevel(signal)).toBe('fair')
  })

  it('无退化信号时判为 good', () => {
    expect(resolveContextQualityLevel(computeContextQualitySignal(input()))).toBe('good')
  })
})

describe('markCriticalMessages', () => {
  it('识别用户约束、架构决策与未决项', () => {
    const ids = markCriticalMessages([
      { id: '1', role: 'user', text: '这个字段必须保持向后兼容' },
      { id: '2', role: 'assistant', text: '约定统一用 pnpm 管理依赖' },
      { id: '3', role: 'assistant', text: '待办：补充边界用例' },
      { id: '4', role: 'assistant', text: '我看了下这个文件' },
    ])

    expect(ids).toEqual(['1', '2', '3'])
  })

  it('跳过系统消息', () => {
    const ids = markCriticalMessages([
      { id: '0', role: 'system', text: '必须遵守安全规则' },
    ])

    expect(ids).toEqual([])
  })

  it('空文本不参与标记', () => {
    expect(markCriticalMessages([{ id: '1', role: 'user', text: '' }])).toEqual([])
    expect(markCriticalMessages([{ id: '1', role: 'user' }])).toEqual([])
  })
})

describe('检索优先', () => {
  it('可回溯工具集合包含文件与检索类工具', () => {
    expect(RETRIEVABLE_TOOLS.has('read_file')).toBe(true)
    expect(RETRIEVABLE_TOOLS.has('search_files')).toBe(true)
    expect(RETRIEVABLE_TOOLS.has('run_command')).toBe(false)
  })

  it('占位标识保留工具名与取回线索', () => {
    expect(buildRetrievalPlaceholder('read_file')).toContain('read_file')
    expect(buildRetrievalPlaceholder('read_file')).toContain('重新获取')

    const withLocator = buildRetrievalPlaceholder('read_file', 'src/a.ts')
    expect(withLocator).toContain('src/a.ts')
    expect(withLocator).toContain('重新读取')
  })

  it('统计常驻内容中的可回溯部分', () => {
    const stats = computeResidentStats([
      { name: 'read_file', content: 'x'.repeat(300) },
      { name: 'run_command', content: 'y'.repeat(300) },
      { name: 'search_files', content: 'z'.repeat(300) },
    ])

    expect(stats.residentTokens).toBe(300)
    expect(stats.residentAvoidableTokens).toBe(200)
  })

  it('无消息时不报错', () => {
    expect(computeResidentStats([])).toEqual({ residentTokens: 0, residentAvoidableTokens: 0 })
  })
})
