/**
 * LSP 语言服务桥接 — LSP 服务器的 IPC 处理器
 *
 * 职责：
 * - 暴露 LSP 服务器的安装、状态查询、诊断获取等 IPC 接口
 * - 桥接渲染进程与主进程的 LSP 管理器（lspManager）
 * - 支持自定义 LSP 二进制目录
 * - 提供文件路径到语言 ID 的映射
 */

import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { promises as fs } from 'node:fs'
import { ipcMain } from 'electron'
import { lspManager, LanguageId } from '../../language-server/languageServerManager'
import { EXTENSION_TO_LANGUAGE } from '@shared/languageRegistry'
import {
  getLspServerStatus,
  installServer,
  installBasicServers,
  getLspBinDir,
  getDefaultLspBinDir,
  setCustomLspBinDir,
} from '../../language-server/serverInstaller'
import { lspUriToPath } from '@shared/toolkit/uriHelper'
import { LSP_DEFAULTS } from '@shared/configuration/defaultProfile'

function getFallbackRoot(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return normalized || '/'
  return normalized.slice(0, lastSlash)
}

function getLanguageId(filePath: string): LanguageId | null {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const lang = EXTENSION_TO_LANGUAGE[ext]
  // 只返回 LSP 支持的语言
  return lang as LanguageId | null
}

function getLanguageIdFromUri(uri: string): string {
  const filePath = lspUriToPath(uri)
  return getLanguageId(filePath) || 'plaintext'
}

/**
 * 「语言 + 文件目录」到 LSP 实例 key 的缓存
 *
 * ensureServerForFile 每次都会跑一遍 findBestRoot（逐级向上找 package.json /
 * pyproject.toml 等）再确保服务器存活。悬停、补全、跳转这类请求按鼠标动作触发，
 * 横穿一行代码就会重复十几次，磁盘遍历成了每个请求的固定开销。
 * 同目录下的文件根目录必然相同，缓存到目录粒度即可消除这部分重复。
 *
 * 实例被空闲回收或崩溃移除后缓存自动失效：命中前会校验服务器仍在运行。
 */
const serverKeyCache = new Map<string, string>()
const SERVER_KEY_CACHE_MAX = 500

function cacheServerKey(cacheKey: string, serverKey: string): void {
  if (serverKeyCache.size >= SERVER_KEY_CACHE_MAX) serverKeyCache.clear()
  serverKeyCache.set(cacheKey, serverKey)
}

/** 清空实例缓存（工作空间切换 / 服务器全部停止时调用） */
export function resetServerKeyCache(): void {
  serverKeyCache.clear()
}

/**
 * 请求前确保文档已在服务器侧打开
 *
 * 渲染进程只在自己首次打开文件时发 didOpen。主进程这边的服务器可能因空闲回收、
 * 崩溃重启或进程数超限被淘汰后重建，而渲染进程仍认为文档处于打开状态，不会重发。
 * 服务器手里没有该文档时，hover / 定义 / 引用一律返回空，表现就是「编辑器突然
 * 失去智能提示」。这里在请求前补齐：未打开则从磁盘读取并补发一次 didOpen。
 *
 * 有未保存修改的文档走的是另一条链路 —— didChange 处理器在发现文档未打开时
 * 会带上内存中的文本补 didOpen，因此这里读到的是与编辑器一致的内容。
 */
async function ensureDocumentOpened(serverName: string, uri: string): Promise<void> {
  if (lspManager.isDocumentOpen(serverName, uri)) return

  const filePath = lspUriToPath(uri)
  const languageId = getLanguageId(filePath)
  if (!languageId) return

  try {
    const text = await fs.readFile(filePath, 'utf-8')
    lspManager.trackDocumentOpen(serverName, uri, languageId, 1, text)
    lspManager.sendNotification(serverName, 'textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    })
  } catch {
    // 文件不可读时交给具体请求返回空结果，不额外报错
  }
}

async function getServerForUri(uri: string, workspacePath: string): Promise<string | null> {
  const filePath = lspUriToPath(uri)
  const effectiveWorkspacePath = workspacePath || getFallbackRoot(filePath)

  const languageId = getLanguageId(filePath)
  if (!languageId) return null

  const dir = filePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '') || '/'
  const cacheKey = `${languageId}@${dir}@${effectiveWorkspacePath}`

  const cached = serverKeyCache.get(cacheKey)
  if (cached && lspManager.getRunningServers().includes(cached)) {
    return cached
  }

  // 使用智能根目录检测启动服务器
  const serverKey = await lspManager.ensureServerForFile(filePath, languageId, effectiveWorkspacePath)
  if (serverKey) cacheServerKey(cacheKey, serverKey)
  return serverKey
}

