/**
 * 技能草稿的产物封装
 *
 * 技能草稿与快捷流草稿来自同一份执行轨迹，展示形态也应该一致：两者都走产物通道，
 * 都是受固定标题约束的文本产物，字段名相同（title / description / steps / createdAt），
 * 移动端摘下标题就能按同一套结构渲染，不必为两份草稿各写一套解析。
 *
 * 相较快捷流，技能草稿多带三项：SKILL.md 全文、frontmatter 里的技能名、以及归纳依据
 * （成功次数与样本请求）。用户要判断「这份草稿值不值得上架」，靠的正是这三项。
 *
 * @module runtime/skillDraftArtifact
 */

import { stepsFromSkillBody, type FlowDraftStepPayload } from './flowDraftArtifact'
import type { SkillDraft } from './skillDraftProposer'

/** 技能草稿产物的固定标题：两端必须一致 */
export const SKILL_DRAFT_ARTIFACT_TITLE = '__skill_draft__'

/** 归纳依据：草稿不是凭空生成的，用户需要知道它来自多少次成功 */
export interface SkillDraftProvenancePayload {
  successCount: number
  totalCount: number
  successRate: number
  sampleIntents: string[]
}

/** 技能草稿（与快捷流草稿同构的头部字段，外加 SKILL.md 自身信息） */
export interface SkillDraftPayload {
  title: string
  description: string
  steps: FlowDraftStepPayload[]
  createdAt: number
  /** frontmatter 里的技能名，导出到技能目录时直接用 */
  skillName: string
  /** 完整 SKILL.md 文本，供用户复制或导出 */
  body: string
  provenance: SkillDraftProvenancePayload
}

/**
 * 生成技能草稿产物
 *
 * 步骤从 SKILL.md 正文里读回：技能草稿本就是把执行轨迹写成了文档，
 * 再解析一次文档是唯一不做二次来源的做法，避免两处逻辑各写一套而漂移。
 */
export function buildSkillDraftPayload(input: {
  title: string
  skillDraft: SkillDraft
}): SkillDraftPayload {
  const { skillDraft } = input
  const steps = stepsFromSkillBody(skillDraft.body)

  return {
    title: input.title,
    description: skillDraft.description,
    // 解析不出步骤时给一条覆盖整件事的说明，而不是交一个空草稿
    steps: steps.length > 0 ? steps : [{ text: skillDraft.description || input.title }],
    createdAt: skillDraft.createdAt,
    skillName: skillDraft.name,
    body: skillDraft.body,
    provenance: {
      successCount: skillDraft.provenance.successCount,
      totalCount: skillDraft.provenance.totalCount,
      successRate: skillDraft.provenance.successRate,
      sampleIntents: [...skillDraft.provenance.sampleIntents],
    },
  }
}

/** 把草稿封成产物；序列化失败返回 null，不阻断任务完成上报 */
export function toSkillDraftArtifact(payload: SkillDraftPayload): {
  type: 'text'
  title: string
  content: string
} | null {
  try {
    return {
      type: 'text',
      title: SKILL_DRAFT_ARTIFACT_TITLE,
      content: JSON.stringify(payload),
    }
  } catch {
    return null
  }
}
