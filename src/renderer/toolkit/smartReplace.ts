/**
 * 文本片段定位与替换工具
 *
 * 通过多级匹配管道逐步放宽匹配条件，提升编辑操作的容错能力。
 * 管道由若干 MatchStage 组成，每个阶段尝试以更宽松的方式定位目标片段。
 */

/* ------------------------------------------------------------------ */
/* 对外类型                                                          */
/* ------------------------------------------------------------------ */

/** 匹配阶段产物：在原文中定位到的片段 */
export interface LocatedSpan {
  /** 片段在原文中的起始偏移 */
  start: number
  /** 片段在原文中的结束偏移（不含） */
  end: number
  /** 实际命中的文本 */
  text: string
  /** 命中阶段名称 */
  stage: string
}

/** 替换操作结果 */
export interface ReplaceOutcome {
  success: boolean
  newContent?: string
  matchedText?: string
  stage?: string
  error?: string
  errorCode?: ReplaceErrorCode
}

/** 错误码 */
export type ReplaceErrorCode =
  | 'IDENTICAL_STRINGS'
  | 'MISSING_OLD_STRING'
  | 'MULTIPLE_MATCHES'
  | 'OLD_STRING_NOT_FOUND'

/** 编辑告警类型 */
export type EditWarningType = 'DUPLICATE_LINE' | 'BRACKET_BALANCE' | 'INDENTATION_MISMATCH'

/** 编辑告警 */
export interface EditWarning {
  type: EditWarningType
  message: string
  line?: number
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                          */
/* ------------------------------------------------------------------ */

/** 将文本按行切分，返回行数组与每行起始偏移 */
function splitLinesWithOffsets(text: string): { lines: string[]; offsets: number[] } {
  const lines: string[] = []
  const offsets: number[] = []
  let pos = 0
  const remaining = text

  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i] === '\n') {
      lines.push(remaining.slice(pos, i))
      offsets.push(pos)
      pos = i + 1
    }
  }

  lines.push(remaining.slice(pos))
  offsets.push(pos)
  return { lines, offsets }
}

/** 计算两个等长行块之间的相似度（基于字符级编辑距离） */
function blockSimilarity(sourceLines: string[], targetLines: string[]): number {
  const len = Math.min(sourceLines.length, targetLines.length)
  if (len === 0) return 1

  let total = 0
  for (let i = 0; i < len; i++) {
    const a = sourceLines[i].trim()
    const b = targetLines[i].trim()
    const maxLen = Math.max(a.length, b.length)
    if (maxLen === 0) {
      total += 1
      continue
    }
    total += 1 - editDistance(a, b) / maxLen
  }
  return total / len
}

/** 字符级编辑距离（带长度剪枝） */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)

  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

/** 计算非空行的最小公共缩进 */
function minIndent(text: string): number {
  let min = Infinity
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    const match = line.match(/^(\s*)/)
    const indent = match ? match[1].length : 0
    if (indent < min) min = indent
  }
  return min === Infinity ? 0 : min
}

/** 按最小缩进剥离每行前导空白 */
function dedent(text: string): string {
  const indent = minIndent(text)
  if (indent === 0) return text
  return text
    .split('\n')
    .map((line) => (line.trim().length === 0 ? line : line.slice(indent)))
    .join('\n')
}

/** 将连续空白折叠为单个空格 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 反转义常见转义序列 */
function unescape(text: string): string {
  return text.replace(/\\(n|t|r|'|"|`|\\|\$)/g, (_, ch: string) => {
    switch (ch) {
      case 'n': return '\n'
      case 't': return '\t'
      case 'r': return '\r'
      case "'": return "'"
      case '"': return '"'
      case '`': return '`'
      case '\\': return '\\'
      case '$': return '$'
      default: return _
    }
  })
}

/* ------------------------------------------------------------------ */
/* 匹配阶段                                                          */
/* ------------------------------------------------------------------ */

/** 匹配阶段接口：在原文中尝试定位目标片段 */
interface MatchStage {
  /** 阶段名称 */
  name: string
  /** 尝试定位，返回所有命中片段 */
  locate(content: string, target: string): LocatedSpan[]
}

