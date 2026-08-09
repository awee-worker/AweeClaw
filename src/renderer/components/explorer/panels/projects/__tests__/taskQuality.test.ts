/**
 * taskQuality 解析逻辑单元测试
 *
 * 覆盖：
 * - parseExecutionResult：正常 / 边界 / 异常 / 中英文标题（基于 Markdown H2/H3 标题解析）
 * - extractExecutionResult / mergeExecutionResult：metadata 读写与字段保留
 * - stripResultBlock / hasResultBlock：结果块裁剪与判定
 */
import { describe, it, expect } from 'vitest'
import {
  parseExecutionResult,
  extractExecutionResult,
  mergeExecutionResult,
  stripResultBlock,
  hasResultBlock,
  type TaskExecutionResult,
} from '../taskQuality'

// ─── 测试夹具：完整的结构化结果块（中文 H3 子节） ─────────────
const FULL_BLOCK_ZH = `## 执行结果

### 执行摘要
创建了用户认证模块，包含登录和注册功能。

### 产出文件
- \`/src/auth/login.ts\` — 登录逻辑
- \`/src/auth/register.ts\` — 注册逻辑

### 验收对照
- [x] 实现登录功能
- [x] 实现注册功能
- [ ] JWT 鉴权中间件 — 未实现，待补充

### 后续建议
建议补充密码重置功能。`

// ─── 测试夹具：完整结构化结果块（英文 H3 子节） ───────────────
const FULL_BLOCK_EN = `## Execution Result

### Summary
Created the user auth module with login and register.

### Deliverables
- \`/src/auth/login.ts\` — Login logic

### Acceptance Check
- [x] Login implemented
- [ ] JWT middleware: not yet

### Follow-up
Add password reset.`

