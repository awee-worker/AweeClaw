/**
 * 文件职责：
 * 1. 统一判断 write_file 这次调用的真实意图，是“新建”、“整文件重写”还是“局部修改”。
 * 2. 为执行层提供意图分析，辅助工具选择与元信息回传。
 * 3. 将“是否允许 write_file 执行”的规则收敛到一个地方，避免散落在提示词和执行器里。
 *
 * 设计原则：
 * - write_file 保持“整文件写入”语义，只允许新建或整文件重写。
 * - edit_file 保持“局部修改”语义，作为编辑已有文件的首选。
 * - 对“已有文件 + 局部修改意图”的 write_file 调用做硬拒绝，并给出明确指引，
 *   促使模型切换到 edit_file，而不是让它整文件覆盖后产生副作用。
 * - 策略层只做判定，不直接执行 IO，便于复用、测试和后续扩展。
 */
import * as Diff from 'diff'

export type WriteIntent = 'create' | 'full-rewrite' | 'partial-update'

/**
 * 一次写入分析的结构化结果。
 * 这些字段既用于判定是否允许 write_file，也可用于调试、日志和元信息回传。
 */
export interface WriteIntentAnalysis {
  intent: WriteIntent
  /** 原文件中被删除或替换的行数（行级 diff 统计） */
  changedOriginalLines: number
  /** 新文件中新增或替换的行数（行级 diff 统计） */
  changedNewLines: number
  /** 原文件总行数 */
  totalOriginalLines: number
  /** 原文件被改动的行数占比；高于阈值即判定为整文件重写 */
  changedRatio: number
}

export interface WriteGuardInput {
  path: string
  originalContent: string
  nextContent: string
  hasRecentRead: boolean
}

export interface WriteGuardDecision {
  allow: boolean
  intent: WriteIntent
  reason?: string
  analysis: WriteIntentAnalysis
}

// 当“原文件被改动的比例”低于该阈值时，倾向判定为局部修改而不是整文件重写。
const PARTIAL_CHANGE_RATIO_THRESHOLD = 0.35

// 超过该字符数的超大文件不做精确行级 diff，退化为字符级前后缀估算，避免判定本身拖慢写入。
const LINE_DIFF_CHAR_LIMIT = 400_000

/**
 * 计算两个字符串从头开始的最长公共前缀。
 * 这个值越大，说明文件前半部分越稳定，改动更可能集中在局部区域。
 */
function getCommonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) {
    i++
  }
  return i
}

/**
 * 计算两个字符串从尾部开始的最长公共后缀。
 * 结合公共前缀后，可以近似估算“中间真正发生变化的区域”。
 */
function getCommonSuffixLength(a: string, b: string, prefixLength: number): number {
  const max = Math.min(a.length, b.length) - prefixLength
  let i = 0
  while (
    i < max &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  ) {
    i++
  }
  return i
}

/**
 * 统一换行符后再比较。
 *
 * 换行符差异属于格式噪声：只改了几行内容的写入，在逐行比较下会表现为整个文件
 * 都变了，从而绕过局部修改判定。判定前先归一化该噪声，让结论只反映真正的内容改动。
 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** 统计文本行数；结尾换行符不计入额外行，与行级 diff 的分段口径保持一致 */
function countLines(text: string): number {
  if (!text) return 0
  const segments = text.split('\n')
  return text.endsWith('\n') ? segments.length - 1 : segments.length
}

/**
 * 行级 diff 统计，只累计真正被删除/新增的行数。
 *
 * 早期实现用「字符级公共前后缀包住的区间」估算改动量，会把多处改动之间的
 * 未改动内容一并算作改动：文件里分散改上几处，改动比例就会被高估到阈值以上，
 * 于是常规的局部修改被判成整文件重写、write_file 被放行——这正是模型习惯性
 * 整写覆盖的成因之一。改为行级 diff 后，统计口径与“改了多少行”直接对应。
 */
function analyzeLineDiff(
  originalContent: string,
  nextContent: string
): { removedLines: number; addedLines: number } {
  let removedLines = 0
  let addedLines = 0

  for (const part of Diff.diffLines(originalContent, nextContent)) {
    const lines = countLines(part.value)
    if (part.removed) removedLines += lines
    else if (part.added) addedLines += lines
  }

  return { removedLines, addedLines }
}

/**
 * 分析一次 write_file 的真实意图。
 *
 * 判定口径是「原文件有多少行被真正改动」：
 * - 局部修改（改几行、分散改几处、末尾追加）→ 被改动的原始行占比很低 → partial-update
 * - 整文件重写（大部分行被替换）→ 占比很高 → full-rewrite
 *
 * 超大文件跳过精确行级 diff，退化为字符级前后缀估算，避免判定本身拖慢写入。
 */
