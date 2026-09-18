/**
 * Markdown 文本预处理工具
 * - URL 自动转链接（避开代码块和已有链接）
 * - 软换行转硬换行（保留 Markdown 结构）
 * - 表情标记处理（[emo:xxx] 或 :xxx:）
 */

const URL_PATTERN = /(?<!\()(https?:\/\/[^\s<>\[\]"'`\u3000-\u303F\uFF00-\uFFEF]*[^\s<>\[\]"'`\u3000-\u303F\uFF00-\uFFEF.,;:!?)}\]])/g

/** 检测位置是否处于代码块或链接内 */
function collectProtectedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const patterns = [
    /```[\s\S]*?```/g,   // 围栏代码块
    /`[^`]+`/g,          // 行内代码
    /\[([^\]]*)\]\(([^)]+)\)/g, // Markdown 链接
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      ranges.push([match.index, match.index + match[0].length])
    }
  }
  return ranges
}

/** 将裸 URL 转换为 Markdown 链接，避开代码块和已有链接 */
export function preprocessUrls(text: string): string {
  // 绝大多数流式片段并不含 URL。一次裸字符串搜索比「三轮保护区间正则 + 一轮
  // URL 正则」便宜一到两个数量级，先把这些片段挡在门外。
  if (text.indexOf('http') === -1) return text

  const protectedRanges = collectProtectedRanges(text)
  // 区间来自三个独立正则，合并后并不有序；排序后二分，避免每个 URL 都线性
  // 扫过全部区间（长回复里行内代码可能上百段）。
  protectedRanges.sort((a, b) => a[0] - b[0])
  const isProtected = (idx: number): boolean => {
    let low = 0
    let high = protectedRanges.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const range = protectedRanges[mid]
      if (!range) break
      if (idx < range[0]) high = mid - 1
      else if (idx >= range[1]) low = mid + 1
      else return true
    }
    return false
  }

  URL_PATTERN.lastIndex = 0
  const results: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = URL_PATTERN.exec(text)) !== null) {
    const url = match[0]
    const matchStart = match.index
    const matchEnd = matchStart + url.length

    if (isProtected(matchStart)) continue
    if (matchStart > 0 && text[matchStart - 1] === '(') continue

    results.push(text.slice(lastIndex, matchStart))
    results.push(`[${url}](${url})`)
    lastIndex = matchEnd
  }

  if (lastIndex < text.length) {
    results.push(text.slice(lastIndex))
  }

  return results.length > 0 ? results.join('') : text
}

/**
 * Markdown 结构行（列表、标题、引用、分隔线、表格）
 *
 * 合并为一个交替正则而不是六次 `test`：本函数对每一行都要调用，长回复下
 * 行数上千，逐个正则试探会把成本乘以行数。
 */
const MARKDOWN_STRUCTURE_LINE = /^(?:[\s]*[-*+]\s|[\s]*\d+\.\s|#{1,6}\s|>\s|---|\|)/

function isMarkdownStructureLine(line: string): boolean {
  return MARKDOWN_STRUCTURE_LINE.test(line)
}

/** 将普通文本行的软换行转换为硬换行，保留代码块和 Markdown 结构 */
export function convertLineBreaks(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let inCodeBlock = false

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      result.push(line)
      continue
    }

    if (inCodeBlock) {
      result.push(line)
      continue
    }

    if (line.trim() === '' || isMarkdownStructureLine(line)) {
      result.push(line)
      continue
    }

    result.push(line + '  ')
  }

  return result.join('\n')
}

// ============================================
// 行内处理入口
//
// 清洗链路在流式期间每个内容分片都要跑一次，全文重跑会让整段回复的代价
// 随字符数平方级增长。下面三个函数把同一条规则落到单行上：URL、行内代码、
// 链接、表情标记都不跨行，换行标记本身就逐行追加，因此逐行处理与全文处理
// 结果一致。围栏代码块是唯一需要跨行携带的状态，由调用方持有。
// ============================================

/** 行内代码（不跨行） */
const INLINE_CODE_PATTERN = /`[^`\n]+`/g

/** 行内链接（不跨行） */
const INLINE_LINK_PATTERN = /\[[^\]\n]*\]\([^)\n]+\)/g

/**
 * 单行裸 URL 转 Markdown 链接。
 *
 * 与 preprocessUrls 的差别只在保护区间的作用域：这里只为当前行收集区间，
 * 因此不必为每个 URL 扫过全文中所有区间，长回复里的成本从
 * 「全文区间数 × URL 数」降到「本行区间数 × 本行 URL 数」。
 */
export function linkifyBareUrlsInLine(line: string): string {
  if (line.indexOf('http') === -1) return line

  const ranges: [number, number][] = []
  for (const pattern of [INLINE_CODE_PATTERN, INLINE_LINK_PATTERN]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      ranges.push([match.index, match.index + match[0].length])
    }
  }
  ranges.sort((a, b) => a[0] - b[0])

  const isProtected = (idx: number): boolean => {
    let low = 0
    let high = ranges.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const range = ranges[mid]
      if (!range) break
      if (idx < range[0]) high = mid - 1
      else if (idx >= range[1]) low = mid + 1
      else return true
    }
    return false
  }

  URL_PATTERN.lastIndex = 0
  const results: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = URL_PATTERN.exec(line)) !== null) {
    const url = match[0]
    const matchStart = match.index
    const matchEnd = matchStart + url.length

    if (isProtected(matchStart)) continue
    if (matchStart > 0 && line[matchStart - 1] === '(') continue

    results.push(line.slice(lastIndex, matchStart))
    results.push(`[${url}](${url})`)
    lastIndex = matchEnd
  }

  if (lastIndex < line.length) {
    results.push(line.slice(lastIndex))
  }

  return results.length > 0 ? results.join('') : line
}

