const LEAK_MARKUP_TAGS = [
  'tool_call',
  'tool_calls',
  'function_call',
  'function_calls',
] as const

interface LeakTagPattern {
  name: string
  openPattern: RegExp
  closePattern: RegExp
  /** 完整闭合的标签块 */
  blockPattern: RegExp
  /** 只有开标签、始终没有等到闭合的残留 */
  danglingPattern: RegExp
}

const LEAK_TAG_PATTERNS: LeakTagPattern[] = LEAK_MARKUP_TAGS.map(name => ({
  name,
  // 开/闭标签用 g 标志配合 lastIndex 在原串上定位：本文件的两个定位函数在流式期间
  // 每块都要执行，若每次都对剩余文本 slice 一次，长内容下会退化为平方级。
  openPattern: new RegExp(`<${name}(?:\\s[^>]*)?>`, 'gi'),
  closePattern: new RegExp(`</${name}>`, 'gi'),
  // 预编译而非在使用处构造：本函数在流式期间每个内容块都会执行，循环内
  // new RegExp 既重复付出编译成本，也让每次调用产生一批一次性对象。
  blockPattern: new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, 'gi'),
  danglingPattern: new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*$`, 'gi'),
}))

export interface ToolLeakSanitizationResult {
  visibleText: string
  buffer: string
}

function locateNextOpeningTag(text: string, startIndex: number): number {
  let nextIndex = -1

  for (const spec of LEAK_TAG_PATTERNS) {
    spec.openPattern.lastIndex = startIndex
    const match = spec.openPattern.exec(text)
    if (!match) continue

    if (nextIndex === -1 || match.index < nextIndex) {
      nextIndex = match.index
    }
  }

  return nextIndex
}

function matchOpeningTag(text: string, startIndex: number): { spec: LeakTagPattern; openTagEnd: number } | null {
  for (const spec of LEAK_TAG_PATTERNS) {
    spec.openPattern.lastIndex = startIndex
    const match = spec.openPattern.exec(text)
    if (match && match.index === startIndex) {
      return {
        spec,
        openTagEnd: startIndex + match[0].length,
      }
    }
  }

  return null
}

export function filterToolCallLeakChunk(chunk: string, buffered = ''): ToolLeakSanitizationResult {
  const combined = buffered + chunk

  // 泄漏标记必然以 '<' 起头。流式期间本函数每个内容块都会执行一次，正文里
  // 连 '<' 都没有时不该为四个标签各跑一轮 [\s\S]* 全量匹配。
  if (combined.indexOf('<') === -1) {
    return { visibleText: combined, buffer: '' }
  }

  let visibleText = ''
  let cursor = 0

  while (cursor < combined.length) {
    const nextOpenIndex = locateNextOpeningTag(combined, cursor)
    if (nextOpenIndex === -1) {
      visibleText += combined.slice(cursor)
      return { visibleText, buffer: '' }
    }

    visibleText += combined.slice(cursor, nextOpenIndex)

    const openTag = matchOpeningTag(combined, nextOpenIndex)
    if (!openTag) {
      visibleText += combined.slice(nextOpenIndex, nextOpenIndex + 1)
      cursor = nextOpenIndex + 1
      continue
    }

    openTag.spec.closePattern.lastIndex = openTag.openTagEnd
    const closeMatch = openTag.spec.closePattern.exec(combined)
    if (!closeMatch) {
      return { visibleText, buffer: combined.slice(nextOpenIndex) }
    }

    // closeMatch.index 是相对原串的绝对偏移（已在 lastIndex 之后定位）
    cursor = closeMatch.index + closeMatch[0].length
  }

  return { visibleText, buffer: '' }
}

export function stripToolCallLeaks(text: string): string {
  if (!text) return ''

  // 泄漏标记必然以 '<' 起头。这个函数在流式期间每个内容块都会被调用一次，
  // 正文里连 '<' 都没有时不该为四个标签各跑两轮 [\s\S]* 全量正则。
  if (text.indexOf('<') === -1) return text.trim()

  let sanitized = text

  for (const spec of LEAK_TAG_PATTERNS) {
    // 标签名是裸字符串搜索能快速排除的：只有真正出现该标签时才进入正则替换
    if (!sanitized.includes(`<${spec.name}`)) continue

    sanitized = sanitized
      .replace(spec.blockPattern, '')
      .replace(spec.danglingPattern, '')
  }

  return sanitized.trim()
}
