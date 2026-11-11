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

import { exec } from 'node:child_process'
import { shell, systemPreferences } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { resolveScreenPermission } from '../screenshot/screenPermission'

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

/**
 * 隐私面板条目名称的 i18n key
 *
 * macOS 26 起「隐私与安全性」面板的所有条目由名词式改为「允许……」的描述式命名，
 * 旧版「辅助功能」「屏幕录制」在新系统中已不再作为条目标题出现，
 * 引导文案必须按系统大版本取对应名称，否则用户按提示在面板里找不到对应项。
 */
export type PrivacyPanelTitleKey =
  | 'desktop.permission.panelTitle.accessibility'
  | 'desktop.permission.panelTitle.accessibilityModern'
  | 'desktop.permission.panelTitle.screenCapture'
  | 'desktop.permission.panelTitle.screenCaptureModern'

/** 隐私面板条目改为描述式命名的起始 macOS 大版本 */
const PRIVACY_PANEL_RENAME_MAJOR = 26

/** 权限检测结果 */
export interface AccessibilityPermissionResult {
  /** 权限类型 */
  type: AccessibilityPermissionType
  /** 当前状态 */
  status: AccessibilityPermissionStatus
  /** 是否需要引导用户授权 */
  needsGuide: boolean
  /** 系统设置中该权限条目的名称 key，供渲染层按语言取文案 */
  panelTitleKey: PrivacyPanelTitleKey
  /** 检测时间戳 */
  checkedAt: number
  /** 平台 */
  platform: NodeJS.Platform
}

/**
 * 解析系统设置中该权限条目的名称 key
 *
 * - macOS 26 之前：辅助功能 / 屏幕录制
 * - macOS 26 及之后：允许辅助应用程序控制电脑 / 允许应用程序录制你的屏幕
 * - Windows / Linux：沿用旧版名称（无实际引导意义）
 */
function resolvePanelTitleKey(
  type: AccessibilityPermissionType,
  platform: NodeJS.Platform,
): PrivacyPanelTitleKey {
  const modern =
    platform === 'darwin' &&
    Number.parseInt(process.getSystemVersion().split('.')[0] ?? '0', 10) >= PRIVACY_PANEL_RENAME_MAJOR

  if (type === 'accessibility') {
    return modern
      ? 'desktop.permission.panelTitle.accessibilityModern'
      : 'desktop.permission.panelTitle.accessibility'
  }
  return modern
    ? 'desktop.permission.panelTitle.screenCaptureModern'
    : 'desktop.permission.panelTitle.screenCapture'
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
      panelTitleKey: resolvePanelTitleKey(type, platform),
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
   *
   * 使用 exec('open ...') 作为主要方式（比 shell.openExternal 更可靠，
   * 不受 Electron sandbox 限制），shell.openExternal 作为降级方案。
   */
  async openSystemPreferences(type: AccessibilityPermissionType = 'accessibility'): Promise<boolean> {
    if (process.platform !== 'darwin') {
      logger.desktop.info('[AccessibilityPermission] Not on macOS, skip opening preferences')
      return false
    }

    const url = SYSTEM_PREFERENCES_URL[type]

    return new Promise((resolve) => {
      // 方案1：使用 macOS 原生的 open 命令（最可靠）
      exec(`open "${url}"`, (err) => {
        if (err) {
          logger.desktop.warn(
            `[AccessibilityPermission] exec open failed: ${err.message}, fallback to shell.openExternal`,
          )
          // 方案2：降级到 shell.openExternal
          shell.openExternal(url)
            .then(() => {
              logger.desktop.info(`[AccessibilityPermission] Opened system preferences for ${type} via shell.openExternal`)
              resolve(true)
            })
            .catch((shellErr) => {
              logger.desktop.error(`[AccessibilityPermission] shell.openExternal also failed:`, shellErr)
              resolve(false)
            })
        } else {
          logger.desktop.info(`[AccessibilityPermission] Opened system preferences for ${type} via open command`)
          resolve(true)
        }
      })
    })
  }

  /**
   * 请求权限（仅 macOS）
   *
   * 两步都做，缺一不可：
   * 1. isTrustedAccessibilityClient(true) 让系统登记本应用并尝试弹窗。
   *    这是应用进入「隐私与安全性」列表的唯一途径——只打开面板不会登记，
   *    用户会在列表里找不到本应用，无从勾选。
   * 2. 仍未授权时直接打开对应面板。系统弹窗只在首次请求时出现，用户忽略或
   *    拒绝过后不再弹出，此时必须由应用主动把用户送到面板前。
   *
   * screenCapture 无法通过 API 主动请求，只走第 2 步。
   */
  async requestPermission(type: AccessibilityPermissionType = 'accessibility'): Promise<AccessibilityPermissionResult> {
    if (process.platform !== 'darwin') {
      return this.check(type, true)
    }

    if (type === 'accessibility') {
      // 让系统登记本应用（参数 true 表示同时请求弹窗）
      systemPreferences.isTrustedAccessibilityClient(true)
      // 等待用户操作后重新检测
      await this.delay(1000)
    }

    // 重新检测（强制刷新缓存）
    const result = await this.check(type, true)

    // 仍未授权：系统不会再次弹窗，直接把用户带到面板前
    if (result.status !== 'granted' && result.status !== 'not-required') {
      await this.openSystemPreferences(type)
    }

    return result
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
        // 与截图链路使用同一判定口径：TCC 状态可能与真实抓取能力不一致，
        // 以一次真实抓取探测的结果为准，避免"系统里已开启却仍被判定为未授权"
        const permission = await resolveScreenPermission('accessibility check')
        return (permission.granted ? 'granted' : permission.status) as AccessibilityPermissionStatus
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
