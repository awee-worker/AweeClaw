/**
 * 工具调用数组的引用复用
 *
 * ── 为什么需要它 ──
 *
 * 流式期间文本分片会不断重写消息 parts：`_doAppendToAssistant` 只替换尾部的
 * 文本段，工具段与 ToolCall 对象的身份都保持不变，但 parts 数组本身换了引用。
 * 于是分组 useMemo 每次都要重算，并为每个工具组生成一个「元素相同、引用不同」
 * 的新数组，直接把 ToolCallGroup 的 memo 打穿 —— 一段文本切片就换来整组工具
 * 卡片的重新渲染，而这段时间里没有任何一张卡片的数据发生了变化。
 *
 * 这里做一次身份回收：元素逐个相同就沿用上一轮的数组引用。
 * 与 IncrementalBlockSplitter 保留已提交块前缀是同一个思路，只是回收的是数组
 * 而不是解析结果。
 *
 * @module chatMessage/blocks/toolCallsArrayReuse
 */

import type { ToolCall } from '@intelligence/providerTypes'

/**
 * 若新旧数组元素逐个相同，返回旧数组引用
 *
 * 只做逐位比较：这里刻意不比较元素内容 —— ToolCall 对象由 store 持有，
 * 内容变化必然伴随对象重建，引用不等即可判定为变化；反过来比较字段会把
 * 一次 O(n) 的引用扫描变成深比较，得不偿失。
 *
 * @param previous 上一轮的数组；首次渲染时为 undefined
 * @param next 本轮新建的数组
 * @returns 元素未变时返回 previous，否则返回 next
 */
export function reuseToolCallsIfUnchanged(
  previous: ToolCall[] | undefined,
  next: ToolCall[],
): ToolCall[] {
  if (!previous || previous.length !== next.length) return next

  for (let i = 0; i < next.length; i++) {
    if (previous[i] !== next[i]) return next
  }

  return previous
}
