/**
 * 桌面控制 API
 *
 * 覆盖 IPC 频道：desktop:*
 *
 * 能力范围：
 * - Phase 1: 应用启动 / 系统信息 / 音量亮度 / 进程管理
 * - Phase 2: 窗口控制 / 屏幕截图 / 输入模拟 / 文件操作
 * - Phase 3: 紧急停止 / 辅助功能权限
 *
 * 注：Phase 4（操作录制 / 视觉闭环 / 工作流引擎 / 自动化模式）已迁移至
 * 内置 computer-use MCP 服务，不再通过 IPC 暴露。
 */
import { ipcRenderer, IpcRendererEvent } from 'electron'
import { invoke, on } from '../ipcHelpers'

export function createDesktopApi() {
  return {
    // ============ Phase 1: 基础控制 ============
    desktopLaunchApp: (name: string, args?: string[]) =>
      invoke('desktop:launchApp')(name, args),
    desktopQuitApp: (name: string) => invoke('desktop:quitApp')(name),
    desktopListInstalledApps: invoke('desktop:listInstalledApps'),
    desktopFindApp: (name: string) => invoke('desktop:findApp')(name),
    desktopOpenUrl: (url: string) => invoke('desktop:openUrl')(url),
    desktopOpenFile: (filePath: string) => invoke('desktop:openFile')(filePath),
    desktopGetSystemInfo: invoke('desktop:getSystemInfo'),
    desktopSetVolume: (volume: number) => invoke('desktop:setVolume')(volume),
    desktopSetBrightness: (level: number) => invoke('desktop:setBrightness')(level),
    desktopListProcesses: invoke('desktop:listProcesses'),
    desktopFindProcess: (query: string | number) => invoke('desktop:findProcess')(query),
    desktopKillProcess: (pid: number, force?: boolean) =>
      invoke('desktop:killProcess')(pid, force),
    desktopIsProcessRunning: (name: string) => invoke('desktop:isProcessRunning')(name),

    // ============ Phase 2: 窗口控制 ============
    desktopListWindows: invoke('desktop:listWindows'),
    desktopFindWindow: (query: string) => invoke('desktop:findWindow')(query),
    desktopFocusWindow: (windowId: string) => invoke('desktop:focusWindow')(windowId),
    desktopMinimizeWindow: (windowId: string) =>
      invoke('desktop:minimizeWindow')(windowId),
    desktopMaximizeWindow: (windowId: string) =>
      invoke('desktop:maximizeWindow')(windowId),
    desktopRestoreWindow: (windowId: string) =>
      invoke('desktop:restoreWindow')(windowId),
    desktopCloseWindow: (windowId: string) => invoke('desktop:closeWindow')(windowId),
    desktopBringWindowToFront: (windowId: string) =>
      invoke('desktop:bringWindowToFront')(windowId),
    desktopSetWindowBounds: (
      windowId: string,
      bounds: { x: number; y: number; width: number; height: number },
    ) => invoke('desktop:setWindowBounds')(windowId, bounds),

    // ============ Phase 2: 屏幕截图 ============
    desktopCaptureScreen: (displayId?: number) =>
      invoke('desktop:captureScreen')(displayId),
    desktopCaptureRegion: (
      region: { x: number; y: number; width: number; height: number },
      displayId?: number,
    ) => invoke('desktop:captureRegion')(region, displayId),
    desktopCaptureAllScreens: invoke('desktop:captureAllScreens'),

    // ============ Phase 2: 输入模拟 ============
    desktopMouseClick: (params: {
      x: number
      y: number
      button: 'left' | 'right' | 'middle'
      clickType: 'single' | 'double'
    }) => invoke('desktop:mouseClick')(params),
    desktopMouseMove: (params: { x: number; y: number; smooth?: boolean; duration?: number }) =>
      invoke('desktop:mouseMove')(params),
    desktopMouseScroll: (params: { x: number; y: number; amount: number }) =>
      invoke('desktop:mouseScroll')(params),
    desktopMouseDrag: (params: {
      fromX: number
      fromY: number
      toX: number
      toY: number
      button: 'left' | 'right' | 'middle'
      duration?: number
    }) => invoke('desktop:mouseDrag')(params),
    desktopTypeText: (text: string, delayMs?: number) =>
      invoke('desktop:typeText')(text, delayMs),
    desktopPressKey: (key: string) => invoke('desktop:pressKey')(key),
    desktopKeyCombo: (keys: string[]) => invoke('desktop:keyCombo')(keys),

    // ============ Phase 2: 文件操作 ============
    desktopCopyFile: (sourcePath: string, targetPath: string) =>
      invoke('desktop:copyFile')(sourcePath, targetPath),
    desktopMoveFile: (sourcePath: string, targetPath: string) =>
      invoke('desktop:moveFile')(sourcePath, targetPath),
    desktopDeleteFile: (targetPath: string) => invoke('desktop:deleteFile')(targetPath),
    desktopRenameFile: (sourcePath: string, newName: string) =>
      invoke('desktop:renameFile')(sourcePath, newName),
    desktopGetFileInfo: (targetPath: string) => invoke('desktop:getFileInfo')(targetPath),
    desktopFileExists: (targetPath: string) => invoke('desktop:fileExists')(targetPath),
    desktopCreateDirectory: (targetPath: string) =>
      invoke('desktop:createDirectory')(targetPath),
    desktopListDirectory: (targetPath: string) =>
      invoke('desktop:listDirectory')(targetPath),

    // ============ Phase 3: 紧急停止 ============
    desktopEmergencyStopGetState: invoke('desktop:emergencyStopGetState'),
    desktopEmergencyStopTrigger: (params: { source: string; reason?: string }) =>
      invoke('desktop:emergencyStopTrigger')(params),
    desktopEmergencyStopReset: invoke('desktop:emergencyStopReset'),
    onDesktopEmergencyStopStateChange: on<unknown>('desktop:emergencyStopStateChanged'),

    // ============ Phase 3: 辅助功能权限 ============
    desktopAccessibilityCheck: (type?: string, forceRefresh?: boolean) =>
      invoke('desktop:accessibilityCheck')(type, forceRefresh),
    desktopAccessibilityCheckAll: (forceRefresh?: boolean) =>
      invoke('desktop:accessibilityCheckAll')(forceRefresh),
    desktopAccessibilityOpenPreferences: (type?: string) =>
      invoke('desktop:accessibilityOpenPreferences')(type),
    desktopAccessibilityRequestPermission: (type?: string) =>
      invoke('desktop:accessibilityRequestPermission')(type),
    /** 辅助功能权限变更 — 主进程推送 { type, status }，回调解构为双参数 */
    onDesktopAccessibilityPermissionChange: (
      callback: (type: string, status: string) => void,
    ): (() => void) => {
      const handler = (
        _: IpcRendererEvent,
        data: { type: string; status: string },
      ) => callback(data.type, data.status)
      ipcRenderer.on('desktop:accessibilityPermissionChanged', handler)
      return () =>
        ipcRenderer.removeListener('desktop:accessibilityPermissionChanged', handler)
    },
  }
}
