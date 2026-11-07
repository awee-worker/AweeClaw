/**
 * 技能草稿产物的守门测试
 *
 * 与快捷流共用一套头部字段是这套方案的契约：字段一漂移，移动端就得为两份草稿
 * 各写一套解析。重点覆盖字段形状、步骤来源、兜底与序列化降级。
 */
import { describe, it, expect } from 'vitest'
import {
  buildSkillDraftPayload,
  toSkillDraftArtifact,
  SKILL_DRAFT_ARTIFACT_TITLE,
} from '../skillDraftArtifact'
import type { SkillDraft } from '../skillDraftProposer'

/** 造一个最小技能草稿：body 里按 SKILL.md 约定写出步骤 */
function makeSkillDraft(overrides: Partial<SkillDraft> = {}): SkillDraft {
  const body = [
    '---',
    'name: weekly-report',
    'description: 生成周报',
    '---',
    '',
    '## Steps',
    '',
    '1. `read_file` with path=<file_path>',
    '2. `write_file` with path=/w/out.md',
    '',
  ].join('\n')

  return {
    name: 'weekly-report',
    description: '生成周报并导出',
    body,
    provenance: {
      successCount: 3,
      totalCount: 4,
      successRate: 0.75,
      sampleIntents: ['帮我生成周报'],
    },
    createdAt: 1700000000000,
    ...overrides,
  }
}

describe('buildSkillDraftPayload', () => {
  it('头部字段与快捷流草稿同构，并携带技能名与全文', () => {
    const payload = buildSkillDraftPayload({ title: '生成周报', skillDraft: makeSkillDraft() })

    expect(payload.title).toBe('生成周报')
    expect(payload.description).toBe('生成周报并导出')
    expect(typeof payload.createdAt).toBe('number')
    expect(Array.isArray(payload.steps)).toBe(true)
    expect(payload.skillName).toBe('weekly-report')
    expect(payload.body).toContain('weekly-report')
  })

  it('步骤取自 SKILL.md 正文，占位符翻成中文参数名', () => {
    const payload = buildSkillDraftPayload({ title: 't', skillDraft: makeSkillDraft() })

    expect(payload.steps).toHaveLength(2)
    expect(payload.steps[0].text).toContain('read_file')
    expect(payload.steps[0].placeholder).toBe('文件路径')
    expect(payload.steps[1].placeholder).toBeUndefined()
  })

  it('正文里读不出步骤时给一条兜底步骤，不交空草稿', () => {
    const payload = buildSkillDraftPayload({
      title: '生成周报',
      skillDraft: makeSkillDraft({ body: 'no steps here', description: '只有描述' }),
    })

    expect(payload.steps).toHaveLength(1)
    expect(payload.steps[0].text).toBe('只有描述')
  })

  it('createdAt 沿用草稿生成时间，而不是封装时间', () => {
    const payload = buildSkillDraftPayload({ title: 't', skillDraft: makeSkillDraft() })
    expect(payload.createdAt).toBe(1700000000000)
  })

  it('归纳依据完整带出，供用户判断是否上架', () => {
    const payload = buildSkillDraftPayload({ title: 't', skillDraft: makeSkillDraft() })

    expect(payload.provenance.successCount).toBe(3)
    expect(payload.provenance.totalCount).toBe(4)
    expect(payload.provenance.sampleIntents).toEqual(['帮我生成周报'])
  })

  it('样本请求是副本：改动产物不影响原草稿', () => {
    const draft = makeSkillDraft()
    const payload = buildSkillDraftPayload({ title: 't', skillDraft: draft })

    payload.provenance.sampleIntents.push('额外样本')
    expect(draft.provenance.sampleIntents).toEqual(['帮我生成周报'])
  })
})

describe('toSkillDraftArtifact', () => {
  it('封成固定标题的文本产物，移动端可据此认出', () => {
    const payload = buildSkillDraftPayload({ title: '生成周报', skillDraft: makeSkillDraft() })
    const artifact = toSkillDraftArtifact(payload)

    expect(artifact).not.toBeNull()
    expect(artifact!.title).toBe(SKILL_DRAFT_ARTIFACT_TITLE)
    expect(artifact!.type).toBe('text')

    const roundTrip = JSON.parse(artifact!.content)
    expect(roundTrip.title).toBe('生成周报')
    expect(roundTrip.skillName).toBe('weekly-report')
    expect(Array.isArray(roundTrip.steps)).toBe(true)
  })

  it('与快捷流草稿的产物标题不同，两者可并存不被混淆', () => {
    expect(SKILL_DRAFT_ARTIFACT_TITLE).not.toBe('__flow_draft__')
    expect(SKILL_DRAFT_ARTIFACT_TITLE).toBe('__skill_draft__')
  })
})
