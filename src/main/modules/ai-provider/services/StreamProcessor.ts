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
import { resolveThinkingCompatibility } from '../core/ProviderFeatureMatrix'
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

/* ------------------------------------------------------------------ */
/* 流式超时分级                                                       */
/* ------------------------------------------------------------------ */

/** 默认常规空闲超时时间（毫秒）—— 相邻分片之间的最大间隔 */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000

/**
 * 默认首包超时时间（毫秒）—— 请求发出到首个分片到达的最大等待。
 *
 * 推理模型（扩展思考）在产出首个分片前可能有很长的静默期，
 * 若沿用常规空闲超时，会把正常思考误判为「流停滞」并强制关闭请求，
 * 表现为「AI 还没思考完就自动中断」。
 */
const DEFAULT_FIRST_CHUNK_TIMEOUT_MS = 180_000

/**
 * 思考阶段的空闲超时时间（毫秒）。
 *
 * 模型思考期间可能长时间不产出任何分片（取决于 provider 是否流式返回
 * reasoning 增量），必须给出远高于常规的空闲容忍，否则思考时间一旦
 * 超过常规阈值，请求就会被强制中止。
 */
const THINKING_IDLE_TIMEOUT_MS = 300_000

/**
 * AI SDK 总请求超时的安全下限（毫秒）。
 *
 * AI SDK 的 `timeout` 语义是「整个请求的总耗时上限」，一旦命中会直接中止
 * 流式请求。而用户在模型配置里填写的 `timeout`（界面以「秒」为单位）
 * 实际语义更接近「多久没有数据算超时」，数值往往偏小（例如 30 秒）。
 * 若把它原样交给 SDK 当总超时，模型只要思考 / 长任务超过该值，请求就会被
 * SDK 强行中止，表现为「AI 还在思考就被自动中断」。
 *
 * 因此这里给 SDK 总超时设置一个宽松的安全下限，仅用于兜底「请求永久挂起」；
 * 真正的停滞检测交给按阶段分级的本地空闲守卫（StreamTimeoutGuard）负责。
 */
const REQUEST_TIMEOUT_FLOOR_MS = 30 * 60_000

/** 流式阶段标识（用于按阶段选择超时阈值与日志诊断） */
export type StreamPhase = 'first-chunk' | 'reasoning' | 'streaming'

