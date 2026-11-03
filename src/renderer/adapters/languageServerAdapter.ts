/**
 * LSP 服务 - 渲染进程端
 * 支持多根目录工作空间
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { EXTENSION_TO_LANGUAGE, LSP_SUPPORTED_LANGUAGES } from '@shared/languageRegistry'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { pathToLspUri } from '@shared/toolkit/uriHelper'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { isLspAvailable } from '@renderer/modes/lspAvailability'

/**
 * 当前场景是否允许发起 LSP 请求
 *
 * provider 注册在 monaco 全局实例上且无法撤销，从代码开发场景切走后它们仍然挂着。
 * 服务已经停止，若不在请求入口拦截，每次悬停 / 补全都会走一趟 IPC 到主进程
 * 再以「no running server」失败——结果正确但白耗跨进程往返，日志也会被刷满。
 */
function isLspRequestAllowed(): boolean {
  return isLspAvailable(useSceneModeStore.getState().currentSceneMode)
}

// 文档版本追踪
const documentVersions = new Map<string, number>()
const openedDocuments = new Set<string>()

/** 查找引用的渲染侧超时：超过后落错误态，避免面板无限加载 */
const REFERENCES_TIMEOUT_MS = 15000

function getFileDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return normalized || '/'
  return normalized.slice(0, lastSlash)
}

// ===== 内部辅助函数 =====

/**
 * LSP 请求参数类型
 */
interface LspRequestParams {
  uri: string
  workspacePath: string | null
}

interface LspPositionParams extends LspRequestParams {
  line: number
  character: number
}

interface LspDocumentParams extends LspRequestParams {
  text: string
}

interface NormalizedLspLocation {
  uri: string
  range: any
}

function normalizeLspLocation(location: any): NormalizedLspLocation | null {
  if (!location || typeof location !== 'object') return null

  if (typeof location.uri === 'string' && location.range) {
    return {
      uri: location.uri,
      range: location.range,
    }
  }

  if (typeof location.targetUri === 'string' && (location.targetSelectionRange || location.targetRange)) {
    return {
      uri: location.targetUri,
      range: location.targetSelectionRange || location.targetRange,
    }
  }

  return null
}

/**
 * 执行 LSP 请求的通用包装器
 * 处理 URI 转换、工作空间路径获取、错误处理
 */
async function executeLspRequest<T>(
  filePath: string,
  request: (params: LspRequestParams) => Promise<T>,
  defaultValue: T
): Promise<T> {
  if (!isLspRequestAllowed()) return defaultValue

  const uri = pathToLspUri(filePath)
  const workspacePath = getFileWorkspaceRoot(filePath)
  try {
    return await request({ uri, workspacePath })
  } catch {
    return defaultValue
  }
}

/**
 * 执行带位置参数的 LSP 请求
 */
async function executeLspPositionRequest<T>(
  filePath: string,
  line: number,
  character: number,
  request: (params: LspPositionParams) => Promise<T>,
  defaultValue: T
): Promise<T> {
  if (!isLspRequestAllowed()) return defaultValue

  const uri = pathToLspUri(filePath)
  const workspacePath = getFileWorkspaceRoot(filePath)
  try {
    return await request({ uri, line, character, workspacePath })
  } catch (err) {
    // 静默返回默认值会让「请求失败」与「确实没有结果」无法区分，
    // 排查时只能看到 provider 返回空。保留一条 debug 记录。
    logger.lsp.debug('[LSP] position request failed', {
      filePath,
      line,
      character,
      message: toAppError(err).message,
    })
    return defaultValue
  }
}

/**
 * 获取文件所属的工作空间根目录
 */
export function getFileWorkspaceRoot(filePath: string): string | null {
  const { workspace } = useStore.getState()
  if (!workspace || workspace.roots.length === 0) return getFileDirectory(filePath)

  // 找到最长匹配的根目录（处理嵌套情况）
  const normalizedPath = filePath.replace(/\\/g, '/')
  let bestMatch: string | null = null

  for (const root of workspace.roots) {
    const normalizedRoot = root.replace(/\\/g, '/')
    if (normalizedPath.startsWith(normalizedRoot)) {
      if (!bestMatch || normalizedRoot.length > bestMatch.length) {
        bestMatch = root
      }
    }
  }

  return bestMatch || workspace.roots[0] || getFileDirectory(filePath)
}

