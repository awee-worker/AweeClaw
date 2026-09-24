/**
 * 验收检查点核对
 *
 * 验收目标：检查点能被逐条核对；证据缺失与证据为空区分开；
 * 自报通过但缺乏依据的情况能被识别出来；未通过项阻止按完成结案。
 */

import { describe, expect, it } from 'vitest'
import {
  evaluateAcceptanceChecks,
  normalizeAcceptanceChecks,
  renderAcceptanceReport,
  validateAcceptanceChecks,
  type AcceptanceCheck,
} from '../acceptanceChecks'

function check(id: string, description: string, payload?: string): AcceptanceCheck {
  return payload
    ? { id, description, verify: { kind: 'tool', payload } }
    : { id, description }
}

describe('normalizeAcceptanceChecks', () => {
  it('非数组输入返回空列表', () => {
    expect(normalizeAcceptanceChecks(undefined)).toEqual([])
    expect(normalizeAcceptanceChecks(null)).toEqual([])
    expect(normalizeAcceptanceChecks('write_file')).toEqual([])
    expect(normalizeAcceptanceChecks({ id: 'a' })).toEqual([])
  })

  it('丢弃没有描述或非对象的条目', () => {
    const result = normalizeAcceptanceChecks([
      { id: 'a', description: '   ' },
      null,
      'string',
      { id: 'b', description: '产出报告文件' },
    ])

    expect(result).toEqual([{ id: 'b', description: '产出报告文件' }])
  })

  it('缺少 id 时按序号补位，保证每条都有稳定标识', () => {
    const result = normalizeAcceptanceChecks([{ description: '第一项' }])

    expect(result[0].id).toBe('check-1')
  })

  it('id 重复时只保留第一条', () => {
    const result = normalizeAcceptanceChecks([
      { id: 'dup', description: '先声明的' },
      { id: 'dup', description: '后声明的' },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('先声明的')
  })

  it('无法识别的判定规则被丢弃，该条退化为人工确认', () => {
    const result = normalizeAcceptanceChecks([
      { id: 'a', description: '登录可用', verify: { kind: 'sql', payload: 'select 1' } },
      { id: 'b', description: '空载荷', verify: { kind: 'tool', payload: '  ' } },
    ])

    expect(result[0].verify).toBeUndefined()
    expect(result[1].verify).toBeUndefined()
  })

  it('声明数量超过上限时截断', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, description: `第 ${i} 项` }))

    expect(normalizeAcceptanceChecks(many)).toHaveLength(32)
  })
})

