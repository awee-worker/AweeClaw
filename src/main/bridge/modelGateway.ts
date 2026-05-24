/**
 * LLM IPC handlers - 重构版
 * 
 * 支持功能：
 * - 流式对话
 * - 同步生成（后台任务）
 * - 结构化输出（代码分析、重构、修复、测试生成）
 * - Embeddings（向量嵌入、语义搜索）
 * - 多窗口隔离
 * - [AweeClaw] 请求中间件管道
 * - [AweeClaw] Token 预算管理
 * - [AweeClaw] 场景感知路由
 */

import { logger } from '@shared/toolkit/LogEngine'
import { ipcMain, BrowserWindow } from 'electron'
import Store from 'electron-store'
import { LLMService, LLMError } from '../modules/ai-provider'
import type { TokenUsage as LLMTokenUsage } from '../modules/ai-provider/providerTypes'
import { BRAND } from '@shared/brand'
import { ErrorCode } from '@shared/toolkit/errorCatalog'

// 按窗口 webContents.id 管理独立的 LLM 服务
const llmServices = new Map<number, LLMService>()
const compactionServices = new Map<number, LLMService>()

/**
 * 转换 TokenUsage 格式
 * LLM 服务使用 inputTokens/outputTokens
 * 前端 Agent 使用 promptTokens/completionTokens
 */
function convertTokenUsage(usage: LLMTokenUsage | undefined): {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
} | undefined {
  if (!usage) return undefined
  
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens,
  }
}

/**
 * 获取或创建 LLM 服务实例
 */
function getOrCreateService(webContentsId: number, window: BrowserWindow): LLMService {
  if (!llmServices.has(webContentsId)) {
    logger.ipc.info('[LLMService] Creating new service for window:', webContentsId)
    llmServices.set(webContentsId, new LLMService(window))
  }
  return llmServices.get(webContentsId)!
}

/**
 * 获取或创建压缩服务实例
 */
function getOrCreateCompactionService(webContentsId: number, window: BrowserWindow): LLMService {
  if (!compactionServices.has(webContentsId)) {
    logger.ipc.info('[LLMService] Creating compaction service for window:', webContentsId)
    compactionServices.set(webContentsId, new LLMService(window))
  }
  return compactionServices.get(webContentsId)!
}

/**
 * 统一错误处理 - 记录日志并抛出 LLMError
 */
function logAndThrowError(error: unknown, operation: string): never {
  const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
  
  logger.ipc.error(`[LLMService] ${operation} failed:`, {
    code: llmError.code,
    message: llmError.message,
    retryable: llmError.retryable,
  })
  
  throw llmError
}

