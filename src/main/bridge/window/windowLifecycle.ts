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
import {
  buildNewWindowWorkspaceSession,
  commitNewWindowWorkspace,
} from '../../guard/workspaceGuard'
import { findWindowByWorkspace } from '../../bootstrap/windowManager'

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
  createWindow: (
    isEmpty?: boolean,
    deferLoad?: boolean,
    restoreWorkspace?: boolean,
    newTask?: boolean,
    pickWorkspace?: boolean,
  ) => BrowserWindow,
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
  /**
   * 新建窗口
   *
   * 可选携带目标工作空间根目录：带上时新窗口以该目录作为工作空间打开，
   * 用于「新建任务时把执行目录放在另一个项目」的场景。
   * 不传则维持原行为（空窗口，工作空间由用户自行选择）。
   *
   * @param roots 目标工作空间根目录；留空表示不指定
   * @param options.newTask 窗口打开后直接进入新建任务，
   *   此时工作空间沿用当前最近使用的那一份
   * @param options.pickWorkspace 窗口打开后先让用户选择工作空间
   *   （含最近工作空间列表），选定后才进入主界面
   * @returns 新窗口 ID
   */
  ipcMain.handle('window:new', async (_event, roots?: unknown, options?: unknown) => {
    const targetRoots = Array.isArray(roots)
      ? roots.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
    const opts = options as { newTask?: unknown; pickWorkspace?: unknown } | undefined
    const newTask = Boolean(opts?.newTask)
    // 让用户选工作空间的窗口不继承上一窗口的工作空间：它必须从无工作空间起步，
    // 否则会直接跳过选择界面进入主界面。
    const pickWorkspace = Boolean(opts?.pickWorkspace)

    // 与「打开文件夹」保持同一策略：目录已在其他窗口打开时聚焦该窗口，
    // 不再开第二份。同一目录开两个窗口会让索引、文件监听、存储初始化互相踩踏。
    if (targetRoots.length > 0) {
      const existing = findWindowByWorkspace(targetRoots)
      if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) {
          existing.restore()
        }
        existing.focus()
        logger.system.info('[Window] 目标目录已在其他窗口打开，聚焦该窗口', {
          roots: targetRoots,
          windowId: existing.id,
        })
        return existing.id
      }
    }

    // 会话必须先于窗口创建算好：标记文件写入是异步 IO，
    // 放在建窗之后会让渲染进程抢在登记之前发出 workspace:restore。
    const session = targetRoots.length > 0
      ? await buildNewWindowWorkspaceSession(targetRoots).catch((err) => {
          // 预置失败不阻断开窗：新窗口会退回「未打开工作空间」，用户仍可手动选择
          logger.system.warn('[Window] 新窗口工作空间预计算失败', {
            roots: targetRoots,
            error: String(err),
          })
          return null
        })
      : null

    // 带目录时要求新窗口恢复工作空间：空窗口默认跳过恢复，
    // 不显式要求的话预置的目录永远不会被消费，新窗口仍是无工作空间状态。
    // 新建任务窗口同样要恢复工作空间（沿用最近使用的那一份），否则工具调用会报「没有打开工作空间」
    // 选择工作空间的窗口不恢复：保持无工作空间，选择界面才能作为入口显示
    const win = createWindow(
      true,
      false,
      session !== null || (newTask && !pickWorkspace),
      newTask && !pickWorkspace,
      pickWorkspace,
    )

    // 同步登记，保证新窗口的首次 restore 一定能读到本窗口的目标目录
    if (session) {
      commitNewWindowWorkspace(win, session)
    }

    return win.id
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
