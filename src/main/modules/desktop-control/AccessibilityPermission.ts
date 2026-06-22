/**
 * 辅助功能权限引导（Accessibility Permission Guide）
 *
 * 职责：
 * - 检测当前平台是否需要辅助功能权限（macOS 需要，Windows/Linux 不需要）
 * - 检测权限是否已授予
 * - 提供打开系统偏好设置的能力
 * - 缓存检测结果，避免频繁调用
 *
 * 平台差异：
 * - macOS：模拟输入（鼠标/键盘）需要"辅助功能"权限
 *          截图需要"屏幕录制"权限（macOS 10.15+）
 * - Windows：通常无需额外权限（UAC 提权场景除外）
 * - Linux：通常无需额外权限（X11 下需 xhost 授权，Wayland 支持有限）
 *
 * @module desktop-control/AccessibilityPermission
 */

import { shell, systemPreferences } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/** 权限类型 */
export type AccessibilityPermissionType =
  | 'accessibility' // 辅助功能（鼠标键盘模拟）
  | 'screenCapture' // 屏幕录制（截图）

/** 权限状态 */
export type AccessibilityPermissionStatus =
  | 'granted' // 已授权
  | 'denied' // 已拒绝
  | 'not-determined' // 未询问
  | 'restricted' // 受限（如家长控制）
  | 'not-required' // 当前平台无需此权限

/** 权限检测结果 */
export interface AccessibilityPermissionResult {
  /** 权限类型 */
  type: AccessibilityPermissionType
  /** 当前状态 */
  status: AccessibilityPermissionStatus
  /** 是否需要引导用户授权 */
  needsGuide: boolean
  /** 检测时间戳 */
  checkedAt: number
  /** 平台 */
  platform: NodeJS.Platform
}

/** 系统偏好设置目标 URL */
const SYSTEM_PREFERENCES_URL: Record<AccessibilityPermissionType, string> = {
  accessibility:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenCapture:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
}

/** 权限缓存 TTL（5 秒，平衡实时性与性能） */
const CACHE_TTL = 5_000

/**
 * 辅助功能权限引导服务
 */
export class AccessibilityPermissionService {
  private cache = new Map<AccessibilityPermissionType, AccessibilityPermissionResult>()

  /**
   * 检测指定权限的当前状态
   *
   * macOS 实现：
   * - accessibility: systemPreferences.isTrustedAccessibilityClient(false)
   * - screenCapture: systemPreferences.getMediaAccessStatus('screen')
   *
   * 其他平台直接返回 'not-required'
   */
  async check(
    type: AccessibilityPermissionType = 'accessibility',
    forceRefresh = false,
  ): Promise<AccessibilityPermissionResult> {
    // 缓存检查
    if (!forceRefresh && this.isCacheValid(type)) {
      return this.cache.get(type)!
    }

    const platform = process.platform
    let status: AccessibilityPermissionStatus

    if (platform === 'darwin') {
      status = await this.checkOnDarwin(type)
    } else {
      // Windows / Linux 通常无需辅助功能权限
      status = 'not-required'
    }

    const result: AccessibilityPermissionResult = {
      type,
      status,
      needsGuide: status === 'denied' || status === 'not-determined',
      checkedAt: Date.now(),
      platform,
    }

    this.cache.set(type, result)

    logger.desktop.info(
      `[AccessibilityPermission] ${type} status on ${platform}: ${status}`,
    )

    return result
  }

  /**
   * 检测所有相关权限（macOS 下同时检测 accessibility 和 screenCapture）
   */
  async checkAll(forceRefresh = false): Promise<AccessibilityPermissionResult[]> {
    if (process.platform === 'darwin') {
      const [accessibility, screenCapture] = await Promise.all([
        this.check('accessibility', forceRefresh),
        this.check('screenCapture', forceRefresh),
      ])
      return [accessibility, screenCapture]
    }
    return [await this.check('accessibility', forceRefresh)]
  }

