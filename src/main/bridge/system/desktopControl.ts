/**
 * 桌面控制桥接 — 桌面自动化控制的 IPC 接口
 *
 * 职责：
 * - 暴露桌面操作（鼠标、键盘、屏幕）的 IPC 接口
 * - 所有操作通过 DesktopControlManager 统一调度，自动完成权限校验
 * - 支持紧急停止、无障碍权限检查
 */

import { BrowserWindow } from 'electron'
import { safeIpcHandle } from '../core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getDesktopControlManager } from '../../modules/desktop-control/DesktopControlManager'
import { getAccessibilityPermissionService } from '../../modules/desktop-control/AccessibilityPermission'
import { getEmergencyStopController, EMERGENCY_STOP_EVENT, EMERGENCY_RESET_EVENT } from '../../modules/desktop-control/EmergencyStop'
import type { AccessibilityPermissionType } from '../../modules/desktop-control/AccessibilityPermission'

export function registerDesktopControlHandlers(getMainWindow: (windowId?: number) => BrowserWindow | null): void {
  const manager = getDesktopControlManager()

  // ============ 应用启动 ============

  /** 启动应用 */
  safeIpcHandle('desktop:launchApp', async (_event, name: string, args?: string[]) => {
    const result = await manager.launchApp(name, args)
    return { success: true, data: result }
  })

  /** 退出应用 */
  safeIpcHandle('desktop:quitApp', async (_event, name: string) => {
    const result = await manager.quitApp(name)
    return { success: true, data: result }
  })

  /** 列出已安装应用 */
  safeIpcHandle('desktop:listInstalledApps', async () => {
    const apps = await manager.listInstalledApps()
    return { success: true, data: apps }
  })

  /** 查找已安装应用 */
  safeIpcHandle('desktop:findApp', async (_event, name: string) => {
    const app = await manager.findApp(name)
    return { success: true, data: app }
  })

  /** 用默认浏览器打开 URL */
  safeIpcHandle('desktop:openUrl', async (_event, url: string) => {
    const result = await manager.openUrl(url)
    return { success: true, data: result }
  })

  /** 用默认程序打开文件 */
  safeIpcHandle('desktop:openFile', async (_event, filePath: string) => {
    const result = await manager.openFile(filePath)
    return { success: true, data: result }
  })

  // ============ 系统信息 ============

  /** 获取系统信息 */
  safeIpcHandle('desktop:getSystemInfo', async () => {
    const info = await manager.getSystemInfo()
    return { success: true, data: info }
  })

  /** 设置系统音量 */
  safeIpcHandle('desktop:setVolume', async (_event, volume: number) => {
    const result = await manager.setVolume(volume)
    return { success: true, data: result }
  })

  /** 设置屏幕亮度 */
  safeIpcHandle('desktop:setBrightness', async (_event, level: number) => {
    const result = await manager.setBrightness(level)
    return { success: true, data: result }
  })

  // ============ 进程管理 ============

  /** 列出所有进程 */
  safeIpcHandle('desktop:listProcesses', async () => {
    const processes = await manager.listProcesses()
    return { success: true, data: processes }
  })

  /** 查找进程 */
  safeIpcHandle('desktop:findProcess', async (_event, query: string | number) => {
    const processes = await manager.findProcess(query)
    return { success: true, data: processes }
  })

  /** 终止进程 */
  safeIpcHandle('desktop:killProcess', async (_event, pid: number, force?: boolean) => {
    const result = await manager.killProcess(pid, force)
    return { success: true, data: result }
  })

  /** 检查进程是否在运行 */
  safeIpcHandle('desktop:isProcessRunning', async (_event, name: string) => {
    const running = await manager.isProcessRunning(name)
    return { success: true, data: running }
  })

  // ============ 窗口控制（Phase 2） ============

  /** 列出所有窗口 */
  safeIpcHandle('desktop:listWindows', async () => {
    try {
      const windows = await manager.listWindows()
      return { success: true, data: windows }
    } catch (err) {
      const e = err as Error & { code?: string }
      logger.desktop?.error?.('[desktopControl] listWindows failed:', e.message)
      return {
        success: false,
        error: e.message || 'Failed to list windows',
        code: e.code,
      }
    }
  })

  /** 查找窗口 */
  safeIpcHandle('desktop:findWindow', async (_event, query: string) => {
    const windows = await manager.findWindow(query)
    return { success: true, data: windows }
  })

  /** 聚焦窗口 */
  safeIpcHandle('desktop:focusWindow', async (_event, windowId: string) => {
    const result = await manager.focusWindow(windowId)
    return { success: true, data: result }
  })

  /** 最小化窗口 */
  safeIpcHandle('desktop:minimizeWindow', async (_event, windowId: string) => {
    const result = await manager.minimizeWindow(windowId)
    return { success: true, data: result }
  })

  /** 最大化窗口 */
  safeIpcHandle('desktop:maximizeWindow', async (_event, windowId: string) => {
    const result = await manager.maximizeWindow(windowId)
    return { success: true, data: result }
  })

  /** 还原窗口 */
  safeIpcHandle('desktop:restoreWindow', async (_event, windowId: string) => {
    const result = await manager.restoreWindow(windowId)
    return { success: true, data: result }
  })

  /** 关闭窗口 */
  safeIpcHandle('desktop:closeWindow', async (_event, windowId: string) => {
    const result = await manager.closeWindow(windowId)
    return { success: true, data: result }
  })

  /** 置顶窗口 */
  safeIpcHandle('desktop:bringWindowToFront', async (_event, windowId: string) => {
    const result = await manager.bringWindowToFront(windowId)
    return { success: true, data: result }
  })

  /** 设置窗口位置和大小 */
  safeIpcHandle('desktop:setWindowBounds', async (_event, windowId: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const result = await manager.setWindowBounds(windowId, bounds)
    return { success: true, data: result }
  })

  // ============ 屏幕截图（Phase 2） ============

  /** 截取整个屏幕 */
  safeIpcHandle('desktop:captureScreen', async (_event, displayId?: number) => {
    const result = await manager.captureScreen(displayId)
    return { success: true, data: result }
  })

  /** 截取指定区域 */
  safeIpcHandle('desktop:captureRegion', async (_event, region: { x: number; y: number; width: number; height: number }, displayId?: number) => {
    const result = await manager.captureRegion(region, displayId)
    return { success: true, data: result }
  })

  /** 截取所有屏幕 */
  safeIpcHandle('desktop:captureAllScreens', async () => {
    const result = await manager.captureAllScreens()
    return { success: true, data: result }
  })

  // ============ 输入模拟（Phase 2） ============

  /** 鼠标点击 */
  safeIpcHandle('desktop:mouseClick', async (_event, params: { x: number; y: number; button: 'left' | 'right' | 'middle'; clickType: 'single' | 'double' }) => {
    const result = await manager.mouseClick(params)
    return { success: true, data: result }
  })

  /** 鼠标移动 */
  safeIpcHandle('desktop:mouseMove', async (_event, params: { x: number; y: number; smooth?: boolean; duration?: number }) => {
    const result = await manager.mouseMove(params)
    return { success: true, data: result }
  })

  /** 鼠标滚动 */
  safeIpcHandle('desktop:mouseScroll', async (_event, params: { x: number; y: number; amount: number }) => {
    const result = await manager.mouseScroll(params)
    return { success: true, data: result }
  })

  /** 鼠标拖拽 */
  safeIpcHandle('desktop:mouseDrag', async (_event, params: { fromX: number; fromY: number; toX: number; toY: number; button: 'left' | 'right' | 'middle'; duration?: number }) => {
    const result = await manager.mouseDrag(params)
    return { success: true, data: result }
  })

  /** 输入文本 */
  safeIpcHandle('desktop:typeText', async (_event, text: string, delayMs?: number) => {
    const result = await manager.typeText(text, delayMs)
    return { success: true, data: result }
  })

  /** 按下单个按键 */
  safeIpcHandle('desktop:pressKey', async (_event, key: string) => {
    const result = await manager.pressKey(key)
    return { success: true, data: result }
  })

  /** 组合键 */
  safeIpcHandle('desktop:keyCombo', async (_event, keys: string[]) => {
    const result = await manager.keyCombo(keys)
    return { success: true, data: result }
  })

  // ============ 文件操作（Phase 2） ============

  /** 复制文件/目录 */
  safeIpcHandle('desktop:copyFile', async (_event, sourcePath: string, targetPath: string) => {
    const result = await manager.copyFile(sourcePath, targetPath)
    return { success: true, data: result }
  })

  /** 移动文件/目录 */
  safeIpcHandle('desktop:moveFile', async (_event, sourcePath: string, targetPath: string) => {
    const result = await manager.moveFile(sourcePath, targetPath)
    return { success: true, data: result }
  })

  /** 删除文件/目录 */
  safeIpcHandle('desktop:deleteFile', async (_event, targetPath: string) => {
    const result = await manager.deleteFile(targetPath)
    return { success: true, data: result }
  })

  /** 重命名文件/目录 */
  safeIpcHandle('desktop:renameFile', async (_event, sourcePath: string, newName: string) => {
    const result = await manager.renameFile(sourcePath, newName)
    return { success: true, data: result }
  })

  /** 获取文件信息 */
  safeIpcHandle('desktop:getFileInfo', async (_event, targetPath: string) => {
    const info = await manager.getFileInfo(targetPath)
    return { success: true, data: info }
  })

  /** 判断文件是否存在 */
  safeIpcHandle('desktop:fileExists', async (_event, targetPath: string) => {
    const exists = await manager.fileExists(targetPath)
    return { success: true, data: exists }
  })

  /** 创建目录 */
  safeIpcHandle('desktop:createDirectory', async (_event, targetPath: string) => {
    const result = await manager.createDirectory(targetPath)
    return { success: true, data: result }
  })

  /** 列出目录内容 */
  safeIpcHandle('desktop:listDirectory', async (_event, targetPath: string) => {
    const entries = await manager.listDirectory(targetPath)
    return { success: true, data: entries }
  })

  // ============ 紧急停止（Phase 3） ============

  /** 获取紧急停止状态 */
  safeIpcHandle('desktop:emergencyStopGetState', async () => {
    return { success: true, data: manager.getEmergencyStopState() }
  })

  /** 触发紧急停止 */
  safeIpcHandle('desktop:emergencyStopTrigger', async (_event, params: { source: string; reason?: string }) => {
    manager.triggerEmergencyStop({
      source: params.source as 'user' | 'system' | 'agent' | 'timeout' | 'external',
      reason: params.reason,
    })
    return { success: true }
  })

  /** 复位紧急停止 */
  safeIpcHandle('desktop:emergencyStopReset', async () => {
    manager.resetEmergencyStop()
    return { success: true }
  })

  // ============ 辅助功能权限（Phase 3） ============

  /** 检测权限状态 */
  safeIpcHandle('desktop:accessibilityCheck', async (_event, type?: string, forceRefresh?: boolean) => {
    const service = getAccessibilityPermissionService()
    const result = await service.check(
      (type as AccessibilityPermissionType) || 'accessibility',
      forceRefresh,
    )
    return { success: true, data: result }
  })

  /** 检测所有权限 */
  safeIpcHandle('desktop:accessibilityCheckAll', async (_event, forceRefresh?: boolean) => {
    const service = getAccessibilityPermissionService()
    const results = await service.checkAll(forceRefresh)
    return { success: true, data: results }
  })

  /** 打开系统偏好设置 */
  safeIpcHandle('desktop:accessibilityOpenPreferences', async (_event, type?: string) => {
    const service = getAccessibilityPermissionService()
    const opened = await service.openSystemPreferences(
      (type as AccessibilityPermissionType) || 'accessibility',
    )
    return { success: true, data: opened }
  })

  /** 请求权限 */
  safeIpcHandle('desktop:accessibilityRequestPermission', async (_event, type?: string) => {
    const service = getAccessibilityPermissionService()
    const result = await service.requestPermission(
      (type as AccessibilityPermissionType) || 'accessibility',
    )
    return { success: true, data: result }
  })

  // ============ 事件推送（Phase 3） ============

  // 紧急停止状态变化事件推送到渲染进程
  const stopController = getEmergencyStopController()
  stopController.on(EMERGENCY_STOP_EVENT, (state) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:emergencyStopStateChanged', state)
    }
  })
  stopController.on(EMERGENCY_RESET_EVENT, (state) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:emergencyStopStateChanged', state)
    }
  })

  // 辅助功能权限变化事件推送
  const accessibilityService = getAccessibilityPermissionService()
  accessibilityService.onPermissionChange((type, status) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:accessibilityPermissionChanged', { type, status })
    }
  })

}