/** 从行号区间还原字符偏移 */
function spanFromLines(content: string, lines: string[], offsets: number[], startLine: number, endLine: number): LocatedSpan {
  const start = offsets[startLine]
  const endLineLast = endLine
  const end = endLineLast + 1 < offsets.length ? offsets[endLineLast + 1] - 1 : content.length
  const text = lines.slice(startLine, endLine + 1).join('\n')
  return { start, end, text, stage: '' }
}

/* ---------- 阶段 1：精确子串 ---------- */
const ExactStage: MatchStage = {
  name: 'exact',
  locate(content, target) {
    const spans: LocatedSpan[] = []
    let from = 0
    while (true) {
      const idx = content.indexOf(target, from)
      if (idx === -1) break
      spans.push({ start: idx, end: idx + target.length, text: target, stage: this.name })
      from = idx + target.length
    }
    return spans
  },
}

/* ---------- 阶段 2：逐行修剪比较 ---------- */
const LineTrimStage: MatchStage = {
  name: 'line-trimmed',
  locate(content, target) {
    const { lines, offsets } = splitLinesWithOffsets(content)
    const targetLines = target.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''))
    const spans: LocatedSpan[] = []

    for (let i = 0; i <= lines.length - targetLines.length; i++) {
      let ok = true
      for (let j = 0; j < targetLines.length; j++) {
        if (lines[i + j].trim() !== targetLines[j].trim()) { ok = false; break }
      }
      if (ok) {
        const span = spanFromLines(content, lines, offsets, i, i + targetLines.length - 1)
        span.stage = this.name
        spans.push(span)
      }
    }
    return spans
  },
}

/* ---------- 阶段 3：首尾锚点 + 相似度 ---------- */
const AnchorStage: MatchStage = {
  name: 'block-anchor',
  locate(content, target) {
    const { lines, offsets } = splitLinesWithOffsets(content)
    const targetLines = target.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''))
    if (targetLines.length < 3) return []

    const first = targetLines[0].trim()
    const last = targetLines[targetLines.length - 1].trim()
    const spans: LocatedSpan[] = []

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== first) continue
      for (let j = i + 2; j < lines.length; j++) {
        if (lines[j].trim() !== last) continue
        const blockLines = lines.slice(i, j + 1)
        const sim = blockSimilarity(blockLines.slice(1, -1), targetLines.slice(1, -1))
        if (sim >= 0.3 || (j - i + 1) === targetLines.length) {
          const span = spanFromLines(content, lines, offsets, i, j)
          span.stage = this.name
          spans.push(span)
        }
        break
      }
    }
    return spans
  },
}

/* ---------- 阶段 4：空白归一化 ---------- */
const WhitespaceStage: MatchStage = {
  name: 'whitespace-normalized',
  locate(content, target) {
    const normalizedTarget = collapseWhitespace(target)
    const { lines, offsets } = splitLinesWithOffsets(content)
    const spans: LocatedSpan[] = []
    const targetLines = target.split('\n')

    for (let i = 0; i <= lines.length - targetLines.length; i++) {
      const block = lines.slice(i, i + targetLines.length).join('\n')
      if (collapseWhitespace(block) === normalizedTarget) {
        const span = spanFromLines(content, lines, offsets, i, i + targetLines.length - 1)
        span.stage = this.name
        spans.push(span)
      }
    }
    return spans
  },
}

/* ---------- 阶段 5：缩进剥离 ---------- */
const IndentStage: MatchStage = {
  name: 'indentation-flexible',
  locate(content, target) {
    const dedentedTarget = dedent(target)
    const { lines, offsets } = splitLinesWithOffsets(content)
    const targetLines = target.split('\n')
    const spans: LocatedSpan[] = []

    for (let i = 0; i <= lines.length - targetLines.length; i++) {
      const block = lines.slice(i, i + targetLines.length).join('\n')
      if (dedent(block) === dedentedTarget) {
        const span = spanFromLines(content, lines, offsets, i, i + targetLines.length - 1)
        span.stage = this.name
        spans.push(span)
      }
    }
    return spans
  },
}