  /**
   * 打开系统偏好设置对应面板
   * 仅 macOS 有效
   */
  async openSystemPreferences(type: AccessibilityPermissionType = 'accessibility'): Promise<boolean> {
    if (process.platform !== 'darwin') {
      logger.desktop.info('[AccessibilityPermission] Not on macOS, skip opening preferences')
      return false
    }

    const url = SYSTEM_PREFERENCES_URL[type]
    try {
      await shell.openExternal(url)
      logger.desktop.info(`[AccessibilityPermission] Opened system preferences for ${type}`)
      return true
    } catch (err) {
      logger.desktop.error(`[AccessibilityPermission] Failed to open preferences:`, err)
      return false
    }
  }

  /**
   * 请求权限（仅 macOS，会触发系统弹窗）
   *
   * 注意：
   * - accessibility 权限可通过 prompt 触发系统弹窗
   * - screenCapture 权限无法主动请求，只能引导用户去设置面板
   */
  async requestPermission(type: AccessibilityPermissionType = 'accessibility'): Promise<AccessibilityPermissionResult> {
    if (process.platform !== 'darwin') {
      return this.check(type, true)
    }

    if (type === 'accessibility') {
      // 触发系统弹窗（参数 true 表示弹窗询问）
      systemPreferences.isTrustedAccessibilityClient(true)
      // 等待用户操作后重新检测
      await this.delay(1000)
    }

    // 重新检测（强制刷新缓存）
    return this.check(type, true)
  }

  /**
   * 监听权限变化（macOS 专用）
   * 当用户在系统设置中切换权限时触发回调
   *
   * @returns 取消监听函数
   */
  onPermissionChange(callback: (type: AccessibilityPermissionType, status: AccessibilityPermissionStatus) => void): () => void {
    if (process.platform !== 'darwin') {
      return () => {}
    }

    // macOS 提供了订阅 API
    const accessibilityListener = (_event: string, _userInfo: Record<string, unknown>, _object: string) => {
      this.check('accessibility', true).then((r) => callback('accessibility', r.status))
    }

    const screenListener = (_event: string, _userInfo: Record<string, unknown>, _object: string) => {
      this.check('screenCapture', true).then((r) => callback('screenCapture', r.status))
    }

    try {
      systemPreferences.subscribeNotification(
        'com.apple.accessibility.api',
        accessibilityListener,
      )
      systemPreferences.subscribeNotification(
        'com.apple.screencapture.api',
        screenListener,
      )
    } catch (err) {
      logger.desktop.warn('[AccessibilityPermission] Failed to subscribe notifications:', err)
    }

    return () => {
      // Electron 未提供 unsubscribe，依赖进程生命周期
      // 实际项目中可维护监听器集合
    }
  }

  // ============ 私有方法 ============

  private isCacheValid(type: AccessibilityPermissionType): boolean {
    const cached = this.cache.get(type)
    if (!cached) return false
    return Date.now() - cached.checkedAt < CACHE_TTL
  }

  private async checkOnDarwin(type: AccessibilityPermissionType): Promise<AccessibilityPermissionStatus> {
    try {
      if (type === 'accessibility') {
        // isTrustedAccessibilityClient(false) 仅查询不弹窗
        const trusted = systemPreferences.isTrustedAccessibilityClient(false)
        return trusted ? 'granted' : 'not-determined'
      }

      if (type === 'screenCapture') {
        const status = systemPreferences.getMediaAccessStatus('screen')
        // 'not-determined' | 'granted' | 'denied' | 'restricted'
        return status as AccessibilityPermissionStatus
      }
    } catch (err) {
      logger.desktop.error('[AccessibilityPermission] Check failed on darwin:', err)
      return 'not-determined'
    }

    return 'not-required'
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/** 单例 */
let service: AccessibilityPermissionService | null = null

export function getAccessibilityPermissionService(): AccessibilityPermissionService {
  if (!service) {
    service = new AccessibilityPermissionService()
  }
  return service
}
