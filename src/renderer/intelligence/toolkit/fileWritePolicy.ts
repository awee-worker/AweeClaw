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

/** edit_file 批量模式的一条编辑指令 */
export interface LineEditOp {
  action: 'replace' | 'insert' | 'delete'
  start_line?: number
  end_line?: number
  after_line?: number
  content?: string
}

/** diff 分段值里最后一个换行符是行分隔，不是内容本身，落成编辑指令前要剥掉 */
function trimTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

/**
 * 把「已有文件整写与目标内容的差异」翻译成 edit_file 的批量编辑指令。
 *
 * 用途：write_file 被局部修改守卫拦下时，后台据此把这次整写等价地改写成一组
 * 定位编辑，交由 edit_file 执行，从而在不让前端看到失败的前提下完成同一次修改。
 *
 * 由于指令源自从原文件到目标内容的行级 diff，逐条应用后必然还原出目标内容，
 * 因此这不是「猜测用户的意图」，而是同一结果的另一种等价执行方式。
 */
export function buildLineEditsFromDiff(originalContent: string, nextContent: string): LineEditOp[] {
  const original = normalizeNewlines(originalContent)
  const next = normalizeNewlines(nextContent)
  if (original === next) return []

  const parts = Diff.diffLines(original, next)
  const edits: LineEditOp[] = []
  // 光标指向原文件中「下一个尚未处理的 1-based 行号」
  let cursor = 1

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part.added && !part.removed) {
      cursor += countLines(part.value)
      continue
    }

    // 相邻的删除段与新增段属于同一处改动，合并成一个 hunk
    let removedText = ''
    let addedText = ''
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      if (parts[i].removed) removedText += parts[i].value
      else addedText += parts[i].value
      i++
    }
    i--

    const removedCount = countLines(removedText)

    if (removedCount === 0 && addedText) {
      // 纯插入：after_line 取光标前一行，插在 cursor 之前
      edits.push({ action: 'insert', after_line: cursor - 1, content: trimTrailingNewline(addedText) })
    } else if (removedCount > 0 && !addedText) {
      edits.push({ action: 'delete', start_line: cursor, end_line: cursor + removedCount - 1 })
      cursor += removedCount
    } else if (removedCount > 0 && addedText) {
      edits.push({
        action: 'replace',
        start_line: cursor,
        end_line: cursor + removedCount - 1,
        content: trimTrailingNewline(addedText),
      })
      cursor += removedCount
    }
  }

  return edits
}

/**
 * 把一批行级编辑应用到内容上，返回新内容。
 *
 * 语义与 edit_file 的 batch 模式一致：insert 的 after_line 是「插入到第 N 行之后」，
 * 0 表示插到文件最前面。行号一律基于**原始内容**，因此从大到小应用，
 * 避免前面的编辑把后面的行号推偏。
 *
 * 这是纯字符串变换，不涉及 IO。write_file 的局部修改改判路径靠它就地算出最终内容，
 * 只落盘一次，不再借道 edit_file 执行器（那会带来二次备份与重复的写入事件）。
 */
export function applyLineEdits(
  content: string,
  edits: LineEditOp[],
): { ok: true; content: string } | { ok: false; error: string } {
  if (edits.length === 0) return { ok: true, content }

  let lines = content.split('\n')

  const ordered = [...edits].sort((a, b) => {
    const aLine = a.start_line ?? a.after_line ?? 0
    const bLine = b.start_line ?? b.after_line ?? 0
    return bLine - aLine
  })

  for (const edit of ordered) {
    if (edit.action === 'replace') {
      const start = edit.start_line
      const end = edit.end_line
      if (typeof start !== 'number' || typeof end !== 'number' || start < 1 || end > lines.length || start > end) {
        return { ok: false, error: `replace range ${start}-${end} falls outside the file (${lines.length} lines)` }
      }
      const replacement = (edit.content ?? '').split('\n')
      lines = [...lines.slice(0, start - 1), ...replacement, ...lines.slice(end)]
      continue
    }

    if (edit.action === 'delete') {
      const start = edit.start_line
      const end = edit.end_line
      if (typeof start !== 'number' || typeof end !== 'number' || start < 1 || end > lines.length || start > end) {
        return { ok: false, error: `delete range ${start}-${end} falls outside the file (${lines.length} lines)` }
      }
      lines = [...lines.slice(0, start - 1), ...lines.slice(end)]
      continue
    }

    const after = edit.after_line
    if (typeof after !== 'number' || after < 0 || after > lines.length) {
      return { ok: false, error: `insert anchor ${after} falls outside the file (${lines.length} lines)` }
    }
    const inserted = (edit.content ?? '').split('\n')
    lines = [...lines.slice(0, after), ...inserted, ...lines.slice(after)]
  }

  return { ok: true, content: lines.join('\n') }
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
        `Only ${Math.round(analysis.changedRatio * 100)}% of the file's original lines would change, which is below the ` +
        `${Math.round(PARTIAL_CHANGE_RATIO_THRESHOLD * 100)}% threshold — the system treats this as a partial edit. ` +
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
