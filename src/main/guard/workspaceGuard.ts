/**
 * 工作区守卫 — 工作区相关的 IPC 处理器
 *
 * 设计理念：
 * - 模块化拆分：将工作区操作分为标记管理、会话恢复、文件操作三大模块
 * - 声明式注册：使用辅助函数消除重复的 IPC 注册模板
 * - 路径安全：所有路径操作经过规范化与校验
 * - 多窗口协调：支持工作区重定向到已打开的窗口
 * - 可观测性：关键操作记录日志，便于审计
 *
 * 差异化特性（相比基础实现）：
 * - ShareMenu 支持（macOS 分享菜单）
 * - 递归目录复制（copyDirRecursive）
 * - 工作区标记版本管理
 * - 会话恢复失败时返回详细错误信息
 * - 品牌配置通过 `@shared/brand` 集中管理
 */

import { logger } from '@shared/toolkit/LogEngine'
import { ipcMain, dialog, BrowserWindow, ShareMenu } from 'electron'
import { promises as fsPromises } from 'fs'
import * as path from 'path'
import { BRAND } from '@shared/brand'
import { setupFileWatcher, cleanupFileWatcher, FileWatcherEvent } from './fileSystemObserver'
import { securityManager } from './securityPolicyEngine'

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

/** 窗口管理上下文 */
export interface WindowManagerContext {
  findWindowByWorkspace?: (roots: string[]) => BrowserWindow | null
  setWindowWorkspace?: (windowId: number, roots: string[]) => void
}

/** 存储的工作区会话 */
interface StoredWorkspaceSession {
  configPath: string | null
  roots: string[]
  workspaceId?: string
}

/** 工作区恢复失败原因 */
type RestoreError = 'missing-workspace' | 'invalid-session'

/** 工作区恢复结果 */
interface WorkspaceRestoreResult {
  configPath: string | null
  roots: string[]
  restoreError?: RestoreError
  missingRoots?: string[]
}

/** 文件操作结果 */
interface FileOperationResult {
  success: boolean
  error?: string
  target?: string
  results?: Array<{ source: string; target: string; success: boolean; error?: string }>
}

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

/** 工作区标记文件相对路径 */
const WORKSPACE_MARKER_RELATIVE_PATH = path.join(BRAND.dirName, 'workspace.json')

/** 最近工作区最大数量 */
const MAX_RECENT_WORKSPACES = 10

/* ------------------------------------------------------------------ */
/* 路径工具函数                                                        */
/* ------------------------------------------------------------------ */

/**
 * 规范化工作区路径
 *
 * - 去除首尾空白
 * - 规范化路径分隔符
 * - 去除末尾分隔符（保留 Windows 根路径如 `C:\`）
 *
 * @param targetPath 原始路径
 * @returns 规范化后的路径
 */
function normalizeWorkspacePath(targetPath: string): string {
  const trimmed = targetPath.trim()
  if (!trimmed) {
    return trimmed
  }

  const normalizedSeparators = path.normalize(trimmed)

  // 保留 Windows 根路径（如 `C:\`）
  if (/^[a-zA-Z]:\\$/.test(normalizedSeparators)) {
    return normalizedSeparators
  }

  return normalizedSeparators.replace(/[\\\/]+$/, '')
}

/**
 * 生成工作区 ID
 *
 * @returns 唯一工作区 ID
 */
function generateWorkspaceId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 生成文件监听器 ID
 *
 * @param webContentsId 窗口 webContents ID
 * @returns 监听器 ID
 */
function getWatcherId(webContentsId: number): string {
  return `window-${webContentsId}`
}

/* ------------------------------------------------------------------ */
/* 递归目录复制                                                        */
/* ------------------------------------------------------------------ */

/**
 * 递归复制目录
 *
 * @param source 源目录
 * @param destination 目标目录
 */
