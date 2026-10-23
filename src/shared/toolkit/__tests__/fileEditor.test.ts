import { describe, expect, it } from 'vitest'
import { resolveEditFileRequest, stripLineNumberPrefixes } from '../fileEditor'

describe('stripLineNumberPrefixes', () => {
    it('剥离 read_file 输出里的「行号: 内容」前缀', () => {
        const input = ['12: const a = 1', '13: const b = 2', '14: return a + b'].join('\n')
        expect(stripLineNumberPrefixes(input)).toBe(['const a = 1', 'const b = 2', 'return a + b'].join('\n'))
    })

    it('支持「行号 | 内容」形态', () => {
        const input = ['7 | foo()', '8 | bar()'].join('\n')
        expect(stripLineNumberPrefixes(input)).toBe(['foo()', 'bar()'].join('\n'))
    })

    it('只有一行时不剥离，避免误伤正文', () => {
        expect(stripLineNumberPrefixes('12: const a = 1')).toBe('')
    })

    it('多数行不带行号时不剥离', () => {
        const input = ['1: first', 'plain second', 'plain third', 'plain fourth'].join('\n')
        expect(stripLineNumberPrefixes(input)).toBe('')
    })

    it('正文里的冒号不被当成行号前缀', () => {
        const input = ['name: app', 'version: 1.0'].join('\n')
        expect(stripLineNumberPrefixes(input)).toBe('')
    })

    it('结尾空行不影响比例判定', () => {
        const input = ['1: a', '2: b', ''].join('\n')
        expect(stripLineNumberPrefixes(input)).toBe(['a', 'b', ''].join('\n'))
    })
})

describe('resolveEditFileRequest', () => {
    it('字符串模式要求 old_string 非空', () => {
        const result = resolveEditFileRequest({ path: 'a.ts', old_string: '', new_string: 'x' })
        expect(result.ok).toBe(false)
    })

    it('识别批量模式并清理冲突的顶层字段', () => {
        const result = resolveEditFileRequest({
            path: 'a.ts',
            edits: [{ action: 'replace', start_line: 1, end_line: 2, content: 'x' }],
        })
        expect(result.ok).toBe(true)
        expect(result.mode).toBe('batch')
    })

    it('拒绝混用行模式与字符串模式', () => {
        const result = resolveEditFileRequest({
            path: 'a.ts',
            old_string: 'a',
            new_string: 'b',
            start_line: 1,
            end_line: 2,
            content: 'c',
        })
        expect(result.ok).toBe(false)
    })
})