/** 流式超时档案：按阶段区分的超时阈值 */
export interface StreamTimeoutProfile {
  /** 请求发出 → 首个分片的超时 */
  firstChunkMs: number
  /** 常规分片间隔空闲超时 */
  idleMs: number
  /** 思考阶段分片间隔空闲超时 */
  thinkingIdleMs: number
  /** 本次请求是否启用思考容忍（用于"已开启思考但尚无 reasoning 增量"时也放宽） */
  thinkingTolerant: boolean
}

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
   * @param timeoutMs 当前阶段的空闲超时时间
   * @param phase 当前所处阶段（用于日志与错误描述）
   * @returns 迭代结果
   */
  async next(
    iterator: AsyncIterator<any>,
    requestId: string,
    timeoutMs: number,
    phase: StreamPhase = 'streaming',
  ): Promise<IteratorResult<any>> {
    let timeoutId: NodeJS.Timeout | null = null

    try {
      return await Promise.race([
        iterator.next().finally(() => {
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            logger.llm.warn('[StreamProcessor] 流式空闲超时', { requestId, timeoutMs, phase })
            void iterator.return?.()
            reject(new LLMError(
              '模型流式响应停滞超过 ' + Math.floor(timeoutMs / 1000) + ' 秒（阶段：' + describeStreamPhase(phase) + '）',
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

/** 阶段的中文描述（用于面向用户的错误文案与日志） */
function describeStreamPhase(phase: StreamPhase): string {
  switch (phase) {
    case 'first-chunk':
      return '等待首个响应'
    case 'reasoning':
      return '模型思考中'
    default:
      return '输出中'
  }
}

/**
 * 解析各阶段的流式超时阈值。
 *
 * 关键点：用户在模型配置里设置的 `timeout` 语义更接近「多久没有数据算超时」，
 * 数值可能偏小（例如 30 秒）。这里统一把它作为**下界**，各阶段再取自身的
 * 保守默认值，确保思考阶段始终拥有足够的静默容忍，不会被偏小的配置误判为停滞。
 *
 * @param configuredTimeoutMs 模型配置中的 timeout（毫秒，可选）
 * @param thinkingTolerant 本次请求是否启用思考容忍
 */
export function resolveStreamTimeouts(
  configuredTimeoutMs: number | undefined,
  thinkingTolerant: boolean,
): StreamTimeoutProfile {
  const configured =
    typeof configuredTimeoutMs === 'number' &&
    Number.isFinite(configuredTimeoutMs) &&
    configuredTimeoutMs > 0
      ? configuredTimeoutMs
      : 0

  const idleMs = Math.max(configured, DEFAULT_IDLE_TIMEOUT_MS)
  const thinkingIdleMs = Math.max(idleMs, THINKING_IDLE_TIMEOUT_MS)
  const firstChunkMs = Math.max(
    idleMs,
    configured,
    thinkingTolerant ? THINKING_IDLE_TIMEOUT_MS : DEFAULT_FIRST_CHUNK_TIMEOUT_MS,
  )

  return { firstChunkMs, idleMs, thinkingIdleMs, thinkingTolerant }
}

/**
 * 解析传给 AI SDK 的「总请求超时」（`timeout` 选项）。
 *
 * 与本地空闲守卫是两套独立机制：AI SDK 的 `timeout` 覆盖整个请求，
 * 一旦命中会直接中止。
 *
 * ⚠️ 这里**不能**把用户配置的 `timeout`（界面上以秒为单位，语义上更接近
 * 「多久没数据算超时」）直接当作「整个请求总耗时上限」：思考型模型在思考
 * 阶段可能长时间静默，长回答 / 长任务也可能超过该值，一旦原样透传，SDK 会
 * 在请求完成前强制中断，表现为「AI 还在思考就被自动中断」。
 *
 * 因此总超时统一抬到安全下限（仅兜底「请求永久挂起」），真正的停滞检测
 * 由按阶段分级的本地空闲守卫负责。
 *
 * @param configuredTimeoutMs 模型配置中的 timeout（毫秒，可选）
 * @param _thinkingTolerant 兼容保留（总超时不再区分思考容忍度）
 */
export function resolveRequestTimeoutMs(
  configuredTimeoutMs: number | undefined,
  _thinkingTolerant: boolean,
): number | undefined {
  const configured =
    typeof configuredTimeoutMs === 'number' &&
    Number.isFinite(configuredTimeoutMs) &&
    configuredTimeoutMs > 0
      ? configuredTimeoutMs
      : 0

  return Math.max(configured, REQUEST_TIMEOUT_FLOOR_MS)
}

/**
 * 判断本次请求是否需要思考容忍（放宽静默容忍度）。
 *
 * 覆盖三类情况，任一命中即启用：
 * - Provider 特性矩阵判定思考已开启（GLM-5 强制开启、显式 enableThinking、历史含 reasoning）
 * - 配置了 thinkingBudget
 * - 配置了 reasoningEffort 且非 none
 *
 * 注意：这里只影响**超时容忍度**，不改变是否向 Provider 注入 thinking 参数，
 * 因此不会引入请求参数层面的副作用。
 */
export function resolveThinkingTolerance(
  config: LLMConfig,
  messages: LLMMessage[],
): boolean {
  if (resolveThinkingCompatibility(config, messages).enabled) return true
  if (typeof config.thinkingBudget === 'number' && config.thinkingBudget > 0) return true
  if (config.reasoningEffort && config.reasoningEffort !== 'none') return true
  return false
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

      // 思考感知的超时分级：推理模型在思考阶段可能长时间不产出任何分片，
      // 若沿用单一的空闲超时 / 请求总超时，会被误判为「流停滞」并强制中止请求，
      // 表现为「AI 还没思考完就自动中断」。
      const thinkingTolerant = resolveThinkingTolerance(config, messages)

      // AI SDK 的 `timeout` 是「整个请求总超时」（与本地空闲守卫是两套独立机制），
      // 思考 / 长任务耗时一旦超过该值，SDK 会直接中止请求。
      // 因此这里统一抬到安全下限，详见 resolveRequestTimeoutMs 的说明。
      const requestTimeoutMs = resolveRequestTimeoutMs(
        prepared.callOptions.timeout,
        thinkingTolerant,
      )

      const streamParams: Parameters<typeof streamText>[0] = {
        model,
        messages: coreMessages,
        tools: coreTools,
        activeTools,
        ...prepared.settings,
        ...prepared.callOptions,
        ...(requestTimeoutMs !== undefined ? { timeout: requestTimeoutMs } : {}),
        abortSignal,
        providerOptions: prepared.providerOptions,
      }

      const result = streamText({
        ...streamParams,
        experimental_repairToolCall: this.createToolCallRepairer(),
      })

      const timeouts = resolveStreamTimeouts(prepared.callOptions.timeout, thinkingTolerant)

      logger.llm.info('[StreamProcessor] 超时策略已解析', {
        requestId,
        thinkingTolerant,
        configuredTimeoutMs: prepared.callOptions.timeout ?? null,
        requestTimeoutMs: requestTimeoutMs ?? null,
        firstChunkMs: timeouts.firstChunkMs,
        idleMs: timeouts.idleMs,
        thinkingIdleMs: timeouts.thinkingIdleMs,
      })

      return await this.processStream(
        result,
        strategy,
        requestId,
        timeouts,
        (tools?.length ?? 0) > 0,
        prepared.cacheWriteTokens,
      )
    } catch (error) {
      if (abortSignal?.aborted) {
        const abortedError = new LLMError('请求已取消', ErrorCode.ABORTED, false)
        this.dispatcher.dispatch(requestId, { type: 'error', error: abortedError })
        throw abortedError
      }

      // AI SDK 的请求总超时（或 Provider 侧主动断开）会以 AbortError 形式抛出，
      // 而 ABORTED 与「用户主动取消」是同一个错误码，前端会把二者都当作
      // 「用户取消」静默处理，表现为「没有任何提示的自动中断」。
      // 用户取消已在上面的分支返回，因此走到这里的中断类错误必然是超时 /
      // 连接断开，按 TIMEOUT 上报（可重试 + 有明确提示），不再伪装成取消。
      const errorName = (error as Error)?.name
      const errorMessage = (error as Error)?.message ?? ''
      const isTimeoutLike =
        errorName === 'TimeoutError' ||
        errorName === 'AbortError' ||
        /timed?\s*out|timeout|aborted/i.test(errorMessage)

      const llmError = isTimeoutLike
        ? new LLMError(
            '模型响应超时或连接被中断',
            ErrorCode.TIMEOUT,
            true,
            undefined,
            error instanceof Error ? error : undefined,
          )
        : LLMError.fromError(error)

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
    timeouts: StreamTimeoutProfile,
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
    // 超时分级所需的阶段状态
    let receivedFirstChunk = false
    let reasoningActive = false
    let sawTextOutput = false

    const hasCustomParser = !!strategy.parseStreamText
    const iterator = result.fullStream[Symbol.asyncIterator]()
    const detector = new PseudoToolDetector(enablePseudoTool)

    while (true) {
      // 按阶段选择超时阈值：
      // - first-chunk：请求已发出但尚无任何分片，推理模型的 TTFT 可能很长
      // - reasoning：模型正在思考（含"已开启思考但尚未产出正文/工具调用"）
      // - streaming：常规流式输出，相邻分片间隔容忍度较低
      // 只要模型明确进入思考，或尚未产出任何可见正文 / 工具活动，
      // 就无法区分「正在思考」与「流停滞」——统一按思考阶段给出宽松容忍，
      // 避免把正常思考误判为停滞并强制中断。
      //
      // 注意：这里刻意**不**依赖 thinkingTolerant 开关。很多模型由 Provider
      // 侧隐式开启思考（配置里并未显式勾选 thinking），若以开关为准，这些
      // 模型的思考期会退化成普通 streaming 阶段（60s 空闲即被判停滞）。
      const inThinkingPhase =
        reasoningActive || (!sawTextOutput && !sawToolActivity)
      const phase: StreamPhase = !receivedFirstChunk
        ? 'first-chunk'
        : inThinkingPhase
          ? 'reasoning'
          : 'streaming'
      const timeoutMs =
        phase === 'first-chunk'
          ? timeouts.firstChunkMs
          : phase === 'reasoning'
            ? timeouts.thinkingIdleMs
            : timeouts.idleMs

      const next = await this.timeoutGuard.next(iterator, requestId, timeoutMs, phase)
      if (next.done) break
      const part = next.value
      if (this.window.isDestroyed()) break

      receivedFirstChunk = true

      try {
        this.handleStreamPart(part, {
          strategy,
          detector,
          requestId,
          hasCustomParser,
          onReasoning: (text) => { reasoning += text },
          onReasoningPhase: (active) => { reasoningActive = active },
          onText: (text) => { streamedText += text; sawTextOutput = true },
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
        // 不再静默吞掉分片异常：记录为首个流错误，使最终结果如实上报失败。
        // 否则异常被吞后，只要此前已产出部分文本，就会按"正常完成"上报 done，
        // 前端会误判任务正常结束（表现为"AI 无提示自行中断"）。
        if (!streamError) {
          streamError = error instanceof Error ? error : new Error(String(error))
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
      onReasoningPhase: (active: boolean) => void
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
      case 'start':
      case 'finish':
      case 'raw':
        break

      case 'reasoning-start':
        ctx.onReasoningPhase(true)
        break

      case 'reasoning-end':
        ctx.onReasoningPhase(false)
        break

      case 'abort':
        // 流被中止：显式上报为错误，避免"已产出部分文本 → 被当作正常完成上报 done"。
        // 前端据此可区分"正常完成"与"被中止"，而不是静默结束且无任何原因提示。
        ctx.onError(new LLMError('模型响应被中止', ErrorCode.ABORTED, false))
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
          ctx.onReasoningPhase(true)
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
      onReasoningPhase: (active: boolean) => void
      onText: (text: string) => void
      onToolActivity: () => void
      onExecutableToolCall: () => void
    },
  ): void {
    let content = text

    if (hasCustomParser && strategy.parseStreamText) {
      const parsed = strategy.parseStreamText(text)
      if (parsed.thinking) {
        ctx.onReasoningPhase(true)
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
        ctx.onReasoningPhase(false)
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
