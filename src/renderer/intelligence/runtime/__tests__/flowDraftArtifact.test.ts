/**
 * 快捷流草稿产物的守门测试
 *
 * 结构与移动端 FlowDraft 对齐是这套方案的契约：字段一漂移，移动端就拿不到步骤。
 * 因此重点覆盖字段形状、占位符命名与「没有轨迹时的兜底」。
 */
import { describe, it, expect } from 'vitest'
import {
  buildFlowDraftPayload,
  toFlowDraftArtifact,
  FLOW_DRAFT_ARTIFACT_TITLE,
} from '../flowDraftArtifact'
import type { ProceduralTemplate } from '../proceduralSkillLearner'

/** 造一个最小可用模板：只用到 toolSequence 与 exampleIntents */
function makeTemplate(): ProceduralTemplate {
  return {
    id: 'tpl_1',
    intentSignature: 'report|weekly',
    intentKeywords: ['report', 'weekly'],
    taskType: 'documentation',
    toolSequence: [
      {
        toolName: 'read_file',
        params: {
          path: { type: 'dynamic', placeholder: 'file_path' },
        },
      },
      {
        toolName: 'write_file',
        params: {
          path: { type: 'fixed', value: '/w/out.md' },
          content: { type: 'dynamic', placeholder: 'content' },
        },
      },
    ],
    successCount: 3,
    failureCount: 0,
    successRate: 1,
    consecutiveSuccess: 3,
    lastUsedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    enabled: true,
    exampleIntents: ['帮我生成周报'],
  }
}

describe('buildFlowDraftPayload', () => {
  it('按结构化工具序列生成步骤，并把占位符翻成中文参数名', () => {
    const payload = buildFlowDraftPayload({
      title: '生成周报',
      description: '每周汇总并导出',
      template: makeTemplate(),
    })

    expect(payload.title).toBe('生成周报')
    expect(payload.description).toBe('每周汇总并导出')
    expect(payload.steps).toHaveLength(2)
    expect(payload.steps[0].text).toContain('read_file')
    expect(payload.steps[0].placeholder).toBe('文件路径')
    expect(payload.steps[1].placeholder).toBe('内容')
  })

  it('固定参数原样保留，不产生占位符', () => {
    const payload = buildFlowDraftPayload({
      title: 'x',
      description: 'y',
      template: makeTemplate(),
    })
    expect(payload.steps[1].text).toContain('/w/out.md')
  })

  it('没有模板结构时从 SKILL.md 正文解析步骤', () => {
    const body = [
      '## Steps',
      '',
      '1. `read_file` with path=<file_path>',
      '2. `write_file` with path=/w/out.md',
      '',
    ].join('\n')

    const payload = buildFlowDraftPayload({
      title: 'x',
      description: 'y',
      skillDraft: { name: 'n', description: 'd', body, provenance: { successCount: 1, totalCount: 1, successRate: 1, sampleIntents: [] }, createdAt: 0 },
    })

    expect(payload.steps).toHaveLength(2)
    expect(payload.steps[0].placeholder).toBe('文件路径')
    expect(payload.steps[1].placeholder).toBeUndefined()
  })

  it('既无模板也无正文时给一条兜底步骤，不交空草稿', () => {
    const payload = buildFlowDraftPayload({ title: '生成周报', description: '每周汇总' })
    expect(payload.steps).toHaveLength(1)
    expect(payload.steps[0].text).toBe('每周汇总')
  })

  it('结构优先于正文：两者同时给时用模板轨迹', () => {
    const body = '## Steps\n\n1. `wrong_tool`\n'
    const payload = buildFlowDraftPayload({
      title: 'x',
      description: 'y',
      template: makeTemplate(),
      skillDraft: { name: 'n', description: 'd', body, provenance: { successCount: 1, totalCount: 1, successRate: 1, sampleIntents: [] }, createdAt: 0 },
    })
    expect(payload.steps[0].text).toContain('read_file')
    expect(payload.steps.some((s) => s.text.includes('wrong_tool'))).toBe(false)
  })
})

describe('toFlowDraftArtifact', () => {
  it('封成固定标题的文本产物，移动端可据此认出', () => {
    const payload = buildFlowDraftPayload({ title: 't', description: 'd' })
    const artifact = toFlowDraftArtifact(payload)

    expect(artifact).not.toBeNull()
    expect(artifact!.title).toBe(FLOW_DRAFT_ARTIFACT_TITLE)
    expect(artifact!.type).toBe('text')

    const roundTrip = JSON.parse(artifact!.content)
    expect(roundTrip.title).toBe('t')
    expect(Array.isArray(roundTrip.steps)).toBe(true)
  })
})
