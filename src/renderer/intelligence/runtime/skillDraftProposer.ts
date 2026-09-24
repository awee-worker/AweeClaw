/**
 * 技能草稿生成
 *
 * 把已固化的程序性模板转成 SKILL.md 草稿：模板记录的是「一组按序成功的工具调用」，
 * 草稿要把这份记录写成能被读、能被 `apply_skill` 加载的技能说明。
 *
 * 只生成草稿，不自动提交：模板来自自动化统计，其适用边界需要人来判断，
 * 直接上架会把低质量模板带进市场。
 *
 * @module runtime/skillDraftProposer
 */

import type { ProceduralTemplate } from './proceduralSkillLearner'

/** 技能名的最大长度（过长的名字在清单里不便于识别） */
const MAX_NAME_LENGTH = 48

/** 描述的最大长度 */
const MAX_DESCRIPTION_LENGTH = 140

/** 生成一个草稿所需的最少工具步骤数 */
export const MIN_STEPS_FOR_DRAFT = 1

export interface SkillDraftProvenance {
  successCount: number
  totalCount: number
  successRate: number
  /** 触发过该流程的原始请求样本 */
  sampleIntents: string[]
}

export interface SkillDraft {
  name: string
  description: string
  /** 完整的 SKILL.md 文本（含 frontmatter） */
  body: string
  provenance: SkillDraftProvenance
  createdAt: number
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

/**
 * 绝对路径折叠为占位符
 *
 * 草稿会离开本机（导出、提交市场），本机路径与目录结构不应随之流出。
 */
function redactPath(value: string): string {
  return /^([a-zA-Z]:[\\/]|\/)/.test(value) ? '<local-path>' : value
}

/** 由意图关键词生成符合技能命名约定的名字 */
function buildDraftName(template: ProceduralTemplate): string {
  const words = template.intentKeywords
    .map(keyword => keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .slice(0, 4)

  const slug = words.length > 0 ? words.join('-') : `${template.taskType}-workflow`
  return slug.slice(0, MAX_NAME_LENGTH)
}

/** 唯一工具名列表，保持首次出现顺序 */
function collectToolNames(template: ProceduralTemplate): string[] {
  const seen = new Set<string>()
  const names: string[] = []

  for (const step of template.toolSequence) {
    if (seen.has(step.toolName)) continue
    seen.add(step.toolName)
    names.push(step.toolName)
  }

  return names
}

function buildDraftDescription(template: ProceduralTemplate): string {
  const tools = collectToolNames(template)
  const toolPart = tools.length > 0 ? ` using ${tools.join(', ')}` : ''
  const sample = template.exampleIntents[0]

  const description = sample
    ? `${truncate(sample, 90)} — a ${template.taskType} workflow${toolPart}`
    : `A ${template.taskType} workflow${toolPart}`

  return truncate(description, MAX_DESCRIPTION_LENGTH)
}

/** 渲染单个步骤：动态参数保留为占位符，固定参数如实写出（路径先脱敏） */
function renderStep(step: ProceduralTemplate['toolSequence'][number], index: number): string {
  const args = Object.entries(step.params).map(([key, slot]) => {
    if (slot.type === 'dynamic') {
      return `${key}=<${slot.placeholder ?? key}>`
    }
    return `${key}=${redactPath(slot.value ?? '')}`
  })

  const argPart = args.length > 0 ? ` with ${args.join(', ')}` : ''
  return `${index + 1}. \`${step.toolName}\`${argPart}`
}

function buildDraftBody(
  template: ProceduralTemplate,
  name: string,
  description: string
): string {
  const lines: string[] = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    '## When to use',
    '',
    `适用于 ${template.taskType} 类任务，且请求与该流程此前出现的场景相似。`,
    '',
    '## Steps',
    '',
  ]

  template.toolSequence.forEach((step, index) => {
    lines.push(renderStep(step, index))
  })

  lines.push(
    '',
    '## Notes',
    '',
    '- 参数占位符（形如 <file_path>）需要按当前任务替换为实际值',
    '- 步骤顺序来自成功执行的记录，调整顺序前先确认步骤之间没有依赖',
    '- 这是自动化归纳的流程，执行前请确认它仍适用于当前上下文'
  )

  if (template.exampleIntents.length > 0) {
    lines.push('', '## Example requests', '')
    for (const intent of template.exampleIntents) {
      lines.push(`- ${truncate(intent, 120)}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * 是否值得为该模板生成草稿
 *
 * 只有实际产生过工具调用的模板才有流程可写；纯对话记录无法构成技能。
 */
export function isDraftable(template: ProceduralTemplate): boolean {
  return template.toolSequence.length >= MIN_STEPS_FOR_DRAFT
}

/** 把已固化的模板转成技能草稿 */
export function buildSkillDraft(template: ProceduralTemplate): SkillDraft {
  const name = buildDraftName(template)
  const description = buildDraftDescription(template)

  return {
    name,
    description,
    body: buildDraftBody(template, name, description),
    provenance: {
      successCount: template.successCount,
      totalCount: template.successCount + template.failureCount,
      successRate: template.successRate,
      sampleIntents: [...template.exampleIntents],
    },
    createdAt: Date.now(),
  }
}

/** 批量生成草稿，跳过没有流程可写的模板 */
export function buildSkillDrafts(templates: ProceduralTemplate[]): SkillDraft[] {
  return templates.filter(isDraftable).map(buildSkillDraft)
}
