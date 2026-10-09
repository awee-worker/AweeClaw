/**
 * 主窗口截图模块
 *
 * 复用悬浮球的 ScreenshotAskManager 截图能力（透明覆盖窗口 + 框选 + 裁剪 + 落盘），
 * 但截图结果通过 mainWindow.webContents.send 推送给主窗口（而非头像窗口），
 * 主窗口 ConversationInput 监听后调用 addAttachment 将截图作为附件添加到输入框。
 *
 * 与悬浮球截图流程完全独立：
 * - 独立的 ScreenshotAskManager 实例（不共享 overlayWindow）
 * - 独立的 IPC 通道（screenshot:start-for-main-window / main-window:screenshot-result）
 * - 主窗口截图时无需隐藏/恢复窗口（主窗口本身就在前台，覆盖窗口直接覆盖其上）
 *
 * @module screenshot/mainWindowScreenshot
 */

import { BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import {
  ScreenshotAskManager,
  type ScreenshotResultPayload,
} from '../floating-avatar/ScreenshotAskManager'
import {
  getScreenPermissionStatus,
  isScreenPermissionGranted,
  openScreenPermissionSettings,
  SCREEN_PERMISSION_DENIED,
} from './screenPermission'

/** 工作区路径获取函数类型 */
type WorkspacePathGetter = () => string | null

/**
 * 注册主窗口截图 IPC handler
 *
 * @param getMainWindow 获取主窗口的函数
 * @param getWorkspacePath 获取当前工作区路径的函数（截图落盘用）
 */
export function registerMainWindowScreenshotHandlers(
  getMainWindow: (windowId?: number) => BrowserWindow | null,
  getWorkspacePath: WorkspacePathGetter,
): void {
  // 独立的 ScreenshotAskManager 实例，与悬浮球完全隔离
  const screenshotManager = new ScreenshotAskManager(getWorkspacePath)

  /**
   * 打开 macOS 屏幕录制权限系统设置页（渲染层权限引导弹窗的「打开系统设置」按钮调用）
   */
  safeIpcHandle('screenshot:open-permission-settings', async () => {
    openScreenPermissionSettings()
    return { success: true }
  })

  /**
   * 启动截图（主窗口→main）
   *
   * 渲染进程通过 api.screenshot.start(options) 调用，
   * 主进程启动全屏区域选择覆盖窗口 → 用户框选 → 截图 → 推送结果到主窗口
   *
   * 截图结果通过 'main-window:screenshot-result' 事件推送到主窗口 webContents，
   * ConversationInput 监听后调用 addAttachment 添加截图附件。
   *
   * options.hideWindow（输入框截图按钮长按触发）：截图流程期间隐藏主窗口，
   * 避免本应用窗口被截进画面；流程结束（完成/取消/异常）自动恢复显示。
   *
   * 权限前置检查：未授予 macOS 屏幕录制权限时，desktopCapturer 返回空图（黑屏），
   * 直接返回 SCREEN_PERMISSION_DENIED，由渲染层弹出引导弹窗（而非静默失败）。
   */
  safeIpcHandle('screenshot:start-for-main-window', async (event, options?: { hideWindow?: boolean }) => {
    const permission = getScreenPermissionStatus()
    if (!isScreenPermissionGranted()) {
      logger.system.warn(
        `[MainWindowScreenshot] Screen recording permission not granted (${permission}), guiding user`,
      )
      return { success: false, error: SCREEN_PERMISSION_DENIED, screenPermission: permission }
    }

    try {
      // 截图结果回调：推送到发起请求的主窗口
      const onScreenshotComplete = (payload: ScreenshotResultPayload) => {
        const targetWindow = getMainWindow(event.sender.id) ?? getMainWindow()
        if (!targetWindow || targetWindow.isDestroyed()) {
          logger.system.warn('[MainWindowScreenshot] Target window unavailable, dropping screenshot result')
          return
        }
        targetWindow.webContents.send('main-window:screenshot-result', payload)
      }

      // 长按截图：截到真实桌面而非本应用窗口。覆盖窗口显示前隐藏主窗口，
      // 流程结束由 ScreenshotAskManager 触发 'end' 恢复 —— 恢复发生在结果推送之前，
      // 保证渲染层 document.visibilityState 已回到 visible，附件注入不会丢失。
      const hideWindow = options?.hideWindow === true
      const onVisibilityChange = hideWindow
        ? (phase: 'start' | 'end'): void => {
            const targetWindow = getMainWindow(event.sender.id) ?? getMainWindow()
            if (!targetWindow || targetWindow.isDestroyed()) return
            if (phase === 'start') {
              targetWindow.hide()
            } else {
              targetWindow.show()
              targetWindow.focus()
            }
          }
        : undefined

      await screenshotManager.start(onScreenshotComplete, onVisibilityChange)
      return { success: true }
    } catch (err) {
      logger.system.error('[MainWindowScreenshot] Start failed:', err)
      const screenPermission = (err as { screenPermission?: string })?.screenPermission
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        ...(screenPermission ? { screenPermission } : {}),
      }
    }
  })

  logger.system.info('[MainWindowScreenshot] Handlers registered')
}
