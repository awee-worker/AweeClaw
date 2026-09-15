/**
 * `POST /v1/chat/completions` — 对话补全（SSE 流式 + 非流式）
 *
 * 这是 P0-5 的核心价值点：让第三方客户端（Cherry Studio / ChatBox 等）零改造
 * 接管本地智能体。
 *
 * 复用策略（刻意不重复实现）：
 *   - **非流式** → `SyncService.generate`（主进程既有的 AI SDK generateText 封装，
 *     已处理 thinking / providerOptions / prompt cache / 重试）
 *   - **流式**   → 直接 `streamText`，但**配置构建仍复用** `buildGenerationSettings`
 *     与 `buildProtocolProviderOptions` / `buildThinkingProviderOptions`。
 *     为什么不走 `executePreparedRequest`：它内层包了「生成失败自动重试」，
 *     对流式而言重试会**把已吐出的内容再吐一遍**，比失败更糟。
 *
 * 超时策略（对齐 P0-5 实现注意第 5 条）：
 *   **不设任何超时**。AI 思考/生成耗时不可预估，超时会表现为「AI 还在想就断了」。
 *   中止只由两件事触发：客户端断开连接，或用户在 AweeClaw 里点停止。
 *
 * @module openapi/routes/chatCompletions
 */

import * as crypto from 'crypto'
import type * as http from 'http'
import { streamText } from 'ai'
import { createModel } from '../../ai-provider/modelRegistry'
import { MessageConverter } from '../../ai-provider/core/MessageAdapter'
import {
  buildGenerationSettings,
  buildRequestExecutionOptions,
} from '../../ai-provider/core/RequestConfigBuilder'
import {
  buildProtocolProviderOptions,
  buildThinkingProviderOptions,
  mergeProviderOptions,
  resolveThinkingCompatibility,
} from '../../ai-provider/core/ProviderFeatureMatrix'
import { logger } from '@shared/toolkit/LogEngine'
import { resolveModelRequest, getActiveModelId } from '../OpenApiModelSource'
import type { OpenAiChatRequest, OpenAiUsage } from '@shared/protocols/openApiProtocol'
import type { LLMConfig, LLMMessage } from '@protocols'
import type { RouteContext } from './routeTypes'
import { openAiError } from './routeTypes'

/** 第三方客户端未指定 system 时的兜底提示 */
const DEFAULT_SYSTEM_PROMPT = [
  '你是 AweeClaw 的智能体，当前通过 OpenAI 兼容 API 为一个第三方客户端提供服务。',
  '请直接给出高质量回答，不要提及协议、接口或你正在被谁调用。',
].join('\n')

/** 单条消息的最大字符数（防止外部客户端塞入超长内容打爆上下文） */
const MAX_MESSAGE_CHARS = 200_000

/** 消息条数上限 */
const MAX_MESSAGE_COUNT = 200

// ============================================
// 请求归一化
// ============================================

interface NormalizedRequest {
  messages: LLMMessage[]
  /** 从 messages 里提取的 system 内容（与请求体的 system 字段合并） */
  systemFromMessages: string
  /** 是否含无法处理的多模态内容（如带图片） */
  hasUnsupportedModal: boolean
}

/**
 * 把 OpenAI 风格的 messages 归一化为内部 LLMMessage[]。
 *
 * 多模态取舍：OpenAI 的 `content: [{type:'image_url',...}]` 与内部 ImageContent
 * 结构不同，且图片链路涉及视觉模型路由（另一套配置）。这里**明确拒绝**而不是
 * 悄悄丢掉图片部分 —— 用户以为发了图、模型却没看到，比直接报错更难排查。
 */
function normalizeMessages(raw: unknown): NormalizedRequest {
  const out: LLMMessage[] = []
  let systemFromMessages = ''
  let hasUnsupportedModal = false

  if (!Array.isArray(raw)) return { messages: out, systemFromMessages, hasUnsupportedModal }

  for (const item of raw.slice(0, MAX_MESSAGE_COUNT)) {
    if (!item || typeof item !== 'object') continue
    const msg = item as { role?: unknown; content?: unknown }
    const role = typeof msg.role === 'string' ? msg.role : ''

    const text = extractText(msg.content, () => {
      hasUnsupportedModal = true
    })
    if (!text) continue

    if (role === 'system' || role === 'developer') {
      systemFromMessages = systemFromMessages ? `${systemFromMessages}\n${text}` : text
      continue
    }
    if (role === 'user' || role === 'assistant' || role === 'tool') {
      out.push({ role, content: text.slice(0, MAX_MESSAGE_CHARS) })
    }
  }

  return { messages: out, systemFromMessages, hasUnsupportedModal }
}