describe('parseExecutionResult', () => {
  describe('异常与边界输入', () => {
    it('空字符串返回 null', () => {
      expect(parseExecutionResult('')).toBeNull()
    })

    it('仅含空白返回 null', () => {
      expect(parseExecutionResult('   \n\n  ')).toBeNull()
    })

    it('不含结果标题的普通文本返回 null', () => {
      expect(parseExecutionResult('这是一段普通的 AI 回复，没有结构化结果。')).toBeNull()
    })

    it('含普通 H2 标题但非「执行结果」返回 null', () => {
      expect(parseExecutionResult('## 实现过程\n\n我创建了登录组件。')).toBeNull()
    })

    it('有「执行结果」标题但内容为空返回 null', () => {
      const text = `## 执行结果\n\n## 其他章节`
      expect(parseExecutionResult(text)).toBeNull()
    })

    it('有「执行结果」标题但缺少执行摘要子节返回 null', () => {
      const text = `## 执行结果\n\n### 产出文件\n- \`/a.ts\` — desc`
      expect(parseExecutionResult(text)).toBeNull()
    })
  })

  describe('正常解析（中文标题）', () => {
    const result = parseExecutionResult(FULL_BLOCK_ZH)!

    it('解析出执行摘要', () => {
      expect(result).not.toBeNull()
      expect(result.summary).toBe('创建了用户认证模块，包含登录和注册功能。')
    })

    it('解析出产出文件列表', () => {
      expect(result.deliverables).toHaveLength(2)
      expect(result.deliverables[0]).toEqual({
        path: '/src/auth/login.ts',
        description: '登录逻辑',
      })
      expect(result.deliverables[1]).toEqual({
        path: '/src/auth/register.ts',
        description: '注册逻辑',
      })
    })

    it('解析出验收对照（含通过/未通过/备注）', () => {
      expect(result.acceptanceCheck).toHaveLength(3)
      expect(result.acceptanceCheck[0]).toEqual({
        criteria: '实现登录功能',
        passed: true,
        note: undefined,
      })
      expect(result.acceptanceCheck[2]).toEqual({
        criteria: 'JWT 鉴权中间件',
        passed: false,
        note: '未实现，待补充',
      })
    })

    it('解析出后续建议', () => {
      expect(result.followUp).toBe('建议补充密码重置功能。')
    })

    it('记录解析时间戳', () => {
      expect(result.parsedAt).toBeTruthy()
      expect(() => new Date(result.parsedAt!).toISOString()).not.toThrow()
    })
  })

  describe('正常解析（英文标题）', () => {
    const result = parseExecutionResult(FULL_BLOCK_EN)!

    it('解析出 summary', () => {
      expect(result).not.toBeNull()
      expect(result.summary).toBe('Created the user auth module with login and register.')
    })

    it('解析出 deliverables', () => {
      expect(result.deliverables).toHaveLength(1)
      expect(result.deliverables[0].path).toBe('/src/auth/login.ts')
    })

    it('解析出 acceptance check', () => {
      expect(result.acceptanceCheck).toHaveLength(2)
      expect(result.acceptanceCheck[1]).toEqual({
        criteria: 'JWT middleware',
        passed: false,
        note: 'not yet',
      })
    })

    it('解析出 follow-up', () => {
      expect(result.followUp).toBe('Add password reset.')
    })
  })

  describe('正文 + 结果块混合', () => {
    it('能从包含正文的回复中提取结果块', () => {
      const text = `我先创建了登录组件，然后实现了注册逻辑。\n\n执行过程如下：\n1. 创建文件\n2. 编写逻辑\n\n${FULL_BLOCK_ZH}`
      const result = parseExecutionResult(text)!
      expect(result).not.toBeNull()
      expect(result.summary).toContain('用户认证模块')
      expect(result.deliverables).toHaveLength(2)
    })

    it('仅有摘要子节也能解析（产出/验收为空数组）', () => {
      const text = `## 执行结果\n\n### 执行摘要\n仅完成分析，无文件产出。`
      const result = parseExecutionResult(text)!
      expect(result.summary).toBe('仅完成分析，无文件产出。')
      expect(result.deliverables).toEqual([])
      expect(result.acceptanceCheck).toEqual([])
      expect(result.followUp).toBeUndefined()
    })
  })

  describe('块边界：遇到下一个 H2 截止', () => {
    it('结果块后跟其他 H2 章节时，不把后续内容计入结果块', () => {
      const text = `${FULL_BLOCK_ZH}\n\n## 其他章节\n\n### 执行摘要\n不应被解析进来`
      const result = parseExecutionResult(text)!
      expect(result.summary).toBe('创建了用户认证模块，包含登录和注册功能。')
      // 后续「其他章节」的内容不应混入
      expect(result.followUp).toBe('建议补充密码重置功能。')
    })

    it('H3 标题（###）不会截断结果块（仅 H2 截断）', () => {
      const text = `## 执行结果\n\n### 执行摘要\n摘要。\n### 产出文件\n- \`/a.ts\` — desc\n### 后续建议\n建议`
      const result = parseExecutionResult(text)!
      expect(result.deliverables).toHaveLength(1)
      expect(result.followUp).toBe('建议')
    })
  })

  describe('产出文件分隔符兼容性', () => {
    it('支持冒号分隔', () => {
      const text = `## 执行结果\n\n### 执行摘要\n摘要。\n### 产出文件\n- \`/a.ts\`: 描述`
      const result = parseExecutionResult(text)!
      expect(result.deliverables[0]).toEqual({ path: '/a.ts', description: '描述' })
    })

    it('支持短横线分隔', () => {
      const text = `## 执行结果\n\n### 执行摘要\n摘要。\n### 产出文件\n- \`/a.ts\` - 描述`
      const result = parseExecutionResult(text)!
      expect(result.deliverables[0]).toEqual({ path: '/a.ts', description: '描述' })
    })

    it('支持星号列表项', () => {
      const text = `## 执行结果\n\n### 执行摘要\n摘要。\n### 产出文件\n* \`/a.ts\` — 描述`
      const result = parseExecutionResult(text)!
      expect(result.deliverables).toHaveLength(1)
      expect(result.deliverables[0].path).toBe('/a.ts')
    })
  })

  describe('验收对照格式', () => {
    it('大写 [X] 也视为通过', () => {
      const text = `## 执行结果\n\n### 执行摘要\n摘要。\n### 验收对照\n- [X] 某项标准`
      const result = parseExecutionResult(text)!
      expect(result.acceptanceCheck[0].passed).toBe(true)
    })

    it('无备注的未通过项 note 为 undefined', () => {
      const text = `## 执行结果\n\n### 执行摘要\n摘要。\n### 验收对照\n- [ ] 某项标准`
      const result = parseExecutionResult(text)!
      expect(result.acceptanceCheck[0].passed).toBe(false)
      expect(result.acceptanceCheck[0].note).toBeUndefined()
    })
  })

  describe('标题大小写兼容', () => {
    it('小写 execution result 也识别', () => {
      const text = `## execution result\n\n### summary\nSome summary.`
      const result = parseExecutionResult(text)!
      expect(result.summary).toBe('Some summary.')
    })

    it('小写 summary 子节也识别', () => {
      const text = `## Execution Result\n\n### summary\nSome summary.`
      const result = parseExecutionResult(text)!
      expect(result.summary).toBe('Some summary.')
    })
  })
})

