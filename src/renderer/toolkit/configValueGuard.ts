/**
 * configValueGuard — 配置值「非原始值防御」工具
 *
 * 背景（真实故障）：
 * 表单控件的 onChange 回调拿到的是 React 事件对象，而不是值本身。
 * 一旦把事件对象（或 DOM 节点、组件实例、File、Promise 等）当成值写进 state / config，
 * JSON 序列化后会变成 `{}` 或直接丢失；落库时类型不匹配的字段会被静默丢弃，
 * 最终表现为「提示保存成功，但设置没生效」或「下次进来又变回默认值」，极难排查。
 *
 * 因此所有「写配置」的 updater（updateConfig / saveConfig / updateRandomTopic …）都应该先过一遍本工具：
 * - 放行：string / number（有限数）/ boolean / undefined / null
 * - 放行：由上述值递归组成的数组与纯对象（如 `allowedIps: string[]`、`send: {...}`）
 * - 丢弃：事件对象、DOM 节点、函数、Date、Map/Set、Promise、类实例等
 *   并输出 warn 日志，把「设置不生效」的真实原因直接暴露出来。
 *
 * 注意：NaN / ±Infinity 也一并拦截 —— 它们同样是 number 类型，会绕过 `typeof` 判断，
 * 但序列化后会变成 null，属于同一类「静默写坏配置」的故障（例如 `parseFloat('')`）。
 *
 * @module toolkit/configValueGuard
 */

/** 可作为配置值的原始类型 */
export type ConfigPrimitive = string | number | boolean

/** 丢弃哨兵：区分「值为 undefined」与「该值不可用」两种情况 */
const DROP = Symbol('configValueGuard.drop')

/** 是否为可用的原始配置值（排除 NaN / ±Infinity） */
export function isConfigPrimitive(value: unknown): value is ConfigPrimitive {
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return false
}

/** 无害的空值：用于「清空某个可选字段」的合法写法，必须放行 */
export function isConfigEmpty(value: unknown): value is undefined | null {
  return value === undefined || value === null
}

/** 纯对象（对象字面量 / Object.create(null)）；事件对象与 DOM 节点、类实例都不满足 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** 供日志使用的值描述，便于一眼看出「这是个 React 事件对象」 */
function describeValue(value: unknown): string {
  if (typeof value === 'function') return 'function'
  if (typeof value === 'symbol') return 'symbol'
  if (typeof value !== 'object' || value === null) return typeof value
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name
  return ctor && ctor !== 'Object' ? ctor : 'object'
}

/**
 * 递归剪枝：
 * - 原始值 / undefined / null → 原样返回
 * - 纯对象 → 逐键剪枝，丢弃不可用的子键（保留其余子键）
 * - 数组 → 逐个剪枝，任一元素不可用则整个数组丢弃（数组结构不可残缺）
 * - 其它 → 丢弃
 *
 * 被丢弃的路径会写入 dropped，供调用方统一告警。
 */
function pruneConfigValue(value: unknown, path: string, dropped: string[]): unknown {
  if (isConfigPrimitive(value) || isConfigEmpty(value)) return value

  if (Array.isArray(value)) {
    const items: unknown[] = []
    for (let i = 0; i < value.length; i++) {
      const pruned = pruneConfigValue(value[i], `${path}[${i}]`, dropped)
      // 数组内出现脏值 → 整个数组不可信，直接丢弃该字段
      if (pruned === DROP) return DROP
      items.push(pruned)
    }
    return items
  }

  if (isPlainObject(value)) {
    const obj: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key
      const pruned = pruneConfigValue(child, childPath, dropped)
      if (pruned !== DROP) obj[key] = pruned
    }
    return obj
  }

  dropped.push(`${path || '(root)'} ← ${describeValue(value)}`)
  return DROP
}

/** 某个值（含其数组 / 对象结构）是否可以作为配置值 */
export function isConfigValue(value: unknown): boolean {
  const dropped: string[] = []
  const pruned = pruneConfigValue(value, '', dropped)
  return pruned !== DROP && dropped.length === 0
}

/**
 * 过滤配置补丁：丢弃含非原始值的字段，并输出告警日志。
 *
 * 与「整包校验不合格就全部拒绝」不同，这里逐字段剪枝：
 * `{ enabled: true, send: { enabled: event } }` 会保留 `enabled`、丢弃 `send.enabled`，
 * 避免一个脏值连带把同批次的合法改动一起拦掉。
 *
 * @param patch 待写入的配置补丁
 * @param scope 日志前缀，建议传组件名，便于定位调用方
 * @returns 清洗后的补丁；调用方应用 `Object.keys(clean).length === 0` 判断是否需要中止写入
 */
export function pickConfigPatch<T extends object>(patch: T, scope: string): Partial<T> {
  const clean: Record<string, unknown> = {}
  const dropped: string[] = []

  for (const [key, value] of Object.entries(patch)) {
    const pruned = pruneConfigValue(value, key, dropped)
    if (pruned !== DROP) clean[key] = pruned
  }

  if (dropped.length > 0) {
    console.warn(`[${scope}] 已丢弃非原始配置值，避免写坏配置:`, dropped.join(', '))
  }

  return clean as Partial<T>
}