// preferencesStore 引用，用于保存 LSP 配置
let _preferencesStore: any = null

export function registerLspHandlers(preferencesStore?: any): void {
  _preferencesStore = preferencesStore

  // 启动服务器
  ipcMain.handle('lsp:start', async (_, workspacePath: string) => {
    const success = await lspManager.startServer('typescript', workspacePath)
    return { success }
  })

  // 启动指定语言的服务器
  ipcMain.handle('lsp:startForLanguage', async (_, params: { languageId: LanguageId; workspacePath: string }) => {
    const serverName = await lspManager.ensureServerForLanguage(params.languageId, params.workspacePath)
    return { success: !!serverName, serverName }
  })

  // 停止服务器
  ipcMain.handle('lsp:stop', async () => {
    await lspManager.stopAllServers()
    resetServerKeyCache()
    return { success: true }
  })

  // 获取运行中的服务器
  ipcMain.handle('lsp:getRunningServers', () => lspManager.getRunningServers())

  // ============ 文档同步 ============

  ipcMain.handle('lsp:didOpen', async (_, params: { uri: string; languageId: string; version: number; text: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) {
      logger.lsp.warn('[LSP IPC] didOpen skipped: no server available', {
        uri: params.uri,
        languageId: params.languageId,
        workspacePath: params.workspacePath || '',
      })
      return { success: false, serverName: null }
    }

    // 跟踪文档打开状态
    lspManager.trackDocumentOpen(serverName, params.uri, params.languageId, params.version, params.text)

    lspManager.sendNotification(serverName, 'textDocument/didOpen', {
      textDocument: { uri: params.uri, languageId: params.languageId, version: params.version, text: params.text },
    })
    return { success: true, serverName }
  })

  ipcMain.handle('lsp:didChange', async (_, params: { uri: string; version: number; text: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return

    // 如果文档未在服务器上打开（可能服务器重启过），先打开它
    if (!lspManager.isDocumentOpen(serverName, params.uri)) {
      const languageId = getLanguageIdFromUri(params.uri)
      lspManager.trackDocumentOpen(serverName, params.uri, languageId, params.version, params.text)
      lspManager.sendNotification(serverName, 'textDocument/didOpen', {
        textDocument: { uri: params.uri, languageId, version: params.version, text: params.text },
      })
      return
    }

    // 更新跟踪状态
    lspManager.trackDocumentChange(serverName, params.uri, params.version, params.text)

    lspManager.sendNotification(serverName, 'textDocument/didChange', {
      textDocument: { uri: params.uri, version: params.version },
      contentChanges: [{ text: params.text }],
    })
  })

  ipcMain.handle('lsp:didClose', async (_, params: { uri: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return

    // 移除跟踪
    lspManager.trackDocumentClose(serverName, params.uri)

    lspManager.sendNotification(serverName, 'textDocument/didClose', {
      textDocument: { uri: params.uri },
    })
  })

  // 文档保存通知
  ipcMain.handle('lsp:didSave', async (_, params: { uri: string; text?: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return

    lspManager.sendNotification(serverName, 'textDocument/didSave', {
      textDocument: { uri: params.uri },
      text: params.text, // 可选，取决于 capability
    })
  })

  // ============ LSP 请求 ============

  const createPositionHandler = (method: string, timeoutMs?: number) => {
    return async (_: any, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
      const serverName = await getServerForUri(params.uri, params.workspacePath || '')
      // 定位不到实例是「静默失败」的最常见来源：渲染侧只看到请求发出，
      // 收不到任何结果，表现就是悬停一直转圈、跳转无反应。这里必须留痕。
      if (!serverName) {
        logger.lsp.warn('[LSP IPC] no running server for request', {
          method,
          uri: params.uri,
          workspacePath: params.workspacePath || '',
        })
        return null
      }
      await ensureDocumentOpened(serverName, params.uri)

      try {
        const result = await lspManager.sendRequest(serverName, method, {
          textDocument: { uri: params.uri },
          position: { line: params.line, character: params.character },
        }, timeoutMs)
        if (method === 'textDocument/definition') {
          logger.lsp.info('[LSP IPC] Definition result:', {
            serverName,
            uri: params.uri,
            line: params.line,
            character: params.character,
            isArray: Array.isArray(result),
            count: Array.isArray(result) ? result.length : (result ? 1 : 0),
            sampleKeys: result && !Array.isArray(result) ? Object.keys(result) : (Array.isArray(result) && result[0] ? Object.keys(result[0]) : []),
          })
        }
        return result
      } catch (err) {
        // 超时、进程退出、写管道失败都会落到这里。此前是空 catch，
        // 故障在两端日志里都留不下痕迹，只能靠猜。
        logger.lsp.warn('[LSP IPC] request failed', {
          method,
          serverName,
          uri: params.uri,
          line: params.line,
          character: params.character,
          message: toAppError(err).message,
        })
        return null
      }
    }
  }

  ipcMain.handle('lsp:definition', createPositionHandler('textDocument/definition'))
  ipcMain.handle('lsp:typeDefinition', createPositionHandler('textDocument/typeDefinition'))
  ipcMain.handle('lsp:implementation', createPositionHandler('textDocument/implementation'))
  // hover 在主进程侧的超时比渲染侧稍长：渲染侧先放弃并隐藏浮层，
  // 主进程随即清理挂起的请求，避免连续悬停把 pending 队列堆满
  ipcMain.handle('lsp:hover', createPositionHandler('textDocument/hover', LSP_DEFAULTS.hoverTimeoutMs + 2000))
  ipcMain.handle('lsp:completion', createPositionHandler('textDocument/completion'))
  ipcMain.handle('lsp:signatureHelp', createPositionHandler('textDocument/signatureHelp'))
  ipcMain.handle('lsp:documentHighlight', createPositionHandler('textDocument/documentHighlight'))
  ipcMain.handle('lsp:prepareRename', createPositionHandler('textDocument/prepareRename'))

  ipcMain.handle('lsp:references', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null
    await ensureDocumentOpened(serverName, params.uri)

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/references', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        context: { includeDeclaration: true },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:completionResolve', async (_, item: any) => {
    const running = lspManager.getRunningServers()
    if (running.length === 0) return item

    try {
      return await lspManager.sendRequest(running[0], 'completionItem/resolve', item)
    } catch {
      return item
    }
  })

  ipcMain.handle('lsp:documentSymbol', async (_, params: { uri: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null
    await ensureDocumentOpened(serverName, params.uri)

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/documentSymbol', {
        textDocument: { uri: params.uri },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:workspaceSymbol', async (_, params: { query: string }) => {
    const running = lspManager.getRunningServers()
    if (running.length === 0) return []

    const results = await Promise.all(
      running.map(async (serverName) => {
        try {
          return await lspManager.sendRequest(serverName, 'workspace/symbol', { query: params.query })
        } catch {
          return []
        }
      })
    )
    return results.flat()
  })

  ipcMain.handle('lsp:rename', async (_, params: { uri: string; line: number; character: number; newName: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/rename', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        newName: params.newName,
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:codeAction', async (_, params: { uri: string; range: any; diagnostics?: any[]; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/codeAction', {
        textDocument: { uri: params.uri },
        range: params.range,
        context: { diagnostics: params.diagnostics || [], only: ['quickfix', 'refactor', 'source'] },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:formatting', async (_, params: { uri: string; options?: any; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/formatting', {
        textDocument: { uri: params.uri },
        options: params.options || { tabSize: 2, insertSpaces: true },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:rangeFormatting', async (_, params: { uri: string; range: any; options?: any; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/rangeFormatting', {
        textDocument: { uri: params.uri },
        range: params.range,
        options: params.options || { tabSize: 2, insertSpaces: true },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:foldingRange', async (_, params: { uri: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/foldingRange', {
        textDocument: { uri: params.uri },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:inlayHint', async (_, params: { uri: string; range: any; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/inlayHint', {
        textDocument: { uri: params.uri },
        range: params.range,
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:getDiagnostics', (_, filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/')
    const uri = /^[a-zA-Z]:/.test(normalizedPath)
      ? `file:///${normalizedPath}`
      : `file://${normalizedPath}`
    return lspManager.getDiagnostics(uri)
  })

  // ============ Call Hierarchy 支持 ============

  ipcMain.handle('lsp:prepareCallHierarchy', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.prepareCallHierarchy(serverName, params.uri, params.line, params.character)
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:incomingCalls', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      // 先获取 call hierarchy item
      const items = await lspManager.prepareCallHierarchy(serverName, params.uri, params.line, params.character)
      if (!items || items.length === 0) return []

      // 获取 incoming calls
      return await lspManager.getIncomingCalls(serverName, items[0])
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:outgoingCalls', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      // 先获取 call hierarchy item
      const items = await lspManager.prepareCallHierarchy(serverName, params.uri, params.line, params.character)
      if (!items || items.length === 0) return []

      // 获取 outgoing calls
      return await lspManager.getOutgoingCalls(serverName, items[0])
    } catch {
      return null
    }
  })

  // ============ waitForDiagnostics 支持 ============

  ipcMain.handle('lsp:waitForDiagnostics', async (_, params: { uri: string }) => {
    try {
      await lspManager.waitForDiagnostics(params.uri)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  // ============ 智能根目录检测 ============

  ipcMain.handle('lsp:findBestRoot', async (_, params: { filePath: string; languageId: LanguageId; workspacePath: string }) => {
    try {
      return await lspManager.findBestRoot(params.filePath, params.languageId, params.workspacePath)
    } catch {
      return params.workspacePath
    }
  })

  ipcMain.handle('lsp:ensureServerForFile', async (_, params: { filePath: string; languageId: LanguageId; workspacePath: string }) => {
    const serverName = await lspManager.ensureServerForFile(params.filePath, params.languageId, params.workspacePath)
    return { success: !!serverName, serverName }
  })

  // ============ 文件监视通知 ============

  ipcMain.handle('lsp:didChangeWatchedFiles', async (_, params: { changes: Array<{ uri: string; type: number }>; workspacePath?: string }) => {
    const running = lspManager.getRunningServers()
    for (const serverKey of running) {
      lspManager.notifyDidChangeWatchedFiles(serverKey, params.changes)
    }
  })

  // ============ 获取支持的语言 ============

  ipcMain.handle('lsp:getSupportedLanguages', () => {
    return lspManager.getSupportedLanguages()
  })

  // ============ LSP 服务器安装管理 ============

  ipcMain.handle('lsp:getServerStatus', () => {
    return getLspServerStatus()
  })

  ipcMain.handle('lsp:getBinDir', () => {
    return getLspBinDir()
  })

  ipcMain.handle('lsp:getDefaultBinDir', () => {
    return getDefaultLspBinDir()
  })

  ipcMain.handle('lsp:setCustomBinDir', (_, customPath: string | null) => {
    setCustomLspBinDir(customPath)
    // 保存到配置文件
    if (_preferencesStore) {
      if (customPath) {
        _preferencesStore.set('lspSettings.customBinDir', customPath)
      } else {
        _preferencesStore.delete('lspSettings.customBinDir')
      }
    }
    return { success: true }
  })

  ipcMain.handle('lsp:installServer', async (_, serverType: string) => {
    try {
      return await installServer(serverType)
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  ipcMain.handle('lsp:installBasicServers', async () => {
    try {
      await installBasicServers()
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  logger.lsp.info('[LSP IPC] Handlers registered')
}
