/**
 * 技能清单预算
 *
 * 技能清单（名称 + 描述）常驻系统提示词，本身不携带完整指令——数量增长后，
 * 这份清单会先于技能内容挤占高信号 token 空间。这里给它一个预算：超出时按优先级
 * 保留一部分，其余折叠成一条计数提示。
 *
 * 折叠不等于丢弃：被折叠的技能仍可通过检索工具找到，也能按名加载，
 * 只是不再逐条列在提示词里。
 */

/** 单条清单项的固定开销（列表符号与冒号） */
const ENTRY_PREFIX_CHARS = 4

/** 字符到 token 的换算口径，与项目其它估算保持一致 */
const CHARS_PER_TOKEN = 3

export interface SkillManifestEntry {
  name: string
  description: string
}

export interface SkillManifestBudgetResult {
  /** 实际注入的技能条目 */
  included: SkillManifestEntry[]
  /** 因预算被折叠的技能数 */
  foldedCount: number
  /** 折叠提示；无需折叠时为 null */
  foldedNotice: string | null
}

/** 单条清单项的 token 估算 */
export function estimateSkillEntryTokens(entry: SkillManifestEntry): number {
  return Math.ceil(
    (entry.name.length + entry.description.length + ENTRY_PREFIX_CHARS) / CHARS_PER_TOKEN
  )
}

/**
 * 按预算裁剪技能清单
 *
 * 超出预算时优先保留 `priorityNames` 中的条目（例如与当前场景绑定、或被能力缺口
 * 检测命中的技能），其余按原有顺序保留到预算用完为止。
 */
export function buildSkillManifest(
  skills: SkillManifestEntry[],
  budgetTokens: number,
  priorityNames: string[] = []
): SkillManifestBudgetResult {
  if (skills.length === 0) {
    return { included: [], foldedCount: 0, foldedNotice: null }
  }

  const priority = new Set(priorityNames)
  const ordered = [
    ...skills.filter(entry => priority.has(entry.name)),
    ...skills.filter(entry => !priority.has(entry.name)),
  ]

  const included: SkillManifestEntry[] = []
  let used = 0

  for (const entry of ordered) {
    const cost = estimateSkillEntryTokens(entry)
    // 首条无条件放行：预算配置过小时，清单至少要留下一个候选，
    // 否则它会退化成「只剩折叠提示」，模型完全没有可加载的目标。
    if (included.length > 0 && used + cost > budgetTokens) break

    included.push(entry)
    used += cost
  }

  const foldedCount = skills.length - included.length
  if (foldedCount === 0) {
    return { included, foldedCount: 0, foldedNotice: null }
  }

  return {
    included,
    foldedCount,
    foldedNotice:
      `\n\n${foldedCount} more skill(s) are not listed here because the skill manifest exceeded its token budget. ` +
      'Use the skill search tool to find them, or load one by name with `apply_skill`.',
  }
}
