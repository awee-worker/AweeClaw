/**
 * 流式文本增量清洗器
 *
 * 背景：正文进入 Markdown 渲染前要走一条清洗链路——剥离工具调用泄漏标记、
 * 裸 URL 转链接、软换行转硬换行、表情标记替换。其中链接化要跑三轮保护区正则
 * 加一轮 URL 正则，成本随全文长度线性上升；而流式期间每个内容分片都会触发一次
 * 这条链路，一整段回复的代价因此是字符数的平方级。
 *
 * 思路：流式文本是「只追加」的，已确定的行不会再被改写。把清洗改为按行增量后，
 * 已完成的行只处理一次并缓存，每次只处理新增行与可能还在增长的末行。
 * 清洗规则本身都是行内的：URL、行内代码、链接、表情标记都不跨行，换行标记也
 * 逐行追加，因此逐行处理与全文处理结果一致。唯一需要跨行携带的状态是围栏代码块
 * ——这正是本文件持有的状态之一。
 *
 * 顺带去掉一项白工：围栏内的内容不再做链接化与表情替换。此前是用「保护区间」
 * 在事后抵消掉这些改写，现在直接跳过，代码块密集的回复能省下一整轮全文正则。
 */

import { stripToolCallLeaks } from '@intelligence/utils/toolCallSanitizer'
import { parseFence, type FenceState } from './markdownBlocks'
import {
  appendHardBreak,
  linkifyBareUrlsInLine,
  replaceEmotionTagsInLine,
} from './textPreprocessor'

export interface IncrementalCleanOptions {
  /** 是否处于流式输出：仅流式期间剥离工具调用泄漏标记 */
  streaming: boolean
  /** 是否把软换行转为硬换行（用户消息保留换行，助手正文不转） */
  preserveLineBreaks: boolean
}

/** 选项组合变化即失效：不同的清洗规则产出的行不能混用 */
function modeKey(options: IncrementalCleanOptions): string {
  return `${options.streaming ? 'stream' : 'final'}|${options.preserveLineBreaks ? 'breaks' : 'plain'}`
}

export class IncrementalTextCleaner {
  /** 已定稿的行（每行不含换行符） */
  private committedLines: string[] = []
  /** 已定稿区域在源文本中的长度，即不再变化的源前缀长度 */
  private consumed = 0
  /** 定稿点处的围栏状态 */
  private fence: FenceState | null = null
  /** 上一次的源文本（已完成泄漏剥离），用于判定本次是否为「只追加」 */
  private lastSource = ''
  /** 上一次的选项组合 */
  private mode = ''
  /** 上一轮复用的已定稿行数 */
  private reusedCount = 0
  /** 因处于围栏内而跳过的行数 */
  private fenceSkippedCount = 0

  /** 上一轮复用的已定稿行数，供埋点读取 */
  get reused(): number {
    return this.reusedCount
  }

  /** 因处于围栏代码块内而跳过的行数，供埋点读取 */
  get fenceSkipped(): number {
    return this.fenceSkippedCount
  }

  private reset(): void {
    this.committedLines = []
    this.consumed = 0
    this.fence = null
  }

  /**
   * 传入原始正文，返回清洗后的正文。
   *
   * 返回值与「对全文依次执行整条清洗链路」等价；差异只在围栏代码块内部：
   * 那里的 URL 与表情标记不会被改写（代码块里的 URL 渲染不出链接，
   * 改动它只是给代码文本引入噪声）。
   */
  update(raw: string, options: IncrementalCleanOptions): string {
    const mode = modeKey(options)
    const source = options.streaming ? stripToolCallLeaks(raw) : raw

    if (mode !== this.mode || !source.startsWith(this.lastSource)) {
      this.reset()
      this.mode = mode
    }
    this.lastSource = source

    const cut = source.lastIndexOf('\n')

    // 本轮真正省下的工作量：调用开始时已定稿的行数。本轮新定稿的行是刚算出来的，
    // 不能算进「复用」。
    const reusedBefore = this.committedLines.length

    // 定稿：把新增的完整行处理并入缓存。行尾换行也算定稿的一部分，
    // 因为换行符本身不会被任何一条规则改写。
    if (cut >= this.consumed) {
      const fresh = source.slice(this.consumed, cut).split('\n')
      for (const line of fresh) {
        this.committedLines.push(this.processLine(line, options))
      }
      this.consumed = cut + 1
    }

    this.reusedCount = reusedBefore
    this.fenceSkippedCount = 0

    // 末行尚未定稿：本轮处理它只是为了显示，围栏状态不能随之提交，
    // 否则下一轮它作为完整行再次处理时会重复切换围栏。
    const tailStart = Math.max(this.consumed, cut + 1)
    const tail = source.slice(tailStart)

    let tailText = ''
    if (tail.length > 0) {
      const savedFence = this.fence
      tailText = this.processLine(tail, options)
      this.fence = savedFence
    }

    if (this.committedLines.length === 0) return tailText
    return `${this.committedLines.join('\n')}\n${tailText}`
  }

  /**
   * 处理一行。
   *
   * 围栏行原样通过并翻转状态；围栏内部一律原样通过；其余行按顺序应用
   * 硬换行、链接化、表情替换。
   */
  private processLine(line: string, options: IncrementalCleanOptions): string {
    if (this.fence) {
      const closing = parseFence(line)
      if (closing && closing.char === this.fence.char && closing.length >= this.fence.length) {
        this.fence = null
      }
      this.fenceSkippedCount++
      return line
    }

    const opening = parseFence(line)
    if (opening) {
      this.fence = opening
      return line
    }

    let result = options.preserveLineBreaks ? appendHardBreak(line) : line
    result = linkifyBareUrlsInLine(result)
    return replaceEmotionTagsInLine(result)
  }
}
