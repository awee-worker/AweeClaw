/**
 * 窗口生命周期管理 — 窗口控制的 IPC 处理器
 *
 * 职责：
 * - 暴露窗口最小化、最大化、关闭、主题切换等 IPC 接口
 * - 支持多窗口模式下的窗口创建
 * - 基础窗口控制 handler 仅注册一次，避免重复绑定
 */

import { ipcMain, BrowserWindow, app, nativeTheme } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/** 自绘菜单可执行的原生角色 */
export type MenuRole =
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'delete'
  | 'zoomIn' | 'zoomOut' | 'resetZoom' | 'toggleFullScreen' | 'reload' | 'toggleDevTools'
  | 'minimize' | 'maximize' | 'close' | 'quit'

/** 缩放进阶（与 Chromium 每级 zoom 一致） */
const ZOOM_STEP = 0.5

// 标记是否已注册基础窗口控制
let basicHandlersRegistered = false

export function registerWindowHandlers(
  createWindow: (isEmpty?: boolean) => BrowserWindow,
  isPrimaryWindow?: (windowId: number) => boolean,
) {
  // 基础窗口控制（只注册一次）
  if (!basicHandlersRegistered) {
    basicHandlersRegistered = true

    ipcMain.on('window:minimize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.minimize()
    })

    ipcMain.on('window:maximize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win?.isMaximized()) {
        win.unmaximize()
      } else {
        win?.maximize()
      }
    })

    ipcMain.on('window:close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.close()
    })

    ipcMain.on('window:toggleDevTools', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.webContents.toggleDevTools()
    })

    /**
     * 自绘菜单角色执行（Windows/Linux）
     *
     * 主窗口 frame:false，原生菜单栏不显示；渲染进程自绘菜单栏通过此频道
     * 请求执行等价的「原生角色」（撤销/复制/缩放/重载/窗口控制等）。
     */
    ipcMain.on('menu:execute-role', (event, role: MenuRole) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      const wc = win.webContents
      switch (role) {
        case 'undo': wc.undo(); break
        case 'redo': wc.redo(); break
        case 'cut': wc.cut(); break
        case 'copy': wc.copy(); break
        case 'paste': wc.paste(); break
        case 'selectAll': wc.selectAll(); break
        case 'delete': wc.delete(); break
        case 'zoomIn': wc.setZoomLevel(wc.getZoomLevel() + ZOOM_STEP); break
        case 'zoomOut': wc.setZoomLevel(wc.getZoomLevel() - ZOOM_STEP); break
        case 'resetZoom': wc.setZoomLevel(0); break
        case 'toggleFullScreen': win.setFullScreen(!win.isFullScreen()); break
        case 'reload': wc.reload(); break
        case 'toggleDevTools': wc.toggleDevTools(); break
        case 'minimize': win.minimize(); break
        case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break
        case 'close': win.close(); break
        case 'quit': app.quit(); break
        default: logger.system.warn('[Window] Unknown menu role:', role)
      }
    })

    ipcMain.handle('app:getVersion', () => {
      return app.getVersion()
    })

    // 同步系统主题
    ipcMain.handle('window:setTheme', (event, theme: 'light' | 'dark' | 'system', bgColor?: string) => {
      nativeTheme.themeSource = theme
      if (bgColor) {
        const win = BrowserWindow.fromWebContents(event.sender)
        win?.setBackgroundColor(bgColor)
      }
      return true
    })

    // 渲染端准备完毕通知
    ipcMain.on('app:ready', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        // 窗口已经显示，这里只是日志记录
        logger.system.info('[Window] Renderer ready for window:', { windowId: win.id })
      }
    })

    // 获取当前窗口的唯一标识
    ipcMain.handle('window:getId', (event) => {
      return BrowserWindow.fromWebContents(event.sender)?.id
    })



    // 调整窗口大小
    ipcMain.handle('window:resize', (event, width: number, height: number, minWidth?: number, minHeight?: number) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        // 先设置最小尺寸
        if (minWidth !== undefined && minHeight !== undefined) {
          win.setMinimumSize(minWidth, minHeight)
        }

        // 使用 Electron 内置的动画参数
        win.setSize(width, height, true)
        win.center()
      }
    })
  }

  // 新增：打开新窗口（需要 createWindow 函数）
  // 移除旧的 handler 再注册新的
  try {
    ipcMain.removeHandler('window:new')
  } catch (e) { logger.system.debug('Failed to remove window:new handler:', e) }
  ipcMain.handle('window:new', () => {
    createWindow(true)
  })

  // 当前窗口是否应用级服务宿主窗口（首个窗口）
  // 渲染进程用它避免每个窗口都重复启动渠道连接 / 记忆调度 / 云会话恢复等单例任务，
  // 否则多开窗口会让定时器与后台负载成倍增长。
  // 与 window:new 一样按调用方重注册，保证拿到的是最新的宿主判定函数。
  try {
    ipcMain.removeHandler('window:isPrimary')
  } catch (e) { logger.system.debug('Failed to remove window:isPrimary handler:', e) }
  ipcMain.handle('window:isPrimary', (event) => {
    if (!isPrimaryWindow) return true
    const win = BrowserWindow.fromWebContents(event.sender)
    return !!win && !win.isDestroyed() && isPrimaryWindow(win.id)
  })
}