/**
 * 获取文件的语言 ID
 */
export function getLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return EXTENSION_TO_LANGUAGE[ext] || 'plaintext'
}

/**
 * 检查语言是否支持 LSP
 */
export function isLanguageSupported(languageId: string): boolean {
  return (LSP_SUPPORTED_LANGUAGES as readonly string[]).includes(languageId)
}

/**
 * 启动 LSP 服务器
 */
export async function startLspServer(workspacePath: string): Promise<boolean> {
  try {
    const result = await api.lsp.start(workspacePath)
    return result.success
  } catch (err) {
    const error = toAppError(err)
    logger.lsp.error(`[LSP] Failed to start: ${error.code}`, error)
    return false
  }
}

/**
 * 停止 LSP 服务器
 */
export async function stopLspServer(): Promise<void> {
  try {
    await api.lsp.stop()
    documentVersions.clear()
    openedDocuments.clear()
  } catch (err) {
    const error = toAppError(err)
    logger.lsp.error(`[LSP] Failed to stop: ${error.code}`, error)
  }
}

/**
 * 重置 LSP 服务状态（工作空间切换时调用）
 * 只清理客户端状态，不停止服务器
 */
export function resetLspState(): void {
  documentVersions.clear()
  openedDocuments.clear()
  logger.lsp.info('[LSP] State reset')
}

async function openDocumentIfNeeded(filePath: string, content: string): Promise<boolean> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) {
    return false
  }

  if (openedDocuments.has(uri)) {
    return true
  }

  const version = 1
  const workspacePath = getFileWorkspaceRoot(filePath)
  const params: LspDocumentParams & { languageId: string; version: number } = {
    uri,
    languageId,
    version,
    text: content,
    workspacePath,
  }
  const result = await api.lsp.didOpen(params)
  if (!result?.success) {
    logger.lsp.warn('[LSP] didOpen failed or server unavailable', {
      filePath,
      uri,
      languageId,
      workspacePath,
    })
    return false
  }

  documentVersions.set(uri, version)
  openedDocuments.add(uri)

  // Pyright needs an initial didChange after open to trigger diagnostics.
  if (languageId === 'python') {
    setTimeout(() => {
      didChangeDocument(filePath, content)
    }, 100)
  }

  return true
}

/**
 * 通知服务器文档已打开
 * 使用智能根目录检测来启动正确的 LSP 服务器
 */
export async function didOpenDocument(filePath: string, content: string): Promise<boolean> {
  const uri = pathToLspUri(filePath)
  const wasAlreadyOpen = openedDocuments.has(uri)
  const opened = await openDocumentIfNeeded(filePath, content)
  if (!opened) {
    return false
  }

  if (wasAlreadyOpen) {
    await didChangeDocument(filePath, content)
  }

  return true
}

/**
 * 通知服务器文档已变更
 */
export async function didChangeDocument(filePath: string, content: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return

  const newVersion = (documentVersions.get(uri) || 0) + 1
  documentVersions.set(uri, newVersion)

  const workspacePath = getFileWorkspaceRoot(filePath)
  const params: LspDocumentParams & { version: number } = {
    uri,
    version: newVersion,
    text: content,
    workspacePath,
  }
  await api.lsp.didChange(params)
}

/**
 * 通知服务器文档已关闭
 */
export async function didCloseDocument(filePath: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return

  documentVersions.delete(uri)
  openedDocuments.delete(uri)

  const workspacePath = getFileWorkspaceRoot(filePath)
  const params: LspRequestParams = {
    uri,
    workspacePath,
  }
  await api.lsp.didClose(params)
}

/**
 * 通知服务器文档已保存
 */
export async function didSaveDocument(filePath: string, content?: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return

  const workspacePath = getFileWorkspaceRoot(filePath)
  const params: LspRequestParams & { text?: string } = {
    uri,
    text: content, // 可选：一些 LSP 需要保存时的文本内容
    workspacePath,
  }
  await api.lsp.didSave?.(params)
}

/**
 * 跳转到定义
 */
