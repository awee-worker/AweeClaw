/**
 * 工具卡片路径提取测试
 *
 * 覆盖的核心约定：
 * 1. 同一路径语义在不同工具下的键名差异（path / file_path / filePath / directory /
 *    output_path / paths / files 等）都要能识别 —— 只认 path 会让卡片丢失目标，
 *    差异预览与审批卡片只剩占位符；键名清单与执行层的参数归一化同源
 * 2. 空值与非字符串一律忽略，不产生空路径
 */

import { describe, it, expect } from 'vitest'
import { getToolPathList, getPrimaryToolPath, getPathSummary } from '../helpers'

describe('getToolPathList', () => {
  it('识别 path', () => {
    expect(getToolPathList({ path: 'src/a.ts' })).toEqual(['src/a.ts'])
    expect(getToolPathList({ path: ['src/a.ts', 'src/b.ts'] })).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('识别 file_path（场景开发工具）', () => {
    expect(getToolPathList({ file_path: 'scenario.json' })).toEqual(['scenario.json'])
  })

  it('识别 filePath', () => {
    expect(getToolPathList({ filePath: 'prompts/system.md' })).toEqual(['prompts/system.md'])
  })

  it('识别 paths', () => {
    expect(getToolPathList({ paths: ['a.ts', 'b.ts'] })).toEqual(['a.ts', 'b.ts'])
  })

  it('识别目录与输出路径类键名', () => {
    expect(getToolPathList({ directory: 'src' })).toEqual(['src'])
    expect(getToolPathList({ output_path: 'out/report.pdf' })).toEqual(['out/report.pdf'])
  })

  it('识别 files / file_paths 等复数写法', () => {
    expect(getToolPathList({ files: ['a.ts'] })).toEqual(['a.ts'])
    expect(getToolPathList({ file_paths: ['a.ts'] })).toEqual(['a.ts'])
  })

  it('path 优先于 file_path 与 paths', () => {
    expect(getToolPathList({ path: 'a.ts', file_path: 'b.ts', paths: ['c.ts'] })).toEqual(['a.ts'])
  })

  it('无路径参数时返回空数组而不是空字符串项', () => {
    expect(getToolPathList({ pattern: 'foo' })).toEqual([])
    expect(getToolPathList({ path: '' })).toEqual([])
    expect(getToolPathList({ path: 42 })).toEqual([])
    expect(getToolPathList({ paths: ['', null] } as Record<string, unknown>)).toEqual([])
  })
})

describe('getPrimaryToolPath', () => {
  it('取第一个路径，无路径时为空串', () => {
    expect(getPrimaryToolPath({ file_path: 'scenario.json' })).toBe('scenario.json')
    expect(getPrimaryToolPath({ pattern: 'foo' })).toBe('')
  })
})

describe('getPathSummary', () => {
  it('单路径给出文件名，多路径给出数量与前几个文件名', () => {
    expect(getPathSummary(['/ws/src/a.ts'])).toBe('a.ts')
    expect(getPathSummary(['/ws/a.ts', '/ws/b.ts'])).toBe('2 files ("a.ts", "b.ts")')
  })
})
