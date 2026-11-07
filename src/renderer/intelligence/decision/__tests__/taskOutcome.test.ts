/**
 * 终局诊断与中途自查的守门测试
 *
 * 重点在边界：小预算不提醒、节点轮次计算、子类型归类优先级。
 */
import { describe, it, expect } from 'vitest'
import {
  classifyFailureSubtype,
  failureSubtypeLabel,
  buildTaskSummary,
  buildCompletedSummary,
  buildFailureNextActions,
  buildSelfCheckPrompt,
  firstSentenceOf,
  selfCheckRound,
  SELF_CHECK_MIN_BUDGET,
} from '../taskOutcome'

describe('classifyFailureSubtype', () => {
  it('按关键词归类', () => {
    expect(classifyFailureSubtype('page requires login')).toBe('login_incomplete')
    expect(classifyFailureSubtype('请输入验证码')).toBe('captcha_incomplete')
    expect(classifyFailureSubtype('Permission denied')).toBe('blocked')
    expect(classifyFailureSubtype('ENOENT: no such file')).toBe('route_failed')
    expect(classifyFailureSubtype('device offline')).toBe('device_unavailable')
    expect(classifyFailureSubtype('something odd')).toBe('interaction_failed')
    expect(classifyFailureSubtype('')).toBe('interaction_failed')
  })

  it('登录优先于其他关键词', () => {
    expect(classifyFailureSubtype('login page, permission denied')).toBe('login_incomplete')
  })

  it('本地化文案覆盖全部子类型', () => {
    expect(failureSubtypeLabel('login_incomplete', 'zh')).toContain('登录')
    expect(failureSubtypeLabel('login_incomplete', 'en')).toContain('Login')
  })
})

describe('selfCheckRound', () => {
  it('预算过小不提醒', () => {
    expect(selfCheckRound(SELF_CHECK_MIN_BUDGET - 1, 'half')).toBeNull()
    expect(selfCheckRound(3, 'final')).toBeNull()
  })

  it('60 轮预算 → 30 / 45 / 60', () => {
    expect(selfCheckRound(60, 'half')).toBe(30)
    expect(selfCheckRound(60, 'threeQuarter')).toBe(45)
    expect(selfCheckRound(60, 'final')).toBe(60)
  })

  it('节点轮次严格递增，不出现 0', () => {
    const budget = 10
    const rounds = (['half', 'threeQuarter', 'final'] as const).map((s) => selfCheckRound(budget, s))
    expect(rounds.every((r) => r !== null && r >= 1)).toBe(true)
    expect(rounds[0]! < rounds[1]!).toBe(true)
    expect(rounds[1]! <= rounds[2]!).toBe(true)
  })
})

describe('buildSelfCheckPrompt', () => {
  it('最后一轮明确禁止再调工具', () => {
    const zh = buildSelfCheckPrompt('zh', 'final')
    expect(zh).toContain('不要再调用任何工具')
    expect(zh).toContain('如实')
  })

  it('中途自查要求回答三件事并给出放弃出口', () => {
    const zh = buildSelfCheckPrompt('zh', 'half')
    expect(zh).toContain('已经确认了什么')
    expect(zh).toContain('放弃')
  })
})

describe('buildTaskSummary / buildFailureNextActions', () => {
  it('无错误时不给 blocker', () => {
    const summary = buildTaskSummary({ reached: '第 3 步' })
    expect(summary.blocker).toBeUndefined()
    expect(summary.nextActions.length).toBeGreaterThanOrEqual(2)
  })

  it('有错误时归类并附详情', () => {
    const summary = buildTaskSummary({ reached: '打开页面', error: 'requires login' })
    expect(summary.blocker?.subtype).toBe('login_incomplete')
    expect(summary.blocker?.detail).toBe('requires login')
  })

  it('可接管时多给「我来处理」', () => {
    const withTakeover = buildFailureNextActions({ canTakeover: true }).map((a) => a.action)
    const without = buildFailureNextActions().map((a) => a.action)
    expect(withTakeover).toContain('takeover')
    expect(without).not.toContain('takeover')
    expect(without).toContain('retry')
    expect(without).toContain('new-task')
  })
})

describe('成功终局摘要', () => {
  it('成功态没有 blocker，也不给失败类动作', () => {
    const summary = buildCompletedSummary('已生成周报并放到工作空间')
    expect(summary.reached).toBe('已生成周报并放到工作空间')
    expect(summary.blocker).toBeUndefined()
    // 成功后又给「重试」只会在移动端制造一个无意义的按钮
    expect(summary.nextActions).toEqual([])
  })

  it('空内容退回默认文案而不是空字符串', () => {
    expect(buildCompletedSummary('   ').reached).toBe('任务已完成')
  })

  it('reached 超长时截断，避免撑爆移动端卡片', () => {
    const summary = buildCompletedSummary('啊'.repeat(500))
    expect(summary.reached.length).toBeLessThanOrEqual(200)
  })
})

describe('firstSentenceOf', () => {
  it('取第一句并收敛空白', () => {
    expect(firstSentenceOf('已生成周报。另外还导出了 PDF。')).toBe('已生成周报。')
  })

  it('没有句末标点时取整段（压缩空白）', () => {
    expect(firstSentenceOf('  完成  所有步骤  ')).toBe('完成 所有步骤')
  })

  it('空文本返回空串', () => {
    expect(firstSentenceOf('   ')).toBe('')
  })
})