export function registerLLMHandlers(_getMainWindow: () => BrowserWindow | null) {
  // ============================================
  // 流式对话
  // ============================================

  ipcMain.handle('llm:sendMessage', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found for LLM request')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      await service.sendMessage(params)
      // 流式响应通过事件发送，不需要返回值
    } catch (error) {
      // 流式错误已通过 llm:error 事件发送到前端
      // 这里只记录日志，不抛出，避免 IPC 包装错误消息
      const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
      logger.ipc.error('[LLMService] Send message failed:', {
        code: llmError.code,
        message: llmError.message,
        retryable: llmError.retryable,
      })
    }
  })

  ipcMain.on('llm:abort', (event) => {
    llmServices.get(event.sender.id)?.abort()
  })

  // ============================================
  // 同步生成
  // ============================================

  ipcMain.handle('llm:compactContext', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found for compaction request')

    const service = getOrCreateCompactionService(event.sender.id, window)
    
    try {
      const response = await service.sendMessageSync(params)
      return {
        content: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      if (error instanceof LLMError) {
        return { error: error.message, code: error.code }
      }
      return { error: (error as Error).message }
    }
  })

  // ============================================
  // 结构化输出 - 代码分析
  // ============================================

  ipcMain.handle('llm:analyzeCode', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.analyzeCode(params)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Code analysis')
    }
  })

  ipcMain.handle('llm:analyzeCodeStream', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.analyzeCodeStream(params, (partial) => {
        if (!window.isDestroyed()) {
          window.webContents.send('llm:analyzeCodePartial', partial)
        }
      })
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Code analysis stream')
    }
  })

  // ============================================
  // 结构化输出 - 代码重构
  // ============================================

  ipcMain.handle('llm:suggestRefactoring', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.suggestRefactoring(params)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Refactoring suggestion')
    }
  })

  // ============================================
  // 结构化输出 - 错误修复
  // ============================================

  ipcMain.handle('llm:suggestFixes', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.suggestFixes(params)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Fix suggestion')
    }
  })

  // ============================================
  // 结构化输出 - 测试生成
  // ============================================

  ipcMain.handle('llm:generateTests', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.generateTests(params)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Test generation')
    }
  })

  // ============================================
  // 结构化输出 - 通用对象生成
  // ============================================

  ipcMain.handle('llm:generateObject', async (event, params: {
    config: any
    schema: any
    system: string
    prompt: string
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.generateStructuredObject(params)
      return {
        object: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Object generation')
    }
  })

  // ============================================
  // Embeddings
  // ============================================

  ipcMain.handle('llm:embedText', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.embedText(params.text, params.config)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
      }
    } catch (error) {
      logAndThrowError(error, 'Text embedding')
    }
  })

  ipcMain.handle('llm:embedMany', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.embedMany(params.texts, params.config)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
      }
    } catch (error) {
      logAndThrowError(error, 'Batch embedding')
    }
  })

  ipcMain.handle('llm:findSimilar', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const result = await service.findSimilar(
        params.query,
        params.candidates,
        params.config,
        params.topK
      )
      return result
    } catch (error) {
      logAndThrowError(error, 'Similarity search')
    }
  })

  // [AweeClaw] 注册增强 IPC handlers
  registerAweeClawLLMHandlers()
}

/**
 * 清理指定窗口的 LLM 服务（窗口关闭时调用）
 */
export function cleanupLLMService(webContentsId: number) {
  const service = llmServices.get(webContentsId)
  if (service) {
    logger.ipc.info('[LLMService] Cleaning up service for window:', webContentsId)
    service.destroy()
    llmServices.delete(webContentsId)
  }

  const compactionService = compactionServices.get(webContentsId)
  if (compactionService) {
    compactionService.destroy()
    compactionServices.delete(webContentsId)
  }
}

/**
 * 清理所有窗口的 LLM 服务（应用退出时调用）
 */
export function cleanupAllLLMServices() {
  for (const [id] of llmServices) {
    cleanupLLMService(id)
  }
}

// ============================================
// [AweeClaw] 请求中间件管道
// ============================================

type LLMMiddleware = {
  name: string
  beforeRequest?: (params: any) => any | Promise<any>
  afterResponse?: (params: any, response: any) => any | Promise<any>
  onError?: (params: any, error: any) => void
}

const middlewarePipeline: LLMMiddleware[] = []

function registerMiddleware(middleware: LLMMiddleware): void {
  if (middlewarePipeline.some(m => m.name === middleware.name)) {
    logger.ipc.warn(`[LLM] Middleware "${middleware.name}" already registered, skipping`)
    return
  }
  middlewarePipeline.push(middleware)
  logger.ipc.info(`[LLM] Middleware registered: ${middleware.name}`)
}

async function runBeforeRequest(params: any): Promise<any> {
  let result = params
  for (const mw of middlewarePipeline) {
    if (mw.beforeRequest) {
      try {
        result = await mw.beforeRequest(result)
      } catch (err) {
        logger.ipc.error(`[LLM] Middleware "${mw.name}" beforeRequest failed:`, err)
      }
    }
  }
  return result
}

export async function _runAfterResponse(params: any, response: any): Promise<any> {
  let result = response
  for (const mw of middlewarePipeline) {
    if (mw.afterResponse) {
      try {
        result = await mw.afterResponse(params, result)
      } catch (err) {
        logger.ipc.error(`[LLM] Middleware "${mw.name}" afterResponse failed:`, err)
      }
    }
  }
  return result
}

function runOnError(params: any, error: any): void {
  for (const mw of middlewarePipeline) {
    if (mw.onError) {
      try {
        mw.onError(params, error)
      } catch (err) {
        logger.ipc.error(`[LLM] Middleware "${mw.name}" onError failed:`, err)
      }
    }
  }
}