/* ---------- 阶段 6：转义归一化 ---------- */
const EscapeStage: MatchStage = {
  name: 'escape-normalized',
  locate(content, target) {
    const unescapedTarget = unescape(target)
    const { lines, offsets } = splitLinesWithOffsets(content)
    const targetLines = unescapedTarget.split('\n')
    const spans: LocatedSpan[] = []

    for (let i = 0; i <= lines.length - targetLines.length; i++) {
      const block = lines.slice(i, i + targetLines.length).join('\n')
      if (unescape(block) === unescapedTarget) {
        const span = spanFromLines(content, lines, offsets, i, i + targetLines.length - 1)
        span.stage = this.name
        spans.push(span)
      }
    }
    return spans
  },
}

/* ---------- 阶段 7：首尾修剪 ---------- */
const TrimBoundaryStage: MatchStage = {
  name: 'trimmed-boundary',
  locate(content, target) {
    const trimmed = target.trim()
    if (trimmed === target) return []
    const spans: LocatedSpan[] = []
    const targetLines = target.split('\n')
    const { lines, offsets } = splitLinesWithOffsets(content)

    for (let i = 0; i <= lines.length - targetLines.length; i++) {
      const block = lines.slice(i, i + targetLines.length).join('\n')
      if (block.trim() === trimmed) {
        const span = spanFromLines(content, lines, offsets, i, i + targetLines.length - 1)
        span.stage = this.name
        spans.push(span)
      }
    }
    return spans
  },
}

/* ---------- 阶段 8：上下文感知（首尾锚点 + 中段容忍） ---------- */
const ContextStage: MatchStage = {
  name: 'context-aware',
  locate(content, target) {
    const targetLines = target.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''))
    if (targetLines.length < 3) return []

    const { lines, offsets } = splitLinesWithOffsets(content)
    const first = targetLines[0].trim()
    const last = targetLines[targetLines.length - 1].trim()
    const spans: LocatedSpan[] = []

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== first) continue
      for (let j = i + 2; j < lines.length; j++) {
        if (lines[j].trim() !== last) continue
        if (j - i + 1 !== targetLines.length) break

        let matched = 0
        let total = 0
        for (let k = 1; k < targetLines.length - 1; k++) {
          const a = lines[i + k].trim()
          const b = targetLines[k].trim()
          if (a.length || b.length) {
            total++
            if (a === b) matched++
          }
        }
        if (total === 0 || matched / total >= 0.5) {
          const span = spanFromLines(content, lines, offsets, i, j)
          span.stage = this.name
          spans.push(span)
        }
        break
      }
    }
    return spans
  },
}

/* ------------------------------------------------------------------ */
/* 匹配管道                                                          */
/* ------------------------------------------------------------------ */

/** 匹配管道：按顺序执行各阶段，返回首个有结果的阶段产物 */
class MatchPipeline {
  private readonly stages: MatchStage[]

  constructor(stages: MatchStage[]) {
    this.stages = stages
  }

  /** 执行管道，返回所有命中（仅保留首个有命中的阶段的结果） */
  run(content: string, target: string): LocatedSpan[] {
    for (const stage of this.stages) {
      const spans = stage.locate(content, target)
      if (spans.length > 0) return spans
    }
    return []
  }
}

/** 默认匹配管道（按从严到宽排序） */
const defaultPipeline = new MatchPipeline([
  ExactStage,
  LineTrimStage,
  AnchorStage,
  WhitespaceStage,
  IndentStage,
  EscapeStage,
  TrimBoundaryStage,
  ContextStage,
])

/* ------------------------------------------------------------------ */
/* 对外 API                                                          */
/* ------------------------------------------------------------------ */

/** 智能替换：在 content 中定位 oldString 并替换为 newString */
export function smartReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): ReplaceOutcome {
  if (oldString === newString) {
    return {
      success: false,
      errorCode: 'IDENTICAL_STRINGS',
      error: 'old_string and new_string must be different',
    }
  }

  if (!oldString) {
    return {
      success: false,
      errorCode: 'MISSING_OLD_STRING',
      error: 'old_string is required',
    }
  }

  const spans = defaultPipeline.run(content, oldString)
  if (spans.length === 0) {
    return {
      success: false,
      errorCode: 'OLD_STRING_NOT_FOUND',
      error: 'old_string not found in file. Use read_file to get exact content including whitespace.',
    }
  }

  if (!replaceAll && spans.length > 1) {
    return {
      success: false,
      errorCode: 'MULTIPLE_MATCHES',
      error: 'Found multiple matches for old_string. Include more surrounding context to make it unique.',
    }
  }

  if (replaceAll) {
    let result = ''
    let cursor = 0
    for (const span of spans) {
      result += content.slice(cursor, span.start) + newString
      cursor = span.end
    }
    result += content.slice(cursor)
    return {
      success: true,
      newContent: result,
      matchedText: spans[0].text,
      stage: spans[0].stage,
    }
  }

  const span = spans[0]
  return {
    success: true,
    newContent: content.slice(0, span.start) + newString + content.slice(span.end),
    matchedText: span.text,
    stage: span.stage,
  }
}

