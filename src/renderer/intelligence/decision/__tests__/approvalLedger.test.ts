/**
 * 审批账本单测
 *
 * 覆盖三件事：记录内容是否完整、汇总是否可用于判读规则、容量上限是否生效。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildApprovalEntry,
  clearApprovalLedger,
  getApprovalEntries,
  recordApproval,
  summarizeApprovalLedger,
  summarizeCommand,
} from '../approvalLedger'
import type { BuildApprovalEntryInput } from '../approvalLedger'

function makeEntry(overrides: Partial<BuildApprovalEntryInput> = {}) {
  return buildApprovalEntry({
    toolCall: {
      id: 'call-1',
      name: 'run_command',
      arguments: { command: 'git reset --hard HEAD~1' },
    },
    requestId: 'req-1',
    decision: 'rejected',
    authorizationMode: 'dangerous-only',
    ...overrides,
  })
}

describe('审批账本', () => {
  beforeEach(() => {
    clearApprovalLedger()
  })

  it('命令类记录携带风险分级信息', () => {
    recordApproval(makeEntry())
    const [entry] = getApprovalEntries()

    expect(entry.toolName).toBe('run_command')
    expect(entry.approvalType).toBe('terminal')
    expect(entry.riskLevel).toBe('review')
    expect(entry.riskRuleId).toBe('git-reset-hard')
    expect(entry.riskConfidence).toBeGreaterThan(0.7)
    expect(entry.commandSummary).toContain('git reset --hard')
    expect(entry.authorizationMode).toBe('dangerous-only')
  })

  it('非命令类记录不写入风险字段', () => {
    recordApproval(
      buildApprovalEntry({
        toolCall: { id: 'call-2', name: 'write_file', arguments: { path: 'a.ts' } },
        requestId: 'req-2',
        decision: 'approved',
      }),
    )
    const [entry] = getApprovalEntries()

    expect(entry.toolName).toBe('write_file')
    expect(entry.riskLevel).toBeUndefined()
    expect(entry.riskRuleId).toBeUndefined()
    expect(entry.commandSummary).toBeUndefined()
  })

  it('汇总按风险级别、工具与灰区规则分组', () => {
    recordApproval(makeEntry({ toolCall: { id: 'a', name: 'run_command', arguments: { command: 'git reset --hard' } }, decision: 'rejected' }))
    recordApproval(makeEntry({ toolCall: { id: 'b', name: 'run_command', arguments: { command: 'git reset --hard' } }, decision: 'rejected' }))
    recordApproval(makeEntry({ toolCall: { id: 'c', name: 'run_command', arguments: { command: 'git reset --hard' } }, decision: 'approved' }))
    recordApproval(makeEntry({ toolCall: { id: 'd', name: 'read_file', arguments: { path: 'a.ts' } }, decision: 'approved' }))

    const summary = summarizeApprovalLedger()

    expect(summary.total).toBe(4)
    expect(summary.approved).toBe(2)
    expect(summary.rejected).toBe(2)

    const reviewBucket = summary.byRiskLevel.find((bucket) => bucket.key === 'review')
    expect(reviewBucket?.total).toBe(3)
    expect(reviewBucket?.rejected).toBe(2)
    expect(reviewBucket?.approvalRate).toBeCloseTo(0.3333, 3)

    const ruleBucket = summary.byReviewRule.find((bucket) => bucket.key === 'git-reset-hard')
    expect(ruleBucket?.total).toBe(3)
    expect(ruleBucket?.approvalRate).toBeCloseTo(0.3333, 3)

    // 非命令工具没有级别与规则归属，只出现在按工具分组里
    expect(summary.byTool.find((bucket) => bucket.key === 'read_file')?.total).toBe(1)
  })

  it('超过容量上限时淘汰最旧记录', () => {
    const total = 305
    for (let i = 0; i < total; i++) {
      recordApproval(makeEntry({ requestId: `req-${i}` }))
    }

    const entries = getApprovalEntries()
    expect(entries.length).toBe(300)
    // 最早写入的 5 条应被丢弃
    expect(entries[0].requestId).toBe('req-5')
    expect(entries[entries.length - 1].requestId).toBe(`req-${total - 1}`)
  })

  it('清空后不再保留任何记录', () => {
    recordApproval(makeEntry())
    expect(getApprovalEntries().length).toBe(1)

    clearApprovalLedger()
    expect(getApprovalEntries().length).toBe(0)
    expect(summarizeApprovalLedger().total).toBe(0)
  })

  it('命令摘要压平换行并截断', () => {
    const summary = summarizeCommand('npm  run\n  build')
    expect(summary).toBe('npm run build')

    const long = summarizeCommand('x'.repeat(200))
    expect(long.length).toBeLessThanOrEqual(121)
    expect(long.endsWith('…')).toBe(true)
  })
})
