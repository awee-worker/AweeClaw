/**
 * 屏幕录制权限检查模块（macOS）
 *
 * 背景：macOS 的「屏幕录制」权限按**责任进程（responsible process）**归属判定。
 * - 通过终端（如 Trae / VS Code / Terminal）运行 `npm run dev` 时，Electron 进程的
 *   责任进程是终端应用本身 → 终端有权限就能截图（解释了"Trae 里能截、独立运行不能截"）。
 * - 独立启动打包后的 AweeClaw.app 时，责任进程是 AweeClaw 本体 → 若从未授权，
 *   desktopCapturer.getSources 返回空缩略图（黑图），表现为"截不了图"。
 *
 * 判定策略：系统状态（TCC）优先采信，但**不把它当作唯一依据**。
 * getMediaAccessStatus('screen') 在以下场景会与真实能力不一致：
 * 1. 用户在系统设置里刚开启权限，当前进程缓存的仍是旧值，未重启应用前一直返回 denied；
 * 2. 重新构建后签名指纹变化，系统把新包视为另一个应用，旧授权记录不再匹配，
 *    而系统设置列表里对应的授权项看起来是"已开启"的；
 * 3. 新版 macOS 改用系统级共享选择器后，TCC 状态可能与实际抓取能力脱节。
 * 因此当 TCC 报告未授权时，再做一次真实抓取探测，以抓取结果为准。
 *
 * 非 macOS 平台（Windows / Linux）的 desktopCapturer 无需屏幕录制权限，直接视为 granted。
 */

import { app, desktopCapturer, shell, systemPreferences } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

export type ScreenPermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'

/** 权限错误码：渲染层据此弹出引导弹窗 */
export const SCREEN_PERMISSION_DENIED = 'SCREEN_PERMISSION_DENIED'

/** 探测结果的短期缓存时长：避免连续点击重复抓取，同时保证授权后能很快生效 */
const PROBE_CACHE_TTL = 2000

/** 探测缩略图边长（像素）：只用来判断能否抓到画面，越小越快 */
const PROBE_THUMBNAIL_SIZE = 32

/** 判定"全黑"的通道阈值：未授权时抓到的画面三个通道都为 0 */
const BLACK_CHANNEL_THRESHOLD = 8

let probeCache: { granted: boolean; at: number } | null = null

/**
 * 获取当前屏幕录制权限状态（仅 macOS 有效，其他平台返回 granted）
 *
 * 注意：这是系统 TCC 的原始状态，可能与真实抓取能力不一致，
 * 需要最终判定时请用 resolveScreenPermission()。
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
 * 是否已授予屏幕录制权限（同步版，仅采信系统状态）
 */
export function isScreenPermissionGranted(): boolean {
  return getScreenPermissionStatus() === 'granted'
}

/**
 * 判断缩略图是否为全黑画面
 *
 * 未授予屏幕录制权限时 desktopCapturer 返回的画面是全黑（三通道均为 0）；
 * 正常桌面上必然存在菜单栏、Dock、窗口或壁纸等非黑像素。
 */
function isFullyBlack(image: Electron.NativeImage): boolean {
  try {
    const size = image.getSize()
    if (!size.width || !size.height) return true
    const bitmap = image.toBitmap() // BGRA 排列
    for (let i = 0; i < bitmap.length; i += 4) {
      if (
        bitmap[i] > BLACK_CHANNEL_THRESHOLD ||
        bitmap[i + 1] > BLACK_CHANNEL_THRESHOLD ||
        bitmap[i + 2] > BLACK_CHANNEL_THRESHOLD
      ) {
        return false
      }
    }
    return true
  } catch (err) {
    logger.system.warn('[ScreenPermission] Read thumbnail bitmap failed:', err)
    return false
  }
}

/**
 * 真实抓取探测：以一次小尺寸抓取的结果判断屏幕录制能力
 *
 * @param force 忽略短期缓存，强制重新抓取（权限引导弹窗的「重新检测」使用）
 */
export async function probeScreenCapture(force = false): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  if (!force && probeCache && Date.now() - probeCache.at < PROBE_CACHE_TTL) {
    return probeCache.granted
  }

  let granted = false
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: PROBE_THUMBNAIL_SIZE, height: PROBE_THUMBNAIL_SIZE },
    })
    const thumbnail = sources[0]?.thumbnail
    granted = Boolean(thumbnail) && !thumbnail!.isEmpty() && !isFullyBlack(thumbnail!)
  } catch (err) {
    logger.system.warn('[ScreenPermission] Probe capture failed:', err)
    granted = false
  }

  probeCache = { granted, at: Date.now() }
  return granted
}

/** 屏幕录制权限的最终判定结果 */
export interface ResolvedScreenPermission {
  /** 是否可用（能否真正抓到画面） */
  granted: boolean
  /** 系统 TCC 报告的原始状态（用于展示与日志） */
  status: ScreenPermissionStatus
  /** 判定依据：tcc=系统状态即已授权；probe=系统状态与实际抓取不一致，以抓取为准 */
  source: 'tcc' | 'probe'
}

/**
 * 解析屏幕录制权限的最终状态
 *
 * 系统状态为 granted 时直接通过；否则做一次真实抓取探测，
 * 抓取成功即视为已授权（覆盖 TCC 缓存与签名变更导致的误判）。
 *
 * @param context 日志上下文标识，便于定位是哪条链路发起的检查
 * @param force   忽略探测缓存，强制重新抓取
 */
export async function resolveScreenPermission(
  context?: string,
  force = false,
): Promise<ResolvedScreenPermission> {
  const status = getScreenPermissionStatus()
  if (status === 'granted') {
    return { granted: true, status, source: 'tcc' }
  }

  const granted = await probeScreenCapture(force)
  if (granted) {
    logger.system.info(
      `[ScreenPermission] TCC status "${status}" contradicts capture probe, treat as granted` +
        (context ? ` (${context})` : ''),
    )
  }
  return { granted, status, source: 'probe' }
}

/**
 * 打印应用身份信息，便于定位系统授权记录归属（打包态与开发态路径不同）
 */
export function logAppIdentity(context: string): void {
  if (process.platform !== 'darwin') return
  logger.system.warn(
    `[ScreenPermission] ${context} identity: packaged=${app.isPackaged}, ` +
      `name="${app.getName()}", exe=${process.execPath}`,
  )
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
 *
 * @param status 已判定过的权限状态，省略时现场读取系统状态
 */
export function createPermissionDeniedError(
  status?: ScreenPermissionStatus,
): Error & { screenPermission?: string } {
  const err = new Error(SCREEN_PERMISSION_DENIED) as Error & { screenPermission?: string }
  err.screenPermission = status ?? getScreenPermissionStatus()
  return err
}