export async function goToDefinition(
  filePath: string,
  line: number,
  character: number,
  documentText?: string
): Promise<{ uri: string; range: any }[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    async (params) => {
      if (typeof documentText === 'string') {
        await openDocumentIfNeeded(filePath, documentText)
      }
      logger.lsp.info('[LSP] Go to definition request:', {
        filePath,
        uri: params.uri,
        workspacePath: params.workspacePath,
        line,
        character,
      })
      const result = await api.lsp.definition(params)
      if (!result) return null
      const normalized = (Array.isArray(result) ? result : [result])
        .map(normalizeLspLocation)
        .filter((location): location is NormalizedLspLocation => location !== null)
      logger.lsp.info('[LSP] Go to definition normalized result:', {
        filePath,
        rawCount: Array.isArray(result) ? result.length : 1,
        normalizedCount: normalized.length,
        first: normalized[0] || null,
      })
      return normalized.length > 0 ? normalized : null
    },
    null
  )
}

/**
 * 查找引用
 *
 * 语言服务器在索引未就绪时可能长时间不返回，主进程侧虽有 30s 超时，
 * 但引用面板会一直停在「正在查找引用...」。这里加一层更短的超时并抛出，
 * 让面板落到错误态提示重试，而不是无限转圈。
 */
export async function findReferences(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: any }[] | null> {
  // 非代码开发场景下服务已停止，这里必须提前返回：
  // 否则会白等 REFERENCES_TIMEOUT_MS（15s）才抛超时，引用面板一直停在加载态
  if (!isLspRequestAllowed()) return null

  const uri = pathToLspUri(filePath)
  const workspacePath = getFileWorkspaceRoot(filePath)

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`查找引用超时（${REFERENCES_TIMEOUT_MS / 1000}s 无响应）`)),
        REFERENCES_TIMEOUT_MS,
      )
    })

    return await Promise.race([
      api.lsp.references({ uri, line, character, workspacePath }),
      timeoutPromise,
    ])
  } catch (err) {
    logger.lsp.warn('[LSP] Find references failed', {
      filePath, line, character, message: toAppError(err).message,
    })
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 获取悬停信息
 */
export async function getHoverInfo(
  filePath: string,
  line: number,
  character: number
): Promise<{ contents: any; range?: any } | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.hover(params),
    null
  )
}

/**
 * 获取代码补全
 */
export async function getCompletions(
  filePath: string,
  line: number,
  character: number
): Promise<any> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.completion(params),
    null
  )
}

/**
 * 重命名符号
 */
export async function renameSymbol(
  filePath: string,
  line: number,
  character: number,
  newName: string
): Promise<any> {
  const uri = pathToLspUri(filePath)
  const workspacePath = getFileWorkspaceRoot(filePath)
  try {
    const params: LspPositionParams & { newName: string } = {
      uri,
      line,
      character,
      newName,
      workspacePath,
    }
    return await api.lsp.rename(params)
  } catch {
    return null
  }
}

/**
 * 监听诊断信息
 */
export function onDiagnostics(
  callback: (uri: string, diagnostics: any[]) => void
): () => void {
  return api.lsp.onDiagnostics((params: { uri: string; diagnostics: any[] }) => {
    callback(params.uri, params.diagnostics)
  })
}

/**
 * 跳转到类型定义
 */
export async function goToTypeDefinition(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: any }[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    async (params) => {
      const result = await api.lsp.typeDefinition(params)
      if (!result) return null
      return Array.isArray(result) ? result : [result]
    },
    null
  )
}

/**
 * 跳转到实现
 */
export async function goToImplementation(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: any }[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    async (params) => {
      const result = await api.lsp.implementation(params)
      if (!result) return null
      return Array.isArray(result) ? result : [result]
    },
    null
  )
}

/**
 * 获取签名帮助
 */
export async function getSignatureHelp(
  filePath: string,
  line: number,
  character: number
): Promise<any> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.signatureHelp(params),
    null
  )
}

/**
 * 准备重命名
 */
export async function prepareRename(
  filePath: string,
  line: number,
  character: number
): Promise<{ range: any; placeholder: string } | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.prepareRename(params),
    null
  )
}

/**
 * 获取文档符号（大纲）
 */
export async function getDocumentSymbols(filePath: string): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.documentSymbol(params),
    []
  ) as Promise<any[]>
}

/**
 * 搜索工作空间符号
 */
export async function searchWorkspaceSymbols(query: string): Promise<any[]> {
  if (!isLspRequestAllowed()) return []
  try {
    return await api.lsp.workspaceSymbol({ query }) || []
  } catch {
    return []
  }
}

/**
 * 获取代码操作
 */
