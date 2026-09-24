/**
 * 技能清单预算验收
 *
 * 验收目标：技能数量增长后清单不会无限膨胀，且被折叠的技能仍可被发现。
 */

import { describe, expect, it } from 'vitest'
import {
  buildSkillManifest,
  estimateSkillEntryTokens,
  type SkillManifestEntry,
} from '../skillManifestBudget'

function entry(name: string, description = 'a short description'): SkillManifestEntry {
  return { name, description }
}

function makeSkills(count: number): SkillManifestEntry[] {
  return Array.from({ length: count }, (_, i) => entry(`skill-${i}`, 'handles a specific kind of task'))
}

describe('estimateSkillEntryTokens', () => {
  it('按名称与描述长度估算，且恒为正', () => {
    expect(estimateSkillEntryTokens(entry('a', 'b'))).toBeGreaterThan(0)
    expect(estimateSkillEntryTokens(entry('a-longer-name', 'b'))).toBeGreaterThan(
      estimateSkillEntryTokens(entry('a', 'b'))
    )
  })
})

describe('buildSkillManifest', () => {
  it('空清单直接返回空结果', () => {
    const result = buildSkillManifest([], 1000)

    expect(result.included).toHaveLength(0)
    expect(result.foldedCount).toBe(0)
    expect(result.foldedNotice).toBeNull()
  })

  it('预算充足时全部保留且无折叠提示', () => {
    const skills = makeSkills(5)
    const result = buildSkillManifest(skills, 10_000)

    expect(result.included).toHaveLength(5)
    expect(result.foldedCount).toBe(0)
    expect(result.foldedNotice).toBeNull()
  })

  it('预算不足时折叠超额部分并给出计数提示', () => {
    const skills = makeSkills(50)
    const result = buildSkillManifest(skills, 60)

    expect(result.included.length).toBeLessThan(50)
    expect(result.foldedCount).toBe(50 - result.included.length)
    expect(result.foldedNotice).toContain(String(result.foldedCount))
    expect(result.foldedNotice).toContain('apply_skill')
  })

  it('保留顺序与输入一致，便于模型按序查看', () => {
    const skills = [entry('alpha'), entry('beta'), entry('gamma')]
    const result = buildSkillManifest(skills, 10_000)

    expect(result.included.map(s => s.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('优先名单中的技能被排到前面', () => {
    const skills = [entry('alpha'), entry('beta'), entry('gamma')]
    const result = buildSkillManifest(skills, 10_000, ['gamma'])

    expect(result.included[0].name).toBe('gamma')
    expect(result.included).toHaveLength(3)
  })

  it('预算极小时至少保留首条，清单不塌陷为纯提示', () => {
    const skills = makeSkills(10)
    const result = buildSkillManifest(skills, 0)

    expect(result.included).toHaveLength(1)
    expect(result.foldedCount).toBe(9)
  })

  it('优先技能在预算紧张时仍能进入清单', () => {
    const skills = makeSkills(30)
    const result = buildSkillManifest(skills, 40, ['skill-25'])

    expect(result.included[0].name).toBe('skill-25')
  })

  it('折叠提示为空时不污染清单文本', () => {
    const result = buildSkillManifest(makeSkills(3), 10_000)

    expect(result.foldedNotice).toBeNull()
  })
})
