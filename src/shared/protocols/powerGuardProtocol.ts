/**
 * 防休眠能力契约（主进程 ↔ preload ↔ 渲染层共用）
 *
 * 语义来源：源项目 `py/sleep_guard.py`。本文件只描述「配置存什么」与
 * 「IPC 传什么」，不含任何平台实现（平台分支在 `main/modules/power-guard/PowerGuardPlatform.ts`）。
 *
 * 本文件被主进程与渲染进程共用，因此**不得**引入 electron / node 专属类型。
 *
 * @module shared/protocols/powerGuardProtocol
 */

/** 状态推送通道（主进程 emit / preload 订阅） */
export const POWER_GUARD_STATUS_CHANNEL = 'power-guard:status'

/** 手动保持唤醒的持有者标识（设置页开关驱动的来源） */
export const MANUAL_HOLD_REASON = 'manual'

/**
 * Agent 长任务的持有者标识（`IntelligenceCore.send` 的起止驱动的来源）。
 *
 * 单独抽出常量而不是到处写字面量：主进程要按它做「`autoTriggerAgentTask` 为 false 时
 * 该来源不计入生效集合」的判定，两侧字符串写歪就会出现「开关关了但依然防休眠」。
 */
export const AGENT_TASK_REASON = 'agent-task'

/**
 * 防休眠强度。
 *
 * - `off`    不阻止任何睡眠（保留自动触发规则，等于暂停）
 * - `idle`   阻止**系统空闲休眠**，允许显示器按系统设置关闭（省电，默认）
 * - `system` 阻止**系统休眠 + 显示器休眠**（演示 / 直播场景：屏幕必须常亮）
 *
 * ⚠️ Linux 下 `system` 无法阻止显示器关闭：systemd 的抑制剂分类里没有「显示器」，
 * 显示熄灭由桌面环境自己管。UI 必须如实说明，不能假装做到了。
 */
export type PowerGuardMode = 'off' | 'idle' | 'system'

/** 运行平台 */
export type PowerGuardPlatformKind = 'darwin' | 'linux' | 'win32' | 'unsupported'

/**
 * 实际生效的平台机制。
 *
 * `none` 表示当前没有断言在生效（未启动 / 启动失败 / 平台不支持）。
 */
export type PowerGuardSource = 'caffeinate' | 'systemd-inhibit' | 'powershell' | 'none'

/** 模块配置（落盘结构） */
export interface PowerGuardConfig {
  /**
   * 模块总开关。
   *
   * 默认 true —— P1「所有新增能力默认 enabled:false」的**唯一例外**：
   * 防休眠本身即为 Agent 长任务服务，默认关掉等于把能力藏起来。
   * 安全性由两道闸门保证：默认强度只阻止系统空闲休眠（不阻止显示器关闭），
   * 且只在真有持有者时才 spawn 进程（空闲时零副作用）。
   */
  enabled: boolean
  /** 防休眠强度 */
  mode: PowerGuardMode
  /** 是否在 Agent 长任务执行期间自动防休眠（关闭后只剩手动开关可用） */
  autoTriggerAgentTask: boolean
  /**
   * 任务短于该时长不触发防休眠（毫秒，0 表示立即触发）。
   *
   * 避免为一个 3 秒的任务 spawn 一个 `caffeinate` 子进程；
   * 同时避免任务列表里频繁出现「起了又停」的抖动。
   */
  minDurationMs: number
  /**
   * 手动保持唤醒（设置页开关直接驱动，跨重启持久化）。
   *
   * 与 `autoTriggerAgentTask` 是**两套独立来源**，互不覆盖：
   * 用户手动保持时即使没有任务在跑也生效；自动触发也不会把手动开关顶掉。
   */
  manualHold: boolean
}

/** 一个正在持有防休眠断言的来源 */
export interface PowerGuardHolder {
  /** 来源标识（`agent-task` / `manual` / 后续扩展的任意标识） */
  reason: string
  /** 该来源的持有计数 */
  count: number
  /** 首次持有时刻 */
  since: number
  /** 是否已跨过去抖窗口（达到 minDurationMs 后才真正计入生效集合） */
  effective: boolean
}

/** 模块运行状态（IPC 返回 / 事件推送） */
export interface PowerGuardStatus {
  enabled: boolean
  mode: PowerGuardMode
  platform: PowerGuardPlatformKind
  /** 当前平台是否有可用机制 */
  supported: boolean
  /** 是否已有断言在生效 */
  active: boolean
  /** 生效中的平台机制 */
  source: PowerGuardSource
  /** 生效中的强度（未生效时为 null） */
  activeMode: Exclude<PowerGuardMode, 'off'> | null
  /** 当前持有断言的来源列表 */
  holders: PowerGuardHolder[]
  /** 平台守护子进程 pid（无则 null） */
  guardPid: number | null
  /** 断言开始时刻 */
  startedAt: number | null
  /** 最近一次失败原因（无则空串），用于 UI 如实告知 */
  lastError: string
  /** 启动 / 释放次数（排障用） */
  startCount: number
  stopCount: number
}

/** get-config / update-config / reset-config 的返回体 */
export interface PowerGuardConfigPayload {
  config: PowerGuardConfig
  status: PowerGuardStatus
  /** 配置提示（不阻断保存，仅用于 UI 引导） */
  issues: string[]
}

/** 通用 IPC 响应包装（与 ipcGuard 的 IpcGuardResponse 对齐） */
export interface PowerGuardIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
