/**
 * LLM 模型网关 — 大语言模型服务的 IPC 桥接层
 *
 * 设计理念：
 * - 声明式注册：使用 handler 注册表消除重复的 try-catch 模板
 * - 请求订阅：一路流由一个 requestId 标识，按订阅表投递给所有观察它的窗口，
 *   服务实例全局唯一；这样多个窗口能看同一路流，而不必各自重发一次请求
 * - 统一用量转换：LLM 服务 ↔ 前端 Agent 的 TokenUsage 格式转换
 * - 生命周期管理：窗口关闭时中止它发起的请求并摘除订阅，应用退出时全量清理
 * - 可观测性：关键操作记录日志，便于审计与排障

 */

import { logger } from '@shared/toolkit/LogEngine'
import { ipcMain, BrowserWindow } from 'electron'
import { LLMService, LLMError } from '../../modules/ai-provider'
import { streamSubscriptions } from '../../modules/ai-provider/services/StreamSubscriptions'
import type { TokenUsage as LLMTokenUsage } from '../../modules/ai-provider/providerTypes'
import type { LLMConfig } from '@protocols'
import { BRAND } from '@shared/brand'

/* ------------------------------------------------------------------ */
/* 服务实例管理                                                        */
/* ------------------------------------------------------------------ */

/**
 * 全局 LLM 服务实例（懒创建）
 *
 * 流式事件按 requestId 的订阅关系投递（见 streamSubscriptions），
 * 服务本身与窗口无关，因此不需要再按 webContents 分池。
 */
let llmService: LLMService | null = null

/** 上下文压缩服务实例 */
let compactionService: LLMService | null = null

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
 * 获取 LLM 服务实例
 *
 * 全应用共用一个实例。此前按窗口各建一个，是因为服务持有窗口引用、
 * 事件只能回发给创建它的窗口；现在事件按 requestId 的订阅关系投递，
 * 服务本身不再需要知道窗口，按窗口复制只会重复占用连接池与请求表。
 */
function getService(): LLMService {
  if (!llmService) {
    logger.gateway.info('[modelGateway] 创建 LLM 服务')
    llmService = new LLMService()
  }
  return llmService
}

/**
 * 获取上下文压缩服务实例
 *
 * 压缩是同步生成，不产生流式事件，与窗口没有关联，
 * 全应用共用一个即可。
 */
