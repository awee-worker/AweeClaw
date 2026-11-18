/**
 * 插件配置的打开意图
 *
 * 场景里文生图、语音这类能力全靠已安装插件提供，但「装没装」和「配没配」
 * 是两件事：插件装着而服务商未选、Key 没填时，调用只会拿到一句失败，
 * 用户看到的是「生成失败」，不知道该去哪个页面改什么。
 *
 * 因此场景需要一个能落到「某个已安装插件的配置弹窗」的动作。插件配置属于
 * 插件中心的「已安装」页，场景不知道那个页签怎么切，也不该直接操作它的
 * 内部状态，所以这里只留一个意图：携带 pluginKey，由插件中心的两个入口
 * （全屏页 PluginCenterPage 与宽屏面板 PluginMarketView）消费后自己跳转。
 *
 * 与 pluginMarketIntent 的差别：那个是「按关键词搜索」，落到市场页签；
 * 这个是「按 pluginKey 打开配置」，落到已安装页签并弹配置框。两者都用
 * 一次性读取 + 订阅两条路径，兼顾「本次打开」与「已经挂载」。
 *
 * @module renderer/components/plugin/pluginSettingsIntent
 */

type SettingsListener = (pluginKey: string) => void

/** 尚未被消费的 pluginKey */
let pendingKey: string | null = null

/** 已挂载面板的订阅者 */
const listeners = new Set<SettingsListener>()

/** 设置打开意图；已挂载的面板会立刻收到通知 */
export function setPluginSettingsIntent(pluginKey: string): void {
  const normalized = String(pluginKey ?? '').trim()
  if (!normalized) return
  pendingKey = normalized
  for (const listener of listeners) {
    try {
      listener(normalized)
    } catch {
      // 单个订阅者异常不影响其他面板
    }
  }
}

/** 取走待处理的 pluginKey（一次性） */
export function consumePluginSettingsIntent(): string | null {
  const value = pendingKey
  pendingKey = null
  return value
}

/**
 * 查看待处理意图但不消费
 *
 * 给上层容器用：意图可能在容器挂载之前就设好了（抽屉正是先设意图再挂载），
 * 通知已经发过一遍，容器只能靠这个决定初始落在哪个页签。
 * 真正的消费留在「已安装」面板，它拿到 pluginKey 才弹得出配置框。
 */
export function peekPluginSettingsIntent(): string | null {
  return pendingKey
}

/** 订阅后续意图，返回取消函数 */
export function onPluginSettingsIntent(listener: SettingsListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * MCP serverId → pluginKey
 *
 * 插件注册 MCP 服务时 serverId 固定为 plugin:<pluginKey>（见 PluginHostApi），
 * 场景只拿得到 serverId，落到插件中心需要换回 pluginKey。带别的前缀或没有
 * 前缀时原样返回，交给调用方的兜底匹配。
 */
export function pluginKeyFromServerId(serverId: string): string {
  const value = String(serverId ?? '').trim()
  if (!value) return ''
  const marker = 'plugin:'
  return value.startsWith(marker) ? value.slice(marker.length) : value
}
