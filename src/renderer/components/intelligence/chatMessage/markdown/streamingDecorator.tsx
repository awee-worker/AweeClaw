/**
 * 流式文本装饰器
 * 在流式输出时为尾部字符添加逐字动画样式
 */
import React from 'react'
import { stripToolCallLeaks } from '@intelligence/utils/toolCallSanitizer'

/**
 * 尾部窗口字符数。
 *
 * 窗口内每个字符都是一个独立行内节点，窗口越大，每次推进要更新的节点越多。
 * 这里保留窗口只是为了给「尾部区域」一个稳定的节点边界，不再承载动画效果，
 * 因此取一个足够小的值。
 */
const STREAMING_TAIL_LENGTH = 12

/** 清理流式内容中的工具调用泄漏 */
export function cleanStreamingContent(text: string): string {
  if (!text) return ''
  return stripToolCallLeaks(text)
}

/**
 * 渲染流式尾部文本
 *
 * 窗口内的 key 必须取相对序号：尾部窗口随内容增长整体右移，若用字符在全文中的
 * 绝对下标作 key，每次刷新所有节点的下标都会改变，React 只能把它们全部卸载重建，
 * 成为流式期间的主要渲染开销；相对序号在窗口内稳定，节点得以复用。
 *
 * 节点本身不携带动画：逐字淡入落在 `display: inline` 元素上无法参与合成，
 * 只能回退到渲染主线程逐帧重绘，成本随窗口大小放大，已从样式层移除。
 */
export function renderStreamingTailText(value: string, key: string): React.ReactNode {
  if (!value) return value

  const tailLength = Math.min(STREAMING_TAIL_LENGTH, value.length)
  if (tailLength <= 0) return value

  const stableText = value.slice(0, -tailLength)
  const animatedTail = value.slice(-tailLength)

  return (
    <React.Fragment key={key}>
      {stableText}
      {animatedTail.split('').map((char, i) => (
        <span key={i} className="inline-stream-char">
          {char}
        </span>
      ))}
    </React.Fragment>
  )
}

/** 装饰单个流式子节点 */
function decorateStreamingChild(child: React.ReactNode, path: string): { changed: boolean; node: React.ReactNode } {
  if (typeof child === 'string') {
    return { changed: true, node: renderStreamingTailText(child, path) }
  }
  if (typeof child === 'number') {
    return { changed: true, node: renderStreamingTailText(String(child), path) }
  }
  if (!React.isValidElement(child)) {
    return { changed: false, node: child }
  }

  const childProps = child.props as { children?: React.ReactNode } | null
  if (!childProps || childProps.children == null) {
    return { changed: false, node: child }
  }

  const decoratedChildren = decorateStreamingChildren(childProps.children, path)
  if (decoratedChildren === childProps.children) {
    return { changed: false, node: child }
  }

  return {
    changed: true,
    node: React.cloneElement(child, undefined, decoratedChildren),
  }
}

/** 递归装饰流式子节点，仅对最后一个文本节点应用尾部动画 */
export function decorateStreamingChildren(children: React.ReactNode, basePath = 'tail'): React.ReactNode {
  const childArray = React.Children.toArray(children)
  for (let index = childArray.length - 1; index >= 0; index -= 1) {
    const currentChild = childArray[index]
    const decorated = decorateStreamingChild(currentChild, `${basePath}-${index}`)
    if (!decorated.changed) continue
    if (decorated.node == null || typeof decorated.node === 'boolean') continue

    const nextChildren = [...childArray]
    nextChildren[index] = decorated.node
    return nextChildren
  }
  return children
}