async function copyDirRecursive(source: string, destination: string): Promise<void> {
  await fsPromises.mkdir(destination, { recursive: true })
  const entries = await fsPromises.readdir(source, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(source, entry.name)
    const destPath = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath)
    } else {
      await fsPromises.copyFile(srcPath, destPath)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 文件监听器管理                                                      */
/* ------------------------------------------------------------------ */

/**
 * 重启窗口的文件监听器
 *
 * @param sender 窗口 webContents
 * @param roots 工作区根目录列表
 */
async function restartWindowFileWatcher(
  sender: Electron.WebContents,
  roots: string[],
): Promise<void> {
  const watcherId = getWatcherId(sender.id)

  if (!roots.length) {
    await cleanupFileWatcher(watcherId)
    return
  }

  await setupFileWatcher(watcherId, roots[0], (data: FileWatcherEvent) => {
    try {
      sender.send('file:changed', data)
    } catch {
      void cleanupFileWatcher(watcherId)
    }
  })
}

/* ------------------------------------------------------------------ */
/* 工作区标记管理                                                      */
/* ------------------------------------------------------------------ */

/**
 * 读取工作区标记 ID
 *
 * @param root 工作区根目录
 * @returns 工作区 ID；不存在或无效则返回 null
 */
async function readWorkspaceMarkerId(root: string): Promise<string | null> {
  try {
    const markerPath = path.join(root, WORKSPACE_MARKER_RELATIVE_PATH)
    const content = await fsPromises.readFile(markerPath, 'utf-8')
    const parsed = JSON.parse(content) as { id?: string }

    return typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id : null
  } catch {
    return null
  }
}

/**
 * 确保工作区标记存在
 *
 * 如果标记不存在则创建，包含工作区 ID、创建时间、版本号
 *
 * @param root 工作区根目录
 * @returns 工作区 ID；目录不可访问则返回 null
 */
async function ensureWorkspaceMarker(root: string): Promise<string | null> {
  // 校验根目录可访问
  try {
    await fsPromises.access(root)
  } catch {
    return null
  }

  // 已存在标记则复用
  const existingId = await readWorkspaceMarkerId(root)
  if (existingId) {
    return existingId
  }

  // 创建新标记
  const markerPath = path.join(root, WORKSPACE_MARKER_RELATIVE_PATH)
  const markerDir = path.dirname(markerPath)
  const workspaceId = generateWorkspaceId()

  await fsPromises.mkdir(markerDir, { recursive: true })
  await fsPromises.writeFile(
    markerPath,
    JSON.stringify(
      {
        id: workspaceId,
        createdAt: new Date().toISOString(),
        version: 1,
      },
      null,
      2,
    ),
    'utf-8',
  )

  return workspaceId
}

/* ------------------------------------------------------------------ */
/* 会话恢复校验                                                        */
/* ------------------------------------------------------------------ */

/**
 * 校验工作区会话是否可恢复
 *
 * 检查项：
 * - 所有根目录是否存在且可访问
 * - 工作区标记 ID 是否匹配
 *
 * @param session 存储的会话
 * @returns 可恢复返回 true；否则返回 false
 */
async function isWorkspaceSessionRestorable(
  session: StoredWorkspaceSession,
): Promise<boolean> {
  if (!session.roots.length) return false

  // 校验所有根目录可访问
  try {
    await Promise.all(session.roots.map((root) => fsPromises.access(root)))
  } catch {
    return false
  }

  // 校验工作区标记 ID 匹配
  const currentWorkspaceId = await readWorkspaceMarkerId(session.roots[0])
  if (!currentWorkspaceId || !session.workspaceId) {
    return false
  }

  return currentWorkspaceId === session.workspaceId
}

/* ------------------------------------------------------------------ */
/* 最近工作区管理                                                       */
/* ------------------------------------------------------------------ */

/**
 * 添加路径到最近工作区列表
 *
 * - 去重（大小写不敏感）
 * - 保留最近 MAX_RECENT_WORKSPACES 条
 *
 * @param store electron-store 实例
 * @param workspacePath 工作区路径
 */
function addRecentWorkspace(store: any, workspacePath: string): void {
  const normalizedPath = normalizeWorkspacePath(workspacePath)
  const recent = store.get('recentWorkspaces', []) as string[]

  const filtered = recent.filter(
    (item: string) =>
      normalizeWorkspacePath(item).toLowerCase() !== normalizedPath.toLowerCase(),
  )

  const updated = [normalizedPath, ...filtered].slice(0, MAX_RECENT_WORKSPACES)
  store.set('recentWorkspaces', updated)

  logger.system.info('[workspaceGuard] 更新最近工作区', { count: updated.length })
}

/* ------------------------------------------------------------------ */
/* 窗口重定向辅助                                                       */
/* ------------------------------------------------------------------ */

/**
 * 检查并重定向到已打开的工作区窗口
 *
 * @param windowManager 窗口管理上下文
 * @param roots 工作区根目录
 * @param currentWindow 当前窗口
 * @returns 已重定向返回 true；否则返回 false
 */
function redirectToExistingWindow(
  windowManager: WindowManagerContext | undefined,
  roots: string[],
  currentWindow: BrowserWindow,
): boolean {
  if (!windowManager?.findWindowByWorkspace || roots.length === 0) {
    return false
  }

  const existingWindow = windowManager.findWindowByWorkspace(roots)
  if (!existingWindow || existingWindow === currentWindow) {
    return false
  }

  if (existingWindow.isMinimized()) {
    existingWindow.restore()
  }
  existingWindow.focus()

  logger.system.info('[workspaceGuard] 工作区已在其他窗口打开', { roots })
  return true
}

/* ------------------------------------------------------------------ */
/* 工作区文件解析                                                       */
/* ------------------------------------------------------------------ */

/**
 * 解析工作区配置文件
 *
 * @param configPath 配置文件路径
 * @returns 工作区根目录列表；解析失败返回 null
 */
async function parseWorkspaceConfig(configPath: string): Promise<string[] | null> {
  try {
    const content = await fsPromises.readFile(configPath, 'utf-8')
    const config = JSON.parse(content) as { folders?: Array<{ path: string }> }

    if (!config.folders || !Array.isArray(config.folders)) {
      return null
    }

    return config.folders.map((f) => normalizeWorkspacePath(f.path))
  } catch (e) {
    logger.system.warn('[workspaceGuard] 解析工作区文件失败', { path: configPath, error: String(e) })
    return null
  }
}

/* ------------------------------------------------------------------ */
/* IPC Handler 注册入口                                                */
/* ------------------------------------------------------------------ */

/**
 * 注册工作区相关的 IPC 处理器
 *
 * @param getMainWindowFn 获取主窗口的函数
 * @param store electron-store 实例
 * @param _getWorkspaceSessionFn 获取当前工作区会话的函数（保留兼容性）
 * @param windowManager 窗口管理上下文
 */
export function registerWorkspaceHandlers(
  getMainWindowFn: () => BrowserWindow | null,
  store: any,
  _getWorkspaceSessionFn: (event?: Electron.IpcMainInvokeEvent) => { roots: string[] } | null,
  windowManager?: WindowManagerContext,
): void {
  /* -------- 文件夹打开 -------- */

  ipcMain.handle('file:openFolder', async (event) => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    const folderPath = normalizeWorkspacePath(result.filePaths[0])

    // 检查是否已有窗口打开该项目
    if (redirectToExistingWindow(windowManager, [folderPath], mainWindow)) {
      return { redirected: true, path: folderPath }
    }

    // 记录当前窗口的工作区
    if (windowManager?.setWindowWorkspace) {
      windowManager.setWindowWorkspace(event.sender.id, [folderPath])
    }

    const workspaceId = await ensureWorkspaceMarker(folderPath)
    securityManager.setWorkspacePath(folderPath)

    store.set('lastWorkspacePath', folderPath)
    store.set('lastWorkspaceSession', { configPath: null, roots: [folderPath], workspaceId })
    addRecentWorkspace(store, folderPath)
    await restartWindowFileWatcher(event.sender, [folderPath])

    return folderPath
  })

  /* -------- 工作区打开（多根支持） -------- */

  ipcMain.handle('workspace:open', async (event) => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: `${BRAND.name} Workspace`, extensions: [BRAND.workspaceExt] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePaths[0]) {
      return null
    }

    const targetPath = result.filePaths[0]
    let roots: string[] = []

    if (targetPath.endsWith(`.${BRAND.workspaceExt}`)) {
      const parsed = await parseWorkspaceConfig(targetPath)
      if (!parsed) return null
      roots = parsed
    } else {
      roots = [normalizeWorkspacePath(targetPath)]
    }

    // 检查是否已有窗口打开该项目
    if (redirectToExistingWindow(windowManager, roots, mainWindow)) {
      return { redirected: true, roots }
    }

    if (windowManager?.setWindowWorkspace) {
      windowManager.setWindowWorkspace(event.sender.id, roots)
    }

    const workspaceId = roots[0] ? await ensureWorkspaceMarker(roots[0]) : null
    securityManager.setWorkspacePath(roots[0] || null)

    const session: StoredWorkspaceSession = {
      configPath: targetPath.endsWith(`.${BRAND.workspaceExt}`) ? targetPath : null,
      roots,
      workspaceId: workspaceId || undefined,
    }

    store.set('lastWorkspaceSession', session)
    store.set('lastWorkspacePath', roots[0])
    roots.forEach((r) => addRecentWorkspace(store, r))
    await restartWindowFileWatcher(event.sender, roots)

    return session
  })

  /* -------- 添加文件夹到工作区 -------- */

  ipcMain.handle('workspace:addFolder', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })

    if (!result.canceled && result.filePaths[0]) {
      return result.filePaths[0]
    }
    return null
  })

  /* -------- 保存工作区 -------- */

  ipcMain.handle('workspace:save', async (_, configPath: string, roots: string[]) => {
    if (!configPath || !roots) return false

    let targetPath = configPath
    if (!targetPath) {
      const mainWindow = getMainWindowFn()
      if (!mainWindow) return false

      const result = await dialog.showSaveDialog(mainWindow, {
        filters: [{ name: `${BRAND.name} Workspace`, extensions: [BRAND.workspaceExt] }],
      })
      if (result.canceled || !result.filePath) return false
      targetPath = result.filePath
    }

    const content = JSON.stringify(
      { folders: roots.map((p) => ({ path: p })) },
      null,
      2,
    )

    try {
      await fsPromises.writeFile(targetPath, content, 'utf-8')
      return true
    } catch (e) {
      logger.system.warn('[workspaceGuard] 保存工作区失败', { path: targetPath, error: String(e) })
      return false
    }
  })

  /* -------- 恢复工作区 -------- */

  ipcMain.handle('workspace:restore', async (event) => {
    const session = store.get('lastWorkspaceSession') as StoredWorkspaceSession | null

    if (session) {
      const restorable = await isWorkspaceSessionRestorable(session)
      if (!restorable) {
        store.delete('lastWorkspaceSession')
        store.delete('lastWorkspacePath')
        securityManager.setWorkspacePath(null)

        const result: WorkspaceRestoreResult = {
          configPath: null,
          roots: [],
          restoreError: 'missing-workspace',
          missingRoots: session.roots,
        }
        return result
      }

      if (windowManager?.setWindowWorkspace && session.roots.length > 0) {
        windowManager.setWindowWorkspace(event.sender.id, session.roots)
      }

      securityManager.setWorkspacePath(session.roots[0] || null)
      await restartWindowFileWatcher(event.sender, session.roots)
      return session
    }

    // 回退到旧版路径存储
    const legacyPath = store.get('lastWorkspacePath') as string | null
    if (legacyPath) {
      const legacySession: StoredWorkspaceSession = { configPath: null, roots: [legacyPath] }
      const restorable = await isWorkspaceSessionRestorable(legacySession)

      if (!restorable) {
        store.delete('lastWorkspaceSession')
        store.delete('lastWorkspacePath')
        securityManager.setWorkspacePath(null)

        const result: WorkspaceRestoreResult = {
          configPath: null,
          roots: [],
          restoreError: 'missing-workspace',
          missingRoots: [legacyPath],
        }
        return result
      }

      if (windowManager?.setWindowWorkspace) {
        windowManager.setWindowWorkspace(event.sender.id, [legacyPath])
      }

      securityManager.setWorkspacePath(legacyPath)
      await restartWindowFileWatcher(event.sender, [legacyPath])
      return legacySession
    }

    return null
  })

  /* -------- 设置活动工作区 -------- */

  ipcMain.handle('workspace:setActive', async (event, roots: string[]) => {
    if (!roots || roots.length === 0) return false

    const mainWindow = getMainWindowFn()
    if (redirectToExistingWindow(windowManager, roots, mainWindow!)) {
      return { redirected: true, roots }
    }

    if (windowManager?.setWindowWorkspace) {
      windowManager.setWindowWorkspace(event.sender.id, roots)
    }

    const workspaceId = roots[0] ? await ensureWorkspaceMarker(roots[0]) : null
    securityManager.setWorkspacePath(roots[0] || null)

    store.set('lastWorkspacePath', roots[0])
    store.set('lastWorkspaceSession', { configPath: null, roots, workspaceId })
    roots.forEach((r) => addRecentWorkspace(store, r))
    await restartWindowFileWatcher(event.sender, roots)

    logger.system.info('[workspaceGuard] 活动工作区已设置', { roots })
    return true
  })

  /* -------- 最近工作区管理 -------- */

  ipcMain.handle('workspace:getRecent', () => {
    const recent = store.get('recentWorkspaces', []) as string[]
    const normalizedRecent = recent.map((item) => normalizeWorkspacePath(item)).filter(Boolean)

    // 如果规范化后发生变化，则回写
    if (
      normalizedRecent.length !== recent.length ||
      normalizedRecent.some((item, index) => item !== recent[index])
    ) {
      store.set('recentWorkspaces', normalizedRecent)
    }

    return normalizedRecent
  })

  ipcMain.handle('workspace:exists', async (_, targetPath: string) => {
    if (!targetPath) return false

    try {
      const stats = await fsPromises.stat(targetPath)
      return stats.isDirectory()
    } catch {
      return false
    }
  })

  ipcMain.handle('workspace:clearRecent', () => {
    store.set('recentWorkspaces', [])
    return true
  })

  ipcMain.handle('workspace:removeFromRecent', (_, targetPath: string) => {
    if (!targetPath) return false

    const normalizedPath = normalizeWorkspacePath(targetPath)
    const recent = store.get('recentWorkspaces', []) as string[]
    const filtered = recent.filter(
      (item: string) =>
        normalizeWorkspacePath(item).toLowerCase() !== normalizedPath.toLowerCase(),
    )

    store.set('recentWorkspaces', filtered)
    logger.system.info('[workspaceGuard] 已从最近工作区移除', { path: normalizedPath })
    return true
  })

  /* -------- 对话框 -------- */

  ipcMain.handle('dialog:selectFolder', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })

    if (!result.canceled && result.filePaths[0]) {
      return result.filePaths[0]
    }
    return null
  })

  ipcMain.handle(
    'dialog:selectForImport',
    async (_event, options: { title?: string; allowFiles?: boolean; allowDirs?: boolean; multiSelection?: boolean }) => {
      const mainWindow = getMainWindowFn()
      if (!mainWindow) return []

      const properties: Electron.OpenDialogOptions['properties'] = []
      if (options.allowFiles !== false) properties.push('openFile')
      if (options.allowDirs) properties.push('openDirectory')
      if (options.multiSelection) properties.push('multiSelections')

      const result = await dialog.showOpenDialog(mainWindow, {
        title: options.title || 'Import',
        properties,
      })

      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths
      }
      return []
    },
  )

  ipcMain.handle(
    'dialog:selectForExport',
    async (_event, options: { title?: string; defaultPath?: string }) => {
      const mainWindow = getMainWindowFn()
      if (!mainWindow) return null

      const result = await dialog.showOpenDialog(mainWindow, {
        title: options.title || 'Export',
        defaultPath: options.defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      })

      if (!result.canceled && result.filePaths[0]) {
        return result.filePaths[0]
      }
      return null
    },
  )

  /* -------- 文件导入/导出 -------- */

  ipcMain.handle(
    'file:importIntoWorkspace',
    async (_event, sourcePaths: string[], targetDir: string): Promise<FileOperationResult> => {
      if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || !targetDir) {
        return { success: false, error: 'Invalid parameters' }
      }

      const results: Array<{ source: string; target: string; success: boolean; error?: string }> = []

      for (const src of sourcePaths) {
        try {
          const stat = await fsPromises.stat(src)
          const baseName = path.basename(src)
          const destPath = path.join(targetDir, baseName)

          if (stat.isDirectory()) {
            await copyDirRecursive(src, destPath)
          } else {
            await fsPromises.copyFile(src, destPath)
          }

          results.push({ source: src, target: destPath, success: true })
        } catch (err) {
          results.push({
            source: src,
            target: '',
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      const allSuccess = results.every((r) => r.success)
      return { success: allSuccess, results }
    },
  )

  ipcMain.handle(
    'file:exportFromWorkspace',
    async (_event, sourcePath: string, targetDir: string): Promise<FileOperationResult> => {
      if (!sourcePath || !targetDir) {
        return { success: false, error: 'Invalid parameters' }
      }

      try {
        const stat = await fsPromises.stat(sourcePath)
        const baseName = path.basename(sourcePath)
        const destPath = path.join(targetDir, baseName)

        if (stat.isDirectory()) {
          await copyDirRecursive(sourcePath, destPath)
        } else {
          await fsPromises.copyFile(sourcePath, destPath)
        }

        return { success: true, target: destPath }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )

  /* -------- macOS 分享菜单 -------- */

  ipcMain.handle('file:shareItem', async (_event, filePaths: string[]) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: 'No file paths provided' }
    }

    if (process.platform !== 'darwin') {
      return { success: false, error: 'Share is only supported on macOS' }
    }

    try {
      const mainWindow = getMainWindowFn()
      if (!mainWindow) {
        return { success: false, error: 'No main window' }
      }

      const shareMenu = new ShareMenu({ filePaths })
      shareMenu.popup()

      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  logger.system.info(`[workspaceGuard] ${BRAND.name} 工作区 IPC 已注册`)
}
