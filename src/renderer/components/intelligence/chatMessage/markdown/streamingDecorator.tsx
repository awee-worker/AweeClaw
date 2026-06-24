/**
 * 流式文本装饰器
 * 在流式输出时为尾部字符添加逐字动画样式
 */
import React from 'react'
import { stripToolCallLeaks } from '@intelligence/utils/toolCallSanitizer'

const STREAMING_TAIL_LENGTH = 40

/** 清理流式内容中的工具调用泄漏 */
export function cleanStreamingContent(text: string): string {
  if (!text) return ''
  return stripToolCallLeaks(text)
}

/** 渲染流式尾部文本，为尾部字符添加逐字动画 */
export function renderStreamingTailText(value: string, key: string): React.ReactNode {
  if (!value) return value

  const tailLength = Math.min(STREAMING_TAIL_LENGTH, value.length)
  if (tailLength <= 0) return value

  const stableText = value.slice(0, -tailLength)
  const animatedTail = value.slice(-tailLength)

  return (
    <React.Fragment key={key}>
      {stableText}
      {animatedTail.split('').map((char, i) => {
        const charIndex = value.length - tailLength + i
        return (
          <span key={`${key}-${charIndex}`} className="inline-stream-char">
            {char}
          </span>
        )
      })}
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
