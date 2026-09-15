/**
 * 流式处理器 — 基于 AI SDK 6.0 streamText 的流式对话核心
 *
 * 通过组合多个专职组件实现流式文本生成：
 * - 伪工具调用检测器：从文本流中识别并提取工具调用
 * - 流式事件分发器：IPC 事件的批量与即时发送
 * - 流式静默守卫：长静默期只做连通性诊断，绝不按时间中断
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
import {
  CONNECTION_PROBE_FAILURE_THRESHOLD,
  CONNECTION_PROBE_INTERVAL_MS,
  CONNECTION_PROBE_TIMEOUT_MS,
  describeConnectionDropError,
  isConnectionDropError,
  probeTcpReachable,
  resolveProbeTarget,
  type ConnectionProbeTarget,
} from '../core/ConnectionHealth'

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
/* 流式等待策略（不设时间阈值）                                        */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ 设计原则：**不做任何「空闲多久就中断」的时间判定**。
 *
 * 历史教训：AI 的思考耗时无法预估（推理模型从几十秒到几分钟都属正常），
 * 早期实现的「首包超时 / 空闲超时」会在 AI 正常思考时把请求误判为
 * 「流停滞」并强制中止，表现为「AI 还在思考就自动中断会话」。
 *
 * 因此流式请求的终止条件被收敛为三类**客观信号**：
 * 1. 用户主动点击「停止」→ AbortSignal
 * 2. 传输层明确报错（ECONNRESET / socket hang up / premature close 等）
 * 3. 流在未收到结束标志（finish）的情况下提前 EOF
 *
 * 连通性探测（probeTarget）只用于输出诊断日志，**不参与中断决策**：
 * 它回答的是「目标主机是否可达」，与「当前这条 HTTP 连接是否存活」并不
 * 等价（例如配置代理时直连探测可能失败），用它来中断会误杀正常思考。
 */

/**
 * AI SDK 总请求超时的安全下限（毫秒）。
 *
 * AI SDK 的 `timeout` 语义是「整个请求的总耗时上限」，一旦命中会直接中止
 * 流式请求，因此**不能**把模型配置里那个「空闲超时」语义的值透传进来
 * （详见 generateOnce 中对 callOptions 的剥离）。
 *
 * 这里只保留一个极宽松的兜底，用于「请求永久挂起且传输层始终不报错」的
 * 极端场景；正常思考 / 长任务不会触及该阈值。
 */
const REQUEST_TIMEOUT_FLOOR_MS = 30 * 60_000

/** 流式阶段标识（仅用于诊断日志，不再用于选择超时阈值） */
export type StreamPhase = 'first-chunk' | 'reasoning' | 'streaming'


/* ------------------------------------------------------------------ */
/* 流式静默守卫（只等待 + 诊断，绝不中断）                             */
/* ------------------------------------------------------------------ */

/**
 * 流式静默守卫 —— 等待下一个分片，并在长静默期输出连通性诊断日志。
 *
 * ⚠️ 它**不会**因为静默时间过长而中断请求：请求的终止只来自
 * AbortSignal（用户停止）/ 传输层错误 / 提前 EOF。
 * 连通性探测只写日志，用于排查「界面一直转圈」到底是模型在思考还是网络已断。
 */
class StreamSilenceGuard {
  /**
   * 读取下一个流式分片（无限等待）。
   *
   * @param iterator 流式迭代器
   * @param requestId 请求 ID（用于日志）
   * @param phase 当前所处阶段（仅用于日志）
   * @param probeTarget 连通性诊断目标（可为 null）
   */
  async next(
    iterator: AsyncIterator<any>,
    requestId: string,
    phase: StreamPhase = 'streaming',
    probeTarget: ConnectionProbeTarget | null = null,
  ): Promise<IteratorResult<any>> {
    return this.awaitSilence(iterator, requestId, phase, probeTarget)
  }

