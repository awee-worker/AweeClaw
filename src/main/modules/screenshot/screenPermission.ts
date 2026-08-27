/**
 * 屏幕录制权限检查模块（macOS）
 *
 * 背景：macOS 的「屏幕录制」权限按**责任进程（responsible process）**归属判定。
 * - 通过终端（如 Trae / VS Code / Terminal）运行 `npm run dev` 时，Electron 进程的
 *   责任进程是终端应用本身 → 终端有权限就能截图（解释了"Trae 里能截、独立运行不能截"）。
 * - 独立启动打包后的 AweeClaw.app 时，责任进程是 AweeClaw 本体 → 若从未授权，
 *   desktopCapturer.getSources 返回空缩略图（黑图），表现为"截不了图"。
 *
 * 因此在截图前先检测权限，未授权时引导用户到系统设置开启，而不是静默黑屏。
 *
 * 非 macOS 平台（Windows / Linux）的 desktopCapturer 无需屏幕录制权限，直接视为 granted。
 */

import { systemPreferences, shell } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

export type ScreenPermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'

/** 权限错误码：渲染层据此弹出引导弹窗 */
export const SCREEN_PERMISSION_DENIED = 'SCREEN_PERMISSION_DENIED'

/**
 * 获取当前屏幕录制权限状态（仅 macOS 有效，其他平台返回 granted）
 */
export function getScreenPermissionStatus(): ScreenPermissionStatus {
  if (process.platform !== 'darwin') return 'granted'
  try {
    return systemPreferences.getMediaAccessStatus('screen') as ScreenPermissionStatus
  } catch (err) {
    logger.system.warn('[ScreenPermission] getMediaAccessStatus failed:', err)
    return 'unknown'
  }
}

/**
 * 是否已授予屏幕录制权限
 */
export function isScreenPermissionGranted(): boolean {
  return getScreenPermissionStatus() === 'granted'
}

/**
 * 打开 macOS「隐私与安全性 → 屏幕录制」系统设置页
 * 非 macOS 平台为 no-op
 */
export function openScreenPermissionSettings(): void {
  if (process.platform !== 'darwin') return
  void shell
    .openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    .catch((err) => {
      logger.system.error('[ScreenPermission] Failed to open system settings:', err)
    })
}

/**
 * 构造带权限状态信息的权限错误（供调用方区分普通错误与权限错误）
 */
export function createPermissionDeniedError(): Error & { screenPermission?: string } {
  const err = new Error(SCREEN_PERMISSION_DENIED) as Error & { screenPermission?: string }
  err.screenPermission = getScreenPermissionStatus()
  return err
}
