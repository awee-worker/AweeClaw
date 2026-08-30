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
export type WriteIntent = 'create' | 'full-rewrite' | 'partial-update'

/**
 * 一次写入分析的结构化结果。
 * 这些字段既用于判定是否允许 write_file，也可用于调试、日志和元信息回传。
 */
export interface WriteIntentAnalysis {
  intent: WriteIntent
  commonPrefixChars: number
  commonSuffixChars: number
  changedOriginalChars: number
  changedNewChars: number
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
 * 分析一次 write_file 的真实意图。
 *
 * 这里不依赖 AST，也不做复杂 diff，而是用“公共前后缀 + 变化区间大小”做快速启发式判断。
 * 这么做的目标不是得到最完美的文本 diff，而是给工具选择提供稳定、低成本的决策依据。
 */
export function analyzeWriteIntent(originalContent: string, nextContent: string): WriteIntentAnalysis {
  if (originalContent.length === 0) {
    return {
      intent: 'create',
      commonPrefixChars: 0,
      commonSuffixChars: 0,
      changedOriginalChars: 0,
      changedNewChars: nextContent.length,
      changedRatio: 1,
    }
  }

  const commonPrefixChars = getCommonPrefixLength(originalContent, nextContent)
  const commonSuffixChars = getCommonSuffixLength(originalContent, nextContent, commonPrefixChars)
  const changedOriginalChars = Math.max(0, originalContent.length - commonPrefixChars - commonSuffixChars)
  const changedNewChars = Math.max(0, nextContent.length - commonPrefixChars - commonSuffixChars)
  const changedRatio = originalContent.length === 0 ? 1 : changedOriginalChars / originalContent.length

  const intent: WriteIntent =
    changedRatio <= PARTIAL_CHANGE_RATIO_THRESHOLD
      ? 'partial-update'
      : 'full-rewrite'

  return {
    intent,
    commonPrefixChars,
    commonSuffixChars,
    changedOriginalChars,
    changedNewChars,
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
        `REJECTED: write_file cannot be used to partially modify existing file "${input.path}". ` +
        `${Math.round(analysis.changedRatio * 100)}% of the file content would change, indicating a partial edit. ` +
        `write_file is ONLY for creating new files or complete full-file replacement.\n\n` +
        `CORRECT PROCEDURE:\n` +
        `1. Call read_file(path="${input.path}") to get the current file content\n` +
        `2. Use edit_file with one of these modes:\n` +
        `   - String mode: {path, old_string: "...", new_string: "..."}  (for small text replacements)\n` +
        `   - Line mode: {path, start_line: N, end_line: M, content: "..."}  (for line-range replacements)\n` +
        `   - Batch mode: {path, edits: [{action, start_line, end_line, content}]}  (for multiple changes)\n` +
        `3. Do NOT call write_file again for this file`,
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
