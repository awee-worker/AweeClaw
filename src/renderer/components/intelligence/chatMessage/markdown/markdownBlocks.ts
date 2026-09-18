/**
 * Markdown 分块器
 *
 * 背景：流式输出期间内容会被高频刷新（平滑插值约每 66ms 一次）。若每次都把整篇
 * 文本交给 Markdown 解析器，开销随文本长度线性增长，长回复会持续占满一个核心。
 *
 * 思路：流式文本是「只追加」的，任意时刻已经确定的前缀不会再被改写。把文本按
 * 块级边界切开后，已完成的部分可以交给记忆化组件，只有末尾未完成的块需要重新
 * 解析 —— 单次开销从「全文长度」降为「最后一段长度」。
 *
 * 切分必须保守：一旦把语义相关的行拆到不同块，Markdown 的块级语法（松散列表、
 * 多行引用、缩进代码、表格、围栏代码、数学块）就会被破坏。因此只在明确安全的
 * 空行处切分，不确定时一律不切。
 */

/** 围栏代码块状态 */
export interface FenceState {
  /** 围栏字符（` 或 ~） */
  char: string
  /** 围栏长度 */
  length: number
  /** 围栏行声明的语言标识（闭合围栏与无标识时为 ''） */
  language: string
}

/** 解析一行的围栏标记，非围栏行返回 null */
export function parseFence(line: string): FenceState | null {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*(.*)$/.exec(line)
  if (!match) return null
  // 语言标识取 info string 的第一个词，允许 `ts title="x"` 这类附加写法
  return {
    char: match[1][0],
    length: match[1].length,
    language: match[2].trim().split(/\s+/)[0] || '',
  }
}

/**
 * 判断一行是否为「结构续行」
 *
 * 这类行的下一行若出现空行，往往仍属于同一个块级结构（松散列表项之间的空行、
 * 引用段落之间的空行、表格与分隔行的组合等）。在它们后面切分会改变解析结果，
 * 因此统一视为不可切分。
 */
function isStructureContinuation(line: string): boolean {
  const trimmed = line.trimStart()
  if (!trimmed) return false

  // 无序列表项 / 有序列表项
  if (/^([-*+]|\d+[.)])\s/.test(trimmed)) return true
  // 引用块
  if (trimmed.startsWith('>')) return true
  // 缩进代码块（4 空格或制表符起首）
  if (/^(\t| {4})/.test(line)) return true
  // 表格行（以竖线起首；以竖线结尾的普通段落不算，避免无谓地放弃切分点）
  if (trimmed.startsWith('|')) return true
  // 原生 HTML 块（内容可能跨空行）
  if (trimmed.startsWith('<')) return true

  return false
}

/**
 * 把 Markdown 文本切分为块级片段
 *
 * 返回数组中的每个元素都是一段可以独立交给 Markdown 解析器渲染的文本。
 * 输入为「只追加」的流式文本时，已切分出的前缀块内容保持稳定，
 * 可以安全地配合记忆化组件复用渲染结果。
 */