describe('evaluateAcceptanceChecks', () => {
  it('未声明检查点时允许结案，不产生核对项', () => {
    const outcome = evaluateAcceptanceChecks(undefined)

    expect(outcome.results).toEqual([])
    expect(outcome.passed).toBe(true)
    expect(outcome.summary).toContain('未声明验收检查点')
  })

  it('工具调用出现在证据中时判为通过', () => {
    const outcome = evaluateAcceptanceChecks(
      [check('a', '执行测试', 'run_command')],
      { usedTools: ['read_file', 'run_command'] },
    )

    expect(outcome.results[0].verdict).toBe('passed')
    expect(outcome.passed).toBe(true)
    expect(outcome.results[0].detail).toContain('已调用 run_command')
  })

  it('证据为空数组表示确实未调用，判为未通过', () => {
    const outcome = evaluateAcceptanceChecks([check('a', '执行测试', 'run_command')], {
      usedTools: [],
    })

    expect(outcome.results[0].verdict).toBe('failed')
    expect(outcome.passed).toBe(false)
  })

  it('证据未采集时不误判，转为人工确认', () => {
    const outcome = evaluateAcceptanceChecks([check('a', '执行测试', 'run_command')], {})

    expect(outcome.results[0].verdict).toBe('manual')
    expect(outcome.passed).toBe(true)
    expect(outcome.manualCount).toBe(1)
  })

  it('产出路径规则按片段匹配', () => {
    const checks = [check('a', '产出实施报告', 'path:reports/')]
    const hit = evaluateAcceptanceChecks(checks, {
      writtenPaths: ['aweeclaw-client/src/a.ts', 'reports/plan.md'],
    })
    const miss = evaluateAcceptanceChecks(checks, { writtenPaths: ['src/a.ts'] })

    expect(hit.results[0].verdict).toBe('passed')
    expect(miss.results[0].verdict).toBe('failed')
  })

  it('路径规则缺少片段时转为人工确认', () => {
    const outcome = evaluateAcceptanceChecks([check('a', '产出报告', 'path:')], {
      writtenPaths: ['reports/plan.md'],
    })

    expect(outcome.results[0].verdict).toBe('manual')
  })

  it('表达式规则不自动判定，避免对模型生成的字符串求值', () => {
    const checks: AcceptanceCheck[] = [
      { id: 'a', description: '覆盖率超过 80%', verify: { kind: 'expression', payload: 'cov > 0.8' } },
    ]

    const outcome = evaluateAcceptanceChecks(checks, { usedTools: ['run_command'] })

    expect(outcome.results[0].verdict).toBe('manual')
    expect(outcome.results[0].detail).toContain('表达式类规则')
  })

  it('未声明判定规则的检查点需人工确认', () => {
    const outcome = evaluateAcceptanceChecks([check('a', '输出格式符合团队规范')], {
      usedTools: ['write_file'],
    })

    expect(outcome.results[0].verdict).toBe('manual')
  })

  it('自报通过但证据不支持时标记为过度声明', () => {
    const outcome = evaluateAcceptanceChecks([check('a', '执行测试', 'run_command')], {
      usedTools: ['read_file'],
      claimed: [{ criteria: '执行测试', passed: true }],
    })

    expect(outcome.results[0].verdict).toBe('failed')
    expect(outcome.results[0].overclaim).toBe(true)
    expect(outcome.results[0].detail).toContain('自报已通过')
    expect(outcome.overclaimCount).toBe(1)
    expect(outcome.summary).toContain('自报已通过')
  })

  it('自报条目与检查点描述有标点与大小写差异时仍能对上', () => {
    const outcome = evaluateAcceptanceChecks([check('a', '执行单元测试', 'run_command')], {
      usedTools: [],
      claimed: [{ criteria: '【执行单元测试】：未执行', passed: true }],
    })

    expect(outcome.results[0].overclaim).toBe(true)
  })

  it('自报未通过时不标记过度声明', () => {
    const outcome = evaluateAcceptanceChecks([check('a', '执行测试', 'run_command')], {
      usedTools: [],
      claimed: [{ criteria: '执行测试', passed: false }],
    })

    expect(outcome.results[0].overclaim).toBeUndefined()
    expect(outcome.overclaimCount).toBe(0)
  })

  it('全部为待人工确认时不阻塞结案，但计入统计', () => {
    const outcome = evaluateAcceptanceChecks(
      [check('a', '人工复核输出格式'), check('b', '人工确认业务口径')],
      { usedTools: ['write_file'] },
    )

    expect(outcome.passed).toBe(true)
    expect(outcome.manualCount).toBe(2)
    expect(outcome.summary).toContain('待人工确认 2')
  })

  it('存在未通过项时不允许结案，并在报告中说明', () => {
    const outcome = evaluateAcceptanceChecks(
      [check('a', '执行测试', 'run_command'), check('b', '写入报告', 'path:reports/')],
      { usedTools: ['run_command'], writtenPaths: ['src/a.ts'] },
    )

    expect(outcome.passed).toBe(false)
    expect(outcome.failedCount).toBe(1)
    expect(outcome.summary).toContain('不能按已完成结案')
  })

  it('结案时报告不出现阻止结案的措辞', () => {
    const outcome = evaluateAcceptanceChecks([check('a', '执行测试', 'run_command')], {
      usedTools: ['run_command'],
    })

    expect(outcome.summary).not.toContain('不能按已完成结案')
  })

  it('支持英文输出', () => {
    const outcome = evaluateAcceptanceChecks(
      [check('a', 'Run the test suite', 'run_command')],
      { usedTools: [] },
      'en',
    )

    expect(outcome.summary).toContain('Acceptance: 1 checks')
    expect(outcome.summary).toContain('[FAIL]')
    expect(outcome.summary).toContain('must not be closed as completed')
  })

  it('不修改传入的声明与证据', () => {
    const checks = [check('a', '执行测试', 'run_command')]
    const evidence = { usedTools: ['run_command'], writtenPaths: ['reports/a.md'] }
    const checksSnapshot = JSON.parse(JSON.stringify(checks))
    const evidenceSnapshot = JSON.parse(JSON.stringify(evidence))

    evaluateAcceptanceChecks(checks, evidence)

    expect(checks).toEqual(checksSnapshot)
    expect(evidence).toEqual(evidenceSnapshot)
  })
})

