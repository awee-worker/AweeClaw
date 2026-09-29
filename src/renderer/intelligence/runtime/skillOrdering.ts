/**
 * 技能展示排序
 *
 * 技能列表与二级选项支持两种展示顺序：
 * - default：按内置声明的默认顺序排列（见 DEFAULT_SKILL_ORDER），未声明的技能排在其后
 * - clicks ：按用户累计点击次数降序排列，次数相同回退到默认顺序
 *
 * 排序方式与点击次数保存在 localStorage：它们属于本机界面偏好，
 * 与工作区技能配置（启用状态、场景归属）互相独立，因此不写入技能配置文件。
 */

import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { SkillItem, SubSkillItem } from './skillRepository'

/** 技能排序方式 */
export type SkillSortMode = 'default' | 'clicks'

/**
 * 各场景模式下技能的默认顺序（按技能 name）
 *
 * 未列出的技能（用户自行安装）统一排在已列出的技能之后，按名称升序。
 * 调整顺序时只需改动这里，无需改动技能文件本身。
 */
export const DEFAULT_SKILL_ORDER: Record<SceneMode, string[]> = {
  work: [
    'office-doc',
    'office-sheet',
    'office-ppt',
    'office-meeting',
    'office-email',
    'office-schedule',
    'office-task',
    'office-research',
    'office-data',
  ],
  life: [
    'life-companion',
    'life-health',
    'life-fitness',
    'life-recipe',
    'life-travel',
    'life-plan',
    'life-home',
    'life-shopping',
  ],
  study: [
    'study-plan',
    'study-explain',
    'study-notes',
    'study-quiz',
    'study-paper',
    'study-language',
    'study-memory',
    'study-mindmap',
  ],
  dev: [
    'daily-dev',
    'web-dev',
    'mini-program-dev',
    'app-dev',
    'system-dev',
    'agent-app-dev',
    'skill-dev',
    'dev-docs',
  ],
}

const SORT_MODE_KEY = 'aweeclaw.skill.sortMode'
const CLICK_STATS_KEY = 'aweeclaw.skill.clickStats'

/** 技能级点击统计键 */
function skillKey(name: string): string {
  return `skill:${name}`
}

/** 二级选项点击统计键：同名二级选项在不同技能下分别计数 */
function subSkillKey(skillName: string, label: string): string {
  return `sub:${skillName}:${label}`
}

// ── 排序方式 ──────────────────────────────────────────

const modeListeners = new Set<() => void>()

export function getSkillSortMode(): SkillSortMode {
  try {
    return localStorage.getItem(SORT_MODE_KEY) === 'clicks' ? 'clicks' : 'default'
  } catch {
    return 'default'
  }
}

/** 切换排序方式并通知订阅者；值未变化时不触发通知 */
export function setSkillSortMode(mode: SkillSortMode): void {
  if (getSkillSortMode() === mode) return
  try {
    localStorage.setItem(SORT_MODE_KEY, mode)
  } catch {
    // 存储不可用时仍继续通知，让当前会话内的排序生效
  }
  modeListeners.forEach(listener => listener())
}

export function subscribeSkillSortMode(listener: () => void): () => void {
  modeListeners.add(listener)
  return () => { modeListeners.delete(listener) }
}

// ── 点击统计 ──────────────────────────────────────────

/** 点击统计缓存：读取频繁而写入稀疏，缓存避免每次排序都解析 JSON */
let clickStatsCache: Record<string, number> | null = null

function readClickStats(): Record<string, number> {
  if (clickStatsCache) return clickStatsCache
  try {
    const raw = localStorage.getItem(CLICK_STATS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    clickStatsCache = parsed && typeof parsed === 'object'
      ? parsed as Record<string, number>
      : {}
  } catch {
    clickStatsCache = {}
  }
  return clickStatsCache
}

function bumpClick(key: string): void {
  const next = { ...readClickStats() }
  next[key] = (next[key] || 0) + 1
  clickStatsCache = next
  try {
    localStorage.setItem(CLICK_STATS_KEY, JSON.stringify(next))
  } catch {
    // 存储失败时保留内存计数，本次会话内排序仍然有效
  }
}

/** 记录一次技能点击 */
export function recordSkillClick(name: string): void {
  bumpClick(skillKey(name))
}

/** 记录一次二级选项点击 */
export function recordSubSkillClick(skillName: string, label: string): void {
  bumpClick(subSkillKey(skillName, label))
}

/** 读取技能累计点击次数 */
export function getSkillClickCount(name: string): number {
  return readClickStats()[skillKey(name)] || 0
}

/** 读取二级选项累计点击次数 */
export function getSubSkillClickCount(skillName: string, label: string): number {
  return readClickStats()[subSkillKey(skillName, label)] || 0
}

/** 清空点击统计，回到内置默认顺序 */
export function resetSkillClickStats(): void {
  clickStatsCache = {}
  try {
    localStorage.setItem(CLICK_STATS_KEY, '{}')
  } catch {
    // 忽略存储失败
  }
}

// ── 排序 ──────────────────────────────────────────────

/** 默认顺序下的排序权重：未声明的技能排在已声明技能之后 */
function orderWeight(order: string[], name: string): number {
  const index = order.indexOf(name)
  return index === -1 ? order.length : index
}

/**
 * 技能排序
 *
 * 点击率模式下先按点击次数降序；次数相同（含全为 0）时回退到默认顺序，
 * 保证初始状态下列表顺序与内置声明一致。
 */
export function sortSkills(skills: SkillItem[], mode: SkillSortMode, sceneMode: SceneMode): SkillItem[] {
  const order = DEFAULT_SKILL_ORDER[sceneMode] ?? []
  const stats = readClickStats()

  return [...skills].sort((a, b) => {
    if (mode === 'clicks') {
      const diff = (stats[skillKey(b.name)] || 0) - (stats[skillKey(a.name)] || 0)
      if (diff !== 0) return diff
    }
    const weight = orderWeight(order, a.name) - orderWeight(order, b.name)
    if (weight !== 0) return weight
    return a.name.localeCompare(b.name)
  })
}

/**
 * 二级选项排序
 *
 * 默认模式保持技能文件中声明的顺序；点击率模式按点击次数降序，
 * 次数相同保持声明顺序，避免列表无谓抖动。
 */
export function sortSubSkills(subs: SubSkillItem[], skillName: string, mode: SkillSortMode): SubSkillItem[] {
  if (mode !== 'clicks') return subs

  const stats = readClickStats()
  return subs
    .map((sub, index) => ({ sub, index }))
    .sort((a, b) => {
      const diff = (stats[subSkillKey(skillName, b.sub.label)] || 0)
        - (stats[subSkillKey(skillName, a.sub.label)] || 0)
      return diff !== 0 ? diff : a.index - b.index
    })
    .map(item => item.sub)
}