export function splitMarkdownBlocks(content: string): string[] {
  if (!content) return []

  const lines = content.split('\n')
  const blocks: string[] = []
  let current: string[] = []

  let fence: FenceState | null = null
  let inMathBlock = false

  const commit = (): void => {
    if (current.length === 0) return
    const text = current.join('\n')
    if (text.trim()) blocks.push(text)
    current = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // 围栏代码块内部：原样累积，直到匹配的结束围栏
    if (fence) {
      current.push(line)
      const closing = parseFence(line)
      if (closing && closing.char === fence.char && closing.length >= fence.length) {
        fence = null
      }
      continue
    }

    // 数学块内部（$$ 包裹的多行公式）：公式不能从中间截断
    if (inMathBlock) {
      current.push(line)
      if (trimmed.endsWith('$$')) inMathBlock = false
      continue
    }

    const opening = parseFence(line)
    if (opening) {
      // 围栏可以打断段落（CommonMark 中围栏块是能中断段落的块级结构），因此把围栏
      // 之前的内容先落定成独立块不会改变解析结果。这样做是为了让这段前缀脱离围栏：
      // 否则它会陪着不断增长的代码一起，在每个刷新周期被整块重新解析。
      commit()
      fence = opening
      current.push(line)
      continue
    }

    // 数学块标记行：独占一行的 $$ 兼具开启与关闭语义，
    // 必须单独识别，否则它会被当成普通行，公式内部随即被空行切碎。
    if (trimmed === '$$') {
      inMathBlock = !inMathBlock
      current.push(line)
      continue
    }

    // 跨行公式起始（同一行内闭合的不算）
    if (trimmed.startsWith('$$') && !trimmed.endsWith('$$')) {
      inMathBlock = true
      current.push(line)
      continue
    }

    // 空行：唯一允许切分的位置
    // 需要同时满足：不是文本末尾、上一个有效行属于普通块级内容
    if (!trimmed && i < lines.length - 1) {
      const prevIndex = i - 1
      const prev = prevIndex >= 0 ? lines[prevIndex] : undefined
      if (prev !== undefined && prev.trim() && !isStructureContinuation(prev)) {
        current.push(line)
        commit()
        continue
      }
    }

    current.push(line)
  }

  // 末尾未闭合的围栏或公式仍按普通块输出，交由解析器处理
  commit()
  return blocks
}

/**
 * 增量分块器
 *
 * splitMarkdownBlocks 每次都从全文第一行重扫。流式期间内容每秒增长十余次，
 * 而已经切出来的块永远不再变化，重复扫描纯属白费；长回复下这份开销随字符数
 * 线性增长，叠加刷新频率就是平方级。
 *
 * 这里记住最后一次提交点：提交点之前的行不再参与扫描，只把当时的状态
 * （围栏、数学块、上一行）带过来。于是单次刷新的成本从「全文行数」降为
 * 「未提交行数」。
 *
 * 复用成立的前提是「只追加」：一旦发现当前文本不是上次文本的延伸（内容被
 * 改写、回退、切换线程），立刻退化为全量重扫。提交一旦发生即不可撤销——
 * 换言之，已提交块的内容由构造方式保证稳定，不依赖调用方传对了内容。
 */
export class IncrementalBlockSplitter {
  /** 已提交块（不包含末尾未定稿的块） */
  private blocks: string[] = []
  /** 已提交块在原文中覆盖到的字符偏移，即不再变化的原文前缀长度 */
  private consumed = 0
  /** 提交点前一行原文，用于判断紧随其后的空行能否切分 */
  private prevLine = ''
  /** 提交点处的围栏与数学块状态 */
  private fence: FenceState | null = null
  private inMathBlock = false
  /** 上一次传入的文本，用于判定本次是否为「只追加」 */
  private lastContent = ''
  /** 上一轮复用的已提交块数量 */
  private reusedCount = 0
  /** 尾块若落在未闭合的围栏内，记录该围栏声明的语言标识，否则为 null */
  private tailFenceLanguage: string | null = null

  /** 上一轮复用的已提交块数量，供埋点读取 */
  get reused(): number {
    return this.reusedCount
  }

  /**
   * 尾块是否为未闭合的围栏代码块
   *
   * 为真时尾块的首行必然是围栏开启行：围栏开启处会先把前缀内容提交掉，
   * 因此调用方可以按「首行 + 其余行」直接把尾块拆成代码文本，无须再解析 Markdown。
   * 这是流式期间最值得绕开解析的形态 —— 代码块常常一次输出上百行，
   * 每帧对它跑一遍完整解析并重建整棵节点树的代价，远高于更新一个文本节点。
   */
  get tailFence(): { language: string } | null {
    return this.tailFenceLanguage === null ? null : { language: this.tailFenceLanguage }
  }