// ============================================
// [AweeClaw] Token 预算管理（持久化版）
// ============================================

interface TokenBudget {
  windowId: number
  totalBudget: number
  usedTokens: number
  resetAt: number
}

interface TokenBudgetStoreSchema {
  budgets: Record<string, TokenBudget>
  version: number
}

const TOKEN_BUDGET_STORE_VERSION = 1
const TOKEN_BUDGET_STORE_KEY = 'tokenBudgets'
const DEFAULT_DAILY_BUDGET = 1_000_000
const BUDGET_RESET_INTERVAL_MS = 24 * 60 * 60 * 1000

// 使用 electron-store 持久化 Token 预算
const tokenBudgetStore = new Store<TokenBudgetStoreSchema>({ name: 'token-budget' })

// 内存缓存，避免频繁读写磁盘
const tokenBudgets = new Map<number, TokenBudget>()
let storeDirty = false

/**
 * 从持久化存储加载预算数据
 */
function loadBudgetsFromStore(): void {
  try {
    const data = tokenBudgetStore.get(TOKEN_BUDGET_STORE_KEY) as TokenBudgetStoreSchema | undefined
    if (data?.version === TOKEN_BUDGET_STORE_VERSION && data.budgets) {
      Object.entries(data.budgets).forEach(([windowId, budget]) => {
        tokenBudgets.set(Number(windowId), budget)
      })
      logger.ipc.info(`[TokenBudget] Loaded ${Object.keys(data.budgets).length} budgets from store`)
    }
  } catch (e) {
    logger.ipc.warn('[TokenBudget] Failed to load from store:', e)
  }
}

/**
 * 保存预算数据到持久化存储（防抖写入）
 */
function saveBudgetsToStore(): void {
  if (!storeDirty) return
  try {
    const budgets: Record<string, TokenBudget> = {}
    tokenBudgets.forEach((budget, windowId) => {
      budgets[String(windowId)] = budget
    })
    tokenBudgetStore.set(TOKEN_BUDGET_STORE_KEY, {
      budgets,
      version: TOKEN_BUDGET_STORE_VERSION,
    })
    storeDirty = false
    logger.ipc.debug(`[TokenBudget] Saved ${tokenBudgets.size} budgets to store`)
  } catch (e) {
    logger.ipc.error('[TokenBudget] Failed to save to store:', e)
  }
}

// 每 30 秒自动保存一次
setInterval(saveBudgetsToStore, 30000)

function getTokenBudget(windowId: number): TokenBudget {
  if (!tokenBudgets.has(windowId)) {
    tokenBudgets.set(windowId, {
      windowId,
      totalBudget: DEFAULT_DAILY_BUDGET,
      usedTokens: 0,
      resetAt: Date.now() + BUDGET_RESET_INTERVAL_MS,
    })
    storeDirty = true
  }
  const budget = tokenBudgets.get(windowId)!
  if (Date.now() > budget.resetAt) {
    budget.usedTokens = 0
    budget.resetAt = Date.now() + BUDGET_RESET_INTERVAL_MS
    storeDirty = true
  }
  return budget
}

function checkTokenBudget(windowId: number, estimatedTokens: number): boolean {
  const budget = getTokenBudget(windowId)
  return (budget.usedTokens + estimatedTokens) <= budget.totalBudget
}

function recordTokenUsage(windowId: number, tokens: number): void {
  const budget = getTokenBudget(windowId)
  budget.usedTokens += tokens
  storeDirty = true
}

/**
 * 清理已关闭窗口的预算数据
 */
export function cleanupClosedWindowBudgets(activeWindowIds: Set<number>): void {
  let cleaned = 0
  tokenBudgets.forEach((_, windowId) => {
    if (!activeWindowIds.has(windowId)) {
      tokenBudgets.delete(windowId)
      cleaned++
    }
  })
  if (cleaned > 0) {
    storeDirty = true
    logger.ipc.info(`[TokenBudget] Cleaned up ${cleaned} closed window budgets`)
  }
}

// 启动时加载持久化数据
loadBudgetsFromStore()

// ============================================
// [AweeClaw] 场景感知路由
// ============================================

