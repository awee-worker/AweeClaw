/**
 * 事实核对的守门测试
 *
 * 三条必须成立的规则：
 * 1. 没调过工具（纯问答）→ 不核；
 * 2. 回答里没有可核事实 → 视为未核对，而不是核实通过；
 * 3. 有事实但对不上材料 → 进 gaps，且只标记不拦截。
 */
import { describe, it, expect } from 'vitest'
import { extractFacts, checkAnswerGrounding, buildGroundingNotice } from '../answerGrounding'

describe('extractFacts', () => {
  it('抽取路径、日期、URL、带小数数字', () => {
    const facts = extractFacts(
      '已修改 src/main.ts，版本 2026-11-07，见 https://example.com/doc，覆盖率 87.5%。',
    )
    expect(facts).toContain('src/main.ts')
    expect(facts).toContain('2026-11-07')
    expect(facts).toContain('https://example.com/doc')
    expect(facts).toContain('87.5%')
  })

  it('单个整数不当事实（误报太高）', () => {
    const facts = extractFacts('生成了 3 个文件')
    expect(facts).toEqual([])
  })
})

describe('checkAnswerGrounding', () => {
  it('未调用工具 → 不核', () => {
    const result = checkAnswerGrounding({
      answer: '修改了 src/a.ts',
      toolTexts: [],
      hadToolCalls: false,
    })
    expect(result.checked).toBe(false)
    expect(result.gaps).toEqual([])
  })

  it('无可核事实 → checked=false（未核对，不是核实通过）', () => {
    const result = checkAnswerGrounding({
      answer: '已经完成了',
      toolTexts: ['anything'],
      hadToolCalls: true,
    })
    expect(result.checked).toBe(false)
  })

  it('事实在材料里 → 无 gap', () => {
    const result = checkAnswerGrounding({
      answer: '修改了 src/main.ts',
      toolTexts: ['read_file: src/main.ts (200 lines)'],
      hadToolCalls: true,
    })
    expect(result.checked).toBe(true)
    expect(result.gaps).toEqual([])
  })

  it('事实不在材料里 → 进 gaps', () => {
    const result = checkAnswerGrounding({
      answer: '修改了 src/missing.ts',
      toolTexts: ['read_file: src/main.ts (200 lines)'],
      hadToolCalls: true,
    })
    expect(result.checked).toBe(true)
    expect(result.gaps).toContain('src/missing.ts')
  })

  it('缺失材料时不误判为通过', () => {
    const result = checkAnswerGrounding({
      answer: '修改了 src/main.ts',
      toolTexts: [],
      hadToolCalls: true,
    })
    expect(result.gaps).toContain('src/main.ts')
  })
})

describe('buildGroundingNotice', () => {
  it('无 gap 时返回空串（不打扰正常回答）', () => {
    expect(buildGroundingNotice({ gaps: [], checked: true })).toBe('')
    expect(buildGroundingNotice({ gaps: ['x'], checked: false })).toBe('')
  })

  it('有 gap 时生成一行标记，不阻断交付', () => {
    const notice = buildGroundingNotice({ gaps: ['src/a.ts'], checked: true })
    expect(notice).toContain('未确认')
    expect(notice).toContain('src/a.ts')
  })
})
