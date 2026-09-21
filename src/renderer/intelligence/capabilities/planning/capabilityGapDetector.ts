/**
 * 能力缺口检测器（Capability Gap Detector）
 *
 * 职责：规划阶段判定「当前没有可直接使用的工具或技能完成这件事」，
 * 为后续主动检索技能市场提供触发信号。
 *
 * 设计原则：
 * - 保守优先：只有明确的缺口才产出信号。建议不准会成为噪音，
 *   比漏提示的代价更高，因为噪音会训练用户忽略提示。
 * - 不重复打扰：同一缺口在冷却期内只提示一次。
 * - 只做判定：不触达网络、不安装、不改执行链路。
 *
 * 判定顺序：先看已安装技能是否覆盖，再看现有工具是否覆盖，
 * 两者都不覆盖才产出缺口。
 */

import { TOOL_CONFIGS, type ToolConfig } from '@configuration/toolDefinitions'
import { extractKeywords, MATCH_MIN_KEYWORD_OVERLAP } from '@intelligence/runtime/proceduralSkillLearner'

/** 产出缺口所需的最少关键词数：关键词过少说明意图不明确 */
const MIN_KEYWORDS_FOR_GAP = 2

/**
 * 工具覆盖判定阈值
 *
 * 意图关键词中被某个工具的描述覆盖的比例达到该值即认为工具能承接。
 * 取值偏保守：宁可漏判为「有覆盖」而少提示，也不轻易判定缺口。
 */
const TOOL_COVERAGE_THRESHOLD = 0.5

/** 置信度下限/上限 */
const MIN_CONFIDENCE = 0.5
const MAX_CONFIDENCE = 0.95

/** 低于该置信度不提示 */
const MIN_CONFIDENCE_TO_SUGGEST = 0.6

/** 同一缺口的提示冷却时间 */
const SUGGEST_COOLDOWN_MS = 30 * 60 * 1000

/** 已安装技能的能力描述 */
export interface SkillCapability {
  name: string
  description?: string
  keywords?: string[]
}

/** 缺口判定的输入 */
export interface CapabilityProbe {
  /** 用户意图原文 */
  intent: string
  /** 已安装技能 */
  skills: SkillCapability[]
  /** 当前可用工具名，缺省取全部启用的工具 */
  availableTools?: string[]
}

/** 能力缺口 */
export interface CapabilityGap {
  /** 用户意图描述 */
  intent: string
  /** 提取的能力关键词 */
  keywords: string[]
  /** 现有工具/技能无法覆盖的证据 */
  reason: string
  /** 置信度（0~1） */
  confidence: number
}

/** 全量启用工具名 */
function defaultEnabledTools(): string[] {
  return Object.values(TOOL_CONFIGS as Record<string, ToolConfig>)
    .filter((config) => config?.enabled)
    .map((config) => config.name)
}

/**
 * 技能覆盖度
 *
 * 取双向覆盖率的最大值：
 * - 反向：技能声明的能力词出现在用户意图原文中的比例
 * - 正向：意图关键词被技能文本覆盖的比例
 *
 * 之所以要双向：中文没有词边界，关键词只能按固定长度切分，
 * 同一句话在不同语序下切出的词并不相同。只做正向匹配会漏判
 * 「技能明明覆盖了该意图」的情况（如意图切出「文件批量」，而技能文本里
 * 只有「批量」和「文件」分开出现）。反向匹配用的是技能方声明的词，口径更稳定。
 */
function maxSkillCoverage(
  keywords: string[],
  intentText: string,
  skills: SkillCapability[],
): number {
  const lowerIntent = intentText.toLowerCase()
  let best = 0

  for (const skill of skills) {
    const capabilityWords = [
      ...(skill.keywords ?? []),
      ...extractKeywords(`${skill.name} ${skill.description ?? ''}`),
    ]
    const skillText = `${skill.name} ${skill.description ?? ''}`.toLowerCase()

    const backwardHits = capabilityWords.filter((word) =>
      lowerIntent.includes(word.toLowerCase()),
    ).length
    const backward = capabilityWords.length > 0 ? backwardHits / capabilityWords.length : 0

    const forwardHits = keywords.filter((keyword) => skillText.includes(keyword)).length
    const forward = keywords.length > 0 ? forwardHits / keywords.length : 0

    best = Math.max(best, backward, forward)
  }

  return best
}

