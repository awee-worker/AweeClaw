/**
 * 版本比较与版本目录挑选测试
 *
 * 覆盖回归场景：插件安装目录下残留多个版本目录时（旧版本删除失败、
 * 本地记录丢失等），按字符串字典序会把 "1.9.0" 当成比 "1.10.0" 更新的版本，
 * 导致连接指向旧版本目录。
 */

import { describe, it, expect } from 'vitest'
import { compareVersions, isVersionDirName, pickLatestVersionDir } from '../versionHelper'

describe('compareVersions', () => {
  it('逐段按数值比较，不受字典序影响', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })

  it('主版本与次版本差异优先于修订号', () => {
    expect(compareVersions('1.2.0', '1.1.99')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
  })

  it('段数不足时按 0 补齐', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0)
  })

  it('相同版本返回 0', () => {
    expect(compareVersions('1.5.1', '1.5.1')).toBe(0)
  })

  it('忽略前导 v 与预发布后缀', () => {
    expect(compareVersions('v1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc1', '1.0.0')).toBe(0)
  })

  it('容忍非数字段，不抛异常', () => {
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0)
    expect(compareVersions('', '0.0.0')).toBe(0)
  })
})

describe('isVersionDirName', () => {
  it('识别版本号目录名', () => {
    expect(isVersionDirName('1.10.0')).toBe(true)
    expect(isVersionDirName('1.2')).toBe(true)
    expect(isVersionDirName('1')).toBe(true)
    expect(isVersionDirName('v1.10.0')).toBe(true)
    expect(isVersionDirName('1.0.0-rc1')).toBe(true)
    expect(isVersionDirName(' 1.10.0 ')).toBe(true)
  })

  it('排除非版本号目录名', () => {
    expect(isVersionDirName('backup')).toBe(false)
    expect(isVersionDirName('1.10.0.tmp')).toBe(false)
    expect(isVersionDirName('.DS_Store')).toBe(false)
    expect(isVersionDirName('latest')).toBe(false)
    expect(isVersionDirName('')).toBe(false)
  })
})

describe('pickLatestVersionDir', () => {
  it('多个版本目录取语义版本最大的', () => {
    expect(pickLatestVersionDir(['1.9.0', '1.10.0'])).toBe('1.10.0')
    expect(pickLatestVersionDir(['1.5.1', '1.10.0', '1.9.0'])).toBe('1.10.0')
    expect(pickLatestVersionDir(['2.0.0', '1.99.0'])).toBe('2.0.0')
  })

  it('单个版本目录直接返回', () => {
    expect(pickLatestVersionDir(['1.5.1'])).toBe('1.5.1')
  })

  it('忽略混入的非版本目录', () => {
    expect(pickLatestVersionDir(['1.9.0', '1.10.0', 'backup', '.DS_Store'])).toBe('1.10.0')
  })

  it('无可识别版本目录时退回字典序最大，保持旧行为', () => {
    expect(pickLatestVersionDir(['beta', 'alpha'])).toBe('beta')
  })

  it('空列表返回 null', () => {
    expect(pickLatestVersionDir([])).toBeNull()
  })

  it('不修改传入数组', () => {
    const names = ['1.10.0', '1.9.0']
    pickLatestVersionDir(names)
    expect(names).toEqual(['1.10.0', '1.9.0'])
  })
})
