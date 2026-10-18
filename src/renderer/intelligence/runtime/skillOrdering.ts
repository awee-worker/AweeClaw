/**
 * 技能展示排序
 *
 * 技能列表与二级选项支持两种展示顺序：
 * - default：按内置声明的默认顺序排列（见 DEFAULT_SKILL_ORDER），未声明的技能排在其后
 * - clicks ：按用户累计点击次数降序排列，次数相同回退到默认顺序
 *
 * 在此之上还有一层与排序方式无关的「常用置顶」：技能与已安装插件共用一个候选池，
 * 按点击次数叠加近期衰减算出分数，分数最高的若干项跨分区提到整个列表最前面。
 * 它的作用范围超出单个分区——常用插件可以排在场景内置技能之前。
 *
 * 排序方式、点击次数与最近点击时间都保存在 localStorage：它们属于本机界面偏好，
 * 与工作空间技能配置（启用状态、场景归属）互相独立，因此不写入技能配置文件。
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
const CLICK_RECENCY_KEY = 'aweeclaw.skill.clickRecency'

/** 技能级点击统计键 */
function skillKey(name: string): string {
  return `skill:${name}`
}

/** 插件级点击统计键：插件没有技能正文，与技能分池计数但仍可一起参与置顶 */
function pluginStatKey(pluginKey: string): string {
  return `plugin:${pluginKey}`
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

/** 最近点击时间缓存：与次数分开存放，避免改动既有统计的存储结构 */
let clickRecencyCache: Record<string, number> | null = null

function readClickRecency(): Record<string, number> {
  if (clickRecencyCache) return clickRecencyCache
  try {
    const raw = localStorage.getItem(CLICK_RECENCY_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    clickRecencyCache = parsed && typeof parsed === 'object'
      ? parsed as Record<string, number>
      : {}
  } catch {
    clickRecencyCache = {}
  }
  return clickRecencyCache
}

function bumpClick(key: string): void {
  const next = { ...readClickStats() }
  next[key] = (next[key] || 0) + 1
  clickStatsCache = next

  // 同时记录最近一次点击时间：置顶分数需要它做近期衰减，次数本身不保留时序信息
  const recency = { ...readClickRecency() }
  recency[key] = Date.now()
  clickRecencyCache = recency

  try {
    localStorage.setItem(CLICK_STATS_KEY, JSON.stringify(next))
    localStorage.setItem(CLICK_RECENCY_KEY, JSON.stringify(recency))
  } catch {
    // 存储失败时保留内存计数，本次会话内排序仍然有效
  }

  notifyStatsChanged()
}

/** 记录一次技能点击 */
export function recordSkillClick(name: string): void {
  bumpClick(skillKey(name))
}

/** 记录一次二级选项点击 */
export function recordSubSkillClick(skillName: string, label: string): void {
  bumpClick(subSkillKey(skillName, label))
}

/** 记录一次插件点击 */
export function recordPluginClick(pluginKey: string): void {
  bumpClick(pluginStatKey(pluginKey))
}

/** 读取技能累计点击次数 */
export function getSkillClickCount(name: string): number {
  return readClickStats()[skillKey(name)] || 0
}

/** 读取二级选项累计点击次数 */
export function getSubSkillClickCount(skillName: string, label: string): number {
  return readClickStats()[subSkillKey(skillName, label)] || 0
}

/** 读取插件累计点击次数 */
export function getPluginClickCount(pluginKey: string): number {
  return readClickStats()[pluginStatKey(pluginKey)] || 0
}

/** 清空点击统计与最近点击时间，回到内置默认顺序 */
export function resetSkillClickStats(): void {
  clickStatsCache = {}
  clickRecencyCache = {}
  try {
    localStorage.setItem(CLICK_STATS_KEY, '{}')
    localStorage.setItem(CLICK_RECENCY_KEY, '{}')
  } catch {
    // 忽略存储失败
  }
  notifyStatsChanged()
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

// ── 统计变更通知 ──────────────────────────────────────

const statsListeners = new Set<() => void>()

/** 统计版本号：每次点击自增，配合 useSyncExternalStore 让列表顺序即时刷新 */
let statsVersion = 0

export function subscribeClickStats(listener: () => void): () => void {
  statsListeners.add(listener)
  return () => { statsListeners.delete(listener) }
}

export function getClickStatsVersion(): number {
  return statsVersion
}

function notifyStatsChanged(): void {
  statsVersion += 1
  statsListeners.forEach(listener => listener())
}

// ── 常用置顶 ──────────────────────────────────────────

/** 置顶区最多容纳的条目数：太多等于没排，太少又容易把常用项挤出去 */
export const PINNED_LIMIT = 6

/** 进入置顶区的最低分数：只点过一次的条目不会因为一次误触就长期占据前排 */
const PINNED_MIN_SCORE = 1

/** 近期权重半衰期（天）：越久没用过，同样的次数得分越低 */
const RECENCY_HALF_LIFE_DAYS = 14

/** 可参与置顶的条目：技能与插件共用同一个候选池，才能跨分区置顶 */
export interface PinnedCandidate {
  kind: 'skill' | 'plugin'
  /** 技能名或插件标识 */
  id: string
}

/**
 * 计算条目的常用分数
 *
 * 以累计次数为基数，按距最近一次点击的天数做半衰期衰减：
 * 天天在用的条目权重接近满额，几个月前点过几十次的则自然沉下去。
 * 早期记录没有时间戳，按纯次数参与比较，不因缺少信息被直接淘汰。
 */
function clickScore(key: string): number {
  const count = readClickStats()[key] || 0
  if (count <= 0) return 0
  const last = readClickRecency()[key]
  if (!last) return count
  const elapsedDays = (Date.now() - last) / 86_400_000
  return count * Math.pow(0.5, elapsedDays / RECENCY_HALF_LIFE_DAYS)
}

/** 映射为统计键，与 recordSkillClick / recordPluginClick 写入的键保持一致 */
function candidateStatKey(candidate: PinnedCandidate): string {
  return candidate.kind === 'skill' ? skillKey(candidate.id) : pluginStatKey(candidate.id)
}

/**
 * 挑出需要置顶的条目
 *
 * 返回按分数降序排列的统计键（skill:名称 / plugin:标识）。
 * 技能与插件在同一池子里比分数，所以常用插件可以排在场景内置技能之前。
 * 分数不足 PINNED_MIN_SCORE 的条目一律不置顶，保持原有分区顺序。
 */
export function pickPinnedEntries(
  candidates: PinnedCandidate[],
  limit: number = PINNED_LIMIT,
): string[] {
  return candidates
    .map(candidate => {
      const key = candidateStatKey(candidate)
      return { key, score: clickScore(key) }
    })
    .filter(item => item.score >= PINNED_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.key)
}

