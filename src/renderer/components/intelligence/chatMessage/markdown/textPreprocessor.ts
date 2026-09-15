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
  const protectedRanges = collectProtectedRanges(text)
  const isProtected = (idx: number) => protectedRanges.some(([s, e]) => idx >= s && idx < e)

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

/** 判断是否为 Markdown 结构行（列表、标题、引用、分隔线、表格） */
function isMarkdownStructureLine(line: string): boolean {
  return (
    /^[\s]*[-*+]\s/.test(line) ||
    /^[\s]*\d+\.\s/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^>\s/.test(line) ||
    /^---/.test(line) ||
    /^\|/.test(line)
  )
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
// 表情标记处理
// ============================================

/** 表情标记正则表达式 */
const EMOTION_PATTERNS = [
  /\[emo:([^\]]+)\]/g,  // [emo:开心]
  /:([a-zA-Z0-9_]+):/g, // :happy:
]

/** 检测文本是否包含表情标记 */
export function containsEmotionTags(text: string): boolean {
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
  return text.replace(/<span class="emotion-placeholder" data-emotion="([^"]*)" data-original="([^"]*)"><\/span>/g, (match, name, original) => {
    return original
  })
}
