import { describe, it, expect } from 'vitest'
import {
  getReadableDomainTags,
  getDomainTag,
  SCENE_MODE_DOMAIN_TAG,
  SHARED_DOMAIN_TAG,
} from '../sceneModeProtocol'

describe('getReadableDomainTags', () => {
  it('日常办公与代码开发共享同一工作域', () => {
    const workTags = getReadableDomainTags('work')
    const devTags = getReadableDomainTags('dev')

    expect(workTags).toContain(SCENE_MODE_DOMAIN_TAG.work)
    expect(workTags).toContain(SCENE_MODE_DOMAIN_TAG.dev)
    expect(workTags).toContain(SHARED_DOMAIN_TAG)

    // 两个场景的读取范围必须完全一致，否则「办公记的方案、开发读不到」会复现
    expect([...devTags].sort()).toEqual([...workTags].sort())
  })

  it('生活与学习各自隔离，并读不到工作域内容', () => {
    const lifeTags = getReadableDomainTags('life')
    const studyTags = getReadableDomainTags('study')

    expect(lifeTags).toEqual([SCENE_MODE_DOMAIN_TAG.life, SHARED_DOMAIN_TAG])
    expect(studyTags).toEqual([SCENE_MODE_DOMAIN_TAG.study, SHARED_DOMAIN_TAG])

    for (const tags of [lifeTags, studyTags]) {
      expect(tags).not.toContain(SCENE_MODE_DOMAIN_TAG.work)
      expect(tags).not.toContain(SCENE_MODE_DOMAIN_TAG.dev)
    }
  })

  it('未知模式只回退到共享域', () => {
    expect(getReadableDomainTags('unknown')).toEqual([SHARED_DOMAIN_TAG])
  })

  it('写入侧仍取当前场景自身的域标签', () => {
    // 读侧放开不等于写侧合并：开发模式写入的记忆仍归 domain:dev
    expect(getDomainTag('dev')).toBe(SCENE_MODE_DOMAIN_TAG.dev)
    expect(getDomainTag('work')).toBe(SCENE_MODE_DOMAIN_TAG.work)
  })
})
