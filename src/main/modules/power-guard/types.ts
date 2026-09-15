/**
 * 防休眠模块类型（主进程）
 *
 * 对外契约（配置 / 状态 / 通道名）统一放在 `@shared/protocols/powerGuardProtocol`，
 * 由主进程、preload、渲染层三方共用同一份定义，避免「配置项加了一侧忘了另一侧」。
 * 本文件只补充**主进程专有**的类型，并把共享类型转出去，让模块内部可以只 import 本文件。
 *
 * @module power-guard/types
 */

import type { PowerGuardMode, PowerGuardSource } from '@shared/protocols/powerGuardProtocol'

export type {
  PowerGuardMode,
  PowerGuardPlatformKind,
  PowerGuardSource,
  PowerGuardConfig,
  PowerGuardHolder,
  PowerGuardStatus,
  PowerGuardConfigPayload,
  PowerGuardIpcResponse,
} from '@shared/protocols/powerGuardProtocol'

export {
  POWER_GUARD_STATUS_CHANNEL,
  MANUAL_HOLD_REASON,
  AGENT_TASK_REASON,
} from '@shared/protocols/powerGuardProtocol'

/**
 * 残留守护进程的落盘记录（`<userData>/power-guard/guard.json`）。
 *
 * 这不是配置，而是**崩溃自恢复的现场记录**：正常退出会删除它，
 * 只有应用被强杀（SIGKILL / 断电）时才留下，下次启动据此定向清理，
 * 避免「AweeClaw 已经没了但系统还是睡不了」的僵尸状态。
 *
 * 仅在 systemd-inhibit（Linux）与 PowerShell（Windows）上真正需要 ——
 * macOS 的 `caffeinate -w <pid>` 在父进程消失时会自行退出。
 */
export interface PowerGuardStateFile {
  version: 1
  /** 写文件的 AweeClaw 主进程 pid（用于判断上个实例是否还活着） */
  ownerPid: number
  /** 平台守护子进程 pid（拿不到时为 0） */
  guardPid: number
  kind: PowerGuardSource
  mode: Exclude<PowerGuardMode, 'off'>
  startedAt: number
}

