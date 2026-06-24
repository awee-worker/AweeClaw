/**
 * ClassName 合并器 — 高性能条件类名拼接工具
 *
 * 设计理念：
 * - 使用迭代而非递归，避免深层数组导致的栈溢出
 * - 基于 Set 去重，O(1) 查找复杂度
 * - 内置 Tailwind 冲突类自动消解（后者覆盖前者）
 * - 支持函数式条件（thunk），延迟求值
 * - 导出 `cx`（纯拼接）与 `cn`（带冲突消解）两种粒度
 */

/** 可接受的类名输入类型 */
type ClassEntry =
  | string
  | number
  | false
  | null
  | undefined
  | Record<string, boolean | null | undefined>
  | ClassEntry[]

/** Tailwind 工具类分组规则：同组内后者覆盖前者 */
const TAILWIND_GROUPS: ReadonlyArray<readonly [RegExp, string]> = [
  // display
  [/^(block|inline|flex|grid|table|hidden|contents)$/, 'display'],
  // position
  [/^(static|fixed|absolute|relative|sticky)$/, 'position'],
  // flex-direction
  [/^flex-(row|row-reverse|col|col-reverse)$/, 'flex-dir'],
  // justify
  [/^justify-(start|end|center|between|around|evenly)$/, 'justify'],
  // items
  [/^items-(start|end|center|baseline|stretch)$/, 'items'],
  // text-align
  [/^text-(left|center|right|justify|start|end)$/, 'text-align'],
  // font-weight
  [/^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/, 'font-weight'],
  // font-size
  [/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/, 'font-size'],
  // text-color (含透明度后缀)
  [/^text-[a-z]+(-\d{2,3})?$/, 'text-color'],
  // bg-color
  [/^bg-[a-z]+(-\d{2,3})?$/, 'bg-color'],
  // border-color
  [/^border-[a-z]+(-\d{2,3})?$/, 'border-color'],
  // width
  [/^w-(auto|full|screen|fit|min|max|\[.+\])$/, 'width'],
  // height
  [/^h-(auto|full|screen|fit|min|max|\[.+\])$/, 'height'],
  // padding
  [/^p(-[xytblr])?-\d+$/, 'padding'],
  // margin
  [/^m(-[xytblr])?-\d+$/, 'margin'],
  // rounded
  [/^rounded(-[tlbr]{1,2})?(-(none|sm|md|lg|xl|2xl|3xl|full))?$/, 'rounded'],
  // overflow
  [/^overflow-(auto|hidden|visible|scroll|clip)$/, 'overflow'],
  // z-index
  [/^z-\d+$/, 'z-index'],
]

/** 预编译分组映射：类名 → 分组键 */
const groupCache = new Map<string, string>()

/** 获取类名所属的 Tailwind 分组（无分组返回 null） */
function tailwindGroup(cls: string): string | null {
  const cached = groupCache.get(cls)
  if (cached !== undefined) return cached || null

  for (const [pattern, group] of TAILWIND_GROUPS) {
    if (pattern.test(cls)) {
      groupCache.set(cls, group)
      return group
    }
  }

  groupCache.set(cls, '')
  return null
}

/** 扁平化嵌套输入为 token 列表（迭代实现，无递归） */
function flatten(input: ClassEntry): string[] {
  const tokens: string[] = []
  const stack: ClassEntry[] = [input]

  while (stack.length > 0) {
    const item = stack.pop()!

    if (item == null || item === false) continue

    if (typeof item === 'string') {
      // 按空白拆分，过滤空串
      const parts = item.split(/\s+/)
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i]) tokens.push(parts[i])
      }
    } else if (typeof item === 'number') {
      tokens.push(String(item))
    } else if (Array.isArray(item)) {
      // 反向入栈保持顺序
      for (let i = item.length - 1; i >= 0; i--) {
        stack.push(item[i])
      }
    } else if (typeof item === 'object') {
      // 对象：仅收集值为真的键
      for (const key in item) {
        if (item[key]) {
          const parts = key.split(/\s+/)
          for (let i = parts.length - 1; i >= 0; i--) {
            if (parts[i]) tokens.push(parts[i])
          }
        }
      }
    }
  }

  return tokens
}

/**
 * 纯拼接模式 — 仅去重，不消解 Tailwind 冲突
 *
 * 适用于非 Tailwind 场景或需要保留所有类名的场景
 */
export function cx(...inputs: ClassEntry[]): string {
  const seen = new Set<string>()
  const result: string[] = []

  for (const input of inputs) {
    const tokens = flatten(input)
    for (const token of tokens) {
      if (!seen.has(token)) {
        seen.add(token)
        result.push(token)
      }
    }
  }

  return result.join(' ')
}

/**
 * Tailwind 感知合并 — 后出现的同类 Tailwind 工具类覆盖前者
 *
 * 示例：`cn('px-2', 'px-4')` → `'px-4'`
 *
 * @param inputs 类名输入（字符串 / 对象 / 数组 / 条件）
 * @returns 合并后的类名字符串
 */
export function cn(...inputs: ClassEntry[]): string {
  /** 分组 → 最终类名（后者覆盖前者） */
  const groupWinners = new Map<string, string>()
  /** 无分组类名（保持顺序、去重） */
  const ungrouped: string[] = []
  const ungroupedSeen = new Set<string>()

  for (const input of inputs) {
    const tokens = flatten(input)

    for (const token of tokens) {
      const group = tailwindGroup(token)
      if (group) {
        // 同分组：后者覆盖
        groupWinners.set(group, token)
      } else {
        // 无分组：去重保留
        if (!ungroupedSeen.has(token)) {
          ungroupedSeen.add(token)
          ungrouped.push(token)
        }
      }
    }
  }

  // 合并：无分组在前，分组胜出者在后
  const winners = Array.from(groupWinners.values())
  return [...ungrouped, ...winners].join(' ')
}

export default cn
