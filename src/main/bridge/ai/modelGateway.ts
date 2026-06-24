/**
 * LLM 模型网关 — 大语言模型服务的 IPC 桥接层
 *
 * 设计理念：
 * - 声明式注册：使用 handler 注册表消除重复的 try-catch 模板
 * - 窗口隔离：按 webContents.id 隔离 LLM 服务实例，支持多窗口独立会话
 * - 统一用量转换：LLM 服务 ↔ 前端 Agent 的 TokenUsage 格式转换
 * - 生命周期管理：窗口关闭时自动清理服务实例，应用退出时全量清理
 * - 可观测性：关键操作记录日志，便于审计与排障

 */

import { logger } from '@shared/toolkit/LogEngine'
import { ipcMain, BrowserWindow } from 'electron'
import { LLMService, LLMError } from '../../modules/ai-provider'
import type { TokenUsage as LLMTokenUsage } from '../../modules/ai-provider/providerTypes'
import type { LLMConfig } from '@protocols'
import { BRAND } from '@shared/brand'

/* ------------------------------------------------------------------ */
/* 服务实例管理（按窗口隔离）                                          */
/* ------------------------------------------------------------------ */

/** 普通对话服务实例池 */
const llmServices = new Map<number, LLMService>()

/** 上下文压缩服务实例池 */
const compactionServices = new Map<number, LLMService>()

/**
 * 转换 TokenUsage 格式
 *
 * LLM 服务使用 inputTokens/outputTokens
 * 前端 Agent 使用 promptTokens/completionTokens
 *
 * @param usage LLM 服务的用量数据
 * @returns 前端 Agent 使用的用量格式
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
 *
 * @param webContentsId 窗口 webContents ID
 * @param window Electron 窗口实例
 * @returns LLM 服务实例
 */
function getOrCreateService(webContentsId: number, window: BrowserWindow): LLMService {
  let service = llmServices.get(webContentsId)
  if (!service) {
    logger.gateway.info('[modelGateway] 创建 LLM 服务', { webContentsId })
    service = new LLMService(window)
    llmServices.set(webContentsId, service)
  }
  return service
}

/**
 * 获取或创建上下文压缩服务实例
 *
 * @param webContentsId 窗口 webContents ID
 * @param window Electron 窗口实例
 * @returns LLM 服务实例（用于压缩）
 */
function getOrCreateCompactionService(
  webContentsId: number,
  window: BrowserWindow,
): LLMService {
  let service = compactionServices.get(webContentsId)
  if (!service) {
    logger.gateway.info('[modelGateway] 创建压缩服务', { webContentsId })
    service = new LLMService(window)
    compactionServices.set(webContentsId, service)
  }
  return service
}

/* ------------------------------------------------------------------ */
/* Handler 注册器 — 消除重复的 try-catch 模板                         */
/* ------------------------------------------------------------------ */

/** 标准化响应（成功）— 使用 LLM 服务的原始 TokenUsage 格式 */
interface SuccessResult<T = unknown> {
  data: T
  usage?: LLMTokenUsage
  metadata?: unknown
}

/**
 * 从 IPC 事件中提取窗口与服务
 *
 * @param event IPC 事件
 * @returns 窗口与服务实例
 * @throws 如果窗口不存在
 */
function resolveWindowService(event: Electron.IpcMainInvokeEvent): {
  window: BrowserWindow
  service: LLMService
} {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('[modelGateway] 无法找到对应的窗口')
  }
  const service = getOrCreateService(event.sender.id, window)
  return { window, service }
}

/**
 * 包装异步 handler：统一捕获异常、转换用量、记录日志
 *
 * @param fn 业务函数（返回含 data/usage/metadata 的对象，usage 为 LLM 原始格式）
 * @param operation 操作名（用于日志）
 * @returns IPC handler
 */
function wrapLLMHandler<T extends SuccessResult>(
  fn: (service: LLMService, window: BrowserWindow, params: any) => Promise<T>,
  operation: string,
) {
  return async (
    event: Electron.IpcMainInvokeEvent,
    params: unknown,
  ): Promise<{
    data?: unknown
    usage?: ReturnType<typeof convertTokenUsage>
    metadata?: unknown
    error?: string
    code?: string
  }> => {
    const { window, service } = resolveWindowService(event)

    try {
      const result = await fn(service, window, params)
      return {
        data: result.data,
        usage: convertTokenUsage(result.usage),
        metadata: result.metadata,
      }
    } catch (error) {
      return handleLLMError(error, operation)
    }
  }
}

/**
 * 统一错误处理：记录日志并返回错误响应
 *
 * @param error 原始错误
 * @param operation 操作名
 * @returns 错误响应对象
 */
function handleLLMError(error: unknown, operation: string): {
  error: string
  code?: string
} {
  const llmError = error instanceof LLMError ? error : LLMError.fromError(error)

  logger.gateway.warn('[modelGateway] 操作失败', {
    operation,
    code: llmError.code,
    message: llmError.message,
    retryable: llmError.retryable,
  })

  return { error: llmError.message, code: llmError.code }
}

