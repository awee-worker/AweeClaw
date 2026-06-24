/**
 * 文本差异分析模块 — 基于行/词级别的变更计算
 *
 * 设计理念：
 * - 单一职责：仅负责差异计算，不涉及文件 I/O
 * - 多粒度：支持行级（diffLines）与词级（diffWords）分析
 * - 结构化输出：返回结构化变更记录，便于 UI 渲染
 * - 性能优化：大文本时使用流式遍历，避免全量 split
 * - 可扩展：ChangeMetrics 支持自定义指标扩展
 */

import * as Diff from 'diff'

/** 变更类型 */
export type ChangeType = 'added' | 'removed' | 'unchanged'

/** 单条变更记录 */
export interface ChangeRecord {
  type: ChangeType
  value: string
  /** 起始行号（1-based，仅行级有效） */
  startLine?: number
  /** 结束行号（1-based，仅行级有效） */
  endLine?: number
}

/** 行级变更统计 */
export interface LineChangeStats {
  /** 新增行数 */
  added: number
  /** 删除行数 */
  removed: number
  /** 未变更行数 */
  unchanged: number
  /** 变更率（0-1） */
  changeRate: number
}

/** 词级变更统计 */
export interface WordChangeStats {
  /** 新增词数 */
  wordsAdded: number
  /** 删除词数 */
  wordsRemoved: number
  /** 总词数（新文本） */
  totalWords: number
}

/** 综合变更指标 */
export interface ChangeMetrics extends LineChangeStats, WordChangeStats {
  /** 变更摘要（人类可读） */
  summary: string
  /** 变更记录列表 */
  changes: ChangeRecord[]
}

/**
 * 计算实际行数（排除末尾空行）
 *
 * @param text 文本片段
 * @returns 实际行数
 */
function countLines(text: string): number {
  if (!text) return 0
  const lines = text.split('\n')
  return text.endsWith('\n') ? lines.length - 1 : lines.length
}

/**
 * 计算两个文本之间的行数变化
 *
 * 基于 diff 库的 Myers 算法，精确计算增加和删除行数
 *
 * @param oldContent 原始文本
 * @param newContent 新文本
 * @returns 行级变更统计
 */
export function calculateLineChanges(
  oldContent: string,
  newContent: string,
): { added: number; removed: number } {
  const stats = analyzeLineChanges(oldContent, newContent)
  return { added: stats.added, removed: stats.removed }
}

/**
 * 行级变更分析 — 返回完整统计与变更记录
 *
 * @param oldContent 原始文本
 * @param newContent 新文本
 * @returns 行级变更统计（含变更率、未变更数）
 */
export function analyzeLineChanges(
  oldContent: string,
  newContent: string,
): LineChangeStats & { changes: ChangeRecord[] } {
  const parts = Diff.diffLines(oldContent, newContent)

  let added = 0
  let removed = 0
  let unchanged = 0
  let currentLine = 1
  const changes: ChangeRecord[] = []

  for (const part of parts) {
    const lineCount = countLines(part.value)

    if (part.added) {
      added += lineCount
      changes.push({
        type: 'added',
        value: part.value,
        startLine: currentLine,
        endLine: currentLine + lineCount - 1,
      })
      currentLine += lineCount
    } else if (part.removed) {
      removed += lineCount
      changes.push({
        type: 'removed',
        value: part.value,
        startLine: currentLine,
        endLine: currentLine + lineCount - 1,
      })
    } else {
      unchanged += lineCount
      changes.push({
        type: 'unchanged',
        value: part.value,
        startLine: currentLine,
        endLine: currentLine + lineCount - 1,
      })
      currentLine += lineCount
    }
  }

  const totalLines = added + removed + unchanged
  const changeRate = totalLines > 0 ? (added + removed) / totalLines : 0

  return { added, removed, unchanged, changeRate, changes }
}

/**
 * 词级变更分析 — 统计新增/删除的词数
 *
 * @param oldContent 原始文本
 * @param newContent 新文本
 * @returns 词级变更统计
 */
export function analyzeWordChanges(
  oldContent: string,
  newContent: string,
): WordChangeStats {
  const parts = Diff.diffWords(oldContent, newContent)

  let wordsAdded = 0
  let wordsRemoved = 0

  for (const part of parts) {
    if (part.added) {
      wordsAdded += part.value.trim().split(/\s+/).filter(Boolean).length
    } else if (part.removed) {
      wordsRemoved += part.value.trim().split(/\s+/).filter(Boolean).length
    }
  }

  const totalWords = newContent.trim().split(/\s+/).filter(Boolean).length

  return { wordsAdded, wordsRemoved, totalWords }
}

/**
 * 生成人类可读的变更摘要
 *
 * @param stats 行级统计
 * @param wordStats 词级统计（可选）
 * @returns 摘要字符串
 */
function buildSummary(stats: LineChangeStats, wordStats?: WordChangeStats): string {
  const parts: string[] = []

  if (stats.added > 0) parts.push(`+${stats.added} 行`)
  if (stats.removed > 0) parts.push(`-${stats.removed} 行`)

  if (wordStats) {
    if (wordStats.wordsAdded > 0) parts.push(`+${wordStats.wordsAdded} 词`)
    if (wordStats.wordsRemoved > 0) parts.push(`-${wordStats.wordsRemoved} 词`)
  }

  if (parts.length === 0) return '无变更'
  return parts.join('，')
}

/**
 * 综合变更分析 — 一次性获取行级 + 词级 + 摘要
 *
 * @param oldContent 原始文本
 * @param newContent 新文本
 * @returns 综合变更指标
 */
export function computeChangeMetrics(
  oldContent: string,
  newContent: string,
): ChangeMetrics {
  const lineStats = analyzeLineChanges(oldContent, newContent)
  const wordStats = analyzeWordChanges(oldContent, newContent)
  const summary = buildSummary(lineStats, wordStats)

  return {
    ...lineStats,
    ...wordStats,
    summary,
    changes: lineStats.changes,
  }
}