/** 规范化行尾为 LF */
export function normalizeLineEndings(text: string): string {
  return text.replaceAll('\r\n', '\n')
}

/** 裁剪 diff 的公共缩进，便于阅读 */
export function trimDiff(diff: string): string {
  const lines = diff.split('\n')
  const contentLines = lines.filter(
    (l) => (l.startsWith('+') || l.startsWith('-') || l.startsWith(' ')) && !l.startsWith('---') && !l.startsWith('+++'),
  )
  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const body = line.slice(1)
    if (body.trim().length === 0) continue
    const match = body.match(/^(\s*)/)
    if (match) min = Math.min(min, match[1].length)
  }
  if (min === Infinity || min === 0) return diff

  return lines
    .map((line) => {
      if ((line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) && !line.startsWith('---') && !line.startsWith('+++')) {
        return line[0] + line.slice(1 + min)
      }
      return line
    })
    .join('\n')
}

/* ------------------------------------------------------------------ */
/* 编辑告警                                                          */
/* ------------------------------------------------------------------ */

/** 统计括号净平衡 */
function bracketBalance(text: string): Record<string, number> {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const opens = new Set(Object.keys(pairs))
  const closes = new Set(Object.values(pairs))
  const counts: Record<string, number> = {}
  let inString: string | null = null
  let escaped = false

  for (const ch of text) {
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"' || ch === "'" || ch === '`') {
      if (inString === ch) inString = null
      else if (inString === null) inString = ch
      continue
    }
    if (inString) continue
    if (opens.has(ch) || closes.has(ch)) counts[ch] = (counts[ch] || 0) + 1
  }

  const balance: Record<string, number> = {}
  for (const [open, close] of Object.entries(pairs)) {
    balance[`${open}${close}`] = (counts[open] || 0) - (counts[close] || 0)
  }
  return balance
}

/** 检测行替换操作的常见错误 */
export function checkLineReplaceWarnings(
  oldLines: string[],
  newLines: string[],
  resultLines: string[],
  startLine: number,
  endLine: number,
): EditWarning[] {
  const warnings: EditWarning[] = []

  if (newLines.length > 0 && endLine <= resultLines.length) {
    const lastNew = newLines[newLines.length - 1].trim()
    const survivingIdx = startLine - 1 + newLines.length
    if (survivingIdx < resultLines.length) {
      const firstSurviving = resultLines[survivingIdx].trim()
      if (lastNew && lastNew === firstSurviving && lastNew.length > 10) {
        warnings.push({
          type: 'DUPLICATE_LINE',
          message: `Line ${survivingIdx + 1} is identical to the last replaced line. This may indicate an off-by-one error in end_line.`,
          line: survivingIdx + 1,
        })
      }
    }
  }

  const oldBalance = bracketBalance(oldLines.join('\n'))
  const newBalance = bracketBalance(newLines.join('\n'))
  for (const [pair, oldNet] of Object.entries(oldBalance)) {
    const newNet = newBalance[pair] || 0
    const diff = newNet - oldNet
    if (diff !== 0) {
      // 带上方向（more opens / more closes）：只看数字需要读者自己推断符号含义，
      // 而这条警告是要给模型看的，说清方向才能直接指导它修正。
      const direction = diff > 0 ? 'more opens' : 'more closes'
      warnings.push({
        type: 'BRACKET_BALANCE',
        message: `Bracket balance changed: ${pair[0]}...${pair[1]} ${diff > 0 ? '+' : ''}${diff} (${direction}). Replacement may have mismatched brackets.`,
        line: startLine,
      })
    }
  }

  return warnings
}
