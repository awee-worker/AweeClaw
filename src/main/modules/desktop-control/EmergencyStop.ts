/**
 * 紧急停止机制（Emergency Stop）
 *
 * 职责：
 * - 维护全局停止状态标志，触发后所有桌面控制操作立即拒绝执行
 * - 提供 AbortController，长时操作（如鼠标拖拽、文本输入）可监听中断信号
 * - 记录停止事件审计日志，包含触发原因与时间
 * - 支持手动复位（仅在确认环境安全后由用户主动操作）
 *
 * 设计原则：
 * - 单例模式，全局唯一停止控制器
 * - 状态变更通过 EventEmitter 通知订阅者（IPC 层、UI 层、Agent 层）
 * - 一旦触发，必须显式 reset() 才能恢复，避免自动恢复带来的风险
 *
 * @module desktop-control/EmergencyStop
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'

/** 紧急停止事件名 */
export const EMERGENCY_STOP_EVENT = 'emergency-stop:triggered' as const
export const EMERGENCY_RESET_EVENT = 'emergency-stop:reset' as const

/** 停止触发来源 */
export type EmergencyStopSource =
  | 'user' // 用户手动触发（UI 按钮 / 快捷键）
  | 'system' // 系统事件（窗口失焦、休眠等）
  | 'agent' // Agent 自主触发（检测到异常）
  | 'timeout' // 操作超时自动触发
  | 'external' // 外部 IPC 调用

/** 停止状态记录 */
export interface EmergencyStopState {
  /** 是否处于停止状态 */
  readonly stopped: boolean
  /** 触发时间戳（毫秒） */
  readonly triggeredAt: number | null
  /** 触发来源 */
  readonly source: EmergencyStopSource | null
  /** 触发原因 */
  readonly reason: string | null
  /** 累计触发次数 */
  readonly triggerCount: number
}

/** 触发参数 */
export interface EmergencyStopParams {
  source: EmergencyStopSource
  reason?: string
}

/**
 * 紧急停止控制器
 *
 * 使用方式：
 * ```ts
 * const stop = getEmergencyStopController()
 *
 * // 在操作前检查
 * stop.check() // 若已停止，抛出 EmergencyStopError
 *
 * // 在长时操作中监听中断
 * const signal = stop.createSignal()
 * await someLongTask({ signal })
 *
 * // 触发停止
 * stop.trigger({ source: 'user', reason: 'User pressed ESC' })
 *
 * // 复位（需用户确认）
 * stop.reset()
 * ```
 */
export class EmergencyStopController extends EventEmitter {
  private stopped = false
  private triggeredAt: number | null = null
  private source: EmergencyStopSource | null = null
  private reason: string | null = null
  private triggerCount = 0
  private currentAbortController: AbortController | null = null

  /** 获取当前状态快照 */
  getState(): EmergencyStopState {
    return {
      stopped: this.stopped,
      triggeredAt: this.triggeredAt,
      source: this.source,
      reason: this.reason,
      triggerCount: this.triggerCount,
    }
  }

  /** 是否处于停止状态 */
  isStopped(): boolean {
    return this.stopped
  }

  /**
   * 检查是否可执行操作
   * 若处于停止状态，抛出 EmergencyStopError
   */
  check(): void {
    if (this.stopped) {
      const err = new EmergencyStopError(
        `Emergency stop is active (triggered by ${this.source || 'unknown'}: ${this.reason || 'no reason'})`,
      )
      throw err
    }
  }

  /**
   * 创建中断信号
   * 触发停止时，关联的 AbortController 会被 abort
   * 操作完成后应调用 signal 清理（通过 createSignal 返回的 cleanup）
   */
  createSignal(): AbortSignal {
    const controller = new AbortController()
    this.currentAbortController = controller

    // 若已处于停止状态，立即中断
    if (this.stopped) {
      controller.abort()
    }

    return controller.signal
  }

  /**
   * 触发紧急停止
   * - 设置停止标志
   * - 中断当前 AbortController
   * - 发送事件通知
   * - 记录审计日志
   */
  trigger(params: EmergencyStopParams): void {
    const { source, reason } = params

    this.stopped = true
    this.triggeredAt = Date.now()
    this.source = source
    this.reason = reason || null
    this.triggerCount += 1

    // 中断当前正在执行的操作
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }

    // 记录审计日志
    logger.desktop.warn(
      `[EmergencyStop] Triggered by ${source}: ${reason || 'no reason provided'} (count=${this.triggerCount})`,
    )

    // 通知订阅者
    this.emit(EMERGENCY_STOP_EVENT, this.getState())
  }

  /**
   * 复位停止状态
   *
   * 安全要求：
   * - 仅在用户主动确认后调用
   * - 复位后清除所有状态
   * - 发送复位事件
   */
  reset(): void {
    if (!this.stopped) {
      return
    }

    logger.desktop.info('[EmergencyStop] Reset by user')

    this.stopped = false
    this.triggeredAt = null
    this.source = null
    this.reason = null
    this.currentAbortController = null

    this.emit(EMERGENCY_RESET_EVENT, this.getState())
  }

  /**
   * 订阅停止事件
   * @returns 取消订阅函数
   */
  onStop(listener: (state: EmergencyStopState) => void): () => void {
    this.on(EMERGENCY_STOP_EVENT, listener)
    return () => this.off(EMERGENCY_STOP_EVENT, listener)
  }

  /**
   * 订阅复位事件
   * @returns 取消订阅函数
   */
  onReset(listener: (state: EmergencyStopState) => void): () => void {
    this.on(EMERGENCY_RESET_EVENT, listener)
    return () => this.off(EMERGENCY_RESET_EVENT, listener)
  }
}

/**
 * 紧急停止错误
 * 用于在操作被拒绝时抛出，便于上层捕获区分
 */
export class EmergencyStopError extends Error {
  readonly code = 'EMERGENCY_STOP'
  readonly isEmergencyStop = true

  constructor(message: string) {
    super(message)
    this.name = 'EmergencyStopError'
  }
}

/** 单例 */
let controller: EmergencyStopController | null = null

export function getEmergencyStopController(): EmergencyStopController {
  if (!controller) {
    controller = new EmergencyStopController()
  }
  return controller
}
