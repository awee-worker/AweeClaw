/**
 * 流式文本装饰器
 *
 * 历史上这里会把尾部文本逐字符拆成一串行内 span，给每个字符挂淡入动画。
 * 逐字淡入已从样式层移除（行内元素无法参与合成，opacity 动画只能回退到渲染
 * 主线程逐帧重绘，成本随字符数放大），拆分也随之失去意义：
 * 一段完整文本被切成十余个行内元素后，浏览器无法再把它当作单个文本段做整形与
 * 布局缓存，而尾块每个刷新周期都会重写一遍 —— 等于持续为这批碎片重排。
 *
 * 因此这里不再改写节点结构，只保留同名导出，让调用点不必关心装饰策略的变化。
 * 后续若需要新的流式表达，也应优先选择不破坏文本连续性的做法。
 */
import type React from 'react'
import { stripToolCallLeaks } from '@intelligence/utils/toolCallSanitizer'

/** 清理流式内容中的工具调用泄漏 */
export function cleanStreamingContent(text: string): string {
  if (!text) return ''
  return stripToolCallLeaks(text)
}

/** 原样返回子节点：当前不再对流式文本做任何结构改写 */
export function decorateStreamingChildren(children: React.ReactNode): React.ReactNode {
  return children
}

