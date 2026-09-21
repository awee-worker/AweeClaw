/**
 * 上下文来源信任标签
 *
 * 定位：为「内容进入 LLM 上下文」这条链路建立信任分级。
 *
 * 与 main/guard 下的防护是互补关系，不是替代：
 *   - guard 层管系统资源（路径越界、命令注入、外链），防的是「动作」被滥用
 *   - 本层管内容本身，防的是外部内容被当作指令执行
 *
 * 为什么走「来源分级 + 数据边界」而不是内容过滤：
 * 注入载荷已能绕过基于文本特征的防线（非自然语言的符号序列、图形化载荷即可绕过），
 * 任何依赖内容语义的判别都会被绕开；而「内容来自哪里」是结构化事实，不依赖语义判断。
 */

/** 来源信任级别 */
export type TrustLevel =
  /** 系统提示、用户直输指令、已签名场景配置 */
  | 'instruction'
  /** 工作区内文件、本地知识库、本地执行结果 */
  | 'trusted'
  /** 网页抓取、外部服务返回、渠道消息、外部智能体产出 */
  | 'untrusted'

/** 内容产出通道 */
export type TrustChannel =
  | 'local_fs'
  | 'local_compute'
  | 'web'
  | 'external_service'
  | 'channel_message'
  | 'agent'

/** 工具结果的来源信息 */
export interface ToolOrigin {
  toolName: string
  channel: TrustChannel
  trust: TrustLevel
  /** 来源定位：URL / 文件路径 / 服务名 / 智能体名 */
  locator?: string
}

/** 不可信来源摘要（供确认卡片与审计记录展示） */
export interface UntrustedSourceSummary {
  toolName: string
  channel: TrustChannel
  locator?: string
}

/** 本轮上下文中的不可信内容信号 */
export interface UntrustedContextSignal {
  present: boolean
  sources: UntrustedSourceSummary[]
}

/** 无不可信内容的空信号（可直接复用，无需每次构造） */
export const EMPTY_UNTRUSTED_SIGNAL: UntrustedContextSignal = { present: false, sources: [] }

/** 外部内容在上下文中的包裹标签名 */
export const UNTRUSTED_CONTENT_TAG = 'external_content'

/** 通道展示名 */
export const TRUST_CHANNEL_LABELS: Record<TrustChannel, string> = {
  local_fs: '本地文件',
  local_compute: '本地执行',
  web: '网页抓取',
  external_service: '外部服务',
  channel_message: '渠道消息',
  agent: '外部智能体',
}

/** 信任级别展示名 */
export const TRUST_LEVEL_LABELS: Record<TrustLevel, string> = {
  instruction: '指令',
  trusted: '可信',
  untrusted: '不可信',
}

/** 判断来源是否为不可信 */
export function isUntrustedOrigin(origin?: ToolOrigin | null): boolean {
  return origin?.trust === 'untrusted'
}
