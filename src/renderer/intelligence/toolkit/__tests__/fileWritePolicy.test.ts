import { describe, it, expect } from 'vitest'
import { analyzeWriteIntent, guardWriteFile } from '../fileWritePolicy'

/** 构造一份 80 行的样本文件，用于模拟“已有文件”的局部修改与整写覆盖 */
const BASE_LINES = Array.from({ length: 80 }, (_, i) => `const value${i} = ${i}`)
const BASE = BASE_LINES.join('\n')

/** 按行号批量替换，模拟模型改写文件内容 */
function replaceLines(source: string, edits: Array<[number, string]>): string {
  const lines = source.split('\n')
  for (const [index, text] of edits) lines[index] = text
  return lines.join('\n')
}

describe('analyzeWriteIntent', () => {
  it('原文件为空时判定为新建', () => {
    expect(analyzeWriteIntent('', BASE).intent).toBe('create')
  })

  it('单点局部修改判定为局部修改', () => {
    const next = replaceLines(BASE, [[40, '// changed']])
    expect(analyzeWriteIntent(BASE, next).intent).toBe('partial-update')
  })

  it('分散在文件多处的局部修改判定为局部修改', () => {
    // 回归重点：早期用「字符级公共前后缀包住的区间」估算改动量，
    // 会把三处改动之间未改动的内容一并算作改动，导致这类常规修改被判成整文件重写。
    const next = replaceLines(BASE, [
      [20, '// changed a'],
      [21, '// changed b'],
      [40, '// changed c'],
      [41, '// changed d'],
      [60, '// changed e'],
      [61, '// changed f'],
    ])
    const analysis = analyzeWriteIntent(BASE, next)
    expect(analysis.intent).toBe('partial-update')
    expect(analysis.changedOriginalLines).toBe(6)
    expect(analysis.changedRatio).toBeLessThan(0.35)
  })

  it('末尾追加内容判定为局部修改', () => {
    const next = `${BASE}\nconst appended = true`
    expect(analyzeWriteIntent(BASE, next).intent).toBe('partial-update')
  })

  it('换行符差异不计入改动量', () => {
    const next = BASE.replace(/\n/g, '\r\n')
    expect(analyzeWriteIntent(BASE, next).intent).toBe('partial-update')
    expect(analyzeWriteIntent(BASE, next).changedRatio).toBe(0)
  })

  it('大部分内容被替换判定为整文件重写', () => {
    const next = BASE_LINES.map((_, i) => `const rewritten${i} = ${i * 2}`).join('\n')
    expect(analyzeWriteIntent(BASE, next).intent).toBe('full-rewrite')
  })
})

describe('guardWriteFile', () => {
  it('新建文件放行', () => {
    const decision = guardWriteFile({
      path: 'src/new.ts',
      originalContent: '',
      nextContent: BASE,
      hasRecentRead: false,
    })
    expect(decision.allow).toBe(true)
    expect(decision.intent).toBe('create')
  })

  it('局部修改被拒绝，并引导改用 edit_file', () => {
    const next = replaceLines(BASE, [
      [20, '// changed a'],
      [40, '// changed b'],
      [60, '// changed c'],
    ])
    const decision = guardWriteFile({
      path: 'src/existing.ts',
      originalContent: BASE,
      nextContent: next,
      hasRecentRead: true,
    })
    expect(decision.allow).toBe(false)
    expect(decision.intent).toBe('partial-update')
    expect(decision.reason).toContain('edit_file')
    expect(decision.reason).toContain('read_file')
  })

  it('整文件重写在已读取时直接放行', () => {
    const next = BASE_LINES.map((_, i) => `const rewritten${i} = ${i}`).join('\n')
    const decision = guardWriteFile({
      path: 'src/existing.ts',
      originalContent: BASE,
      nextContent: next,
      hasRecentRead: true,
    })
    expect(decision.allow).toBe(true)
    expect(decision.intent).toBe('full-rewrite')
    expect(decision.reason).toBeUndefined()
  })

  it('整文件重写但未先读取时放行并附加提示', () => {
    const next = BASE_LINES.map((_, i) => `const rewritten${i} = ${i}`).join('\n')
    const decision = guardWriteFile({
      path: 'src/existing.ts',
      originalContent: BASE,
      nextContent: next,
      hasRecentRead: false,
    })
    expect(decision.allow).toBe(true)
    expect(decision.reason).toContain('edit_file')
  })
})
