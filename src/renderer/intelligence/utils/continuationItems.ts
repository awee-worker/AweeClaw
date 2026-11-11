/**
 * 续做清单与待办状态的比对
 *
 * offer_continuation 的 `remaining` 是模型自由表述的清单，而会话待办里记着每件事
 * 的真实状态。两者文案常有出入（空白、标点、大小写、措辞长短不一），直接字符串
 * 相等比对基本退化为「一条都过滤不掉」，因此这里先归一化再做宽松匹配。
 */

/** 比对用的待办条目：只关心文案与状态 */
export interface ContinuationTodoLike {
  content: string
  status: string
}

/**
 * 归一化续做条目
 *
 * 抹平空白、标点与大小写差异，只保留用于判断「是不是同一件事」的骨架字符。
 * 中英文标点一并处理，模型的输出里两种混用很常见。
 */
export function normalizeContinuationItem(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[.,;:!?'"`()[\]{}<>，。；：！？、（）【】《》\-—_/\\]+/g, '')
}

/**
 * 两个续做条目是否指向同一件事
 *
 * 相等即可判定；一方是另一方的子串时也视为同一项，但要求较短的一侧有足够长度，
 * 避免「测试」这类短词把不相干的条目一并吞掉。
 */
export function isSameContinuationItem(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const shorter = a.length <= b.length ? a : b
  const longer = shorter === a ? b : a
  return shorter.length >= 6 && longer.includes(shorter)
}

/**
 * 剔除续做清单中其实已经完成的事项
 *
 * 模型经常把整份待办清单原样塞给 offer_continuation，其中已完成的条目会被渲染成
 * 「待续做」，用户点继续时又被重新执行一遍。这里以待办的实际状态为准做确定性过滤。
 * 待办为空（模型没建清单）时无从判断，原样保留。
 */
export function filterCompletedContinuationItems(
  remaining: readonly string[],
  todos: readonly ContinuationTodoLike[],
): string[] {
  if (todos.length === 0) return [...remaining]

  const completedKeys = todos
    .filter(todo => todo.status === 'completed')
    .map(todo => normalizeContinuationItem(todo.content))
    .filter(Boolean)

  if (completedKeys.length === 0) return [...remaining]

  return remaining.filter(item => {
    const key = normalizeContinuationItem(item)
    if (!key) return true
    return !completedKeys.some(done => isSameContinuationItem(done, key))
  })
}