  private invalidate(): void {
    this.blocks = []
    this.consumed = 0
    this.prevLine = ''
    this.fence = null
    this.inMathBlock = false
    this.tailFenceLanguage = null
  }

  /**
   * 传入当前全文，返回块级切分结果。
   *
   * 返回数组的最后一个元素是尚未定稿的尾块，其余元素与本轮之前的结果逐字相同。
   */
  update(content: string): string[] {
    if (!content.startsWith(this.lastContent)) {
      this.invalidate()
    }
    this.lastContent = content

    const carriedPrev = this.prevLine
    // 只切出未提交的部分，已提交的行不必再进内存
    const lines = (this.consumed > 0 ? content.slice(this.consumed) : content).split('\n')

    let current: string[] = []
    let fence = this.fence
    let inMathBlock = this.inMathBlock
    let cursor = this.consumed

    this.reusedCount = this.blocks.length

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      const isLast = i === lines.length - 1
      // 本地行号 i 对应全局行号 i + 已提交行数，因此「非末行」的判定在切片后依然成立
      const prev = i === 0 ? carriedPrev : lines[i - 1]

      // 该行在原文中占据的长度（含行尾换行）。末行没有换行，但提交点只可能
      // 落在非末行上，因此用于计算消费偏移时它总是准确的。
      cursor += line.length + 1

      // 围栏代码块内部：原样累积，直到匹配的结束围栏
      if (fence) {
        current.push(line)
        const closing = parseFence(line)
        if (closing && closing.char === fence.char && closing.length >= fence.length) {
          fence = null
        }
        continue
      }

      // 数学块内部（$$ 包裹的多行公式）：公式不能从中间截断
      if (inMathBlock) {
        current.push(line)
        if (trimmed.endsWith('$$')) inMathBlock = false
        continue
      }

      const opening = parseFence(line)
      if (opening) {
        // 与全文实现保持一致：围栏之前的内容先落定成独立块（围栏能中断段落，拆开解析结果不变）。
        // 好处是这段前缀不必陪着持续增长的代码每帧重解析，尾块也能作为纯代码单独渲染。
        if (current.length > 0) {
          const text = current.join('\n')
          if (text.trim()) {
            this.blocks.push(text)
          }
          current = []
          // 消费点停在围栏行之前：围栏内容仍在未提交区，下一轮从这里重新进入围栏状态。
          // cursor 已含本行，减掉本行长度与换行即得本行之前的偏移。
          this.consumed = cursor - line.length - 1
          this.prevLine = line
        }
        fence = opening
        current.push(line)
        continue
      }

      if (trimmed === '$$') {
        inMathBlock = !inMathBlock
        current.push(line)
        continue
      }

      if (trimmed.startsWith('$$') && !trimmed.endsWith('$$')) {
        inMathBlock = true
        current.push(line)
        continue
      }

      // 空行：唯一允许切分的位置。这里之后的行仍可能增长，因此提交点可固化
      if (!trimmed && !isLast && prev !== undefined && prev.trim() && !isStructureContinuation(prev)) {
        current.push(line)
        const text = current.join('\n')
        // 纯空白块不产生渲染单元，但同样要推进消费偏移，否则下轮会重复扫描它
        if (text.trim()) {
          this.blocks.push(text)
        }
        current = []

        this.consumed = cursor
        this.prevLine = line
        this.fence = fence
        this.inMathBlock = inMathBlock
        continue
      }

      current.push(line)
    }

    // 尾块每轮重新解析，因此只随返回值给出，不写进已提交列表
    const tail = current.length > 0 ? current.join('\n') : ''
    const result = this.blocks.slice()
    if (tail.trim()) {
      result.push(tail)
    }
    // 循环结束仍未闭合的围栏，只能落在尾块里，随结果一并暴露给调用方
    this.tailFenceLanguage = fence ? fence.language : null
    return result
  }
}
