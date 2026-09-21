/**
 * 工具路径参数归一化测试
 *
 * 核心约定：
 * 1. 别名路径参数在声明参数缺失或为空时被归一过去，避免调用稳定失败
 * 2. 调用方已给出有效值时不被覆盖
 * 3. 未声明路径参数的工具原样返回
 * 4. 路径为空时提示工具真正期望的参数名
 */

import { describe, it, expect } from 'vitest'
import {
  buildMissingPathHint,
  normalizeToolPathArgs,
  resolveDeclaredPathParam,
} from '../toolArgNormalizer'

describe('resolveDeclaredPathParam', () => {
  it('识别工具声明的路径参数名', () => {
    expect(resolveDeclaredPathParam('read_file')).toBe('path')
    expect(resolveDeclaredPathParam('extract_document')).toBe('file_path')
  })

  it('没有声明路径参数的工具返回 null', () => {
    expect(resolveDeclaredPathParam('codebase_search')).toBeNull()
    expect(resolveDeclaredPathParam('not_a_tool')).toBeNull()
  })
})

describe('normalizeToolPathArgs', () => {
  it('把 file_path 归一到声明的 path', () => {
    const args = normalizeToolPathArgs('read_file', { file_path: 'src/a.ts' })
    expect(args.path).toBe('src/a.ts')
  })

  it('把 path 归一到声明的 file_path', () => {
    const args = normalizeToolPathArgs('extract_document', { path: 'docs/a.pdf' })
    expect(args.file_path).toBe('docs/a.pdf')
  })

  it('声明参数为空串或空数组时用别名补齐', () => {
    expect(normalizeToolPathArgs('read_file', { path: '', file_path: 'src/a.ts' }).path).toBe('src/a.ts')
    expect(normalizeToolPathArgs('read_file', { path: [], dir: 'src' }).path).toBe('src')
  })

  it('已给出有效值时不覆盖', () => {
    const args = normalizeToolPathArgs('read_file', { path: 'src/a.ts', file_path: 'src/b.ts' })
    expect(args.path).toBe('src/a.ts')
  })

  it('没有可用路径时保持原样', () => {
    const input = { path: '', pattern: 'foo' }
    expect(normalizeToolPathArgs('read_file', input)).toEqual(input)
  })

  it('未声明路径参数的工具原样返回', () => {
    const input = { query: 'foo' }
    expect(normalizeToolPathArgs('codebase_search', input)).toEqual(input)
  })

  it('参数缺失时返回空对象', () => {
    expect(normalizeToolPathArgs('read_file', undefined)).toEqual({})
  })
})

describe('buildMissingPathHint', () => {
  it('路径为空时给出声明的参数名与示例', () => {
    const hint = buildMissingPathHint('read_file', {})
    expect(hint).toContain('"path"')
    expect(hint).toContain('path="src/main.ts"')
  })

  it('路径有效时不追加提示', () => {
    expect(buildMissingPathHint('read_file', { path: 'src/a.ts' })).toBe('')
  })

  it('未声明路径参数的工具不追加提示', () => {
    expect(buildMissingPathHint('codebase_search', {})).toBe('')
  })
})
