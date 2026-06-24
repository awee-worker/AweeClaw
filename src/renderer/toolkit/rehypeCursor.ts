/**
 * Rehype 流式光标插件 — 在 Markdown AST 末尾注入光标元素
 *
 * 设计理念：
 * - 可配置光标样式（闪烁 / 实心 / 下划线）
 * - 支持自定义光标类名与子元素
 * - 深度优先遍历，精确定位最后一个文本节点
 * - 空树安全：无子节点时自动创建段落容器
 * - 纯函数式选项合并，无副作用
 */

/** 光标视觉样式 */
export type CursorStyle = 'blink' | 'solid' | 'underscore' | 'bar'

/** 插件配置 */
export interface CursorPluginOptions {
  /** 是否显示光标 */
  show: boolean
  /** 光标样式（默认 blink） */
  style?: CursorStyle
  /** 自定义 CSS 类名前缀（默认 'stream-cursor'） */
  classNamePrefix?: string
  /** 光标内嵌内容（如 SVG 或文字） */
  content?: string
}

/** 默认配置 */
const DEFAULT_OPTIONS: Required<CursorPluginOptions> = {
  show: true,
  style: 'blink',
  classNamePrefix: 'stream-cursor',
  content: '',
}

/** HAST 节点类型（简化版，避免引入完整 hast 类型） */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/** 样式 → CSS 类名后缀映射 */
const STYLE_CLASS_MAP: Readonly<Record<CursorStyle, string>> = {
  blink: 'blink',
  solid: 'solid',
  underscore: 'underscore',
  bar: 'bar',
}

/**
 * 构建光标元素节点
 */
function createCursorNode(prefix: string, style: CursorStyle, content: string): HastNode {
  const className = `${prefix} ${prefix}--${STYLE_CLASS_MAP[style]}`
  const children: HastNode[] = content
    ? [{ type: 'text', value: content }]
    : []

  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [className] },
    children,
  }
}

/**
 * 深度优先查找最后一个文本节点，在其后插入光标
 *
 * @param node 当前 HAST 节点
 * @param cursor 光标元素
 * @returns 是否成功插入
 */
function injectAfterLastText(node: HastNode, cursor: HastNode): boolean {
  // 无子节点：无法插入
  if (!node.children || node.children.length === 0) {
    return false
  }

  // 从后往前找第一个可插入位置
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i]

    // 文本节点：直接在后面插入光标
    if (child.type === 'text') {
      node.children.splice(i + 1, 0, cursor)
      return true
    }

    // 元素节点：递归尝试在内部插入
    if (child.type === 'element' && child.children) {
      if (injectAfterLastText(child, cursor)) {
        return true
      }
      // 内部无文本节点：在元素后面插入
      node.children.splice(i + 1, 0, cursor)
      return true
    }
  }

  // 所有子节点都不是文本/元素：追加到末尾
  node.children.push(cursor)
  return true
}

/**
 * Rehype 插件入口 — 返回 transformer 函数
 *
 * @param options 插件配置
 * @returns transformer `(tree) => void`
 *
 * @example
 * ```ts
 * import { rehypeCursor } from '@utils/rehypeCursor'
 *
 * // 基础用法
 * rehypeCursor({ show: isStreaming })
 *
 * // 自定义样式
 * rehypeCursor({ show: true, style: 'underscore' })
 * ```
 */
export const rehypeCursor = (options: CursorPluginOptions) => {
  const config: Required<CursorPluginOptions> = { ...DEFAULT_OPTIONS, ...options }

  return (tree: HastNode): void => {
    if (!config.show) return

    const cursor = createCursorNode(
      config.classNamePrefix,
      config.style,
      config.content,
    )

    // 空树保护：无子节点时创建段落容器
    if (!tree.children || tree.children.length === 0) {
      tree.children = [{
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [cursor],
      }]
      return
    }

    injectAfterLastText(tree, cursor)
  }
}

export default rehypeCursor