/** 工具覆盖度：意图关键词被某个工具描述覆盖的最大比例 */
function maxToolCoverage(
  keywords: string[],
  availableTools?: string[],
): { coverage: number; toolName?: string } {
  const names = availableTools ?? defaultEnabledTools()
  const configs = TOOL_CONFIGS as Record<string, ToolConfig>

  let best = 0
  let bestName: string | undefined

  for (const name of names) {
    const config = configs[name]
    const text = `${name} ${config?.description ?? ''}`.toLowerCase()
    const hit = keywords.filter((keyword) => text.includes(keyword)).length
    const coverage = hit / keywords.length
    if (coverage > best) {
      best = coverage
      bestName = name
    }
  }

  return { coverage: best, toolName: bestName }
}

/**
 * 判定能力缺口
 *
 * 返回 null 表示无需提示：可能是意图不明确、已有技能覆盖、或现有工具足以承接。
 */
export function detectCapabilityGap(probe: CapabilityProbe): CapabilityGap | null {
  const intent = (probe.intent || '').trim()
  if (!intent) return null

  const keywords = extractKeywords(intent)
  if (keywords.length < MIN_KEYWORDS_FOR_GAP) return null

  // 已有技能覆盖
  const skillCoverage = maxSkillCoverage(keywords, intent, probe.skills ?? [])
  if (skillCoverage >= MATCH_MIN_KEYWORD_OVERLAP) return null

  // 现有工具覆盖
  const { coverage, toolName } = maxToolCoverage(keywords, probe.availableTools)
  if (coverage >= TOOL_COVERAGE_THRESHOLD) return null

  const confidence = Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, 1 - coverage))
  if (confidence < MIN_CONFIDENCE_TO_SUGGEST) return null

  const coverageHint = toolName
    ? `最接近的工具是 ${toolName}，仅覆盖 ${(coverage * 100).toFixed(0)}% 的意图关键词`
    : '现有工具中没有与该意图相关的项'

  return {
    intent,
    keywords,
    reason: `${coverageHint}；已安装技能的最高覆盖度为 ${(skillCoverage * 100).toFixed(0)}%，低于 ${(MATCH_MIN_KEYWORD_OVERLAP * 100).toFixed(0)}% 的覆盖线`,
    confidence: Math.round(confidence * 100) / 100,
  }
}

// ============================================
// 去重：同一缺口在冷却期内只提示一次
// ============================================

const suggestedGaps = new Map<string, number>()

/**
 * 缺口签名
 *
 * 基于意图文本的字符多重集，而不是关键词列表：关键词受分词边界影响，
 * 同一件事换个语序就会切出不同的词，导致同一缺口被反复提示。
 * 字符级归一化对语序不敏感，同时保留字符重复次数以区分长度不同的意图。
 */
export function gapSignature(gap: CapabilityGap): string {
  return gap.intent
    .toLowerCase()
    .replace(/[\s，。、！？：；,.!?:;"'（）()【】[\]{}<>《》—\-_/\\|]+/g, '')
    .split('')
    .sort()
    .join('')
}

/** 该缺口当前是否允许提示 */
export function shouldSuggestGap(gap: CapabilityGap, now = Date.now()): boolean {
  const last = suggestedGaps.get(gapSignature(gap))
  if (last === undefined) return true
  return now - last >= SUGGEST_COOLDOWN_MS
}

/** 记录该缺口已提示 */
export function markGapSuggested(gap: CapabilityGap, now = Date.now()): void {
  suggestedGaps.set(gapSignature(gap), now)
}

/** 清空提示记录（供测试与显式重置使用） */
export function resetSuggestedGaps(): void {
  suggestedGaps.clear()
}
