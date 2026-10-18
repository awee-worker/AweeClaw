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

/**
 * 孤立的闭合标签
 *
 * 上面的 blockPattern 只处理「成对出现」与「只有开标签」两种形态；还有第三种：
 * 开标签在更早的分片里已被剥掉、或模型只吐出了闭合标签，于是正文里单独剩下
 * 一个 `</tool_call>`。这类残片不是正文，必须一并清掉。
 */
const STANDALONE_CLOSE_TAG_PATTERN = /<\/(?:tool_call|tool_calls|function_call|function_calls)>/gi

/**
 * 模型结束符残片
 *
 * 部分推理模型会把训练时的结束标记写进正文（`</s>`、`<|im_end|>` 等）。
 * 它们既不是工具调用也不是 Markdown，渲染出来就是正文末尾的半截标签。
 */
const MODEL_SENTINEL_PATTERNS: RegExp[] = [
  /<\/s>/g,
  /<\|im_end\|>/g,
  /<\|endoftext\|>/g,
]

/**
 * 末尾未闭合的标签残片：流被截断时留下的 `</too`、`<|im_en`、`</`、`<` 等
 *
 * 只匹配「从 `<` 起一路到结尾」的片段，且残片内部不含空白 —— 标签名一旦被
 * 空白打断就是属性段（`<tool_call id=`），长度不可控；而正文里的 `<` 后面
 * 通常跟着空格（`比较 a < b`），也不该被当成残片。
 */
const TAIL_TAG_FRAGMENT_PATTERN = /^(?:<\/?[A-Za-z_|][^<>\s]{0,20}|<\/?)$/

/**
 * 清掉孤立闭合标签与模型结束符
 *
 * 两类残片必然以 `</` 或 `<|` 起头，先用裸字符串搜索挡掉绝大多数不含残片的
 * 内容块 —— 本函数在流式期间每块都会执行一次。
 */
function stripStandaloneLeaks(text: string): string {
  if (text.indexOf('</') === -1 && text.indexOf('<|') === -1) return text

  let result = text
  STANDALONE_CLOSE_TAG_PATTERN.lastIndex = 0
  result = result.replace(STANDALONE_CLOSE_TAG_PATTERN, '')

  for (const pattern of MODEL_SENTINEL_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, '')
  }

  return result
}

/**
 * 清掉整段文本末尾未闭合的标签残片
 *
 * 只对整段结尾生效：行中间的 `<` 是正文（如 `比较 a < b`），完整行的末尾也
 * 可能合法地以 `<` 收尾，这些都不能动。流式期间末行每轮重算，被清掉的字符
 * 会在后续内容到达后自然恢复，因此不会丢字。
 */
function stripTailTagFragment(text: string): string {
  let result = text
  // 清两轮：`</too` 被清掉后可能又露出一个尾部 `<`
  for (let round = 0; round < 2; round++) {
    // 从最后一个 '<' 起判定，而不是让正则自己去找：正文中间的 `<`（如
    // `比较 a < b`）不会被误认为残片
    const lastLt = result.lastIndexOf('<')
    if (lastLt === -1) break
    if (!TAIL_TAG_FRAGMENT_PATTERN.test(result.slice(lastLt))) break
    result = result.slice(0, lastLt)
  }
  return result
}

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

/**
 * 需要缓冲的标签片段
 *
 * 除开标签外，闭合标签与模型结束符同样要缓冲：分片边界也可能把 `</tool_call>`
 * 切成 `</`、`</tool_ca` 先后送达。不缓冲的话，前半截会先作为正文显示出来，
 * 补齐后再被吞掉，用户看到的就是末尾闪一下残片。
 */
const LEAK_TAG_FRAGMENTS: string[] = [
  ...LEAK_MARKUP_TAGS,
  ...LEAK_MARKUP_TAGS.map(name => `/${name}`),
  '/s',
  '|im_end|',
  '|endoftext|',
]

