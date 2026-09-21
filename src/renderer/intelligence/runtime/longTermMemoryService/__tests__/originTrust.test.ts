import { describe, expect, it } from 'vitest'
import { mergeOriginTrust, parseTrustChannel, parseTrustLevel } from '../originTrust'

describe('parseTrustLevel', () => {
  it('识别三种合法级别', () => {
    expect(parseTrustLevel('instruction')).toBe('instruction')
    expect(parseTrustLevel('trusted')).toBe('trusted')
    expect(parseTrustLevel('untrusted')).toBe('untrusted')
  })

  it('空值与未知值一律返回来源未知', () => {
    expect(parseTrustLevel(null)).toBeUndefined()
    expect(parseTrustLevel('')).toBeUndefined()
    expect(parseTrustLevel('TRUSTED')).toBeUndefined()
    expect(parseTrustLevel('whatever')).toBeUndefined()
  })
})

describe('parseTrustChannel', () => {
  it('识别合法通道', () => {
    expect(parseTrustChannel('web')).toBe('web')
    expect(parseTrustChannel('channel_message')).toBe('channel_message')
  })

  it('非法通道返回未知', () => {
    expect(parseTrustChannel('filesystem')).toBeUndefined()
    expect(parseTrustChannel(null)).toBeUndefined()
  })
})

describe('mergeOriginTrust', () => {
  it('全部可信时结果为可信', () => {
    const result = mergeOriginTrust([
      { originTrust: 'trusted', originLocator: '/a.md', originChannel: 'local_fs' },
      { originTrust: 'trusted', originLocator: '/b.md', originChannel: 'local_fs' },
    ])
    expect(result.originTrust).toBe('trusted')
    expect(result.originLocator).toBe('/a.md, /b.md')
    expect(result.originChannel).toBe('local_fs')
  })

  it('存在不可信来源时向下收敛为不可信', () => {
    const result = mergeOriginTrust([
      { originTrust: 'trusted', originLocator: '/a.md', originChannel: 'local_fs' },
      { originTrust: 'untrusted', originLocator: 'https://x.com', originChannel: 'web' },
    ])
    expect(result.originTrust).toBe('untrusted')
    expect(result.originLocator).toBe('/a.md, https://x.com')
  })

  it('不可信在前、可信在后同样收敛为不可信', () => {
    const result = mergeOriginTrust([
      { originTrust: 'untrusted', originChannel: 'web' },
      { originTrust: 'instruction', originChannel: 'local_compute' },
    ])
    expect(result.originTrust).toBe('untrusted')
  })

  it('来源全部未知时保持未知，不假定可信', () => {
    const result = mergeOriginTrust([{}, { originTrust: undefined }])
    expect(result.originTrust).toBeUndefined()
  })

  it('空数组返回空结果', () => {
    expect(mergeOriginTrust([])).toEqual({})
  })

  it('来源定位超过三处时折叠计数', () => {
    const result = mergeOriginTrust([
      { originTrust: 'trusted', originLocator: '/1' },
      { originTrust: 'trusted', originLocator: '/2' },
      { originTrust: 'trusted', originLocator: '/3' },
      { originTrust: 'trusted', originLocator: '/4' },
    ])
    expect(result.originLocator).toBe('/1, /2, /3 等 4 处')
  })

  it('重复来源定位去重', () => {
    const result = mergeOriginTrust([
      { originTrust: 'trusted', originLocator: '/a.md' },
      { originTrust: 'trusted', originLocator: '/a.md' },
    ])
    expect(result.originLocator).toBe('/a.md')
  })

  it('证据取首个非空', () => {
    const result = mergeOriginTrust([
      { originTrust: 'trusted' },
      { originTrust: 'trusted', evidence: '原文片段' },
    ])
    expect(result.evidence).toBe('原文片段')
  })
})
