/**
 * 插件市场的打开意图
 *
 * 场景要引导用户去装某个插件（例如视频工坊缺文生视频插件），打开市场的同一次
 * 操作里还要把搜索词带过去 —— 否则用户面对上百个条目，还得自己回忆插件叫什么。
 *
 * 面板可能已经挂载（用户先前打开过市场），所以不能只留一个「下次挂载时读取」
 * 的变量：这里同时提供一次性读取与订阅两条路径，挂载中和已挂载都能接住。
 *
 * @module renderer/components/plugin/pluginMarketIntent
 */

type QueryListener = (query: string) => void

/** 尚未被消费的查询词 */
let pendingQuery: string | null = null

/** 已挂载面板的订阅者 */
const listeners = new Set<QueryListener>()

/** 设置打开意图；已挂载的面板会立刻收到通知 */
export function setPluginMarketQuery(query: string): void {
  const normalized = String(query ?? '').trim()
  if (!normalized) return
  pendingQuery = normalized
  for (const listener of listeners) {
    try {
      listener(normalized)
    } catch {
      // 单个订阅者异常不影响其他面板
    }
  }
}

/** 取走待处理的查询词（一次性） */
export function consumePluginMarketQuery(): string | null {
  const value = pendingQuery
  pendingQuery = null
  return value
}

/** 订阅后续意图，返回取消函数 */
export function onPluginMarketQuery(listener: QueryListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