/**
 * 定位文本末尾「疑似泄漏标签前缀」的起始下标，没有则返回 -1。
 *
 * 分片边界经常把一个标签切成两半：`<tool_call>` 的 `<` 或 `<tool_` 会单独作为
 * 一块到达。这时没有完整标签可供匹配，若按正文输出，用户就会在回复末尾看到一个
 * 孤立的 `<`（补齐后又会变成标签残片）。因此这类结尾一律先缓冲，等后续字符到达
 * 再判断它到底是泄漏标记还是正常文本。
 */
function findPendingLeakPrefixStart(text: string): number {
  const open = text.lastIndexOf('<')
  if (open === -1) return -1

  const fragment = text.slice(open + 1)
  // 已经出现 '>' 说明标签到达了终止，或者是 <b> 这类正常标签，不该拦截
  if (fragment.includes('>')) return -1

  const namePart = fragment.split(/\s/)[0] ?? ''

  for (const candidate of LEAK_TAG_FRAGMENTS) {
    if (namePart.length <= candidate.length && candidate.startsWith(namePart)) {
      return open
    }
  }

  return -1
}

/**
 * 开标签块的跨块状态机
 *
 * 只处理「开标签 → 是否等到闭合」这一种配对关系。孤立闭合标签与模型结束符
 * 不在这里删：`<tool_call></tool_call>` 一旦被提前抹成 `<tool_call>`，开标签
 * 就会被判成「未闭合」，连同其后的正文一起被吞进缓冲。
 */
function filterLeakMarkup(combined: string): ToolLeakSanitizationResult {
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
      const rest = combined.slice(cursor)
      const pendingStart = findPendingLeakPrefixStart(rest)
      if (pendingStart === -1) {
        visibleText += rest
        return { visibleText, buffer: '' }
      }

      // 前缀之后还可能有正常正文，只把尾巴留在缓冲里
      visibleText += rest.slice(0, pendingStart)
      return { visibleText, buffer: rest.slice(pendingStart) }
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

export function filterToolCallLeakChunk(chunk: string, buffered = ''): ToolLeakSanitizationResult {
  const result = filterLeakMarkup(buffered + chunk)

  // 配对判定完成后，再清掉没有配对语义的残片：孤立闭合标签、模型结束符。
  // 缓冲内容保持原样，它还在等后续分片补齐。
  return {
    visibleText: stripStandaloneLeaks(result.visibleText),
    buffer: result.buffer,
  }
}

/**
 * 流结束时冲刷跨块缓冲
 *
 * 缓冲里保存的是「最后一块中从疑似标签处起、直到文本末尾」的内容，它一直在等
 * 后续分片补齐。流结束意味着后续不会再有分片，若不冲刷，这段内容会随缓冲一起
 * 丢失——表现为回复在某个 `<` 处被硬生生截断。
 *
 * 冲刷时仍按残片规则过一遍：属于标签残片的部分（`</`、`</tool_ca`、`<|im_en`）
 * 丢弃，其余按正文返回。
 */
export function flushToolCallLeakBuffer(buffered: string): string {
  if (!buffered) return ''
  const cleaned = stripStandaloneLeaks(buffered)

  // 以泄漏开标签起头 = 还没等到闭合的工具调用块（流在中途断掉时这里会留着
  // 半截 JSON）。它是泄漏标记，不是正文，整体丢弃，绝不能冲进回复里。
  for (const spec of LEAK_TAG_PATTERNS) {
    spec.openPattern.lastIndex = 0
    const match = spec.openPattern.exec(cleaned)
    if (match && match.index === 0) return ''
  }

  return stripTailTagFragment(cleaned)
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

  sanitized = stripStandaloneLeaks(sanitized)

  // 末尾残片只对整段结尾生效：完整行的行末 `<` 属于正文，不能清
  return stripTailTagFragment(sanitized.trim()).trim()
}
