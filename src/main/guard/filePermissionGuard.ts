/**
 * 安全文件操作模块 — 整合文件操作、工作区管理和文件监听功能
 *
 * 设计理念：
 * - 模块化：知识库文件提取已拆分到 knowledgeFileExtractor.ts
 * - 安全校验：统一使用 fileSecurityHelpers 进行权限校验
 * - 声明式注册：使用辅助函数消除重复的 IPC 注册模板
 * - 可观测性：所有操作记录安全日志
 *
 * 差异化特性（相比基础实现）：
 * - 场景权限策略（ScenarioPermissionPolicy）
 * - 操作频率限制
 * - 安全事件通知
 * - 知识库文件提取（拆分到独立模块）
 * - 品牌配置通过 `@shared/brand` 集中管理
 */

import { logger } from '@shared/toolkit/LogEngine'
import { toAppError, ErrorCode } from '@shared/toolkit/errorCatalog'
import { ipcMain, dialog, shell } from 'electron'
import { safeOpenExternal } from './safeExternalUrl'
import * as path from 'path'
import fs, { promises as fsPromises } from 'fs'
import Store from 'electron-store'
import { securityManager, OperationType } from './securityPolicyEngine'

// 导入拆分的模块
import { readFileWithEncoding, readLargeFile } from './fileAccessControl'
import {
  setupFileWatcher,
  cleanupFileWatcher,
  FileWatcherEvent,
} from './fileSystemObserver'
import {
  registerWorkspaceHandlers,
  WindowManagerContext,
} from './workspaceGuard'

// 导入知识库文件提取器（拆分模块）
import {
  extractPdfText as extractKnowledgePdfText,
  extractDocxText as extractKnowledgeDocxText,
  extractDocText as extractKnowledgeDocText,
  extractXlsxText as extractKnowledgeXlsxText,
  extractPptText as extractKnowledgePptText,
  readKnowledgeFile,
} from './knowledgeFileExtractor'

// 导入安全校验辅助
import {
  validateFileOperation,
  logFileSuccess,
  logFileFailure,
  ensureParentDir,
  isNewFile,
  writeFileWithRetry,
  writeBinaryFileWithRetry,
} from './fileSecurityHelpers'

/**
 * 向渲染进程发送错误通知
 */
function showSecurityError(mainWindow: any, title: string, message: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:error', { title, message, variant: 'danger' })
  } else {
    // 如果窗口不可用，回退到原生对话框
    dialog.showErrorBox(title, message)
  }
}

/**
 * 向所有渲染进程发送文件变更通知
 */
function notifyFileChanged(getMainWindowFn: () => any, event: FileWatcherEvent): void {
  const win = getMainWindowFn()
  if (win && !win.isDestroyed()) {
    win.webContents.send('file:changed', event)
  }
}

/**
 * 注册所有安全文件 IPC Handlers
 * 整合文件操作和工作区管理
 */
