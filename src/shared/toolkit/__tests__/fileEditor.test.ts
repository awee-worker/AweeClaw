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
        if (!result.ok) return
        expect(result.mode).toBe('batch')
        // 批量模式存在时，顶层字段被清理，解析结果里不应再出现它们
        expect(result.normalized).not.toHaveProperty('start_line')
    })

    it('混用行模式与字符串模式时选字符串模式，并说明忽略了哪些字段', () => {
        const result = resolveEditFileRequest({
            path: 'a.ts',
            old_string: 'a',
            new_string: 'b',
            start_line: 1,
            end_line: 2,
            content: 'c',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.mode).toBe('string')
        expect(result.notes?.join(' ')).toContain('start_line/end_line/content were ignored')
    })

    it('批量模式优先于其他模式', () => {
        const result = resolveEditFileRequest({
            path: 'a.ts',
            old_string: 'a',
            new_string: 'b',
            edits: [{ action: 'replace', start_line: 1, end_line: 1, content: 'x' }],
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.mode).toBe('batch')
        expect(result.notes?.join(' ')).toContain('batch mode takes precedence')
    })

    it('行模式完整、字符串字段只是空占位符时，仍执行行模式', () => {
        const result = resolveEditFileRequest({
            path: 'a.ts',
            old_string: '',
            new_string: '',
            start_line: 3,
            end_line: 4,
            content: 'x',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.mode).toBe('line')
    })

    it('数值以字符串形式传入时按数字处理', () => {
        const result = resolveEditFileRequest({
            path: 'a.ts',
            start_line: '3',
            end_line: '4',
            content: 'x',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.mode).toBe('line')
        expect(result.args).toMatchObject({ start_line: 3, end_line: 4 })
    })

    it('批量编辑里的字符串行号同样被转换', () => {
        const result = resolveEditFileRequest({
            path: 'a.ts',
            edits: [{ action: 'replace', start_line: '2', end_line: '3', content: 'x' }],
        })
        expect(result.ok).toBe(true)
        if (!result.ok || result.mode !== 'batch') return
        expect(result.args.edits[0]).toMatchObject({ start_line: 2, end_line: 3 })
    })

    it('null 字段不参与模式判定', () => {
        const result = resolveEditFileRequest({
            path: 'a.ts',
            old_string: null as unknown as string,
            new_string: null as unknown as string,
            start_line: 1,
            end_line: 1,
            content: 'x',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.mode).toBe('line')
    })

    it('完全没有编辑内容时报错并列出三种可用形态', () => {
        const result = resolveEditFileRequest({ path: 'a.ts' })
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error).toContain('old_string')
        expect(result.error).toContain('edits')
    })
})