export function analyzeWriteIntent(originalContent: string, nextContent: string): WriteIntentAnalysis {
  const original = normalizeNewlines(originalContent)
  const next = normalizeNewlines(nextContent)

  if (original.length === 0) {
    return {
      intent: 'create',
      changedOriginalLines: 0,
      changedNewLines: countLines(next),
      totalOriginalLines: 0,
      changedRatio: 1,
    }
  }

  const totalOriginalLines = countLines(original)

  // 超大文件退化为字符级估算：行级 diff 在「大文件 + 大面积改动」时开销不可控
  if (original.length > LINE_DIFF_CHAR_LIMIT || next.length > LINE_DIFF_CHAR_LIMIT) {
    const commonPrefixChars = getCommonPrefixLength(original, next)
    const commonSuffixChars = getCommonSuffixLength(original, next, commonPrefixChars)
    const changedOriginalChars = Math.max(0, original.length - commonPrefixChars - commonSuffixChars)
    const changedRatio = changedOriginalChars / original.length

    return {
      intent: changedRatio <= PARTIAL_CHANGE_RATIO_THRESHOLD ? 'partial-update' : 'full-rewrite',
      changedOriginalLines: Math.round(totalOriginalLines * changedRatio),
      changedNewLines: Math.max(0, next.length - commonPrefixChars - commonSuffixChars),
      totalOriginalLines,
      changedRatio,
    }
  }

  const { removedLines, addedLines } = analyzeLineDiff(original, next)
  const changedRatio = totalOriginalLines === 0 ? 1 : removedLines / totalOriginalLines

  return {
    intent: changedRatio <= PARTIAL_CHANGE_RATIO_THRESHOLD ? 'partial-update' : 'full-rewrite',
    changedOriginalLines: removedLines,
    changedNewLines: addedLines,
    totalOriginalLines,
    changedRatio,
  }
}

/**
 * write_file 执行前的统一守卫。
 *
 * 核心规则：
 * 1. 新文件允许直接 write_file。
 * 2. 已有文件 + 疑似局部修改（partial-update）→ 硬拒绝，强制模型改用 edit_file。
 *    局部修改用 write_file 整写会覆盖整文件，属于危险操作；拒绝理由会直接回传给
 *    模型，引导它 read_file 后用 edit_file 完成编辑。
 * 3. 已有文件 + 整文件重写（full-rewrite）→ 允许，执行层会做 .history 备份、
 *    冲突检测与变更审批。
 * 4. 已有文件 + 整写但模型未先 read_file → 放行并附加提示（早期硬拒绝该场景
 *    会导致模型频繁报错、反复重试甚至卡住任务，故保留放行 + 提示）。
 *
 * 设计背景：
 * - 早期版本对“已有文件 + 未先 read_file”和“疑似局部修改”都做硬拒绝，导致模型
 *   在编辑已有文件时频繁报错、反复重试甚至卡住任务。现已收敛为：只有“局部修改
 *   意图”硬拒绝（引导到 edit_file），其余放行，由执行层的备份/审批兜底安全性。
 */
export function guardWriteFile(input: WriteGuardInput): WriteGuardDecision {
  const analysis = analyzeWriteIntent(input.originalContent, input.nextContent)

  if (analysis.intent === 'create') {
    return {
      allow: true,
      intent: analysis.intent,
      analysis,
    }
  }

  // 已有文件 + 局部修改意图：拒绝 write_file，强制引导到 edit_file。
  if (analysis.intent === 'partial-update') {
    return {
      allow: false,
      intent: analysis.intent,
      reason:
        `${Math.round(analysis.changedRatio * 100)}% of the file's original lines would change, which is below the ` +
        `${Math.round(analysis.changedRatio * 100)}% of the file content would change, which is below the ` +
        `${Math.round(PARTIAL_CHANGE_RATIO_THRESHOLD * 100)}% threshold — the system treats it as a partial edit. ` +
        `write_file is ONLY for creating new files or complete full-file replacement.\n\n` +
        `CORRECT PROCEDURE (do NOT retry write_file, for this file or any other partial change):\n` +
        `1. Call read_file(path="${input.path}") to get the current file content\n` +
        `2. Use edit_file with one of these modes:\n` +
        `   - String mode: {path, old_string: "...", new_string: "..."}  (for small text replacements)\n` +
        `   - Line mode: {path, start_line: N, end_line: M, content: "..."}  (for line-range replacements)\n` +
        `   - Batch mode: {path, edits: [{action, start_line, end_line, content}]}  (for multiple changes)\n` +
        `3. Do NOT call write_file again for this file. A rejected write_file always wastes a round trip — ` +
        `for any future local change, go straight to edit_file.`,
      analysis,
    }
  }

  // 已有文件 + 整文件重写，但模型未先 read_file：放行并附加提示。
  if (!input.hasRecentRead) {
    return {
      allow: true,
      intent: analysis.intent,
      reason:
        `NOTE: write_file was used on existing file "${input.path}" without a prior read_file call. ` +
        `The full file was overwritten. For future edits to this file, use edit_file instead:\n` +
        `1. Call read_file(path="${input.path}") first\n` +
        `2. Then use edit_file with old_string/new_string, start_line/end_line/content, or edits array\n` +
        `3. Only use write_file for new files or intentional full-file replacement.`,
      analysis,
    }
  }

  // 已有文件 + 整文件重写：允许整写。执行层自带备份与冲突检测，覆盖是安全的。
  return {
    allow: true,
    intent: analysis.intent,
    analysis,
  }
}