describe('renderAcceptanceReport', () => {
  it('无核对项时给出明确说明', () => {
    expect(renderAcceptanceReport({ results: [], passed: true, failedCount: 0, manualCount: 0, overclaimCount: 0, summary: '' })).toContain(
      '未声明验收检查点',
    )
  })

  it('逐条列出每一项的结论与依据', () => {
    const outcome = evaluateAcceptanceChecks(
      [check('a', '执行测试', 'run_command'), check('b', '写入报告', 'path:reports/')],
      { usedTools: ['run_command'], writtenPaths: ['reports/final.md'] },
    )

    expect(outcome.summary).toContain('验收核对：2 项，通过 2、未通过 0、待人工确认 0')
    expect(outcome.summary).toContain('- [通过] 执行测试')
    expect(outcome.summary).toContain('- [通过] 写入报告')
  })
})

describe('validateAcceptanceChecks', () => {
  it('未声明时视为合法，不报问题', () => {
    const result = validateAcceptanceChecks(undefined)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.checks).toEqual([])
  })

  it('非数组声明报错', () => {
    const result = validateAcceptanceChecks({ id: 'a' })

    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toContain('必须是数组')
  })

  it('空数组给出告警但不阻断发布', () => {
    const result = validateAcceptanceChecks([])

    expect(result.valid).toBe(true)
    expect(result.warnings[0].message).toContain('空数组')
  })

  it('合法声明通过校验，并给出归一化结果', () => {
    const result = validateAcceptanceChecks([
      { id: 'a', description: '执行测试', verify: { kind: 'tool', payload: 'run_command' } },
      { id: 'b', description: '人工复核输出' },
    ])

    expect(result.valid).toBe(true)
    expect(result.checks).toHaveLength(2)
  })

  it('缺少描述报错，并带上位置信息', () => {
    const result = validateAcceptanceChecks([{ id: 'a', description: '  ' }])

    expect(result.valid).toBe(false)
    expect(result.errors[0].index).toBe(0)
    expect(result.errors[0].message).toContain('缺少描述')
  })

  it('id 重复报错', () => {
    const result = validateAcceptanceChecks([
      { id: 'dup', description: '第一项' },
      { id: 'dup', description: '第二项' },
    ])

    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toContain('id 重复')
  })

  it('缺少 id 只给告警，因为会自动补位', () => {
    const result = validateAcceptanceChecks([{ description: '第一项' }])

    expect(result.valid).toBe(true)
    expect(result.warnings[0].message).toContain('缺少 id')
  })

  it('非法的判定规则类型报错', () => {
    const result = validateAcceptanceChecks([
      { id: 'a', description: '查询', verify: { kind: 'sql', payload: 'select 1' } },
    ])

    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toContain('只支持 tool / expression')
  })

  it('判定规则缺少载荷时报错', () => {
    const result = validateAcceptanceChecks([
      { id: 'a', description: '执行测试', verify: { kind: 'tool', payload: '   ' } },
    ])

    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toContain('payload 不能为空')
  })

  it('表达式规则给出告警，提示运行时会转人工确认', () => {
    const result = validateAcceptanceChecks([
      { id: 'a', description: '覆盖率达标', verify: { kind: 'expression', payload: 'cov > 0.8' } },
    ])

    expect(result.valid).toBe(true)
    expect(result.warnings[0].message).toContain('人工确认')
  })

  it('非对象条目报错', () => {
    const result = validateAcceptanceChecks(['not-an-object'])

    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toContain('必须是对象')
  })

  it('超出数量上限时给出告警', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, description: `第 ${i} 项` }))
    const result = validateAcceptanceChecks(many)

    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.message.includes('超过上限'))).toBe(true)
  })
})
