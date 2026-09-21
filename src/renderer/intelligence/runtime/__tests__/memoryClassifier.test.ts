import { describe, expect, it } from 'vitest'
import { ruleBasedClassify } from '../memoryClassifier'

describe('ruleBasedClassify 分类行为', () => {
  it('命中关键词时给出分类与子分类', () => {
    const result = ruleBasedClassify('项目要开发新版本，需求已确认')
    expect(result.category).toBe('WORK')
    expect(result.subcategory).toBe('project')
    expect(result.classifiedBy).toBe('rule')
  })

  it('无命中时归入未分类', () => {
    const result = ruleBasedClassify('zzz qqq')
    expect(result.category).toBe('UNCATEGORIZED')
    expect(result.confidence).toBe(0)
  })

  it('空内容归入未分类', () => {
    expect(ruleBasedClassify('').category).toBe('UNCATEGORIZED')
  })
})

describe('ruleBasedClassify 来源透传', () => {
  it('不传来源时结果不携带来源字段', () => {
    const result = ruleBasedClassify('项目要开发新版本')
    expect('originTrust' in result).toBe(false)
    expect('originChannel' in result).toBe(false)
  })

  it('传入来源时原样带出，不改变分类结果', () => {
    const plain = ruleBasedClassify('项目要开发新版本，需求已确认')
    const withOrigin = ruleBasedClassify('项目要开发新版本，需求已确认', {
      originTrust: 'untrusted',
      originChannel: 'web',
      originLocator: 'https://example.com/a',
      evidence: '原文片段',
    })

    expect(withOrigin.category).toBe(plain.category)
    expect(withOrigin.confidence).toBe(plain.confidence)
    expect(withOrigin.originTrust).toBe('untrusted')
    expect(withOrigin.originChannel).toBe('web')
    expect(withOrigin.originLocator).toBe('https://example.com/a')
    expect(withOrigin.evidence).toBe('原文片段')
  })

  it('未分类分支同样带出来源', () => {
    const result = ruleBasedClassify('zzz qqq', {
      originTrust: 'untrusted',
      originChannel: 'channel_message',
    })
    expect(result.category).toBe('UNCATEGORIZED')
    expect(result.originTrust).toBe('untrusted')
    expect(result.originChannel).toBe('channel_message')
  })
})