/** 从 OpenAI content 里抽出纯文本；遇到图片/文件等置位 onUnsupported */
function extractText(content: unknown, onUnsupported: () => void): string {
  if (typeof content === 'string') {
    return content.includes('\0') ? content.replace(/\0/g, '') : content
  }
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === 'text' && typeof p.text === 'string') {
      parts.push(p.text)
      continue
    }
    // 任何非文本块（image_url / input_audio / file …）都标记为不支持
    onUnsupported()
  }
  return parts.join('\n')
}

/** 请求未提供内容时的占位（部分客户端会发空 content 的心跳） */
function isEmptyConversation(messages: LLMMessage[]): boolean {
  return messages.length === 0
}

// ============================================
// 主入口
// ============================================

export async function handleChatCompletions(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const body = (await ctx.readJsonBody(req)) as OpenAiChatRequest | null
  if (!body) {
    ctx.respondJson(res, 400, openAiError('请求体不是合法 JSON 或超出大小限制', 'invalid_request_error', 'invalid_request_error'))
    return
  }

  const normalized = normalizeMessages(body.messages)
  if (normalized.hasUnsupportedModal) {
    ctx.respondJson(
      res,
      400,
      openAiError(
        '暂不支持图片 / 音频等多模态输入：请改用纯文本消息（AweeClaw 的图像理解请在客户端内使用）',
        'unsupported_content',
        'invalid_request_error',
      ),
    )
    return
  }
  if (isEmptyConversation(normalized.messages)) {
    ctx.respondJson(res, 400, openAiError('messages 不能为空', 'invalid_request_error', 'invalid_request_error'))
    return
  }

  const resolved = resolveModelRequest(body.model)
  if (!resolved.config) {
    ctx.respondJson(res, 400, openAiError(resolved.error || '模型不可用', 'model_not_available', 'invalid_request_error'))
    return
  }

  // agent:<id> 路由 → 用智能体人格；请求体 system 追加在后（外部客户端的显式指令更具体）
  const systemPrompt = [resolved.agentSystemPrompt, normalized.systemFromMessages, resolved.agentSystemPrompt ? '' : DEFAULT_SYSTEM_PROMPT]
    .filter(Boolean)
    .join('\n\n')

  const config = applySamplingOverrides(resolved.config, body)
  // 回填给客户端的 model：优先用它自己传的名字，否则用实际生效的模型
  const modelId = body.model || config.model || getActiveModelId()

  if (body.stream === true) {
    await streamCompletion(res, ctx, config, normalized.messages, systemPrompt, modelId)
    return
  }
  await syncCompletion(res, ctx, config, normalized.messages, systemPrompt, modelId)
}

/** 把请求体的采样参数覆盖到本地配置上（仅覆盖客户端显式传了的字段） */
function applySamplingOverrides(config: LLMConfig, body: OpenAiChatRequest): LLMConfig {
  const next: LLMConfig = { ...config }
  if (typeof body.temperature === 'number') next.temperature = body.temperature
  if (typeof body.top_p === 'number') next.topP = body.top_p
  if (typeof body.max_tokens === 'number' && body.max_tokens > 0) next.maxTokens = body.max_tokens
  if (typeof body.stop === 'string') next.stopSequences = [body.stop]
  else if (Array.isArray(body.stop)) next.stopSequences = body.stop.filter((s) => typeof s === 'string')
  return next
}

// ============================================
// 非流式
// ============================================

async function syncCompletion(
  res: http.ServerResponse,
  ctx: RouteContext,
  config: LLMConfig,
  messages: LLMMessage[],
  systemPrompt: string,
  modelId: string,
): Promise<void> {
  const startedAt = Date.now()
  try {
    const { SyncService } = await import('../../ai-provider/services/ModelSyncCoordinator')
    const result = await new SyncService().generate({ config, messages, systemPrompt })
    const content = (result.data || '').trim()

    ctx.respondJson(res, 200, {
      id: newCompletionId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: normalizeFinishReason(result.metadata?.finishReason),
        },
      ],
      // 缺失时如实置 0，不伪造（方案第 4 条）
      usage: toOpenAiUsage(result.usage),
    })
    logger.system.info(`[OpenApi] chat/completions (sync) ok in ${Date.now() - startedAt}ms`)
  } catch (err) {
    ctx.reportError(err, 'POST /v1/chat/completions (sync)')
    ctx.respondJson(res, 502, openAiError(describeGenerationError(err), 'upstream_error'))
  }
}

// ============================================
// 流式（SSE）
// ============================================

