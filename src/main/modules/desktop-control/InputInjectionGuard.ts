/**
 * 输入注入闸门（Input Injection Guard）
 *
 * 解决的问题：macOS 的 CGEventPost 在没有「辅助功能」授权时不会报错，事件被系统
 * 静默丢弃。平台层因此返回 success:true，远程端看到的是「操作成功」但屏幕毫无变化，
 * 用户只会得出「点了没反应」的结论，且没有任何线索可以排查。
 *
 * 这里的职责有三个：
 * 1. 注入前确认系统真的允许注入，不允许就抛出可读原因，而不是照常调用
 * 2. 注入后回读指针位置，用客观事实判断事件是否被系统吞掉
 * 3. 首次被拦时不弹系统框，由调用方决定何时引导用户去授权
 *
 * @module desktop-control/InputInjectionGuard
 */

import { screen } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import {
  getAccessibilityPermissionService,
  type AccessibilityPermissionResult,
} from './AccessibilityPermission'

/** 注入被系统拒绝时抛出的错误码，供上层翻译成用户可读文案 */
export const INPUT_PERMISSION_DENIED = 'input_permission_denied'

/** 注入后指针未到达目标位置时抛出的错误码 */
export const INPUT_NOT_EFFECTIVE = 'input_not_effective'

/**
 * 指针落点校验允许的偏差（逻辑像素）
 *
 * 系统对指针位置有取整，事件处理也有亚像素误差；2px 足以覆盖这些正常抖动，
 * 又远小于任何一次有效移动，不会把成功误判成失败。
 */
const POINTER_TOLERANCE_PX = 2

/** 权限检查结果缓存时长：用户可能刚去系统设置里授权，不宜缓存太久 */
const PERMISSION_CACHE_TTL = 3000

export class InputInjectionGuard {
  private cached: { at: number; result: AccessibilityPermissionResult } | null = null

  /** 当前平台是否需要辅助功能授权才能注入 */
  get requiresSystemPermission(): boolean {
    return process.platform === 'darwin'
  }

  /**
   * 注入前的准入校验
   *
   * 非 macOS 平台直接放行：Windows 的 SendInput 与 Linux 的 XTest 都不需要
   * 单独的授权，注入失败会以真实错误返回。
   */
  async assertReady(): Promise<void> {
    if (!this.requiresSystemPermission) return

    const result = await this.checkPermission()
    if (result.status === 'granted' || result.status === 'not-required') return

    logger.desktop.warn(
      `[InputInjectionGuard] 辅助功能未授权，注入被拦下: status=${result.status}`,
    )
    const err = new Error(INPUT_PERMISSION_DENIED)
    err.name = 'InputPermissionDeniedError'
    throw err
  }

  /**
   * 查询辅助功能授权状态
   *
   * 短缓存而不是每次都问系统：一次远程拖拽会产生几十次注入，
   * 每次都过一遍 TCC 查询会把主进程拖慢。
   */
  async checkPermission(force = false): Promise<AccessibilityPermissionResult> {
    if (!force && this.cached && Date.now() - this.cached.at < PERMISSION_CACHE_TTL) {
      return this.cached.result
    }
    const result = await getAccessibilityPermissionService().check('accessibility', true)
    this.cached = { at: Date.now(), result }
    return result
  }

  /** 权限状态变化后调用，让下一次校验重新问系统 */
  invalidate(): void {
    this.cached = null
  }

  /**
   * 校验指针是否真的落到了目标位置
   *
   * 只在鼠标类操作后调用。事件被系统丢弃时指针停在原处，读回位置与目标点的
   * 差距会远超容差，据此可以判定注入未生效——这是唯一不依赖平台层自报成功的
   * 客观信号。
   *
   * @returns true 表示落点符合预期；非 macOS 平台无法可靠读取，直接返回 true
   */
  verifyPointerLanded(x: number, y: number): boolean {
    if (!this.requiresSystemPermission) return true

    let actual: { x: number; y: number }
    try {
      actual = screen.getCursorScreenPoint()
    } catch (err) {
      // 读不到位置不代表注入失败，不做判断以免误伤
      logger.desktop.warn('[InputInjectionGuard] 读取指针位置失败，跳过落点校验:', err)
      return true
    }

    const dx = Math.abs(actual.x - x)
    const dy = Math.abs(actual.y - y)
    const landed = dx <= POINTER_TOLERANCE_PX && dy <= POINTER_TOLERANCE_PX

    if (!landed) {
      logger.desktop.warn(
        `[InputInjectionGuard] 指针未落到目标点: 期望(${x},${y}) 实际(${actual.x},${actual.y})`,
      )
    }
    return landed
  }

  /**
   * 等事件落地后校验指针落点
   *
   * CGEventPost 与指针桥都是把事件异步投递到窗口服务器，调用返回时指针往往还没动。
   * 立刻回读必然读到旧位置，于是「已经点中了」被误判成「操作没生效」。
   * 这里按短间隔重读若干次，任一次命中容差即认为落地；全部落空才判否。
   *
   * @returns true 表示指针最终落在目标点（或在读不到位置的平台上放行）
   */
  async verifyPointerLandedEventually(
    x: number,
    y: number,
    retries = 4,
    intervalMs = 40,
  ): Promise<boolean> {
    if (!this.requiresSystemPermission) return true
    for (let i = 0; i < retries; i += 1) {
      if (this.verifyPointerLanded(x, y)) return true
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    return false
  }

  /** 指针落点不符时构造统一错误 */
  static notEffectiveError(x: number, y: number): Error {
    const err = new Error(`${INPUT_NOT_EFFECTIVE}:(${x},${y})`)
    err.name = 'InputNotEffectiveError'
    return err
  }
}

let guard: InputInjectionGuard | null = null

export function getInputInjectionGuard(): InputInjectionGuard {
  if (!guard) guard = new InputInjectionGuard()
  return guard
}
