/**
 * 媒体设备权限 IPC（主进程）
 *
 * 为什么需要主进程介入：
 * - macOS 的麦克风授权由 TCC 管理，只有主进程的 systemPreferences 才能触发系统授权框；
 *   渲染进程直接 getUserMedia 拿到的只是失败结果，用户看不到任何可以「点允许」的界面。
 * - 用户一旦在系统层点过「不允许」，macOS 不会再次弹框，必须在「系统设置 → 隐私与安全性 →
 *   麦克风」里手动打开。渲染层无法完成这一步，只能跳转。
 *
 * 通道清单：
 * - media-permission:get-mic-status    查询麦克风授权状态（只读，不弹窗）
 * - media-permission:request-mic       请求麦克风授权（macOS 弹系统框）
 * - media-permission:open-mic-settings 打开系统麦克风隐私设置页
 *
 * 平台差异：
 * - macOS / Windows：getMediaAccessStatus 可用，状态可信
 * - Linux：Electron 不实现该 API，返回 unsupported，交由 Chromium 在 getUserMedia 时处理
 */
import { shell, systemPreferences } from 'electron'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'

/** 麦克风授权状态（与 Electron MediaAccessStatus 对齐，补充 unsupported） */
export type MicAccessStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'
  | 'unsupported'

export interface MicAccessResult {
  status: MicAccessStatus
  /** 当前是否可用（仅 granted 为 true；unsupported 交由渲染层自行尝试） */
  granted: boolean
  platform: NodeJS.Platform
}

/** 系统是否支持通过主进程查询媒体权限 */
function supportsMediaAccess(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32'
}

/** 读取麦克风授权状态（不触发任何系统弹窗） */
function readMicStatus(): MicAccessStatus {
  if (!supportsMediaAccess()) return 'unsupported'
  try {
    return systemPreferences.getMediaAccessStatus('microphone') as MicAccessStatus
  } catch (err) {
    logger.system.warn('[MediaPermission] getMediaAccessStatus failed:', err)
    return 'unknown'
  }
}

/**
 * 打开系统麦克风隐私设置页
 *
 * macOS 13+ 的隐私面板分为「隐私与安全性」与旧版「安全性与隐私」两种 URL 形式，
 * 旧 URL 在新系统上仍会被重定向，因此统一用旧式深链。
 */
async function openMicSettings(): Promise<{ opened: boolean; error?: string }> {
  try {
    if (process.platform === 'darwin') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      )
      return { opened: true }
    }
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy-microphone')
      return { opened: true }
    }
    // Linux 没有统一的隐私设置入口，交由桌面环境自行处理
    return { opened: false, error: '当前平台不支持自动跳转，请手动在系统设置中授权麦克风' }
  } catch (err) {
    logger.system.error('[MediaPermission] open mic settings failed:', err)
    return { opened: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerMediaPermissionIpc(): void {
  /** 查询当前麦克风授权状态 */
  safeIpcHandle('media-permission:get-mic-status', async () => {
    const status = readMicStatus()
    return {
      success: true,
      data: {
        status,
        // unsupported 表示本平台无从查询，渲染层继续走 getUserMedia 即可
        granted: status === 'granted' || status === 'unsupported',
        platform: process.platform,
      } satisfies MicAccessResult,
    }
  })

  /**
   * 请求麦克风授权
   *
   * 只有 not-determined（尚未决定）时系统才会弹框；已 denied 时调用它不会
   * 再弹任何界面，直接返回 false —— 调用方据此走「引导去系统设置」。
   */
  safeIpcHandle('media-permission:request-mic', async () => {
    if (!supportsMediaAccess()) {
      return {
        success: true,
        data: {
          status: 'unsupported',
          granted: true,
          platform: process.platform,
        } satisfies MicAccessResult,
      }
    }

    const before = readMicStatus()
    if (before === 'granted') {
      return {
        success: true,
        data: { status: before, granted: true, platform: process.platform } satisfies MicAccessResult,
      }
    }

    let granted = false
    try {
      granted = await systemPreferences.askForMediaAccess('microphone')
    } catch (err) {
      logger.system.error('[MediaPermission] askForMediaAccess failed:', err)
    }

    // 以系统实际状态为准：askForMediaAccess 在部分场景返回 true 但状态仍是 denied
    const after = readMicStatus()
    logger.system.info(`[MediaPermission] request mic: ${before} -> ${after} (granted=${granted})`)

    return {
      success: true,
      data: {
        status: after,
        granted: after === 'granted' || granted,
        platform: process.platform,
      } satisfies MicAccessResult,
    }
  })

  /** 跳转系统麦克风隐私设置 */
  safeIpcHandle('media-permission:open-mic-settings', async () => {
    const result = await openMicSettings()
    return { success: result.opened, data: result, error: result.error }
  })
}
