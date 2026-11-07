/**
 * 证据账本 / 压缩完整性 / 授权对齐 的守门测试
 *
 * 三块共用一个主题：都会直接影响「模型看到什么」。账本决定它能看到多少原文，
 * 完整性决定它的记忆有没有被裁丢，授权决定它能不能不打招呼就删除东西。
 */
import { describe, it, expect } from 'vitest'
import { EvidenceLedger, EVIDENCE_MAX_CHARS } from '../runtime/evidenceLedger'
import {
  verifyCompressionIntegrity,
  restoreIntoSafePosition,
  isSequenceValid,
} from '../capabilities/context/contextRecovery'
import { needsConfirmation, isIrreversibleAction } from '@shared/protocols/taskContract'

describe('EvidenceLedger', () => {
  it('记录后可按 id 取回', () => {
    const ledger = new EvidenceLedger()
    const ref = ledger.record({ content: 'line1\nline2', summary: '摘要' })
    expect(ref.evidenceId).toBe('ev_1')
    expect(ledger.resolve(ref.evidenceId)).toEqual({ status: 'ok', content: 'line1\nline2' })
  })

  it('同内容去重，不重复占预算', () => {
    const ledger = new EvidenceLedger()
    const first = ledger.record({ content: 'same content' })
    const second = ledger.record({ content: 'same content' })
    expect(second.evidenceId).toBe(first.evidenceId)
    expect(second.deduped).toBe(true)
    expect(ledger.size()).toBe(1)
  })

  it('超长内容截断并标记', () => {
    const ledger = new EvidenceLedger()
    const ref = ledger.record({ content: 'x'.repeat(EVIDENCE_MAX_CHARS + 100) })
    expect(ref.truncated).toBe(true)
    const resolved = ledger.resolve(ref.evidenceId)
    expect(resolved.status).toBe('ok')
    if (resolved.status === 'ok') expect(resolved.content.length).toBe(EVIDENCE_MAX_CHARS)
  })

  it('过期与不存在必须区分，不能静默返回空', () => {
    const ledger = new EvidenceLedger()
    // 塞入超过总量的内容，最旧的会被降级为摘要
    for (let i = 0; i < 20; i += 1) {
      ledger.record({ content: `block-${i}-${'y'.repeat(EVIDENCE_MAX_CHARS)}` })
    }
    const oldest = ledger.resolve('ev_1')
    expect(oldest.status).toBe('expired')
    if (oldest.status === 'expired') expect(oldest.summary).toBeTruthy()

    expect(ledger.resolve('ev_not_exist')).toEqual({ status: 'missing' })
  })

  it('render 只给编号与摘要，不搬原文', () => {
    const ledger = new EvidenceLedger()
    ledger.record({ content: 'A'.repeat(500), summary: '读取了配置文件' })
    const rendered = ledger.render()
    expect(rendered).toContain('ev_1')
    expect(rendered).toContain('读取了配置文件')
    expect(rendered).not.toContain('A'.repeat(100))
  })
})

describe('压缩完整性校验', () => {
  const original = [
    { role: 'user', content: '帮我把报告导出成 PDF' },
    { role: 'assistant', content: '好的', tool_calls: [{ id: 'c1' }] },
    { role: 'tool', content: 'file written', tool_call_id: 'c1' },
    { role: 'user', content: '【进度自查】请说明进度' },
  ]

  it('用户原话与规则消息丢失都能报出来', () => {
    const compressed = [
      { role: 'assistant', content: '好的', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', content: 'file written', tool_call_id: 'c1' },
    ]
    const report = verifyCompressionIntegrity(original, compressed)
    expect(report.ok).toBe(false)
    expect(report.missingUserMessages.length).toBe(1)
    expect(report.missingRuleMessages.length).toBe(1)
  })

  it('全部保留时 ok=true', () => {
    expect(verifyCompressionIntegrity(original, original).ok).toBe(true)
  })

  it('恢复放回原位置（不是补到末尾）', () => {
    const compressed = [
      { role: 'assistant', content: '好的', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', content: 'file written', tool_call_id: 'c1' },
    ]
    const result = restoreIntoSafePosition(original, compressed)
    const texts = result.messages.map((m) => String(m.content ?? ''))
    // 用户原话应回到第一条，而不是追加在最后
    expect(texts[0]).toContain('导出成 PDF')
    expect(result.restored).toBeGreaterThan(0)
  })

  it('不会插在 tool_call 与 tool_result 之间', () => {
    const compressed = [
      { role: 'assistant', content: '好的', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', content: 'file written', tool_call_id: 'c1' },
    ]
    const result = restoreIntoSafePosition(original, compressed)
    expect(isSequenceValid(result.messages)).toBe(true)
  })

  it('序列合法性检查能识别缺失的 tool_result', () => {
    const broken = [
      { role: 'assistant', content: '好的', tool_calls: [{ id: 'c1' }] },
      { role: 'user', content: '打断一下' },
    ]
    expect(isSequenceValid(broken)).toBe(false)
  })
})

describe('授权模式对齐', () => {
  it('every-step：中高风险都要确认', () => {
    expect(needsConfirmation('every-step', 'medium')).toBe(true)
    expect(needsConfirmation('every-step', 'high')).toBe(true)
    expect(needsConfirmation('every-step', 'low')).toBe(false)
  })

  it('dangerous-only：只有 high', () => {
    expect(needsConfirmation('dangerous-only', 'medium')).toBe(false)
    expect(needsConfirmation('dangerous-only', 'high')).toBe(true)
  })

  it('never：不额外确认，但不可逆操作仍硬拦', () => {
    expect(needsConfirmation('never', 'high', false)).toBe(false)
    expect(needsConfirmation('never', 'high', true)).toBe(true)
  })

  it('不可逆动作识别', () => {
    expect(isIrreversibleAction('delete_file')).toBe(true)
    expect(isIrreversibleAction('run_command:rm -rf build')).toBe(true)
    expect(isIrreversibleAction('read_file')).toBe(false)
    expect(isIrreversibleAction(undefined)).toBe(false)
  })
})