interface ScenarioModelRoute {
  scenarioId: string
  preferredModel?: string
  fallbackModel?: string
  maxTokens?: number
  temperature?: number
}

const scenarioRoutes = new Map<string, ScenarioModelRoute>()

function getScenarioRoute(scenarioId: string): ScenarioModelRoute | undefined {
  return scenarioRoutes.get(scenarioId)
}

// ============================================
// [AweeClaw] 独有 IPC Handlers
// ============================================

function registerAweeClawLLMHandlers(): void {
  // 中间件管理
  ipcMain.handle('llm:registerMiddleware', async (_, middleware: LLMMiddleware) => {
    registerMiddleware(middleware)
    return { success: true }
  })

  ipcMain.handle('llm:listMiddleware', async () => {
    return { success: true, middleware: middlewarePipeline.map(m => ({ name: m.name })) }
  })

  ipcMain.handle('llm:removeMiddleware', async (_, name: string) => {
    const idx = middlewarePipeline.findIndex(m => m.name === name)
    if (idx >= 0) {
      middlewarePipeline.splice(idx, 1)
      logger.ipc.info(`[LLM] Middleware removed: ${name}`)
      return { success: true }
    }
    return { success: false, error: 'Middleware not found' }
  })

  // Token 预算管理
  ipcMain.handle('llm:getTokenBudget', async (_, windowId?: number) => {
    const wid = windowId ?? 0
    const budget = getTokenBudget(wid)
    return {
      success: true,
      budget: {
        totalBudget: budget.totalBudget,
        usedTokens: budget.usedTokens,
        remainingTokens: budget.totalBudget - budget.usedTokens,
        resetAt: budget.resetAt,
      },
    }
  })

  ipcMain.handle('llm:setTokenBudget', async (_, windowId: number, totalBudget: number) => {
    const budget = getTokenBudget(windowId)
    budget.totalBudget = totalBudget
    return { success: true }
  })

  ipcMain.handle('llm:resetTokenBudget', async (_, windowId?: number) => {
    const wid = windowId ?? 0
    const budget = getTokenBudget(wid)
    budget.usedTokens = 0
    budget.resetAt = Date.now() + 24 * 60 * 60 * 1000
    return { success: true }
  })

  // 场景感知路由
  ipcMain.handle('llm:setScenarioRoute', async (_, route: ScenarioModelRoute) => {
    scenarioRoutes.set(route.scenarioId, route)
    logger.ipc.info(`[LLM] Scenario route set: ${route.scenarioId} -> ${route.preferredModel || 'default'}`)
    return { success: true }
  })

  ipcMain.handle('llm:getScenarioRoute', async (_, scenarioId: string) => {
    const route = getScenarioRoute(scenarioId)
    return { success: true, route: route || null }
  })

  ipcMain.handle('llm:removeScenarioRoute', async (_, scenarioId: string) => {
    scenarioRoutes.delete(scenarioId)
    return { success: true }
  })

  ipcMain.handle('llm:listScenarioRoutes', async () => {
    return { success: true, routes: Array.from(scenarioRoutes.values()) }
  })

  // 带中间件的流式对话
  ipcMain.handle('llm:sendMessageWithMiddleware', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found for LLM request')

    const estimatedTokens = (params.messages?.reduce((sum: number, m: any) => sum + (m.content?.length || 0), 0) || 0) / 4
    if (!checkTokenBudget(event.sender.id, estimatedTokens)) {
      throw new LLMError('Token budget exceeded for this window', ErrorCode.LLM_QUOTA_EXCEEDED, false)
    }

    const processedParams = await runBeforeRequest(params)
    const service = getOrCreateService(event.sender.id, window)

    try {
      await service.sendMessage(processedParams)
      if (processedParams._estimatedTokens) {
        recordTokenUsage(event.sender.id, processedParams._estimatedTokens)
      }
    } catch (error) {
      runOnError(processedParams, error)
      const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
      logger.ipc.error(`[LLMService] Send message with middleware failed:`, {
        code: llmError.code,
        message: llmError.message,
        retryable: llmError.retryable,
      })
    }
  })

  logger.ipc.info(`[LLM] ${BRAND.name} enhanced IPC handlers registered (middleware, budget, scenario routing)`)
}
