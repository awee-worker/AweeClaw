/**
 * 技能/插件二级项选择结果的合并与派生
 *
 * 二级项之间是并列关系：一个技能常同时提供「生成方式」「模板风格」「输出比例」，
 * 用户把它们逐个选完才算表达完整意图。因此选择结果必须按二级项分开存在，
 * 同一个二级项再选一次只覆盖它自己，其余项原样保留。
 *
 * 展示串（subSelection）与注入说明（stateNote）都是派生值，由这里统一生成，
 * 避免各处各拼一遍导致顺序或分隔符不一致。
 */

import type { SubSelectionEntry } from '@intelligence/types/contextModel'

/** 展示串里各条选择之间的分隔符 */
const LABEL_SEPARATOR = ' · '

/** 注入说明里各条约束之间的分隔符 */
const NOTE_SEPARATOR = '\n\n'

/**
 * 合并二级项选择结果
 *
 * - 同一 key（同一个二级项）后选覆盖先选
 * - 新 key 追加到末尾，保证多个并列项同时存在
 * - 入参里出现没有 key 的条目时视为整体替换：这类调用来自只报一条展示串的旧路径，
 *   无法判断它对应哪个二级项，继续保留旧条目只会留下互相矛盾的选项。
 */
export function mergeSubSelections(
  existing: SubSelectionEntry[] | undefined,
  incoming: SubSelectionEntry[],
): SubSelectionEntry[] {
  const valid = incoming.filter(entry => entry && entry.label)
  if (valid.length === 0) return existing ?? []
  if (valid.some(entry => !entry.key)) return valid

  const merged = new Map<string, SubSelectionEntry>()
  for (const entry of existing ?? []) merged.set(entry.key, entry)
  for (const entry of valid) merged.set(entry.key, entry)
  return [...merged.values()]
}

/** 由结构化条目派生展示串与注入说明 */
export function deriveSubSelection(entries: SubSelectionEntry[] | undefined): {
  subSelection?: string
  stateNote?: string
} {
  if (!entries || entries.length === 0) {
    return { subSelection: undefined, stateNote: undefined }
  }
  const labels = entries.map(entry => entry.label).filter(Boolean)
  const notes = entries.map(entry => entry.note).filter((note): note is string => Boolean(note))
  return {
    subSelection: labels.length > 0 ? labels.join(LABEL_SEPARATOR) : undefined,
    stateNote: notes.length > 0 ? notes.join(NOTE_SEPARATOR) : undefined,
  }
}

/** 没有分隔符可依据时的兜底标识：同类说明重复写回只覆盖自己，不误伤别的二级项 */
const FALLBACK_NOTE_KEY = 'plugin-note'

/**
 * 从展示标签里推导二级项标识
 *
 * 插件侧写回的是「结果说明 + 短标签」，本身没有二级项标识，标签形如
 * 「风格 · 商务浅色」或「生成方式：原生可编辑」。不推导 key，这条选择就会被
 * mergeSubSelections 当成旧格式的整体替换，把用户先前选好的其它二级项一并冲掉——
 * 表现就是「先选生成方式、再选风格，生成方式消失了」，而反过来选却两项都在。
 *
 * 分隔符之前的那一段就是二级项名，可以直接当 key 用；没有分隔符时退回固定 key，
 * 让同类说明覆盖自己而不是越堆越多。
 */
export function deriveSelectionKey(
  label: string | undefined,
  note: string | undefined,
): string {
  const raw = String(label || note || '').trim()
  if (!raw) return FALLBACK_NOTE_KEY
  const matched = raw.match(/^([^：:·|・]{1,12})\s*[：:·|・]/)
  const prefix = matched?.[1]?.trim()
  return prefix || FALLBACK_NOTE_KEY
}

/**
 * 把「只带了一条展示串」的旧数据补成结构化条目
 *
 * 历史会话与插件侧只写 subSelection 的调用没有 key，此时只能当作一条整体选择，
 * 后续再选其他二级项会走整体替换，与旧行为一致。
 */
export function normalizeSubSelections(item: {
  subSelections?: SubSelectionEntry[]
  subSelection?: string
  stateNote?: string
}): SubSelectionEntry[] {
  if (item.subSelections && item.subSelections.length > 0) return item.subSelections
  if (item.subSelection) {
    // 只有展示串、没有说明正文时，说明正文可能仍挂在 stateNote 上，一并接管。
    // key 保持为空：这条来自「只报一条展示串」的旧路径，语义就是整体替换，
    // 凭空补一个 key 会把它变成合并，旧调用方的清理意图随之失效。
    return [{ key: '', label: item.subSelection, note: item.stateNote }]
  }
  // 只有说明正文（插件侧旧调用只写了 stateNote）：用它自身充当展示标签
  if (item.stateNote) return [{ key: '', label: item.stateNote, note: item.stateNote }]
  return []
}
