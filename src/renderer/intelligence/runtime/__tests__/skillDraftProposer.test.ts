/**
 * 技能草稿生成验收
 *
 * 验收目标：固化的流程能被写成结构合法的 SKILL.md，来源统计如实带出，
 * 且本机路径不会随草稿流出。
 */

import { describe, expect, it } from 'vitest'
import { buildSkillDraft, buildSkillDrafts, isDraftable } from '../skillDraftProposer'
import type { ProceduralTemplate } from '../proceduralSkillLearner'

type Template = ProceduralTemplate
type Step = ProceduralTemplate['toolSequence'][number]

function step(toolName: string, params: Step['params'] = {}): Step {
  return { toolName, params }
}

function template(overrides: Partial<Template> = {}): Template {
  return {
    id: 't1',
    intentSignature: 'deploy service',
    intentKeywords: ['deploy', 'service'],
    taskType: 'coding',
    toolSequence: [
      step('read_file', { path: { type: 'dynamic', placeholder: 'path' } }),
      step('edit_file', { path: { type: 'dynamic', placeholder: 'path' } }),
      step('edit_file', { path: { type: 'dynamic', placeholder: 'path' } }),
    ],
    successCount: 5,
    failureCount: 1,
    successRate: 5 / 6,
    consecutiveSuccess: 3,
    lastUsedAt: 0,
    createdAt: 0,
    updatedAt: 0,
    enabled: true,
    exampleIntents: ['帮我部署一下这个服务'],
    ...overrides,
  }
}


describe('isDraftable', () => {
  it('多工具协作且含产出动作的流程可以成稿', () => {
    expect(isDraftable(template())).toBe(true)
  })

  it('没有工具调用的记录不成稿', () => {
    expect(isDraftable(template({ toolSequence: [] }))).toBe(false)
  })

  it('单步调用不成稿：那只是用了一次工具，不是方法', () => {
    expect(isDraftable(template({
      toolSequence: [step('edit_file', { path: { type: 'dynamic', placeholder: 'path' } })],
    }))).toBe(false)
  })

  it('同一个工具连调多次不成稿：那是重复动作，不是流程编排', () => {
    expect(isDraftable(template({
      toolSequence: [step('edit_file'), step('edit_file'), step('edit_file')],
    }))).toBe(false)
  })

  it('纯只读探查不成稿：没产出动作就没有可复用的方法', () => {
    expect(isDraftable(template({
      toolSequence: [step('read_file'), step('search_files'), step('list_directory')],
    }))).toBe(false)
  })
})

describe('buildSkillDraft', () => {
  it('名字取自意图关键词并符合命名约定', () => {
    const draft = buildSkillDraft(template({ intentKeywords: ['Deploy', 'Service'] }))

    expect(draft.name).toBe('deploy-service')
    expect(draft.name).toMatch(/^[a-z0-9-]+$/)
  })

  it('关键词全为中文时退回到任务类型加主要工具命名', () => {
    const draft = buildSkillDraft(template({ intentKeywords: ['部署', '服务'], taskType: 'coding' }))

    expect(draft.name).toBe('coding-edit-file')
  })

  it('SKILL.md 带 frontmatter 且含名称与描述', () => {
    const draft = buildSkillDraft(template())

    expect(draft.body.startsWith('---')).toBe(true)
    expect(draft.body).toContain(`name: ${draft.name}`)
    expect(draft.body).toContain(`description: ${draft.description}`)
    expect(draft.body).toContain('## Steps')
  })

  it('步骤按序输出，动态参数保留占位符', () => {
    const draft = buildSkillDraft(
      template({
        toolSequence: [
          step('read_file', { path: { type: 'dynamic', placeholder: 'path' } }),
          step('edit_file', { path: { type: 'dynamic', placeholder: 'path' } }),
        ],
      })
    )

    expect(draft.body).toContain('1. `read_file` with path=<path>')
    expect(draft.body).toContain('2. `edit_file` with path=<path>')
  })

  it('固定参数如实写出，但绝对路径被脱敏', () => {
    const draft = buildSkillDraft(
      template({
        toolSequence: [
          step('run_command', {
            command: { type: 'fixed', value: 'npm test' },
            cwd: { type: 'fixed', value: '/Users/someone/private-project' },
          }),
        ],
      })
    )

    expect(draft.body).toContain('command=npm test')
    expect(draft.body).toContain('cwd=<local-path>')
    expect(draft.body).not.toContain('/Users/someone')
  })

  it('来源统计与模板一致，并带回来源模板 id', () => {
    const draft = buildSkillDraft(template({ id: 'tpl-42', successCount: 7, failureCount: 3, successRate: 0.7 }))

    expect(draft.templateId).toBe('tpl-42')
    expect(draft.provenance.successCount).toBe(7)
    expect(draft.provenance.totalCount).toBe(10)
    expect(draft.provenance.successRate).toBeCloseTo(0.7)
    expect(draft.provenance.sampleIntents).toEqual(['帮我部署一下这个服务'])
  })

  it('样本请求作为示例写入正文', () => {
    const draft = buildSkillDraft(template({ exampleIntents: ['部署服务', '再部署一次'] }))

    expect(draft.body).toContain('## Example requests')
    expect(draft.body).toContain('- 部署服务')
    expect(draft.body).toContain('- 再部署一次')
  })

  it('描述不超出长度上限', () => {
    const draft = buildSkillDraft(
      template({ exampleIntents: ['x'.repeat(500)] })
    )

    expect(draft.description.length).toBeLessThanOrEqual(140)
  })
})

describe('buildSkillDrafts', () => {
  it('跳过没有流程可写的模板', () => {
    const drafts = buildSkillDrafts([
      template({ id: 'a' }),
      template({ id: 'b', toolSequence: [] }),
    ])

    expect(drafts).toHaveLength(1)
  })

  it('空输入返回空结果', () => {
    expect(buildSkillDrafts([])).toHaveLength(0)
  })
})