export function registerSecureFileHandlers(
  getMainWindowFn: () => any,
  store: any,
  getWorkspaceSessionFn: (event?: Electron.IpcMainInvokeEvent) => { roots: string[] } | null,
  windowManager?: WindowManagerContext
) {
  ; (global as any).mainWindow = getMainWindowFn()

  // 注册工作区相关处理器（从 workspaceHandlers.ts 导入）
  registerWorkspaceHandlers(getMainWindowFn, store, getWorkspaceSessionFn, windowManager)

  // ========== 文件操作处理器 ==========

  // 打开文件（带对话框）
  ipcMain.handle('file:open', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })

    if (!result.canceled && result.filePaths[0]) {
      const filePath = result.filePaths[0]
      if (securityManager.isSensitivePath(filePath)) {
        showSecurityError(mainWindow, '安全警告', '不允许访问系统敏感路径')
        return null
      }

      try {
        const content = await fsPromises.readFile(filePath, 'utf-8')
        securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
          userAction: true,
          size: content.length,
        })
        return { path: filePath, content }
      } catch (err) {
        logger.security.error('[SecureFile] Failed to read file:', filePath, err)
        securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
          userAction: true,
          error: String(err),
        })
        return null
      }
    }
    return null
  })

  ipcMain.handle('file:openKnowledgeFiles', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['md', 'txt', 'json', 'csv', 'pdf', 'docx', 'doc', 'xlsx', 'xls', 'ppt', 'pptx', 'db', 'sqlite', 'sqlite3'] },
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word', extensions: ['docx', 'doc'] },
        { name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] },
        { name: 'PowerPoint', extensions: ['ppt', 'pptx'] },
        { name: 'Text', extensions: ['txt', 'json'] },
        { name: 'Database', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const safePaths = result.filePaths.filter(p => !securityManager.isSensitivePath(p))
      return safePaths
    }
    return null
  })

  ipcMain.handle('file:readKnowledgeFile', async (_event, filePath: string) => {
    return readKnowledgeFile(filePath, readLargeFile, readFileWithEncoding)
  })

  ipcMain.handle('file:extractKnowledgeDocxText', async (_event, filePath: string) => {
    return extractKnowledgeDocxText(filePath)
  })

  ipcMain.handle('file:extractKnowledgeDocText', async (_event, filePath: string) => {
    return extractKnowledgeDocText(filePath)
  })

  ipcMain.handle('file:extractKnowledgeXlsxText', async (_event, filePath: string) => {
    return extractKnowledgeXlsxText(filePath)
  })

  ipcMain.handle('file:extractKnowledgePptText', async (_event, filePath: string) => {
    return extractKnowledgePptText(filePath)
  })

  ipcMain.handle('file:extractKnowledgePdfText', async (_event, filePath: string) => {
    return extractKnowledgePdfText(filePath)
  })

  ipcMain.handle('file:readDir', async (_, dirPath: string) => {
    if (!dirPath) return []
    if (securityManager.isSensitivePath(dirPath)) return []

    try {
      const items = await fsPromises.readdir(dirPath, { withFileTypes: true })
      return items.map((item) => ({
        name: item.name,
        path: path.join(dirPath, item.name),
        isDirectory: item.isDirectory(),
      }))
    } catch {
      return []
    }
  })

  // 获取目录树
  ipcMain.handle('file:getTree', async (_, dirPath: string, maxDepth = 2) => {
    if (!dirPath || maxDepth < 0) return ''
    if (securityManager.isSensitivePath(dirPath)) return ''

    const buildTree = async (currentPath: string, currentDepth: number): Promise<string> => {
      if (currentDepth >= maxDepth) return ''
      try {
        const items = await fsPromises.readdir(currentPath, { withFileTypes: true })
        let result = ''
        for (const item of items) {
          const fullPath = path.join(currentPath, item.name)
          const indent = '  '.repeat(currentDepth)
          if (item.isDirectory()) {
            result += `${indent}📁 ${item.name}/\n`
            result += await buildTree(fullPath, currentDepth + 1)
          } else {
            result += `${indent}📄 ${item.name}\n`
          }
        }
        return result
      } catch {
        return ''
      }
    }
    return await buildTree(dirPath, 0)
  })

  // 读取文件（无弹窗，使用拆分的 fileUtils）
  ipcMain.handle('file:read', async (event, filePath: string) => {
    if (!filePath) return null

    // 跳过虚拟协议路径（如 git-diff://、diff:// 等），这些不是真实文件路径
    if (/^[a-zA-Z][\w-]*:\/\//.test(filePath) && !(/^[a-zA-Z]:\\/.test(filePath))) {
      return null
    }

    const workspace = getWorkspaceSessionFn(event)

    // 强制工作区边界
    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return null
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const stats = await fsPromises.stat(filePath)
      // 使用拆分的 fileUtils 函数
      const content =
        stats.size > 5 * 1024 * 1024
          ? await readLargeFile(filePath, 0, 10000)
          : await readFileWithEncoding(filePath)

      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        size: stats.size,
        bypass: true,
      })
      return content
    } catch (err) {
      // 文件不存在是正常情况（如可选的规则文件），不记录为 ERROR
      if (toAppError(err).code === ErrorCode.FILE_NOT_FOUND || (err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        logger.security.debug('[File] not found:', filePath)
      } else {
        logger.security.error('[File] read failed:', filePath, toAppError(err).message)
      }
      return null
    }
  })

  // 读取二进制文件为 base64
  ipcMain.handle('file:readBinary', async (event, filePath: string) => {
    if (!filePath) return null
    const workspace = getWorkspaceSessionFn(event)

    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return null
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const stats = await fsPromises.stat(filePath)
      if (stats.size > 50 * 1024 * 1024) {
        return null
      }

      const buffer = await fsPromises.readFile(filePath)
      const base64 = buffer.toString('base64')

      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        size: stats.size,
        binary: true,
      })
      return base64
    } catch (err) {
      logger.security.error('[File] read binary failed:', filePath, toAppError(err).message)
      return null
    }
  })

  // 提取 .doc 文件文本
  ipcMain.handle('file:extractDocText', async (event, filePath: string) => {
    if (!filePath) return null
    const workspace = getWorkspaceSessionFn(event)

    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return null
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const WordExtractor = (await import('word-extractor')).default
      const extractor = new WordExtractor()
      const extracted = await extractor.extract(filePath)
      const text = extracted.getBody()
      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        docTextExtraction: true,
      })
      return text
    } catch (err) {
      logger.security.error('[File] extract doc text failed:', filePath, toAppError(err).message)
      return null
    }
  })

  // 提取 .ppt 文件文本
  ipcMain.handle('file:extractPptText', async (event, filePath: string) => {
    if (!filePath) return null
    const workspace = getWorkspaceSessionFn(event)

    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return null
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const officeParser = (await import('officeparser')).default
      const text = await officeParser.parseOffice(filePath)
      const result = typeof text === 'string' ? text : (text as any)?.toText?.() || String(text)
      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        pptTextExtraction: true,
      })
      return result
    } catch (err) {
      logger.security.error('[File] extract ppt text failed:', filePath, toAppError(err).message)
      return null
    }
  })

  ipcMain.handle('file:extractDocxText', async (event, filePath: string) => {
    if (!filePath) return null
    const workspace = getWorkspaceSessionFn(event)

    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return null
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        docxTextExtraction: true,
      })
      return result.value
    } catch (err) {
      logger.security.error('[File] extract docx text failed:', filePath, toAppError(err).message)
      return null
    }
  })

  ipcMain.handle('file:extractXlsxText', async (event, filePath: string) => {
    if (!filePath) return null
    const workspace = getWorkspaceSessionFn(event)

    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return null
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.readFile(filePath)
      const lines: string[] = []
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        const csv = XLSX.utils.sheet_to_csv(sheet)
        lines.push(`## Sheet: ${sheetName}\n${csv}`)
      }
      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        xlsxTextExtraction: true,
      })
      return lines.join('\n\n')
    } catch (err) {
      logger.security.error('[File] extract xlsx text failed:', filePath, toAppError(err).message)
      return null
    }
  })

  ipcMain.handle('file:extractPdfText', async (event, filePath: string) => {
    if (!filePath) return null
    const workspace = getWorkspaceSessionFn(event)

    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return null
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const pdfParse = await import('pdf-parse')
      const dataBuffer = await import('fs').then(fs => fs.promises.readFile(filePath))
      const data = await (pdfParse as any).default(dataBuffer)
      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        pdfTextExtraction: true,
      })
      return data.text
    } catch (err) {
      logger.security.error('[File] extract pdf text failed:', filePath, toAppError(err).message)
      return null
    }
  })

  // 写入文件（无弹窗）
  ipcMain.handle('file:write', async (event, filePath: string, content: string) => {
    if (!filePath || typeof filePath !== 'string') return false
    if (content === undefined || content === null) return false

    const workspace = getWorkspaceSessionFn(event)
    const securityCheck = validateFileOperation(
      filePath,
      workspace,
      OperationType.FILE_WRITE,
    )
    if (!securityCheck.passed) return false

    try {
      await ensureParentDir(filePath)
      const isNew = await isNewFile(filePath)
      // 使用带重试 + 原子写入的安全写入：
      // - 原子写入：写入同目录临时文件后 rename 替换，避免部分写入和大部分文件锁冲突
      // - 自动重试：对 EBUSY/EAGAIN/EACCES 等瞬时错误最多重试 3 次，间隔递增
      // 解决 AI 写文件偶尔失败的常见原因（文件被 LSP/编辑器/Git 短暂占用等）
      const success = await writeFileWithRetry(filePath, content, 'utf-8')
      if (!success) {
        logFileFailure(OperationType.FILE_WRITE, filePath, new Error('writeFileWithRetry returned false after retries'))
        return false
      }
      logFileSuccess(OperationType.FILE_WRITE, filePath, {
        size: content.length,
        bypass: true,
      })
      // 主动通知渲染进程文件变更
      notifyFileChanged(getMainWindowFn, {
        event: isNew ? 'create' : 'update',
        path: filePath,
      })
      return true
    } catch (err) {
      logFileFailure(OperationType.FILE_WRITE, filePath, err)
      return false
    }
  })

  // 写入二进制文件（base64 编码），用于保存用户上传的附件
  ipcMain.handle('file:writeBinary', async (event, filePath: string, base64Data: string) => {
    if (!filePath || typeof filePath !== 'string') return false
    if (!base64Data || typeof base64Data !== 'string') return false

    const workspace = getWorkspaceSessionFn(event)
    const securityCheck = validateFileOperation(
      filePath,
      workspace,
      OperationType.FILE_WRITE,
      true,
    )
    if (!securityCheck.passed) return false

    try {
      await ensureParentDir(filePath)
      const isNew = await isNewFile(filePath)
      const buffer = Buffer.from(base64Data, 'base64')
      // 二进制写入同样使用重试 + 原子写入，避免附件保存失败
      const success = await writeBinaryFileWithRetry(filePath, buffer)
      if (!success) {
        logger.security.error('[File] write binary failed (retries exhausted):', filePath)
        return false
      }
      logFileSuccess(OperationType.FILE_WRITE, filePath, {
        size: buffer.length,
        binary: true,
        bypass: true,
      })
      // 主动通知渲染进程文件变更
      notifyFileChanged(getMainWindowFn, {
        event: isNew ? 'create' : 'update',
        path: filePath,
      })
      return true
    } catch (err) {
      logger.security.error('[File] write binary failed:', filePath, toAppError(err).message)
      return false
    }
  })

  // 确保目录存在
  ipcMain.handle('file:ensureDir', async (event, dirPath: string) => {
    if (!dirPath) return false
    const workspace = getWorkspaceSessionFn(event)
    if (workspace && !securityManager.validateWorkspacePath(dirPath, workspace.roots)) return false
    if (securityManager.isSensitivePath(dirPath)) return false
    try {
      await fsPromises.mkdir(dirPath, { recursive: true })
      return true
    } catch {
      return false
    }
  })

  // 保存文件（带对话框支持）
  ipcMain.handle('file:save', async (event, content: string, currentPath?: string) => {
    if (currentPath) {
      if (securityManager.isSensitivePath(currentPath)) return null

      const workspace = getWorkspaceSessionFn(event)
      if (workspace && !securityManager.validateWorkspacePath(currentPath, workspace.roots)) {
        securityManager.logOperation(OperationType.FILE_WRITE, currentPath, false, {
          reason: '安全底线：超出工作区边界',
        })
        return null
      }

      try {
        const dir = path.dirname(currentPath)
        const isNewFile = !fs.existsSync(currentPath)
        await fsPromises.mkdir(dir, { recursive: true })
        await fsPromises.writeFile(currentPath, content, 'utf-8')
        securityManager.logOperation(OperationType.FILE_WRITE, currentPath, true)
        // 主动通知渲染进程文件变更
        notifyFileChanged(getMainWindowFn, {
          event: isNewFile ? 'create' : 'update',
          path: currentPath,
        })
        return currentPath
      } catch {
        return null
      }
    }

    // 新建文件：需要选择路径
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const workspace = getWorkspaceSessionFn(event)
    const defaultPath =
      workspace && workspace.roots.length > 0 ? workspace.roots[0] : require('os').homedir()

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })

    if (!result.canceled && result.filePath) {
      const savePath = result.filePath
      if (securityManager.isSensitivePath(savePath)) {
        showSecurityError(mainWindow, '安全警告', '不允许保存到系统敏感路径')
        return null
      }

      try {
        await fsPromises.writeFile(savePath, content, 'utf-8')
        securityManager.logOperation(OperationType.FILE_WRITE, savePath, true, {
          isNewFile: true,
          bypass: true,
        })
        // 主动通知渲染进程文件创建
        notifyFileChanged(getMainWindowFn, {
          event: 'create',
          path: savePath,
        })
        return savePath
      } catch {
        return null
      }
    }
    return null
  })

  // 文件是否存在
  ipcMain.handle('file:exists', async (event, filePath: string) => {
    if (securityManager.isSensitivePath(filePath)) return false

    const workspace = getWorkspaceSessionFn(event)
    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      return false
    }

    try {
      await fsPromises.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 创建目录（无弹窗）
  ipcMain.handle('file:mkdir', async (event, dirPath: string) => {
    if (!dirPath || typeof dirPath !== 'string') return false
    const workspace = getWorkspaceSessionFn(event)
    if (workspace && !securityManager.validateWorkspacePath(dirPath, workspace.roots)) return false
    if (securityManager.isSensitivePath(dirPath)) return false

    try {
      const isNewDir = !fs.existsSync(dirPath)
      await fsPromises.mkdir(dirPath, { recursive: true })
      securityManager.logOperation(OperationType.FILE_WRITE, dirPath, true, {
        isDirectory: true,
        bypass: true,
      })
      // 主动通知渲染进程目录创建
      if (isNewDir) {
        notifyFileChanged(getMainWindowFn, {
          event: 'create',
          path: dirPath,
        })
      }
      return true
    } catch (err) {
      logger.security.error('[File] mkdir failed:', dirPath, toAppError(err).message)
      return false
    }
  })

  // 递归计算目录大小
  async function calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        totalSize += await calculateDirectorySize(entryPath)
      } else {
        const stat = await fsPromises.stat(entryPath)
        totalSize += stat.size
      }
      // 提前退出：超过阈值无需继续统计
      if (totalSize > 100 * 1024 * 1024) break
    }
    return totalSize
  }

  // 删除文件/目录（无弹窗，仅底线检查）
  ipcMain.handle('file:delete', async (event, filePath: string) => {
    if (!filePath) return false
    const workspace = getWorkspaceSessionFn(event)
    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return false
    }
    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return false
    }

    // 关键配置文件保护
    const criticalFiles = [/\.env$/i, /package-lock\.json$/i, /yarn\.lock$/i, /pnpm-lock\.yaml$/i]
    for (const pattern of criticalFiles) {
      if (pattern.test(filePath)) {
        securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
          reason: '安全底线：关键配置文件',
        })
        return false
      }
    }

    // 工作区系统目录保护（.aweeclaw 及其子文件/子目录）
    const normalizedPath = path.normalize(filePath).replace(/\\/g, '/')
    const pathSegments = normalizedPath.split('/')
    const aweeclawIndex = pathSegments.findIndex(seg => seg === '.aweeclaw')
    if (aweeclawIndex !== -1) {
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
        reason: '安全底线：工作区系统目录 (.aweeclaw)',
      })
      showSecurityError(
        getMainWindowFn(),
        '安全警告',
        '不允许删除工作区系统目录 (.aweeclaw) 及其内容，该目录存储了项目配置、记忆和索引数据。',
      )
      return false
    }

    // 大目录保护
    try {
      const stat = await fsPromises.stat(filePath)
      if (stat.isDirectory()) {
        const dirSize = await calculateDirectorySize(filePath)
        if (dirSize > 100 * 1024 * 1024) {
          securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
            reason: `安全底线：目录过大 (${(dirSize / 1024 / 1024).toFixed(1)}MB)`,
          })
          return false
        }
      }
    } catch {
      return false
    }

    try {
      const stat = await fsPromises.stat(filePath)
      if (stat.isDirectory()) {
        await fsPromises.rm(filePath, { recursive: true, force: true })
      } else {
        await fsPromises.unlink(filePath)
      }
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, true, {
        size: stat.size,
        bypass: true,
      })
      // 主动通知渲染进程文件/目录删除
      notifyFileChanged(getMainWindowFn, {
        event: 'delete',
        path: filePath,
      })
      return true
    } catch (err) {
      logger.security.error('[File] delete failed:', filePath, toAppError(err).message)
      return false
    }
  })

  // 复制文件（无弹窗）
  ipcMain.handle('file:copy', async (event, sourcePath: string, destinationPath: string) => {
    if (!sourcePath || !destinationPath) return false
    const workspace = getWorkspaceSessionFn(event)
    if (workspace && (!securityManager.validateWorkspacePath(sourcePath, workspace.roots) || !securityManager.validateWorkspacePath(destinationPath, workspace.roots))) {
      securityManager.logOperation(OperationType.FILE_WRITE, sourcePath, false, {
        reason: '安全底线：超出工作区边界',
        destinationPath,
      })
      return false
    }
    if (securityManager.isSensitivePath(sourcePath) || securityManager.isSensitivePath(destinationPath)) {
      securityManager.logOperation(OperationType.FILE_WRITE, sourcePath, false, {
        reason: '安全底线：敏感路径',
        destinationPath,
      })
      return false
    }

    try {
      const stat = await fsPromises.stat(sourcePath)
      await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true })
      if (stat.isDirectory()) {
        await fsPromises.cp(sourcePath, destinationPath, {
          recursive: true,
          errorOnExist: true,
          force: false,
        })
      } else {
        await fsPromises.copyFile(sourcePath, destinationPath)
      }
      securityManager.logOperation(OperationType.FILE_WRITE, sourcePath, true, {
        destinationPath,
        isDirectory: stat.isDirectory(),
        bypass: true,
      })
      // 主动通知渲染进程文件创建
      notifyFileChanged(getMainWindowFn, {
        event: 'create',
        path: destinationPath,
      })
      return true
    } catch (err) {
      logger.security.error('[File] copy failed:', sourcePath, toAppError(err).message)
      return false
    }
  })

  // 重命名文件（无弹窗）
  ipcMain.handle('file:rename', async (event, oldPath: string, newPath: string) => {
    if (!oldPath || !newPath) return false
    const workspace = getWorkspaceSessionFn(event)
    if (workspace && (!securityManager.validateWorkspacePath(oldPath, workspace.roots) || !securityManager.validateWorkspacePath(newPath, workspace.roots))) {
      securityManager.logOperation(OperationType.FILE_RENAME, oldPath, false, {
        reason: '安全底线：超出工作区边界',
        newPath,
      })
      return false
    }
    if (securityManager.isSensitivePath(oldPath) || securityManager.isSensitivePath(newPath)) {
      securityManager.logOperation(OperationType.FILE_RENAME, oldPath, false, {
        reason: '安全底线：敏感路径',
        newPath,
      })
      return false
    }

    try {
      await fsPromises.rename(oldPath, newPath)
      securityManager.logOperation(OperationType.FILE_RENAME, oldPath, true, {
        newPath,
        bypass: true,
      })
      // 主动通知渲染进程：旧路径删除 + 新路径创建
      notifyFileChanged(getMainWindowFn, {
        event: 'delete',
        path: oldPath,
      })
      notifyFileChanged(getMainWindowFn, {
        event: 'create',
        path: newPath,
      })
      return true
    } catch (err) {
      logger.security.error('[File] rename failed:', oldPath, toAppError(err).message)
      return false
    }
  })

  // 在文件管理器中显示
  ipcMain.handle('file:showInFolder', async (_, filePath: string) => {
    try {
      shell.showItemInFolder(filePath)
      return true
    } catch {
      return false
    }
  })

  // 在浏览器中打开文件（使用 shell.openPath 直接调用系统默认程序，不经过 URL 协议白名单）
  ipcMain.handle('file:openInBrowser', async (_, filePath: string) => {
    try {
      await fsPromises.access(filePath)
      const errorMessage = await shell.openPath(filePath)
      // openPath 成功返回空字符串，失败返回错误消息
      return !errorMessage
    } catch {
      return false
    }
  })

  ipcMain.handle('shell:openExternalUrl', async (_, rawUrl: string) => {
    return await safeOpenExternal(rawUrl)
  })

  // 文件监听（使用拆分的 fileWatcher）
  ipcMain.handle('file:watch', (_, action: string) => {
    if (action === 'start') {
      const win = getMainWindowFn()
      const workspace = getWorkspaceSessionFn()
      if (win && workspace?.roots?.[0]) {
        void setupFileWatcher(`window-${win.webContents.id}`, workspace.roots[0], (data: FileWatcherEvent) => {
          win.webContents.send('file:changed', data)
        })
      }
    } else if (action === 'stop') {
      const win = getMainWindowFn()
      void cleanupFileWatcher(win ? `window-${win.webContents.id}` : undefined)
    }
  })

  // ========== 安全权限功能 ==========

  ipcMain.handle('security:getPermissions', () => {
    const securityStore = new Store({ name: 'security' })
    return securityStore.get('permissions', {})
  })

  ipcMain.handle('security:resetPermissions', () => {
    const securityStore = new Store({ name: 'security' })
    securityStore.delete('permissions')
    return true
  })
}

/**
 * 清理安全文件监听器
 * 导出以便外部调用
 */
export function cleanupSecureFileWatcher() {
  cleanupFileWatcher()
}

// 导出安全管理器
export { securityManager }

// 重新导出拆分模块的类型和函数，方便外部使用
export type { FileWatcherEvent, WindowManagerContext }
export { setupFileWatcher, cleanupFileWatcher } from './fileSystemObserver'
export { readFileWithEncoding, readLargeFile } from './fileAccessControl'
