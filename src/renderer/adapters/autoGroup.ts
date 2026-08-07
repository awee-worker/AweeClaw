/**
 * IPC API 自动分组工具（类型安全）
 *
 * 将扁平的 preload API（如 `debugCreateSession`、`updaterCheck`）
 * 按前缀自动分组为嵌套结构（如 `api.debug.createSession`、`api.updater.check`），
 * 消除 electronBridge.ts 中大量手动包装样板代码。
 *
 * 命名约定：
 *   扁平方法 `prefixMethodName` → 分组 `prefix.methodName`
 *   前缀全小写，方法名首字母大写，转换后方法名首字母小写
 *   例：`debugCreateSession` → `debug.createSession`
 *       `updaterCheck`       → `updater.check`
 *       `onUpdaterStatus`    → `updater.onStatus`
 *
 * 类型安全：通过模板字面量类型（Template Literal Types）在编译期
 * 精确推导分组后的方法签名，保留原始参数和返回值类型。
 *
 * 对于不符合约定或需要自定义逻辑的方法，可通过 custom 参数补充。
 */

/** 通用函数类型 */
type AnyFn = (...args: any[]) => any

/** 通用 API 对象类型（宽松约束，兼容 ElectronAPI 等接口类型） */
type AnyApi = Record<string, any>

/* ================================================================== */
/* 类型推导：从扁平接口中按前缀提取方法签名                            */
/* ================================================================== */

/**
 * 判断字符串首字母是否大写（用于区分前缀边界，避免巧合匹配）
 *
 * 非字母字符（如 `_`、数字）虽能通过 `Uppercase` 自反性，
 * 但实际 API 命名中不会出现 `prefix_xxx` 形式，故无需额外过滤。
 */
type StartsUpper<S extends string> = S extends `${infer First}${string}`
  ? First extends Uppercase<First>
    ? true
    : false
  : false

/**
 * 从 T 中提取 `prefixXxx` 方法，去掉前缀并首字母小写
 *
 * @example
 * ```ts
 * type R = PrefixedMethods<{ pythonGetStatus: () => Promise<S>, pythonReinstall: () => Promise<void> }, 'python'>
 * // → { getStatus: () => Promise<S>, reinstall: () => Promise<void> }
 * ```
 */
type PrefixedMethods<T, P extends string> = {
  [K in keyof T as K extends `${P}${infer Rest}`
    ? StartsUpper<Rest> extends true
      ? Uncapitalize<Rest>
      : never
    : never]: T[K]
}

/**
 * 从 T 中提取 `on{Prefix}Xxx` 事件，转为 `onXxx`
 *
 * @example
 * ```ts
 * type R = PrefixedEvents<{ onUpdaterStatus: (cb: Fn) => Fn }, 'updater'>
 * // → { onStatus: (cb: Fn) => Fn }
 * ```
 */
type PrefixedEvents<T, P extends string> = {
  [K in keyof T as K extends `on${Capitalize<P>}${infer Rest}`
    ? StartsUpper<Rest> extends true
      ? `on${Rest}`
      : never
    : never]: T[K]
}

/**
 * 自动分组的完整返回类型：方法 + 事件 + 自定义覆盖
 *
 * 三者交叉（intersection），自定义方法优先级最高（同名覆盖）。
 */
type AutoGrouped<T extends AnyApi, P extends string, C> =
  PrefixedMethods<T, P> & PrefixedEvents<T, P> & (C extends undefined ? {} : C)

/* ================================================================== */
/* 运行时实现                                                          */
/* ================================================================== */

/**
 * 从扁平 API 对象中按前缀提取并分组方法
 *
 * @param raw    扁平 API 对象（如 window.electronAPI）
 * @param prefix 方法前缀（如 'debug'、'updater'）
 * @returns 分组后的方法对象，方法名首字母小写
 *
 * @example
 * ```ts
 * // raw = { debugCreateSession: fn, debugLaunch: fn, updaterCheck: fn }
 * groupMethods(raw, 'debug')
 * // → { createSession: (...args) => raw.debugCreateSession(...args),
 * //     launch: (...args) => raw.debugLaunch(...args) }
 * ```
 */
export function groupMethods<T extends AnyApi>(
  raw: T,
  prefix: string,
): Record<string, AnyFn> {
  const result: Record<string, AnyFn> = {}

  for (const key of Object.keys(raw)) {
    // 匹配前缀 + 大写字母开头的方法名（如 debugCreateSession、updaterCheck）
    if (!key.startsWith(prefix)) continue
    if (key.length <= prefix.length) continue

    const rest = key.slice(prefix.length)
    // 方法名首字符必须是大写字母（确保是前缀边界，而非巧合匹配）
    if (!/^[A-Z]/.test(rest)) continue

    // 首字母小写：CreateSession → createSession
    const methodName = rest[0].toLowerCase() + rest.slice(1)
    const fn = raw[key]
    if (typeof fn === 'function') {
      result[methodName] = (...args: any[]) => fn(...args)
    }
  }

  return result
}

/**
 * 从扁平 API 对象中按 `on{Prefix}Xxx` 模式提取事件监听方法
 *
 * 约定：`onUpdaterStatus` → `updater` 组下的 `onStatus`
 *
 * @param raw    扁平 API 对象
 * @param Prefix 方法前缀（首字母大写，如 'Updater'、'Debug'）
 * @returns 事件监听方法对象，方法名以 `on` 开头
 */
export function groupEvents<T extends AnyApi>(
  raw: T,
  Prefix: string,
): Record<string, AnyFn> {
  const result: Record<string, AnyFn> = {}
  const pattern = `on${Prefix}`

  for (const key of Object.keys(raw)) {
    if (!key.startsWith(pattern)) continue
    if (key.length <= pattern.length) continue

    const rest = key.slice(pattern.length)
    if (!/^[A-Z]/.test(rest)) continue

    // onUpdaterStatus → onStatus
    const eventName = `on${rest}`
    const fn = raw[key]
    if (typeof fn === 'function') {
      result[eventName] = (...args: any[]) => fn(...args)
    }
  }

  return result
}

/**
 * 创建完整的 API 分组（自动方法 + 自动事件 + 自定义覆盖）
 *
 * 合并三种来源：
 * 1. groupMethods — 匹配 `prefixXxx` 的常规方法
 * 2. groupEvents  — 匹配 `onPrefixXxx` 的事件监听
 * 3. custom       — 手动定义的特殊方法（优先级最高，覆盖同名自动分组方法）
 *
 * @param raw    扁平 API 对象
 * @param prefix 方法前缀（小写，如 'updater'、'debug'）
 * @param custom 自定义方法（覆盖同名自动分组方法）
 * @returns 类型安全的分组对象，保留原始方法签名
 *
 * @example
 * ```ts
 * // 自动分组 updaterCheck → check, updaterDownload → download
 * // 自动分组 onUpdaterStatus → onStatus
 * // 自定义 customAction
 * updater: createGroup(raw, 'updater', {
 *   customAction: () => { ... }
 * })
 * ```
 */
export function createGroup<
  T extends AnyApi,
  P extends string,
  C extends Record<string, AnyFn> | undefined = undefined,
>(
  raw: T,
  prefix: P,
  custom?: C,
): AutoGrouped<T, P, C> {
  const methods = groupMethods(raw, prefix)
  const Prefix = prefix[0].toUpperCase() + prefix.slice(1)
  const events = groupEvents(raw, Prefix)

  return {
    ...methods,
    ...events,
    ...custom,
  } as AutoGrouped<T, P, C>
}