function getCompactionService(): LLMService {
  if (!compactionService) {
    logger.gateway.info('[modelGateway] 创建压缩服务')
    compactionService = new LLMService()
  }
  return compactionService
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
/**
 * 从 IPC 事件解析发起窗口
 *
 * 只用于窗口校验与一次性回投（例如流式代码分析的 partial 回调），
 * 不再决定用哪个服务实例 —— 服务已是全局单例。
 *
 * @param event IPC 事件
 * @returns 窗口实例与它的 webContents ID
 * @throws 如果窗口不存在
 */
function resolveWindow(event: Electron.IpcMainInvokeEvent): {
  window: BrowserWindow
  senderId: number
} {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) {
    throw new Error('[modelGateway] 无法找到对应的窗口')
  }
  return { window, senderId: event.sender.id }
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
    const { window } = resolveWindow(event)
    const service = getService()

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
    const service = getService()

    // requestId 必须在网关侧定下来：流式事件按它路由，而订阅关系
    // 要早于首个分片建立，等服务内部再生成就晚了 —— 首屏增量会无处可投。
    const requestId: string = (params as { requestId?: string })?.requestId || crypto.randomUUID()
    streamSubscriptions.bindOwner(requestId, event.sender.id)

    try {
      await service.sendMessage({ ...params, requestId })
      // 流式响应通过事件发送，不需要返回值
    } catch (error) {
      // 流式错误已通过 llm:error 事件发送到前端
      // 这里只记录日志，不抛出，避免 IPC 包装错误消息
      const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
      logger.gateway.warn('[modelGateway] 流式对话失败', {
        code: llmError.code,
        message: llmError.message,
      })
    } finally {
      streamSubscriptions.release(requestId)
    }
  })

  ipcMain.on('llm:abort', (event, requestId?: string) => {
    const service = getService()
    const senderId = event.sender.id

    if (requestId) {
      // 服务已不再按窗口分区，abort 必须靠订阅表鉴权，
      // 否则任一窗口都能拿着 requestId 掐掉别的窗口正在跑的流。
      if (!streamSubscriptions.isOwner(requestId, senderId)) {
        logger.gateway.warn('[modelGateway] 拒绝中止非本窗口发起的请求', { requestId, senderId })
        return
      }
      service.abort(requestId)
      return
    }

    // 不带 requestId 时中止「该窗口发起的」全部请求，
    // 而不是服务里的全部 —— 后者会把其它窗口的流一起杀掉。
    const owned = streamSubscriptions.requestsOfWindow(senderId)
    for (const id of owned) service.abort(id)
    logger.gateway.info('[modelGateway] 中止窗口全部请求', { senderId, count: owned.length })
  })

  /* -------- 流订阅：让多个窗口观察同一路流 -------- */

  /**
   * 列出当前可订阅的流
   *
   * 子窗口（悬浮球、迷你聊天）先发现「主窗口正在跑什么」，再按 requestId
   * 接上去，而不是自己重新发一次请求 —— 后者会重复消耗上游额度，
   * 且两边内容必然不一致。
   */
  ipcMain.handle('llm:listActiveStreams', async () => {
    return { streams: streamSubscriptions.listActive() }
  })

  /**
   * 订阅一路流
   *
   * 订阅成功后立即回放已产出内容，新订阅者不必从半截开始看。
   * 回放走同一组事件类型，渲染层不需要为「补历史」写第二套解析逻辑。
   */
  ipcMain.handle('llm:subscribe', async (event, requestId: unknown) => {
    if (typeof requestId !== 'string' || !requestId) {
      return { ok: false, reason: 'invalid-request-id' }
    }

    const snapshot = streamSubscriptions.snapshotOf(requestId)
    if (!snapshot) {
      return { ok: false, reason: 'not-found' }
    }

    streamSubscriptions.addSubscriber(requestId, event.sender.id)

    const sender = event.sender
    if (!sender.isDestroyed()) {
      const replay: Array<Record<string, unknown>> = []
      // 顺序按「推理 → 正文 → 工具调用」近似还原：正文通常在后，
      // 工具调用穿插其间，回放无法精确复现时间轴，但能补齐语义。
      if (snapshot.reasoning) {
        replay.push({ type: 'reasoning', content: snapshot.reasoning })
      }
      if (snapshot.text) {
        replay.push({ type: 'text', content: snapshot.text })
      }
      for (const call of snapshot.toolCalls) {
        replay.push({
          type: call.arguments === undefined ? 'tool_call_start' : 'tool_call_available',
          id: call.id,
          name: call.name,
          ...(call.arguments === undefined ? {} : { arguments: call.arguments }),
        })
      }
      if (replay.length > 0) {
        sender.send(`llm:stream:${requestId}`, { type: 'batch', events: replay })
      }
    }

    logger.gateway.info('[modelGateway] 窗口订阅流', {
      requestId,
      webContentsId: event.sender.id,
      replayedChars: snapshot.text.length,
      truncated: snapshot.truncated,
    })
    return { ok: true, snapshot }
  })

  /** 解除订阅（不影响发起方，也不中止流） */
  ipcMain.handle('llm:unsubscribe', async (event, requestId: unknown) => {
    if (typeof requestId === 'string' && requestId) {
      streamSubscriptions.removeSubscriber(requestId, event.sender.id)
    }
    return { ok: true }
  })

  /* -------- 同步生成（上下文压缩） -------- */

  ipcMain.handle('llm:compactContext', async (_event, params) => {
    const service = getCompactionService()
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
    const { window } = resolveWindow(event)
    const service = getService()

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

  ipcMain.handle('llm:findSimilar', async (_event, params) => {
    const service = getService()

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
 * 清理指定窗口的 LLM 订阅（窗口关闭时调用）
 *
 * 窗口关掉后它发起的流已无人接收，继续跑只会烧上游 token，因此主动中止。
 * 注意这里不销毁服务实例：服务是全局的，销毁它会把其它窗口正在进行的
 * 请求一并掐断；也不需要为清理而将服务创建出来。
 *
 * @param webContentsId 窗口 webContents ID
 */
export function cleanupLLMService(webContentsId: number): void {
  // 先摘订阅再判断存亡：窗口已销毁，它自己不构成「还有人在看」
  streamSubscriptions.dropWindow(webContentsId)

  const owned = streamSubscriptions.requestsOfWindow(webContentsId)
  let aborted = 0
  let handedOver = 0

  for (const requestId of owned) {
    // 发起方退出但仍有其它窗口在观察：把发起权移交出去，让流继续。
    // 直接中止会让「主窗口关掉、子窗口继续看」这个场景失效。
    const remaining = streamSubscriptions.subscribersOf(requestId)
    if (remaining.length > 0) {
      streamSubscriptions.transferOwner(requestId, remaining[0])
      handedOver += 1
      continue
    }

    llmService?.abort(requestId)
    streamSubscriptions.release(requestId)
    aborted += 1
  }

  logger.gateway.info('[modelGateway] 清理窗口订阅', {
    webContentsId,
    aborted,
    handedOver,
  })
}

/**
 * 清理所有窗口的 LLM 服务（应用退出时调用）
 */
export function cleanupAllLLMServices(): void {
  llmService?.abort()
  llmService?.destroy()
  llmService = null
  compactionService?.destroy()
  compactionService = null
  streamSubscriptions.clear()
}
