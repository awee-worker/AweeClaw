/**
 * 任务契约验收
 *
 * 验收目标：声明的边界能被逐项判定，越界原因可解释，契约可导出。
 */

import { describe, expect, it } from 'vitest'
import {
  checkContractExpiry,
  checkTimeLimit,
  checkTokenBudget,
  checkToolAllowed,
  checkUntrustedContent,
  createDefaultTaskContract,
  evaluateContract,
  summarizeContract,
  toContractAuditEntry,
  validateTaskContract,
} from '../taskContract'

describe('createDefaultTaskContract', () => {
  it('默认禁止消费外部内容，需显式开启', () => {
    const contract = createDefaultTaskContract('t1')

    expect(contract.allowUntrustedContent).toBe(false)
    expect(contract.allowWrites).toBe(true)
    expect(contract.approvalPolicy).toBe('default')
  })

  it('可通过覆盖项调整边界', () => {
    const contract = createDefaultTaskContract('t1', {
      allowedTools: ['read_file'],
      allowWrites: false,
    })

    expect(contract.allowedTools).toEqual(['read_file'])
    expect(contract.allowWrites).toBe(false)
  })
})

describe('validateTaskContract', () => {
  it('默认契约合法', () => {
    expect(validateTaskContract(createDefaultTaskContract('t1')).valid).toBe(true)
  })

  it('额度非正数时报错', () => {
    const result = validateTaskContract(
      createDefaultTaskContract('t1', { tokenBudget: 0, timeLimitMs: -1 }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining(['tokenBudget 必须为正数', 'timeLimitMs 必须为正数']),
    )
  })

  it('未知确认策略时报错', () => {
    const result = validateTaskContract(
      createDefaultTaskContract('t1', {
        approvalPolicy: 'paranoid' as unknown as 'default',
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('未知的确认策略')
  })

  it('有效期区间颠倒时报错', () => {
    const result = validateTaskContract(
      createDefaultTaskContract('t1', { issuedAt: 1000, expiresAt: 500 }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.join()).toContain('有效期')
  })

  it('契约缺失时返回不合法而非抛错', () => {
    expect(validateTaskContract(null).valid).toBe(false)
  })
})

describe('checkToolAllowed', () => {
  it('禁止写操作时写工具被拒', () => {
    const contract = createDefaultTaskContract('t1', { allowWrites: false })
    const check = checkToolAllowed(contract, 'write_file')

    expect(check.allowed).toBe(false)
    expect(check.reason).toBe('write_not_allowed')
  })

  it('禁止写操作时读工具仍可用', () => {
    const contract = createDefaultTaskContract('t1', { allowWrites: false })

    expect(checkToolAllowed(contract, 'read_file').allowed).toBe(true)
    expect(checkToolAllowed(contract, 'search_files').allowed).toBe(true)
  })

  it('白名单外的工具被拒', () => {
    const contract = createDefaultTaskContract('t1', { allowedTools: ['read_file'] })
    const check = checkToolAllowed(contract, 'web_search')

    expect(check.allowed).toBe(false)
    expect(check.reason).toBe('tool_not_allowed')
  })

  it('空白名单表示不限制', () => {
    const contract = createDefaultTaskContract('t1')

    expect(checkToolAllowed(contract, 'web_search').allowed).toBe(true)
  })

  it('类别黑名单优先级高于白名单', () => {
    const contract = createDefaultTaskContract('t1', {
      allowedTools: ['run_command'],
      deniedCategories: ['terminal'],
    })
    const check = checkToolAllowed(contract, 'run_command', 'terminal')

    expect(check.allowed).toBe(false)
    expect(check.reason).toBe('category_denied')
  })
})

describe('额度与时长判定', () => {
  it('token 超限被拒', () => {
    const contract = createDefaultTaskContract('t1', { tokenBudget: 1000 })

    expect(checkTokenBudget(contract, 1000).allowed).toBe(true)
    expect(checkTokenBudget(contract, 1001).allowed).toBe(false)
    expect(checkTokenBudget(contract, 1001).reason).toBe('token_budget_exceeded')
  })

  it('超出时间上限被拒', () => {
    const contract = createDefaultTaskContract('t1', { timeLimitMs: 1000 })

    expect(checkTimeLimit(contract, 0, 1000).allowed).toBe(true)
    const exceeded = checkTimeLimit(contract, 0, 2000)
    expect(exceeded.allowed).toBe(false)
    expect(exceeded.reason).toBe('time_limit_exceeded')
  })

  it('契约失效后被拒', () => {
    const contract = createDefaultTaskContract('t1', { issuedAt: 0, expiresAt: 1000 })

    expect(checkContractExpiry(contract, 500).allowed).toBe(true)
    expect(checkContractExpiry(contract, 1500).reason).toBe('contract_expired')
  })

  it('未设失效时间时永不过期', () => {
    expect(checkContractExpiry(createDefaultTaskContract('t1'), Date.now() + 1e9).allowed).toBe(true)
  })
})

describe('checkUntrustedContent', () => {
  it('默认禁止消费外部内容', () => {
    const check = checkUntrustedContent(createDefaultTaskContract('t1'))

    expect(check.allowed).toBe(false)
    expect(check.reason).toBe('untrusted_content_not_allowed')
  })

  it('显式允许后放行', () => {
    const contract = createDefaultTaskContract('t1', { allowUntrustedContent: true })

    expect(checkUntrustedContent(contract).allowed).toBe(true)
  })
})

describe('evaluateContract', () => {
  it('任一项越界即整体拒绝', () => {
    const contract = createDefaultTaskContract('t1', { tokenBudget: 100, timeLimitMs: 1000 })
    const check = evaluateContract(contract, { usedTokens: 500, startedAt: 0, now: 100 })

    expect(check.allowed).toBe(false)
    expect(check.reason).toBe('token_budget_exceeded')
  })

  it('全部在界内时放行', () => {
    const contract = createDefaultTaskContract('t1', { tokenBudget: 10_000, timeLimitMs: 10_000 })
    const check = evaluateContract(contract, { usedTokens: 500, startedAt: 0, now: 100 })

    expect(check.allowed).toBe(true)
  })

  it('失效优先于额度判定', () => {
    const contract = createDefaultTaskContract('t1', { issuedAt: 0, expiresAt: 10, tokenBudget: 1 })
    const check = evaluateContract(contract, { usedTokens: 9999, now: 100 })

    expect(check.reason).toBe('contract_expired')
  })
})

describe('summarizeContract', () => {
  it('导出「被允许做什么」的清单', () => {
    const contract = createDefaultTaskContract('t1', {
      allowedTools: ['read_file'],
      allowWrites: false,
      deniedCategories: ['network'],
    })
    const text = summarizeContract(contract)

    expect(text).toContain('t1')
    expect(text).toContain('read_file')
    expect(text).toContain('禁止')
    expect(text).toContain('network')
  })

  it('支持英文输出', () => {
    const text = summarizeContract(createDefaultTaskContract('t1'), 'en')

    expect(text).toContain('Task contract')
    expect(text).toContain('Writes: allowed')
  })
})

describe('toContractAuditEntry', () => {
  it('契约与执行结果一并留痕', () => {
    const contract = createDefaultTaskContract('t1')
    const entry = toContractAuditEntry(contract, {
      usedTokens: 1200,
      elapsedMs: 3000,
      violations: [{ reason: 'write_not_allowed', at: 100 }],
      completed: true,
    })

    expect(entry.action).toBe('task.contract')
    expect(entry.taskId).toBe('t1')
    expect(entry.violationCount).toBe(1)
    expect(entry.contract.tokenBudget).toBe(contract.tokenBudget)
  })

  it('无越界时计数为零', () => {
    const entry = toContractAuditEntry(createDefaultTaskContract('t1'), {
      violations: [],
      completed: true,
    })

    expect(entry.violationCount).toBe(0)
  })
})