/**
 * 单行软换行转硬换行。
 *
 * 围栏代码块内部的判定不在这里：那需要跨行状态，由增量清洗器在调用前挡掉。
 */
export function appendHardBreak(line: string): string {
  if (line.trim() === '' || isMarkdownStructureLine(line)) return line
  return line + '  '
}

/** 单行表情标记替换为 HTML 占位符（规则与全文版共用同一组正则） */
export function replaceEmotionTagsInLine(line: string): string {
  if (!containsEmotionTags(line)) return line
  return replaceEmotionTagsWithHtml(line)
}

// ============================================
// 表情标记处理
// ============================================

/** 表情标记正则表达式 */
const EMOTION_PATTERNS = [
  /\[emo:([^\]]+)\]/g,  // [emo:开心]
  /:([a-zA-Z0-9_]+):/g, // :happy:
]

/** 检测文本是否包含表情标记 */
export function containsEmotionTags(text: string): boolean {
  // 两种标记分别必须含有 '[' 与 ':'。流式期间本函数每个内容块都会被调用一次，
  // 先用裸字符串搜索把普通文本挡掉，比直接跑两轮全局正则便宜得多。
  if (text.indexOf('[') === -1 && text.indexOf(':') === -1) return false

  return EMOTION_PATTERNS.some(pattern => {
    pattern.lastIndex = 0
    return pattern.test(text)
  })
}

/** 提取文本中的所有表情标记 */
export function extractEmotionTags(text: string): string[] {
  const tags: string[] = []

  for (const pattern of EMOTION_PATTERNS) {
    pattern.lastIndex = 0
    let match

    while ((match = pattern.exec(text)) !== null) {
      tags.push(match[0])
    }
  }

  return [...new Set(tags)] // 去重
}

/** 将表情标记替换为 HTML 占位符 */
export function replaceEmotionTagsWithHtml(text: string): string {
  if (!containsEmotionTags(text)) {
    return text
  }

  let result = text

  // 替换 [emo:xxx] 格式
  result = result.replace(/\[emo:([^\]]+)\]/g, (match, name) => {
    return `<span class="emotion-placeholder" data-emotion="${name}" data-original="${match}">${match}</span>`
  })

  // 替换 :xxx: 格式（避免替换 Markdown 链接中的冒号）
  result = result.replace(/(?<!\():(?![\/])([a-zA-Z0-9_]+):(?!\))/g, (match, name) => {
    return `<span class="emotion-placeholder" data-emotion="${name}" data-original="${match}">${match}</span>`
  })

  return result
}

/** 从 HTML 占位符恢复表情标记 */
export function restoreEmotionTagsFromHtml(text: string): string {
  return text.replace(/<span class="emotion-placeholder" data-emotion="([^"]*)" data-original="([^"]*)"><\/span>/g, (_match, _name, original) => {
    return original
  })
}