/* ------------------------------------------------------------------ */
/* IPC Handler 注册入口                                                */
/* ------------------------------------------------------------------ */

/**
 * 注册 LLM 相关 IPC handler
 *
 * @param _getMainWindow 获取主窗口的函数（保留兼容性）
 */
export function registerLLMHandlers(
  _getMainWindow: () => BrowserWindow | null,
): void {
  /* -------- 流式对话 -------- */

  ipcMain.handle('llm:sendMessage', async (event, params) => {
    const { window, service } = resolveWindowService(event)

    try {
      await service.sendMessage(params)
      // 流式响应通过事件发送，不需要返回值
    } catch (error) {
      // 流式错误已通过 llm:error 事件发送到前端
      // 这里只记录日志，不抛出，避免 IPC 包装错误消息
      const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
      logger.gateway.warn('[modelGateway] 流式对话失败', {
        code: llmError.code,
        message: llmError.message,
      })
    }
  })

  ipcMain.on('llm:abort', (event) => {
    llmServices.get(event.sender.id)?.abort()
  })

  /* -------- 同步生成（上下文压缩） -------- */

  ipcMain.handle('llm:compactContext', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('[modelGateway] 压缩请求未找到窗口')

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

  /* -------- 结构化输出：代码分析 -------- */

  ipcMain.handle(
    'llm:analyzeCode',
    wrapLLMHandler(
      (service, _window, params) => service.analyzeCode(params),
      '代码分析',
    ),
  )

  ipcMain.handle('llm:analyzeCodeStream', async (event, params) => {
    const { window, service } = resolveWindowService(event)

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
      return handleLLMError(error, '代码分析流式')
    }
  })

  /* -------- 结构化输出：代码重构 -------- */

  ipcMain.handle(
    'llm:suggestRefactoring',
    wrapLLMHandler(
      (service, _window, params) => service.suggestRefactoring(params),
      '重构建议',
    ),
  )

  /* -------- 结构化输出：错误修复 -------- */

  ipcMain.handle(
    'llm:suggestFixes',
    wrapLLMHandler(
      (service, _window, params) => service.suggestFixes(params),
      '修复建议',
    ),
  )

  /* -------- 结构化输出：测试生成 -------- */

  ipcMain.handle(
    'llm:generateTests',
    wrapLLMHandler(
      (service, _window, params) => service.generateTests(params),
      '测试生成',
    ),
  )

  /* -------- 结构化输出：通用对象生成 -------- */

  ipcMain.handle(
    'llm:generateObject',
    wrapLLMHandler(
      (service, _window, params: {
        config: unknown
        schema: unknown
        system: string
        prompt: string
      }) =>
        service.generateStructuredObject({
          ...params,
          config: params.config as LLMConfig,
        }).then((response) => ({
          data: response.data,
          usage: response.usage,
          metadata: response.metadata,
        })) as Promise<SuccessResult & { data: unknown }>,
      '对象生成',
    ),
  )

  /* -------- Embeddings -------- */

  ipcMain.handle(
    'llm:embedText',
    wrapLLMHandler(
      (service, _window, params: { text: string; config?: unknown }) =>
        service.embedText(params.text, params.config as LLMConfig).then((response) => ({
          data: response.data,
          usage: response.usage,
        })),
      '文本嵌入',
    ),
  )

  ipcMain.handle(
    'llm:embedMany',
    wrapLLMHandler(
      (service, _window, params: { texts: string[]; config?: unknown }) =>
        service.embedMany(params.texts, params.config as LLMConfig).then((response) => ({
          data: response.data,
          usage: response.usage,
        })),
      '批量嵌入',
    ),
  )

  ipcMain.handle('llm:findSimilar', async (event, params) => {
    const { service } = resolveWindowService(event)

    try {
      const result = await service.findSimilar(
        params.query,
        params.candidates,
        params.config,
        params.topK,
      )
      return result
    } catch (error) {
      return handleLLMError(error, '相似度搜索')
    }
  })

  // [AweeClaw] 增强IPC handlers已内联到上方注册流程

  logger.gateway.info(`[modelGateway] ${BRAND.name} LLM IPC 已注册`)
}

/* ------------------------------------------------------------------ */
/* 生命周期管理                                                        */
/* ------------------------------------------------------------------ */

/**
 * 清理指定窗口的 LLM 服务（窗口关闭时调用）
 *
 * @param webContentsId 窗口 webContents ID
 */
export function cleanupLLMService(webContentsId: number): void {
  const service = llmServices.get(webContentsId)
  if (service) {
    logger.gateway.info('[modelGateway] 清理 LLM 服务', { webContentsId })
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
export function cleanupAllLLMServices(): void {
  for (const id of llmServices.keys()) {
    cleanupLLMService(id)
  }
}