export async function getCodeActions(
  filePath: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  diagnostics?: any[]
): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.codeAction({ ...params, range, diagnostics }),
    []
  ) as Promise<any[]>
}

/**
 * 格式化文档
 */
export async function formatDocument(
  filePath: string,
  options?: { tabSize?: number; insertSpaces?: boolean }
): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.formatting({ ...params, options }),
    []
  ) as Promise<any[]>
}

/**
 * 格式化选区
 */
export async function formatRange(
  filePath: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  options?: { tabSize?: number; insertSpaces?: boolean }
): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.rangeFormatting({ ...params, range, options }),
    []
  ) as Promise<any[]>
}

/**
 * 获取文档高亮
 */
export async function getDocumentHighlights(
  filePath: string,
  line: number,
  character: number
): Promise<any[]> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.documentHighlight(params),
    []
  ) as Promise<any[]>
}

/**
 * 获取折叠范围
 */
export async function getFoldingRanges(filePath: string): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.foldingRange(params),
    []
  ) as Promise<any[]>
}

/**
 * 解析补全项
 */
export async function resolveCompletionItem(item: any): Promise<any> {
  if (!isLspRequestAllowed()) return item
  try {
    return await api.lsp.completionResolve(item)
  } catch {
    return item
  }
}

/**
 * 获取内联提示
 */
export async function getInlayHints(
  filePath: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.inlayHint({ ...params, range }),
    []
  ) as Promise<any[]>
}

// ============ Call Hierarchy 支持 ============

/**
 * 准备调用层次结构
 * 返回指定位置的调用层次项
 */
export async function prepareCallHierarchy(
  filePath: string,
  line: number,
  character: number
): Promise<any[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.prepareCallHierarchy(params),
    null
  )
}

/**
 * 获取调用当前函数的所有位置（谁调用了我）
 */
export async function getIncomingCalls(
  filePath: string,
  line: number,
  character: number
): Promise<any[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.incomingCalls(params),
    null
  )
}

/**
 * 获取当前函数调用的所有位置（我调用了谁）
 */
export async function getOutgoingCalls(
  filePath: string,
  line: number,
  character: number
): Promise<any[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.outgoingCalls(params),
    null
  )
}

// ============ waitForDiagnostics 支持 ============

/**
 * 等待指定文件的诊断信息
 * 用于在文件修改后等待 LSP 返回最新的诊断结果
 */
export async function waitForDiagnostics(filePath: string): Promise<boolean> {
  if (!isLspRequestAllowed()) return false
  const uri = pathToLspUri(filePath)
  try {
    const result = await api.lsp.waitForDiagnostics({ uri })
    return result?.success || false
  } catch {
    return false
  }
}

// ============ 智能根目录检测 ============

/**
 * 获取文件的最佳工作空间根目录
 * 根据语言类型智能检测项目根目录
 */
export async function findBestRoot(filePath: string): Promise<string | null> {
  const languageId = getLanguageId(filePath)
  const workspacePath = getFileWorkspaceRoot(filePath)
  if (!workspacePath) return null

  try {
    return await api.lsp.findBestRoot({ filePath, languageId, workspacePath })
  } catch {
    return workspacePath
  }
}

/**
 * 为指定文件启动 LSP 服务器（使用智能根目录检测）
 */
export async function ensureServerForFile(filePath: string): Promise<boolean> {
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return false

  const workspacePath = getFileWorkspaceRoot(filePath)
  if (!workspacePath) return false

  try {
    const result = await api.lsp.ensureServerForFile({ filePath, languageId, workspacePath })
    return result?.success || false
  } catch {
    return false
  }
}

// ============ 文件监视通知 ============

/**
 * 通知 LSP 服务器文件变化
 * type: 1 = Created, 2 = Changed, 3 = Deleted
 * 
 * 注意：此函数主要用于渲染进程手动触发通知
 * 文件监视器会自动调用主进程的 lspManager.notifyDidChangeWatchedFiles
 */
export async function notifyFileChanges(
  changes: Array<{ filePath: string; type: 1 | 2 | 3 }>
): Promise<void> {
  const lspChanges = changes.map(c => ({
    uri: pathToLspUri(c.filePath),
    type: c.type,
  }))

  try {
    await api.lsp.didChangeWatchedFiles({ changes: lspChanges })
  } catch {
    // 忽略错误
  }
}
