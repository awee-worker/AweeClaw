/**
 * IPC 调用辅助函数
 *
 * 封装 ipcRenderer 的三种调用模式，消除 preload 实现中的样板代码：
 * - invoke: 双向调用（主进程返回结果）
 * - send:   单向发送（不等待结果）
 * - on:     事件订阅（返回取消订阅函数）
 *
 * 使用工厂函数让每个 API 方法的实现从「写 5 行 handler 模板」
 * 简化为「调用一个 helper」。
 */
import { ipcRenderer, IpcRendererEvent } from 'electron'

// =================== invoke / send ===================

/**
 * 创建一个调用 `ipcRenderer.invoke(channel, ...args)` 的函数。
 *
 * @example
 * const readFile = invoke<string>('file:read')
 * // 等价于 (path: string) => ipcRenderer.invoke('file:read', path)
 */
export function invoke<R = unknown>(channel: string): (...args: unknown[]) => Promise<R> {
  return (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
}

/**
 * 创建一个调用 `ipcRenderer.send(channel, ...args)` 的函数（单向，不等待结果）。
 *
 * @example
 * const minimize = send('window:minimize')
 * // 等价于 () => ipcRenderer.send('window:minimize')
 */
export function send(channel: string): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    ipcRenderer.send(channel, ...args)
  }
}

// =================== 事件订阅 ===================

/**
 * 订阅指定频道的 IPC 事件（单参数载荷）。
 * 返回取消订阅函数，符合 preload API 的统一约定。
 *
 * @example
 * const onSettingsChanged = on<{ key: string; value: unknown }>('settings:changed')
 * // 使用：const off = onSettingsChanged((event) => { ... }); off()
 */
export function on<P = unknown>(channel: string): (callback: (payload: P) => void) => () => void {
  return (callback: (payload: P) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: P) => callback(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * 订阅指定频道的 IPC 事件（多参数载荷）。
 *
 * 某些主进程事件以多参数形式推送（如 search:results 传递 searchId + results），
 * 此 helper 保留原始多参数签名。
 *
 * @example
 * const onSearchResults = onArgs<[string, SearchFileResult[]]>('search:results')
 * // 使用：const off = onSearchResults((searchId, results) => { ... }); off()
 */
export function onArgs<A extends unknown[] = unknown[]>(
  channel: string,
): (callback: (...args: A) => void) => () => void {
  return (callback: (...args: A) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, ...args: A) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * 订阅无参数的 IPC 事件。
 *
 * @example
 * const onSystemResume = onVoid('system:resume')
 */
export function onVoid(channel: string): (callback: () => void) => () => void {
  return (callback: () => void): (() => void) => {
    const handler = () => callback()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

// =================== 动态频道订阅 ===================

/**
 * 创建基于动态频道前缀的订阅工厂。
 *
 * 用于 LLM 流式响应等需要按 requestId 隔离频道的场景。
 *
 * @param channelPrefix 频道前缀，如 `llm:stream:`
 * @returns 接收 id 和 callback 的订阅函数
 *
 * @example
 * const onLLMStream = dynamicChannel<LLMStreamChunk>('llm:stream:')
 * // 使用：const off = onLLMStream(requestId, (chunk) => { ... }); off()
 */
export function dynamicChannel<P = unknown>(
  channelPrefix: string,
): (id: string, callback: (payload: P) => void) => () => void {
  return (id: string, callback: (payload: P) => void): (() => void) => {
    const channel = `${channelPrefix}${id}`
    const handler = (_event: IpcRendererEvent, payload: P) => callback(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}