async function streamCompletion(
  res: http.ServerResponse,
  ctx: RouteContext,
  config: LLMConfig,
  messages: LLMMessage[],
  systemPrompt: string,
  modelId: string,
): Promise<void> {
  const startedAt = Date.now()

  let model
  let baseMessages
  let settings
  let providerOptions
  let headers

  try {
    model = createModel(config)
    baseMessages = new MessageConverter().convert(messages, systemPrompt)
    settings = buildGenerationSettings(config)
    headers = buildRequestExecutionOptions(config).headers

    providerOptions = buildProtocolProviderOptions(config)
    if (resolveThinkingCompatibility(config, messages).enabled) {
      providerOptions = mergeProviderOptions(providerOptions, buildThinkingProviderOptions(config))
    }
  } catch (err) {
    ctx.reportError(err, 'POST /v1/chat/completions (stream, prepare)')
    ctx.respondJson(res, 502, openAiError(describeGenerationError(err), 'upstream_error'))
    return
  }

  const completionId = newCompletionId()
  const created = Math.floor(Date.now() / 1000)

  // 客户端断开 → 中止生成。用 res 'close' 而不是 req 'aborted'：
  // Node 18+ 两者语义有重叠，res.close + writableEnded 判断更可靠
  const controller = new AbortController()
  let clientGone = false
  const onClose = (): void => {
    if (!res.writableEnded) {
      clientGone = true
      controller.abort()
      logger.system.info('[OpenApi] SSE client disconnected, generation aborted')
    }
  }
  res.on('close', onClose)

  const writeSse = (payload: unknown): void => {
    if (res.writableEnded) return
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  const writeChunk = (delta: Record<string, unknown>, finishReason: string | null): void => {
    writeSse({
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: modelId,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })
  }

  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 反向代理（nginx）默认会缓冲 SSE，显式关闭
      'X-Accel-Buffering': 'no',
    })
    // 禁用 Nagle：否则小 chunk 会被攒着一起发，流式变成「一段一段跳」
    res.socket?.setNoDelay(true)
    res.flushHeaders?.()

    // 首个 chunk 只带 role，符合 OpenAI 客户端预期
    writeChunk({ role: 'assistant' }, null)

    // ⚠️ 必须包一层对象返回：streamText 的返回值是 thenable，
    // 直接 return 会被 async 函数 await 掉 —— 那就等到流结束才拿到结果，SSE 全废
    const result = streamText({
      model,
      messages: baseMessages,
      ...settings,
      ...(headers ? { headers } : {}),
      providerOptions,
      abortSignal: controller.signal,
      // 不传 timeout：AI 生成耗时不设上限（见文件头注释）
    })

    for await (const delta of result.textStream) {
      if (clientGone) break
      if (delta) writeChunk({ content: delta }, null)
    }

    if (!clientGone) {
      writeChunk({}, 'stop')
      if (!res.writableEnded) res.write('data: [DONE]\n\n')
      logger.system.info(`[OpenApi] chat/completions (stream) done in ${Date.now() - startedAt}ms`)
    }
  } catch (err) {
    if (clientGone) return
    ctx.reportError(err, 'POST /v1/chat/completions (stream)')
    // 已经写了 SSE 头，只能把错误塞进流里 —— 直接断开会让客户端空等到超时
    writeSse(openAiError(describeGenerationError(err), 'upstream_error'))
    if (!res.writableEnded) res.write('data: [DONE]\n\n')
  } finally {
    res.removeListener('close', onClose)
    if (!res.writableEnded) res.end()
  }
}

// ============================================
// 工具
// ============================================

function newCompletionId(): string {
  return `chatcmpl-${crypto.randomBytes(12).toString('hex')}`
}

/** AI SDK 的 finishReason → OpenAI 的 finish_reason */
function normalizeFinishReason(reason: string | undefined): string {
  switch (reason) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'tool-calls':
      return 'tool_calls'
    case 'content-filter':
      return 'content_filter'
    case 'error':
      return 'stop'
    default:
      return 'stop'
  }
}

/** 内部 usage → OpenAI usage（缺失时置 0） */
function toOpenAiUsage(usage: unknown): OpenAiUsage {
  const u = (usage || {}) as { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  const prompt = Number(u.promptTokens) || 0
  const completion = Number(u.completionTokens) || 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: Number(u.totalTokens) || prompt + completion,
  }
}

/** 把生成异常翻译成第三方客户端能读懂的原因 */
function describeGenerationError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/api key|unauthorized|401/i.test(raw)) {
    return '本机配置的模型 API Key 无效或已过期，请在 AweeClaw「设置 → 模型」中更新后重试'
  }
  if (/rate limit|429/i.test(raw)) {
    return '模型服务商限流，请稍后重试'
  }
  if (/quota|insufficient/i.test(raw)) {
    return '模型额度不足，请检查 AweeClaw 中的账户或密钥'
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(raw)) {
    return `无法连接模型服务商：${raw}`
  }
  return `模型调用失败：${raw}`
}

/** 供测试引用（避免 tree-shaking 掉工具函数） */
export const __internal = { normalizeMessages, applySamplingOverrides, toOpenAiUsage, normalizeFinishReason }