describe('extractExecutionResult', () => {
  it('metadata 为 null 返回 null', () => {
    expect(extractExecutionResult(null)).toBeNull()
  })

  it('metadata 不是对象返回 null', () => {
    expect(extractExecutionResult('string')).toBeNull()
    expect(extractExecutionResult(123)).toBeNull()
  })

  it('metadata 无 result 字段返回 null', () => {
    expect(extractExecutionResult({ quality: { expectedOutput: 'x' } })).toBeNull()
  })

  it('result 缺少 summary 返回 null', () => {
    expect(extractExecutionResult({ result: { deliverables: [] } })).toBeNull()
  })

  it('完整 result 正确提取', () => {
    const metadata = {
      quality: { expectedOutput: 'out' },
      result: {
        summary: '摘要',
        deliverables: [{ path: '/a.ts', description: 'desc' }],
        acceptanceCheck: [
          { criteria: 'c1', passed: true },
          { criteria: 'c2', passed: false, note: '原因' },
        ],
        followUp: '建议',
        durationSec: 42,
        parsedAt: '2026-01-01T00:00:00.000Z',
      },
    }
    const result = extractExecutionResult(metadata)!
    expect(result.summary).toBe('摘要')
    expect(result.deliverables).toHaveLength(1)
    expect(result.acceptanceCheck).toHaveLength(2)
    expect(result.acceptanceCheck[1].note).toBe('原因')
    expect(result.durationSec).toBe(42)
  })

  it('对畸形的 deliverables / acceptanceCheck 做防御性解析', () => {
    const metadata = {
      result: {
        summary: '摘要',
        deliverables: [
          { path: '/a.ts', description: 'ok' },
          null,
          { description: 'no path' },
          'string-item',
        ],
        acceptanceCheck: [
          { criteria: 'c1', passed: true },
          null,
          { passed: true }, // 无 criteria，应被过滤
        ],
      },
    }
    const result = extractExecutionResult(metadata)!
    expect(result.deliverables).toHaveLength(1)
    expect(result.acceptanceCheck).toHaveLength(1)
  })
})

describe('mergeExecutionResult', () => {
  it('保留 metadata 中已有的其他字段（如 quality）', () => {
    const metadata = { quality: { expectedOutput: 'out' }, other: 'kept' }
    const result: TaskExecutionResult = {
      summary: '新摘要',
      deliverables: [],
      acceptanceCheck: [],
    }
    const merged = mergeExecutionResult(metadata, result)
    expect(merged.quality).toEqual({ expectedOutput: 'out' })
    expect(merged.other).toBe('kept')
    expect((merged.result as TaskExecutionResult).summary).toBe('新摘要')
  })

  it('metadata 为 null 时仍能写入 result', () => {
    const result: TaskExecutionResult = {
      summary: '摘要',
      deliverables: [],
      acceptanceCheck: [],
    }
    const merged = mergeExecutionResult(null, result)
    expect(merged.result).toBe(result)
  })

  it('不修改原 metadata 对象', () => {
    const metadata = { quality: { expectedOutput: 'out' } }
    const result: TaskExecutionResult = {
      summary: '摘要',
      deliverables: [],
      acceptanceCheck: [],
    }
    mergeExecutionResult(metadata, result)
    expect(metadata).toEqual({ quality: { expectedOutput: 'out' } })
    expect((metadata as Record<string, unknown>).result).toBeUndefined()
  })
})

describe('stripResultBlock', () => {
  it('无结果块时原样返回', () => {
    expect(stripResultBlock('普通文本')).toBe('普通文本')
  })

  it('空字符串原样返回', () => {
    expect(stripResultBlock('')).toBe('')
  })

  it('裁剪结果块，保留正文', () => {
    const text = `正文内容\n\n${FULL_BLOCK_ZH}`
    const stripped = stripResultBlock(text)
    expect(stripped).toBe('正文内容')
    expect(stripped).not.toContain('## 执行结果')
  })
})

describe('hasResultBlock', () => {
  it('包含结果标题 + 摘要子节返回 true', () => {
    expect(hasResultBlock(FULL_BLOCK_ZH)).toBe(true)
  })

  it('仅有结果标题但无摘要子节返回 false', () => {
    expect(hasResultBlock('## 执行结果\n\n### 产出文件\n- /a.ts')).toBe(false)
  })

  it('不含结果标题返回 false', () => {
    expect(hasResultBlock('普通文本')).toBe(false)
  })

  it('英文标题 + summary 子节返回 true', () => {
    expect(hasResultBlock(FULL_BLOCK_EN)).toBe(true)
  })
})
