/**
 * 路径片段折叠回归测试
 *
 * 目标：让「折叠后仍落在允许范围内」的相对写法（src/../lib/x.ts、
 * ../sibling/y.ts）不再被误判为目录穿越，同时保证真正越界的路径
 * 在折叠后依然会被工作区边界校验拦下（折叠不能变成绕过安全校验的手段）。
 */

import { describe, it, expect } from 'vitest'
import {
  collapsePathSegments,
  resolveToolPathInput,
  validatePath,
} from '../pathHelper'

describe('collapsePathSegments', () => {
  it('折叠 . 与 .. 片段', () => {
    expect(collapsePathSegments('/a/b/../c/./d.ts')).toBe('/a/c/d.ts')
    expect(collapsePathSegments('/a/b/../../../c')).toBe('/c')
    expect(collapsePathSegments('src/../lib/x.ts')).toBe('lib/x.ts')
    expect(collapsePathSegments('./src/./a.ts')).toBe('src/a.ts')
  })

  it('统一 Windows 分隔符并保留盘符', () => {
    expect(collapsePathSegments('C:\\proj\\src\\..\\lib\\a.ts')).toBe('C:/proj/lib/a.ts')
    expect(collapsePathSegments('C:\\..\\Windows')).toBe('C:/Windows')
  })

  it('无根可折叠的相对路径保留前导 ..', () => {
    expect(collapsePathSegments('../x.ts')).toBe('../x.ts')
    expect(collapsePathSegments('../../x.ts')).toBe('../../x.ts')
  })

  it('空输入返回空串', () => {
    expect(collapsePathSegments('')).toBe('')
    expect(collapsePathSegments(undefined)).toBe('')
  })
})

describe('resolveToolPathInput', () => {
  const workspace = '/w/project'

  it('相对路径按工作区根展开并折叠', () => {
    expect(resolveToolPathInput('src/a.ts', workspace)).toBe('/w/project/src/a.ts')
    expect(resolveToolPathInput('src/../lib/a.ts', workspace)).toBe('/w/project/lib/a.ts')
    // 向上走一级再回到工作区内部：折叠后仍在工作区内，应被放行
    expect(resolveToolPathInput('../project/lib/a.ts', workspace)).toBe('/w/project/lib/a.ts')
  })

  it('绝对路径原样折叠', () => {
    expect(resolveToolPathInput('/w/project/./a/../b.ts', workspace)).toBe('/w/project/b.ts')
  })
})

describe('折叠 + 边界校验（安全性不因折叠而下降）', () => {
  const workspace = '/w/project'

  it('折叠后仍在工作区内 → 放行', () => {
    const resolved = resolveToolPathInput('src/../lib/a.ts', workspace)
    const result = validatePath(resolved, workspace)
    expect(result.valid).toBe(true)
    expect(result.sanitizedPath).toBe('/w/project/lib/a.ts')
  })

  it('折叠后越出工作区 → 仍然拒绝', () => {
    const escaped = resolveToolPathInput('../sibling/a.ts', workspace)
    expect(escaped).toBe('/w/sibling/a.ts')
    const result = validatePath(escaped, workspace)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Path is outside workspace')
  })

  it('越界且命中系统敏感目录 → 由敏感路径规则拦截（更严格）', () => {
    const escaped = resolveToolPathInput('../../etc/hosts', workspace)
    expect(escaped).toBe('/etc/hosts')
    const result = validatePath(escaped, workspace)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Access to sensitive path denied')
  })

  it('折叠无法绕过敏感路径拦截', () => {
    const sneaky = resolveToolPathInput('/w/project/x/../../.ssh/id_rsa', workspace)
    const result = validatePath(sneaky, workspace)
    expect(result.valid).toBe(false)
  })
})
