/**
 * 流式处理器 — 基于 AI SDK 6.0 streamText 的流式对话核心
 *
 * 通过组合多个专职组件实现流式文本生成：
 * - 伪工具调用检测器：从文本流中识别并提取工具调用
 * - 流式事件分发器：IPC 事件的批量与即时发送
 * - 流式超时守卫：防止流式响应长时间无数据
 * - 思考策略工厂：为不同模型创建思考标签解析策略
 */

import { streamText } from 'ai'
import type { StreamTextResult } from 'ai'
import { BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { ErrorCode } from '@shared/toolkit/errorCatalog'
import { createModel } from '../modelRegistry'
import { MessageConverter } from '../core/MessageAdapter'
import { ToolConverter } from '../core/ToolSchemaAdapter'
import { prepareExecutionRequest } from '@modules/ai-provider/core/ModelRequestRunner'
import { executeWithGenerationRecovery } from '../core/GenerationResilience'
import { LLMError, convertUsage } from '../providerTypes'
import type { StreamEvent, TokenUsage, ResponseMetadata } from '../providerTypes'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@protocols'
import { ThinkingStrategyFactory, type ThinkingStrategy } from '../strategies/ReasoningStrategy'
import { PseudoToolDetector, normalizeToolCallArguments, repairToolCallInput } from './PseudoToolDetector'
import { StreamEventDispatcher } from './StreamEventDispatcher'

/** 流式生成参数 */
export interface StreamingParams {
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  abortSignal?: AbortSignal
  activeTools?: string[]
  requestId: string
}

/** 流式生成结果 */
export interface StreamingResult {
  content: string
  reasoning?: string
  usage?: TokenUsage
  metadata?: ResponseMetadata
}

/** 默认流式空闲超时时间（毫秒） */
const DEFAULT_IDLE_TIMEOUT_MS = 15_000

/* ------------------------------------------------------------------ */
/* 流式超时守卫                                                       */
/* ------------------------------------------------------------------ */

/** 防止流式响应长时间无数据的超时守卫 */
class StreamTimeoutGuard {
  /**
   * 从迭代器读取下一个元素，超时则拒绝
   *
   * @param iterator 流式迭代器
   * @param requestId 请求 ID（用于日志）
   * @param timeoutMs 空闲超时时间
   * @returns 迭代结果
   */
  async next(
    iterator: AsyncIterator<any>,
    requestId: string,
    timeoutMs: number,
  ): Promise<IteratorResult<any>> {
    let timeoutId: NodeJS.Timeout | null = null

    try {
      return await Promise.race([
        iterator.next().finally(() => {
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            logger.llm.warn('[StreamProcessor] 流式空闲超时', { requestId, timeoutMs })
            void iterator.return?.()
            reject(new LLMError(
              '模型流式响应停滞超过 ' + Math.floor(timeoutMs / 1000) + ' 秒',
              ErrorCode.TIMEOUT,
              true,
            ))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }
}

/** 解析空闲超时时间 */
function resolveIdleTimeout(timeoutMs?: number): number {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs
  }
  return DEFAULT_IDLE_TIMEOUT_MS
}

/* ------------------------------------------------------------------ */
/* 流式处理器（外观）                                                 */
/* ------------------------------------------------------------------ */

/** 流式处理器 — 协调模型创建、流式生成、事件分发与超时控制 */
export class StreamingService {
  private readonly messageConverter = new MessageConverter()
  private readonly toolConverter = new ToolConverter()
  private readonly timeoutGuard = new StreamTimeoutGuard()
  private readonly dispatcher: StreamEventDispatcher

  constructor(private readonly window: BrowserWindow) {
    this.dispatcher = new StreamEventDispatcher(window)
  }

  /** 流式生成文本 */
  async generate(params: StreamingParams): Promise<StreamingResult> {
    const { config, requestId, abortSignal } = params
    try {
      return await executeWithGenerationRecovery({
        config,
        operation: 'stream-text',
        requestId,
        abortSignal,
        execute: async (useCache) => this.generateOnce(params, useCache),
      })
    } catch (error) {
      const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
      this.dispatcher.dispatch(requestId, { type: 'error', error: llmError })
      throw llmError
    }
  }

  /** 单次流式生成 */
  private async generateOnce(params: StreamingParams, useCache: boolean): Promise<StreamingResult> {
    const { config, messages, tools, systemPrompt, abortSignal, activeTools, requestId } = params

    const strategy = ThinkingStrategyFactory.create(config.model)
    strategy.reset?.()

    logger.system.info('[StreamProcessor] 开始流式生成', {
      provider: config.provider,
      model: config.model,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
      requestId,
      protocol: config.protocol,
      hasCustomHeaders: Boolean(config.headers && Object.keys(config.headers).length > 0),
    })

    try {
      const model = createModel(config, this.buildModelCallbacks())

      logger.llm.info('[StreamProcessor] 模型已创建', {
        provider: config.provider,
        model: config.model,
        cloudMode: config.cloudMode,
      })

      let coreMessages = this.messageConverter.convert(messages, systemPrompt)
      const prepared = await prepareExecutionRequest({
        config,
        baseMessages: coreMessages,
        originalMessages: messages,
        useCache,
      })
      coreMessages = prepared.messages

      const coreTools = tools ? this.toolConverter.convert(tools) : undefined

      const streamParams: Parameters<typeof streamText>[0] = {
        model,
        messages: coreMessages,
        tools: coreTools,
        activeTools,
        ...prepared.settings,
        ...prepared.callOptions,
        abortSignal,
        providerOptions: prepared.providerOptions,
      }

      const result = streamText({
        ...streamParams,
        experimental_repairToolCall: this.createToolCallRepairer(),
      })

      return await this.processStream(
        result,
        strategy,
        requestId,
        resolveIdleTimeout(prepared.callOptions.timeout),
        (tools?.length ?? 0) > 0,
        prepared.cacheWriteTokens,
      )
    } catch (error) {
      if (abortSignal?.aborted) {
        const abortedError = new LLMError('请求已取消', ErrorCode.ABORTED, false)
        this.dispatcher.dispatch(requestId, { type: 'error', error: abortedError })
        throw abortedError
      }

      const llmError = LLMError.fromError(error)
      logger.llm.error('[StreamProcessor] 流式错误', {
        errorType: error?.constructor?.name,
        errorMessage: (error as Error)?.message?.substring(0, 500),
        errorCode: llmError.code,
        provider: config.provider,
        model: config.model,
        cloudMode: config.cloudMode,
        serverUrl: config.serverUrl,
      })
      throw llmError
    }
  }

  /** 构建模型回调（token 刷新与认证失败） */
  private buildModelCallbacks() {
    return {
      onTokenRefreshed: (newAccessToken: string, newRefreshToken?: string) => {
        if (!this.window.isDestroyed()) {
          this.window.webContents.send('cloud:tokenRefreshed', {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
          })
        }
      },
      onAuthFailed: () => {
        if (!this.window.isDestroyed()) {
          this.window.webContents.send('cloud:authFailed', {})
        }
      },
    }
  }

  /** 创建工具调用修复器 */
  private createToolCallRepairer() {
    return async ({ toolCall, error }: { toolCall: any; error: Error }) => {
      logger.llm.warn('[StreamProcessor] 工具调用解析错误，尝试修复:', {
        toolName: toolCall.toolName,
        error: error.message,
      })

      const repaired = repairToolCallInput(toolCall.input)
      if (repaired !== null) {
        logger.llm.info('[StreamProcessor] 工具调用修复成功')
        return { ...toolCall, input: repaired }
      }

      logger.llm.error('[StreamProcessor] 工具调用修复失败')
      return null
    }
  }

  /** 处理流式响应 */
  private async processStream(
    result: StreamTextResult<any, any>,
    strategy: ThinkingStrategy,
    requestId: string,
    idleTimeoutMs: number,
    enablePseudoTool: boolean,
    cacheWriteTokens?: number,
  ): Promise<StreamingResult> {
    let reasoning = ''
    let streamedText = ''
    let responseMeta: ResponseMetadata | undefined
    let sawNonTextOutput = false
    let streamError: Error | null = null
    let sawToolActivity = false
    let sawExecutableToolCall = false

    const hasCustomParser = !!strategy.parseStreamText
    const iterator = result.fullStream[Symbol.asyncIterator]()
    const detector = new PseudoToolDetector(enablePseudoTool)

    while (true) {
      const next = await this.timeoutGuard.next(iterator, requestId, idleTimeoutMs)
      if (next.done) break
      const part = next.value
      if (this.window.isDestroyed()) break

      try {
        this.handleStreamPart(part, {
          strategy,
          detector,
          requestId,
          hasCustomParser,
          onReasoning: (text) => { reasoning += text },
          onText: (text) => { streamedText += text },
          onToolActivity: () => { sawToolActivity = true },
          onExecutableToolCall: () => { sawExecutableToolCall = true },
          onNonTextOutput: () => { sawNonTextOutput = true },
          onMetadata: (meta) => { responseMeta = meta },
          onError: (err) => { if (!streamError) streamError = err },
        })
      } catch (error) {
        if (!this.window.isDestroyed()) {
          logger.llm.warn('[StreamProcessor] 处理流式分片出错:', error)
        }
      }
    }

    const finalState = detector.finalize()
    if (finalState.visibleText) {
      streamedText += finalState.visibleText
      this.dispatcher.dispatch(requestId, { type: 'text', content: finalState.visibleText })
    }

    if (streamError) throw streamError

    return await this.finalizeStream(
      result,
      strategy,
      detector,
      requestId,
      streamedText,
      reasoning,
      responseMeta,
      sawToolActivity,
      sawExecutableToolCall,
      sawNonTextOutput,
      cacheWriteTokens,
    )
  }

  /** 处理单个流式分片 */
  private handleStreamPart(
    part: any,
    ctx: {
      strategy: ThinkingStrategy
      detector: PseudoToolDetector
      requestId: string
      hasCustomParser: boolean
      onReasoning: (text: string) => void
      onText: (text: string) => void
      onToolActivity: () => void
      onExecutableToolCall: () => void
      onNonTextOutput: () => void
      onMetadata: (meta: ResponseMetadata) => void
      onError: (err: Error) => void
    },
  ): void {
    const { strategy, detector, requestId, hasCustomParser } = ctx

    switch (part.type) {
      case 'text-start':
      case 'text-end':
      case 'reasoning-start':
      case 'reasoning-end':
      case 'start':
      case 'finish':
      case 'raw':
      case 'abort':
        break

      case 'start-step':
        if (part.warnings?.length > 0) {
          logger.llm.warn('[StreamProcessor] Provider 警告', { requestId, warnings: part.warnings })
        }
        break

      case 'text-delta':
        this.handleTextDelta(part.text, strategy, detector, hasCustomParser, ctx)
        break

      case 'reasoning-delta':
        if (part.text) {
          ctx.onReasoning(part.text)
          this.dispatcher.dispatch(requestId, { type: 'reasoning', content: part.text })
        }
        break

      case 'tool-input-start':
        ctx.onToolActivity()
        this.dispatcher.dispatch(requestId, { type: 'tool-call-start', id: part.id, name: part.toolName })
        break

      case 'tool-input-delta':
        ctx.onToolActivity()
        this.dispatcher.dispatch(requestId, { type: 'tool-call-delta', id: part.id, argumentsDelta: part.delta })
        break

      case 'tool-input-end':
        ctx.onToolActivity()
        this.dispatcher.dispatch(requestId, { type: 'tool-call-delta-end', id: part.id })
        break

      case 'tool-call':
        ctx.onToolActivity()
        ctx.onExecutableToolCall()
        this.dispatcher.dispatch(requestId, {
          type: 'tool-call-available',
          id: part.toolCallId,
          name: part.toolName,
          arguments: normalizeToolCallArguments(part.input),
        })
        break

      case 'tool-result':
      case 'tool-error':
      case 'tool-output-denied':
      case 'tool-approval-request':
      case 'file':
        ctx.onNonTextOutput()
        break

      case 'source':
        ctx.onNonTextOutput()
        this.dispatcher.dispatch(requestId, { type: 'source', source: this.extractSource(part) })
        break

      case 'response-metadata':
        ctx.onMetadata({ id: part.id, modelId: part.modelId, timestamp: part.timestamp })
        break

      case 'finish-step':
        if (!ctx['onMetadata' as keyof typeof ctx]) {
          ctx.onMetadata({ id: part.response.id, modelId: part.response.modelId, timestamp: part.response.timestamp })
        }
        break

      case 'error':
        ctx.onError(part.error instanceof Error ? part.error : new Error(String(part.error ?? 'Unknown stream error')))
        break
    }
  }

  /** 处理文本增量 */
  private handleTextDelta(
    text: string,
    strategy: ThinkingStrategy,
    detector: PseudoToolDetector,
    hasCustomParser: boolean,
    ctx: {
      requestId: string
      onReasoning: (text: string) => void
      onText: (text: string) => void
      onToolActivity: () => void
      onExecutableToolCall: () => void
    },
  ): void {
    let content = text

    if (hasCustomParser && strategy.parseStreamText) {
      const parsed = strategy.parseStreamText(text)
      if (parsed.thinking) {
        ctx.onReasoning(parsed.thinking)
        this.dispatcher.dispatch(ctx.requestId, { type: 'reasoning', content: parsed.thinking })
      }
      content = parsed.content || ''
    }

    if (content) {
      const adapted = detector.consume(content)
      for (const event of adapted.events) {
        if (event.type === 'tool-call-available') {
          ctx.onToolActivity()
          ctx.onExecutableToolCall()
        } else if (event.type.startsWith('tool-call')) {
          ctx.onToolActivity()
        }
        this.dispatcher.dispatch(ctx.requestId, event)
      }
      if (adapted.visibleText) {
        ctx.onText(adapted.visibleText)
        this.dispatcher.dispatch(ctx.requestId, { type: 'text', content: adapted.visibleText })
      }
    }
  }

  /** 提取来源信息 */
  private extractSource(part: any): NonNullable<Extract<StreamEvent, { type: 'source' }>['source']> {
    return {
      id: part.id,
      sourceType: part.sourceType,
      ...(part.sourceType === 'url'
        ? { url: part.url, title: part.title }
        : { mediaType: part.mediaType, title: part.title, filename: part.filename }),
    }
  }

  /** 完成流式处理，提取最终结果 */
  private async finalizeStream(
    result: StreamTextResult<any, any>,
    strategy: ThinkingStrategy,
    detector: PseudoToolDetector,
    requestId: string,
    streamedText: string,
    reasoning: string,
    responseMeta: ResponseMetadata | undefined,
    sawToolActivity: boolean,
    sawExecutableToolCall: boolean,
    sawNonTextOutput: boolean,
    cacheWriteTokens?: number,
  ): Promise<StreamingResult> {
    const text = await result.text
    const usage = await result.usage
    const providerMetadata = await result.providerMetadata
    const response = await result.response

    let finalText = text
    let finalReasoning = reasoning

    if (strategy.extractThinking) {
      const parsed = strategy.extractThinking(text)
      finalText = parsed.content
      if (parsed.thinking) finalReasoning = parsed.thinking
    }

    if (detector.hasCaptured()) {
      finalText = streamedText
    }

    const finishReason = await result.finishReason

    if (finishReason === 'tool-calls' && !sawExecutableToolCall) {
      throw new LLMError(
        '模型以工具调用结束但未产生可执行的工具调用',
        ErrorCode.LLM_NO_OUTPUT,
        true,
      )
    }

    if (!finalText.trim() && !finalReasoning.trim() && !sawToolActivity && !sawNonTextOutput) {
      throw new LLMError(
        '模型在 API 调用完成后返回了空响应',
        ErrorCode.LLM_EMPTY_RESPONSE,
        true,
      )
    }

    logger.llm.info('[StreamProcessor] 流式完成', {
      requestId,
      contentLength: finalText.length,
      reasoningLength: finalReasoning.length,
      sawToolActivity,
      sawExecutableToolCall,
      sawNonTextOutput,
      finishReason,
    })

    const streamingResult: StreamingResult = {
      content: finalText,
      reasoning: finalReasoning || undefined,
      usage: usage ? convertUsage(usage, providerMetadata, { cacheWriteTokens }) : undefined,
      metadata: {
        id: responseMeta?.id ?? response.id,
        modelId: responseMeta?.modelId ?? response.modelId,
        timestamp: responseMeta?.timestamp ?? response.timestamp,
        finishReason: finishReason || undefined,
      },
    }

    this.dispatcher.dispatch(requestId, {
      type: 'done',
      reasoning: streamingResult.reasoning,
      usage: streamingResult.usage,
      metadata: streamingResult.metadata,
    })

    this.dispatcher.cleanup(requestId)
    return streamingResult
  }
}

/* ------------------------------------------------------------------ */
/* 场景感知流式处理器                                                 */
/* ------------------------------------------------------------------ */

import type { ScenarioDomain } from '@configuration/defaultProfile'

/** 场景流式处理策略 */
export interface ScenarioStreamPolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 空闲超时（毫秒） */
  idleTimeoutMs: number
  /** 总超时（毫秒） */
  totalTimeoutMs: number
  /** 是否缓冲完整响应后再发送（合规要求） */
  bufferEntireResponse: boolean
  /** 批量发送间隔（毫秒） */
  batchIntervalMs: number
  /** 是否记录流式审计日志 */
  enableAudit: boolean
  /** 是否允许中断 */
  allowAbort: boolean
  /** 最大 token 数（0 表示不限制） */
  maxTokens: number
}

/** 场景流式策略预设 */
const SCENARIO_STREAM_POLICIES: Record<ScenarioDomain, ScenarioStreamPolicy> = {
  /** 法律场景：长超时 + 审计 + 允许中断 */
  legal: {
    domain: 'legal',
    idleTimeoutMs: 30_000,
    totalTimeoutMs: 180_000,
    bufferEntireResponse: false,
    batchIntervalMs: 100,
    enableAudit: true,
    allowAbort: true,
    maxTokens: 16384,
  },

  /** 医疗场景：长超时 + 缓冲完整响应 + 审计 */
  medical: {
    domain: 'medical',
    idleTimeoutMs: 30_000,
    totalTimeoutMs: 180_000,
    bufferEntireResponse: true,
    batchIntervalMs: 200,
    enableAudit: true,
    allowAbort: false,
    maxTokens: 12288,
  },

  /** 教育场景：标准超时 + 流式 */
  education: {
    domain: 'education',
    idleTimeoutMs: 15_000,
    totalTimeoutMs: 120_000,
    bufferEntireResponse: false,
    batchIntervalMs: 50,
    enableAudit: false,
    allowAbort: true,
    maxTokens: 8192,
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    idleTimeoutMs: 15_000,
    totalTimeoutMs: 120_000,
    bufferEntireResponse: false,
    batchIntervalMs: 50,
    enableAudit: false,
    allowAbort: true,
    maxTokens: 0,
  },
}

/**
 * 场景感知流式处理器
 *
 * 在标准 StreamingService 基础上，增加场景策略：
 * - 场景感知的超时控制
 * - 响应缓冲策略（医疗场景要求完整响应）
 * - 批量发送优化
 * - 审计日志记录
 * - 中断权限控制
 */
export class ScenarioStreamProcessor {
  private readonly baseService: StreamingService
  private currentDomain: ScenarioDomain = 'general'

  constructor(baseService: StreamingService) {
    this.baseService = baseService
  }

  /**
   * 设置当前场景
   */
  setScenario(domain: ScenarioDomain): void {
    this.currentDomain = domain
  }

  /**
   * 获取当前场景策略
   */
  getPolicy(): ScenarioStreamPolicy {
    return SCENARIO_STREAM_POLICIES[this.currentDomain]
  }

  /**
   * 场景感知的流式生成
   */
  async generate(
    params: StreamingParams,
    onProgress?: (chunk: string) => void,
  ): Promise<StreamingResult> {
    const policy = SCENARIO_STREAM_POLICIES[this.currentDomain]

    // 审计日志
    if (policy.enableAudit) {
      this.logAudit('stream_start', params.requestId, {
        domain: policy.domain,
        messageCount: params.messages.length,
        hasTools: !!params.tools?.length,
      })
    }

    // 场景感知的参数调整
    const adjustedParams = this.adjustParams(params, policy)

    // 中断权限检查
    if (!policy.allowAbort && adjustedParams.abortSignal) {
      delete adjustedParams.abortSignal
    }

    try {
      const result = await this.baseService.generate(adjustedParams)

      if (policy.enableAudit) {
        this.logAudit('stream_success', params.requestId, {
          domain: policy.domain,
          contentLength: result.content.length,
          hasReasoning: !!result.reasoning,
        })
      }

      // 缓冲模式：完整返回后才通知
      if (policy.bufferEntireResponse && onProgress) {
        onProgress(result.content)
      }

      return result
    } catch (error) {
      if (policy.enableAudit) {
        this.logAudit('stream_error', params.requestId, {
          domain: policy.domain,
          error: String(error),
        })
      }
      throw error
    }
  }

  /**
   * 调整参数以符合场景策略
   */
  private adjustParams(
    params: StreamingParams,
    policy: ScenarioStreamPolicy,
  ): StreamingParams {
    return {
      ...params,
      config: {
        ...params.config,
        maxTokens:
          policy.maxTokens > 0
            ? Math.min(
                policy.maxTokens,
                params.config.maxTokens ?? policy.maxTokens,
              )
            : params.config.maxTokens,
        timeout: Math.max(
          params.config.timeout ?? policy.totalTimeoutMs,
          policy.totalTimeoutMs,
        ),
      },
    }
  }

  /**
   * 审计日志
   */
  private logAudit(
    action: string,
    requestId: string,
    details: Record<string, unknown>,
  ): void {
    logger.security.info(`[STREAM-AUDIT] [${action}] [${requestId}]`, { details })
  }

  /**
   * 获取基础服务
   */
  getBaseService(): StreamingService {
    return this.baseService
  }
}

/**
 * 创建场景感知流式处理器
 */
export function createScenarioStreamProcessor(
  baseService: StreamingService,
): ScenarioStreamProcessor {
  return new ScenarioStreamProcessor(baseService)
}