  /**
   * 无限等待下一个分片，并在长静默期输出连通性诊断。
   *
   * - 静默超过 CONNECTION_PROBE_INTERVAL_MS → 发起一次 TCP 连通性探测
   * - 探测结果**只写日志**：连续失败达阈值时升级为 error 级，便于排查
   *   「AI 长时间无输出是模型在思考，还是网络已断」
   * - 无论探测结果如何都继续等待，绝不在此处中断请求
   */
  private async awaitSilence(
    iterator: AsyncIterator<any>,
    requestId: string,
    phase: StreamPhase,
    probeTarget: ConnectionProbeTarget | null,
  ): Promise<IteratorResult<any>> {
    let probeTimer: NodeJS.Timeout | null = null
    let consecutiveFailures = 0
    let finished = false

    const stop = () => {
      finished = true
      if (probeTimer) {
        clearTimeout(probeTimer)
        probeTimer = null
      }
    }

    const scheduleProbe = () => {
      if (!probeTarget) return
      probeTimer = setTimeout(() => {
        void (async () => {
          if (finished) return

          const reachable = await probeTcpReachable(probeTarget, CONNECTION_PROBE_TIMEOUT_MS)
          if (finished) return

          if (reachable) {
            if (consecutiveFailures > 0) {
              logger.llm.info('[StreamProcessor] 静默期连通性已恢复', {
                requestId,
                target: probeTarget.label,
              })
            }
            consecutiveFailures = 0
            logger.llm.debug('[StreamProcessor] 静默期连通性探测通过，继续等待模型输出', {
              requestId,
              phase,
              target: probeTarget.label,
              silentMs: CONNECTION_PROBE_INTERVAL_MS,
            })
            scheduleProbe()
            return
          }

          consecutiveFailures += 1
          const persistent = consecutiveFailures >= CONNECTION_PROBE_FAILURE_THRESHOLD
          // ⚠️ 仅诊断，不中断：探测回答的是「主机是否可达」，
          //    并不等价于「当前这条 HTTP 连接是否存活」（走代理时尤甚）。
          if (persistent) {
            logger.llm.error(
              '[StreamProcessor] 静默期连通性持续异常（仅告警，不中断请求）',
              {
                requestId,
                phase: describeStreamPhase(phase),
                target: probeTarget.label,
                consecutiveFailures,
              },
            )
          } else {
            logger.llm.warn('[StreamProcessor] 静默期连通性探测失败', {
              requestId,
              phase: describeStreamPhase(phase),
              target: probeTarget.label,
              consecutiveFailures,
            })
          }
          scheduleProbe()
        })()
      }, CONNECTION_PROBE_INTERVAL_MS)
    }

    try {
      scheduleProbe()
      return await iterator.next()
    } finally {
      stop()
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
 * 解析传给 AI SDK 的「总请求超时」（`timeout` 选项）。
 *
 * 与静默守卫是两套独立机制：AI SDK 的 `timeout` 覆盖**整个请求**，
 * 一旦命中会直接中止流式请求。
 *
 * ⚠️ 思考型模型**不设总超时**（返回 `undefined`，交给 SDK 不做限制）：
 * 思考 / 长任务耗时不可预估，任何有限上限都会在请求完成前强制中断，
 * 表现为「AI 还在思考就被自动中断」。
 *
 * ⚠️ 这里**不使用**模型配置里的 `timeout`：它的语义是「多久没有数据算超时」，
 * 而 SDK 的 `timeout` 是「整个请求的总耗时上限」，二者不可互换（默认配置 120s
 * 会直接把一次长思考截断）。配置值已在 generateOnce 中从 callOptions 剥离。
 *
 * 非思考型模型保留一个宽松的安全下限，仅兜底「请求永久挂起且传输层始终不报错」。
 *
 * @param thinkingTolerant 本次请求是否启用思考容忍
 * @returns SDK 总超时（毫秒）；`undefined` 表示不设上限
 */
export function resolveRequestTimeoutMs(
  thinkingTolerant: boolean,
): number | undefined {
  // 思考型模型：不设总超时，交由用户主动中止
  if (thinkingTolerant) return undefined

  // 非思考型模型：仅保留极宽松兜底（30 分钟），正常请求不会触及
  return REQUEST_TIMEOUT_FLOOR_MS
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

/** 流式处理器 — 协调模型创建、流式生成与事件分发（不设基于时间的流中断） */
export class StreamingService {
  private readonly messageConverter = new MessageConverter()
  private readonly toolConverter = new ToolConverter()
  private readonly silenceGuard = new StreamSilenceGuard()
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

      // 思考感知：推理模型（或已开启思考的模型）在思考阶段可能长时间不产出分片。
      const thinkingTolerant = resolveThinkingTolerance(config, messages)

      // ⚠️ 必须先把模型配置里的 `timeout` 从 callOptions 中剥离出来。
      //
      // 二者语义完全不同，混用是「AI 一思考就自动中断」的根因：
      // - 模型配置里的 `timeout`（默认 120s）语义是「多久没有数据算超时」，
      //   是用户按「空闲等待」的直觉填写的；
      // - AI SDK 的 `timeout` 语义是**整个请求的总耗时上限**，
      //   一旦命中 SDK 会直接 abort 整个流式请求。
      //
      // 若把配置值原样透传给 SDK，AI「思考 + 输出」累计超过该值就会被强制中止，
      // 且思考越久越容易触发 —— 表现为「AI 还在思考就自动中断」。
      // 因此这里剥离，再由 resolveRequestTimeoutMs 统一决定总超时策略。
      const { timeout: configuredTimeoutMs, ...callOptions } = prepared.callOptions

      const requestTimeoutMs = resolveRequestTimeoutMs(thinkingTolerant)

      const streamParams: Parameters<typeof streamText>[0] = {
        model,
        messages: coreMessages,
        tools: coreTools,
        activeTools,
        ...prepared.settings,
        ...callOptions,
        ...(requestTimeoutMs !== undefined ? { timeout: requestTimeoutMs } : {}),
        abortSignal,
        providerOptions: prepared.providerOptions,
      }

      const result = streamText({
        ...streamParams,
        experimental_repairToolCall: this.createToolCallRepairer(),
      })

      // 连接连通性探测目标（仅用于诊断日志，无法解析时为 null）
      const probeTarget = resolveProbeTarget(config)

      logger.llm.info('[StreamProcessor] 超时策略已解析', {
        requestId,
        thinkingTolerant,
        // 模型配置里的 timeout 已被剥离，仅作为诊断信息记录（不再直接作用于请求）
        configuredTimeoutMs: configuredTimeoutMs ?? null,
        requestTimeoutMs: requestTimeoutMs ?? null,
        // 流式阶段不再存在任何「空闲多久就中断」的时间阈值：
        // 只有用户主动停止 / 传输层断开 / 流提前 EOF 才会终止请求。
        streamIdleTimeout: null,
        probeTarget: probeTarget?.label ?? null,
      })

      return await this.processStream(
        result,
        strategy,
        requestId,
        (tools?.length ?? 0) > 0,
        probeTarget,
        prepared.cacheWriteTokens,
        abortSignal,
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
      // 用户取消已在上面的分支返回，因此走到这里的都是真实异常，需明确上报。
      //
      // 归类优先级：
      // 1) 已是 LLMError（含「提前 EOF」与「探测失败」包装）→ 保留原始语义
      // 2) 传输层断开（ECONNRESET / EPIPE / UND_ERR_SOCKET ...）→ NETWORK（可重试）
      // 3) 超时类（TimeoutError / AbortError / timeout 文案）→ TIMEOUT（可重试）
      // 4) 其他 → 交给统一错误分类器
      const errorName = (error as Error)?.name
      const errorMessage = (error as Error)?.message ?? ''
      const isTimeoutLike =
        errorName === 'TimeoutError' ||
        errorName === 'AbortError' ||
        /timed?\s*out|timeout|aborted/i.test(errorMessage)
      const isConnectionDrop = !(error instanceof LLMError) && isConnectionDropError(error)

      let llmError: LLMError
      if (error instanceof LLMError) {
        llmError = error
      } else if (isConnectionDrop) {
        llmError = new LLMError(
          `${describeConnectionDropError(error)}，生成已中断`,
          ErrorCode.NETWORK,
          true,
          undefined,
          error instanceof Error ? error : undefined,
        )
      } else if (isTimeoutLike) {
        llmError = new LLMError(
          '模型响应超时或连接被中断',
          ErrorCode.TIMEOUT,
          true,
          undefined,
          error instanceof Error ? error : undefined,
        )
      } else {
        llmError = LLMError.fromError(error)
      }

      logger.llm.error('[StreamProcessor] 流式错误', {
        errorType: error?.constructor?.name,
        errorMessage: (error as Error)?.message?.substring(0, 500),
        errorCode: llmError.code,
        connectionDrop: isConnectionDrop,
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

  /**
   * 处理流式响应
   *
   * @param abortSignal 用户中止信号。用于区分「用户主动停止」与「连接断开」：
   *   前者应静默收尾，后者才以 NETWORK 错误上报（可自动重试）。
   */
  private async processStream(
    result: StreamTextResult<any, any>,
    strategy: ThinkingStrategy,
    requestId: string,
    enablePseudoTool: boolean,
    probeTarget: ConnectionProbeTarget | null,
    cacheWriteTokens?: number,
    abortSignal?: AbortSignal,
  ): Promise<StreamingResult> {
    let reasoning = ''
    let streamedText = ''
    let responseMeta: ResponseMetadata | undefined
    let sawNonTextOutput = false
    let streamError: Error | null = null
    let sawToolActivity = false
    let sawExecutableToolCall = false
    // 阶段状态（仅用于静默期诊断日志，不参与任何中断决策）
    let receivedFirstChunk = false
    let reasoningActive = false
    let sawTextOutput = false
    // 连接断开检测所需的状态
    let sawFinish = false
    let windowDestroyed = false
    // 用户主动停止标记：中止由用户触发时，流会提前 EOF，但这不等于连接断开
    let abortedByUser = false

    const hasCustomParser = !!strategy.parseStreamText
    const iterator = result.fullStream[Symbol.asyncIterator]()
    const detector = new PseudoToolDetector(enablePseudoTool)

    while (true) {
      // 阶段仅用于诊断：区分「等待首个响应 / 模型思考中 / 输出中」，
      // 便于排查长时间静默时的日志。
      // ⚠️ 阶段不再参与超时计算 —— 任何阶段都无限等待下一个分片，
      //    避免把「模型在思考」误判为「流停滞」并强制中断会话。
      const inThinkingPhase =
        reasoningActive || (!sawTextOutput && !sawToolActivity)
      const phase: StreamPhase = !receivedFirstChunk
        ? 'first-chunk'
        : inThinkingPhase
          ? 'reasoning'
          : 'streaming'

      // 用户主动停止：立刻停止消费流，且不允许后续逻辑把它判定为「连接断开」
      // （否则会以 NETWORK 错误上报并触发自动重试，表现为「点了停止又自己跑起来」）
      if (abortSignal?.aborted) {
        abortedByUser = true
        break
      }

      const next = await this.silenceGuard.next(iterator, requestId, phase, probeTarget)
      if (next.done) break
      const part = next.value
      if (this.window.isDestroyed()) {
        windowDestroyed = true
        break
      }

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
          onFinish: () => { sawFinish = true },
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

    // 用户主动停止：按取消收尾，不写错误、不触发重试
    if (abortedByUser || abortSignal?.aborted) {
      logger.llm.info('[StreamProcessor] 流已被用户中止，按取消处理（不视为连接断开）', {
        requestId,
        receivedFirstChunk,
        contentLength: streamedText.length,
        reasoningLength: reasoning.length,
      })
    }

    if (!streamError && !sawFinish && !windowDestroyed && !abortedByUser && !abortSignal?.aborted) {
      streamError = new LLMError(
        '模型响应在完成前中断（未收到结束标志），连接可能已断开',
        ErrorCode.NETWORK,
        true,
      )
      logger.llm.warn('[StreamProcessor] 检测到流提前结束（未收到 finish），判定为连接断开', {
        requestId,
        receivedFirstChunk,
        sawTextOutput,
        sawToolActivity,
        contentLength: streamedText.length,
        reasoningLength: reasoning.length,
      })
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
      onFinish: () => void
    },
  ): void {
    const { strategy, detector, requestId, hasCustomParser } = ctx

    switch (part.type) {
      case 'text-start':
      case 'text-end':
      case 'start':
      case 'raw':
        break

      case 'finish':
        // 流的正常结束标志 —— 连接断开检测靠它区分「正常完成」与「被截断」
        ctx.onFinish()
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
