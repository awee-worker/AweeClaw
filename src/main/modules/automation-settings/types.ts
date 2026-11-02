/**
 * 本地自动化开关 — 类型定义
 *
 * 三个开关分层控制"事件触发 → 建任务 → 执行任务"这条链路，
 * 每一层都能单独关掉，默认全关。
 *
 * 为什么要分层而不是一个总开关：
 * - 关掉执行层才真正省 token（执行层是唯一会调模型的地方）
 * - 关掉建任务层只是不积累记录，不省 token
 * - 关掉事件源层省的是 watcher 与钩子订阅的常驻开销
 * 用一个总开关会把三种完全不同的代价绑在一起，用户想"只看不跑"时无从选择。
 *
 * @module automation-settings/types
 */

/** 本地自动化设置 */
export interface AutomationSettings {
  /**
   * 是否启动事件源监听（FileWatchSource / HookEventSource）
   *
   * 关掉时不注册任何事件源，触发器注册表也不会 start。
   * 省的是 watcher 与钩子订阅的常驻资源，不涉及模型调用。
   */
  triggersEnabled: boolean
  /**
   * 触发命中后是否自动建任务记录
   *
   * 关掉时命中只走日志，账本不增加条目。
   * 建任务是纯本地写入，不调模型，因此这一层不产生 token 开销。
   */
  autoCreateTask: boolean
  /**
   * 任务进入 queued 后是否自动交给 Agent 执行
   *
   * 这是唯一会产生 token 开销的开关，默认关闭。
   * 关掉时任务停在 queued，用户可在任务中心手动点「开始执行」——
   * 手动动作不受该开关约束。
   */
  autoExecuteTask: boolean
}

/** 默认值：三层全关，安装即零行为变化 */
export const DEFAULT_AUTOMATION_SETTINGS: Readonly<AutomationSettings> = Object.freeze({
  triggersEnabled: false,
  autoCreateTask: false,
  autoExecuteTask: false,
})

/** 设置持久化结构 */
export interface PersistedAutomationSettings {
  version: number
  settings: AutomationSettings
}

export const AUTOMATION_SETTINGS_SCHEMA_VERSION = 1

export const AUTOMATION_SETTINGS_LOG_PREFIX = '[AutomationSettings]'
