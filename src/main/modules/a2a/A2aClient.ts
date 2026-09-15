/**
 * A2A 客户端（JSON-RPC 2.0 over HTTP）
 *
 * 职责：把「一个远端 A2A 智能体」封装成一次可等待的方法调用。
 *
 * 协议要点（对齐 A2A 规范 + python-a2a 行为）：
 *   1. 发现   `GET  /.well-known/agent.json`          → AgentCard
 *   2. 调用   `POST {base}`  method=`message/send`    → Task | Message
 *   3. 轮询   `POST {base}`  method=`tasks/get`       → Task（长任务）
 *   4. 取消   `POST {base}`  method=`tasks/cancel`    → Task
 *
 * 三个刻意的设计选择：
 *   - **不用 A2AClient(agentUrl).ask() 的语义**：源项目那行代码掩盖了「同步返回
 *     Message」与「异步返回 Task」两条路径，这里把两者都显式处理并统一成文本。
 *   - **错误一律翻译成中文**：工具返回值会直接进模型上下文，英文栈信息会让模型
 *     反复重试同一调用；给一句人能看懂的原因，模型才会换策略或如实告知用户。
 *   - **绝不无限等待**：单次调用 60s 上限，异步任务改为 1s 间隔轮询 `tasks/get`。
 *
 * @module a2a/A2aClient
 */

import { logger } from '@shared/toolkit/LogEngine'
import {
  A2A_METHODS,
  A2A_TERMINAL_STATES,
} from '@shared/protocols/a2aProtocol'
import type {
  A2aAgentCard,
  A2aArtifact,
  A2aJsonRpcResponse,
  A2aMessage,
  A2aPart,
  A2aResult,
  A2aTask,
} from '@shared/protocols/a2aProtocol'

// ============================================
// 常量
// ============================================

/** 工具调用总超时（同步路径） */
export const A2A_CALL_TIMEOUT_MS = 60_000

/** Agent Card 探测超时（连通性测试要快速失败） */
export const A2A_CARD_TIMEOUT_MS = 8_000

/** 异步任务的轮询间隔 */
const POLL_INTERVAL_MS = 1_000

/** Card 发现路径（按顺序尝试，兼容新旧规范） */
const CARD_PATHS = ['/.well-known/agent.json', '/.well-known/agent-card.json'] as const

// ============================================
// 错误
// ============================================

/** A2A 调用错误（message 已翻译为可直接展示 / 进模型上下文的中文） */
export class A2aError extends Error {
  readonly code: string
  readonly httpStatus?: number

  constructor(message: string, code: string, httpStatus?: number) {
    super(message)
    this.name = 'A2aError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

// ============================================
// 工具函数
// ============================================

/** 生成 JSON-RPC 请求 id（唯一即可，无需全局单调） */
let rpcSeq = 0
function nextRpcId(): string {
  rpcSeq += 1
  return `aweeclaw-${Date.now().toString(36)}-${rpcSeq}`
}

/** 把网络层异常翻译成中文可读原因 */
function describeNetworkError(err: unknown, url: string, timeoutMs: number): string {
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return `调用 A2A 智能体超时（${Math.round(timeoutMs / 1000)}s 未返回）：${url}`
  }
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  const code = cause?.code || (err as { code?: string })?.code

  // 字符串兜底：不同 undici/Node 版本对底层错误的包装方式不一致
  // （有的给 code，有的只把 ERR_* 拼进 message，还有的包在 AggregateError 里），
  // 只认 code 会让「端口没开」这种最常见的问题退化成一句无信息量的英文原文。
  const detail = `${cause?.message || ''} ${err instanceof Error ? err.message : ''}`
  if (!code && detail.trim()) {
    if (/ECONNREFUSED/i.test(detail)) {
      return `无法连接 A2A 智能体：目标端口拒绝连接，请确认服务已启动且地址正确（${url}）`
    }
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail)) {
      return `无法解析 A2A 智能体域名：请检查地址拼写与网络/DNS（${url}）`
    }
    if (/ECONNRESET|EPIPE/i.test(detail)) {
      return `与 A2A 智能体的连接被重置：服务可能已崩溃或中途关闭（${url}）`
    }
    if (/CERT_|self.signed|certificate/i.test(detail)) {
      return `A2A 智能体证书校验失败：如为自签名证书请在系统信任后重试（${url}）`
    }
  }

  switch (code) {
    case 'ECONNREFUSED':
      return `无法连接 A2A 智能体：目标端口拒绝连接，请确认服务已启动且地址正确（${url}）`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `无法解析 A2A 智能体域名：请检查地址拼写与网络/DNS（${url}）`
    case 'ECONNRESET':
    case 'EPIPE':
      return `与 A2A 智能体的连接被重置：服务可能已崩溃或中途关闭（${url}）`
    case 'ETIMEDOUT':
      return `与 A2A 智能体建立连接超时：请检查网络连通性（${url}）`
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return `A2A 智能体证书校验失败：如为自签名证书请在系统信任后重试（${url}）`
    default:
      break
  }
  const rawMessage = cause?.message || (err instanceof Error ? err.message : String(err))
  return `调用 A2A 智能体失败：${rawMessage}（${url}）`
}

/** 把 HTTP 状态码翻译成中文可读原因 */
function describeHttpStatus(status: number, url: string): string {
  if (status === 401 || status === 403) {
    return `A2A 智能体拒绝访问（HTTP ${status}）：请检查访问 Token / 凭证是否正确（${url}）`
  }
  if (status === 404) {
    return `A2A 智能体未提供该端点（HTTP 404）：请确认地址指向 A2A 服务根路径（${url}）`
  }
  if (status === 405) {
    return `A2A 智能体不接受 POST（HTTP 405）：该地址可能不是 JSON-RPC 端点（${url}）`
  }
  if (status === 413) {
    return `请求体过大被拒绝（HTTP 413）：请缩短发送内容（${url}）`
  }
  if (status === 429) {
    return `A2A 智能体限流（HTTP 429）：请稍后重试（${url}）`
  }
  if (status >= 500) {
    return `A2A 智能体内部错误（HTTP ${status}）：问题在对方服务端（${url}）`
  }
  return `A2A 智能体返回异常状态（HTTP ${status}）（${url}）`
}

/** 拼接文本内容块 */
function joinTextParts(parts: A2aPart[] | undefined): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((p): p is Extract<A2aPart, { kind: 'text' }> => p?.kind === 'text' && typeof (p as { text?: unknown }).text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim()
}

/** 从 artifact 列表提取文本 */
function joinArtifacts(artifacts: A2aArtifact[] | undefined): string {
  if (!Array.isArray(artifacts)) return ''
  return artifacts
    .map((a) => joinTextParts(a?.parts))
    .filter(Boolean)
    .join('\n')
    .trim()
}

/**
 * 从 `message/send` 的返回值里提取「人类可读文本」。
 *
 * A2A 允许三种承载方式，按可靠性排序取第一个非空：
 *   1. `artifacts[].parts[].text`（规范推荐）
 *   2. `status.message.parts[].text`（任务在终态附带的总结消息）
 *   3. 返回值本身就是 Message（同步实现）
 */
export function extractTextFromResult(result: A2aResult | undefined | null): string {
  if (!result || typeof result !== 'object') return ''

  if ((result as A2aMessage).kind === 'message') {
    return joinTextParts((result as A2aMessage).parts)
  }

  const task = result as A2aTask
  const fromArtifacts = joinArtifacts(task.artifacts)
  if (fromArtifacts) return fromArtifacts

  const fromStatus = joinTextParts(task.status?.message?.parts)
  if (fromStatus) return fromStatus

  return ''
}

/** 任务是否已进入终态 */
export function isTerminalState(state: unknown): boolean {
  return A2A_TERMINAL_STATES.includes(state as (typeof A2A_TERMINAL_STATES)[number])
}

/** 把任务状态翻译成中文（用于错误提示） */
function describeTaskState(state: string | undefined): string {
  switch (state) {
    case 'failed':
      return '任务执行失败'
    case 'rejected':
      return '任务被对方拒绝'
    case 'canceled':
      return '任务已被取消'
    case 'auth-required':
      return '对方要求先完成身份认证'
    case 'input-required':
      return '对方要求补充输入'
    default:
      return `任务未完成（状态：${state || 'unknown'}）`
  }
}

// ============================================
// 客户端
// ============================================

export interface A2aClientAuth {
  /** Bearer token */
  token?: string
  /** 额外请求头 */
  headers?: Record<string, string>
}

export interface A2aSendOptions {
  contextId?: string
  taskId?: string
  /** 覆盖默认超时 */
  timeoutMs?: number
  /** 外部取消信号（用户点「停止」时用） */
  signal?: AbortSignal
}

export interface A2aSendResult {
  /** 提取出的文本（可能为空字符串，调用方需自行兜底） */
  text: string
  /** 异步任务（同步实现为 null） */
  task: A2aTask | null
  /** 同步消息（异步实现为 null） */
  message: A2aMessage | null
}

export interface A2aCardResult {
  card: A2aAgentCard
  latencyMs: number
  /** 卡片实际命中地址（可能是 /.well-known/agent-card.json） */
  cardUrl: string
}

export class A2aClient {
  private readonly baseUrl: string
  private readonly auth: A2aClientAuth
  /** Card 里声明的 JSON-RPC 端点（发现后覆盖 baseUrl，允许卡片指向别处） */
  private rpcUrl: string

  constructor(baseUrl: string, auth: A2aClientAuth = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.rpcUrl = this.baseUrl
    this.auth = auth
  }

  /** 当前生效的 JSON-RPC 端点 */
  getEndpoint(): string {
    return this.rpcUrl
  }

  // --------------------------------------------
  // 发现
  // --------------------------------------------

  /**
   * 拉取 Agent Card。
   *
   * 依次尝试两个规范路径，全部 404 时把 **base 本身** 当作卡片地址兜底 ——
   * 现实中不少实现（含简易 mock server）直接把卡片挂在根路径。
   */
  async fetchAgentCard(timeoutMs = A2A_CARD_TIMEOUT_MS): Promise<A2aCardResult> {
    const startedAt = Date.now()
    const candidates = [...CARD_PATHS.map((p) => `${this.baseUrl}${p}`), this.baseUrl]

    let lastError: A2aError | null = null
    for (const candidate of candidates) {
      try {
        const res = await this.rawFetch(candidate, { method: 'GET' }, timeoutMs)
        if (res.status === 404) {
          lastError = new A2aError(describeHttpStatus(404, candidate), 'CARD_NOT_FOUND', 404)
          continue
        }
        if (!res.ok) {
          throw new A2aError(describeHttpStatus(res.status, candidate), 'HTTP_ERROR', res.status)
        }

        const text = await res.text()
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          lastError = new A2aError(
            `A2A 智能体返回的不是合法 JSON（${candidate}）：可能该地址是网页而非 A2A 服务`,
            'CARD_NOT_JSON',
          )
          continue
        }

        const card = parsed as A2aAgentCard
        if (!card || typeof card !== 'object' || typeof card.name !== 'string') {
          lastError = new A2aError(
            `A2A Agent Card 缺少 name 字段（${candidate}）：该地址可能不是 A2A 智能体`,
            'CARD_INVALID',
          )
          continue
        }

        // 卡片声明的 url 优先（同一服务可能把 JSON-RPC 挂在不同路径）
        const declared = typeof card.url === 'string' ? card.url.trim() : ''
        if (declared) this.rpcUrl = declared.replace(/\/+$/, '')

        return { card, latencyMs: Date.now() - startedAt, cardUrl: candidate }
      } catch (err) {
        if (err instanceof A2aError && err.code !== 'HTTP_ERROR') throw err
        lastError = err instanceof A2aError ? err : new A2aError(describeNetworkError(err, candidate, timeoutMs), 'NETWORK')
      }
    }

    throw lastError ?? new A2aError(`未能获取 Agent Card（${this.baseUrl}）`, 'CARD_UNKNOWN')
  }

  // --------------------------------------------
  // 调用
  // --------------------------------------------

  /**
   * 发送一条消息并等待结果。
   *
   * 同步实现直接返回 Message；异步实现返回 Task，此时进入轮询直到终态。
   */
  async sendMessage(query: string, options: A2aSendOptions = {}): Promise<A2aSendResult> {
    const timeoutMs = options.timeoutMs ?? A2A_CALL_TIMEOUT_MS
    const message: A2aMessage = {
      kind: 'message',
      messageId: nextRpcId(),
      role: 'user',
      parts: [{ kind: 'text', text: query }],
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.contextId ? { contextId: options.contextId } : {}),
    }

    const result = await this.callWithLegacyFallback<A2aResult>(
      A2A_METHODS.SEND,
      { message },
      timeoutMs,
      options.signal,
    )

    if (!result || typeof result !== 'object') {
      throw new A2aError('A2A 智能体返回了空结果', 'EMPTY_RESULT')
    }

    if ((result as A2aMessage).kind === 'message') {
      return { text: extractTextFromResult(result), task: null, message: result as A2aMessage }
    }

    let task = result as A2aTask
    if (!isTerminalState(task.status?.state)) {
      task = await this.waitForTask(task, timeoutMs, options.signal)
    }

    const text = extractTextFromResult(task)
    if (task.status?.state && !isTerminalState(task.status.state)) {
      throw new A2aError(
        `${describeTaskState(task.status.state)}（taskId=${task.id}）：可稍后用 tasks/get 继续查询`,
        'TASK_PENDING',
      )
    }
    if (!text && task.status?.state !== 'completed') {
      throw new A2aError(
        `${describeTaskState(task.status?.state)}：对方未返回任何文本内容（taskId=${task.id}）`,
        'TASK_NO_TEXT',
      )
    }

    return { text, task, message: null }
  }

  /** 查询任务 */
  async getTask(taskId: string, timeoutMs = A2A_CARD_TIMEOUT_MS): Promise<A2aTask> {
    return this.call<A2aTask>(A2A_METHODS.GET, { id: taskId }, timeoutMs)
  }

  /** 取消任务 */
  async cancelTask(taskId: string, timeoutMs = A2A_CARD_TIMEOUT_MS): Promise<A2aTask> {
    return this.call<A2aTask>(A2A_METHODS.CANCEL, { id: taskId }, timeoutMs)
  }

  // --------------------------------------------
  // 内部
  // --------------------------------------------

  /** 轮询直到终态或超时 */
  private async waitForTask(task: A2aTask, timeoutMs: number, signal?: AbortSignal): Promise<A2aTask> {
    const deadline = Date.now() + timeoutMs
    let current = task

    while (!isTerminalState(current.status?.state)) {
      if (Date.now() >= deadline) return current
      if (signal?.aborted) return current

      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())))

      try {
        current = await this.getTask(current.id, Math.min(A2A_CARD_TIMEOUT_MS, Math.max(1000, deadline - Date.now())))
      } catch (err) {
        // 轮询期间的瞬时失败不该让整次调用报废：记录后继续，直到超时
        logger.system.warn('[A2A] tasks/get failed during polling:', err)
        if (Date.now() >= deadline) return current
      }
    }

    return current
  }

  /**
   * 调用 `message/send`，遇到「方法不存在」时回退到 A2A 早期方法名 `tasks/send`。
   *
   * 只对 -32601 / HTTP 404 / HTTP 405 三种「端点不认这个方法」的信号回退，
   * 其余错误原样抛出 —— 否则会把真实的业务错误当成兼容问题掩盖掉。
   */
  private async callWithLegacyFallback<T>(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await this.call<T>(method, params, timeoutMs, signal)
    } catch (err) {
      const retryable =
        err instanceof A2aError &&
        (err.code === 'METHOD_NOT_FOUND' || err.httpStatus === 404 || err.httpStatus === 405)
      if (!retryable) throw err

      logger.system.info(`[A2A] ${method} unavailable, retrying with ${A2A_METHODS.TASKS_SEND}`)
      return this.call<T>(A2A_METHODS.TASKS_SEND, params, timeoutMs, signal)
    }
  }

  /** 单次 JSON-RPC 调用 */
  private async call<T>(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: nextRpcId(), method, params })

    let res: Response
    try {
      res = await this.rawFetch(
        this.rpcUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
        timeoutMs,
        signal,
      )
    } catch (err) {
      if (err instanceof A2aError) throw err
      throw new A2aError(describeNetworkError(err, this.rpcUrl, timeoutMs), 'NETWORK')
    }

    const text = await res.text()

    if (!res.ok) {
      throw new A2aError(describeHttpStatus(res.status, this.rpcUrl), 'HTTP_ERROR', res.status)
    }

    let parsed: A2aJsonRpcResponse<T>
    try {
      parsed = JSON.parse(text) as A2aJsonRpcResponse<T>
    } catch {
      throw new A2aError(
        `A2A 智能体返回的不是合法 JSON-RPC 响应（${this.rpcUrl}）：可能该地址不是 A2A 端点`,
        'BAD_JSON',
      )
    }

    if (parsed.error) {
      const code = parsed.error.code
      const isMethodMissing = code === -32601 || /method not found|not found/i.test(parsed.error.message || '')
      throw new A2aError(
        `A2A 调用被拒绝（错误码 ${code}）：${parsed.error.message || '对端未提供具体原因'}`,
        isMethodMissing ? 'METHOD_NOT_FOUND' : 'RPC_ERROR',
      )
    }

    if (parsed.result === undefined || parsed.result === null) {
      throw new A2aError('A2A 智能体返回了空结果（JSON-RPC 响应缺少 result）', 'EMPTY_RESULT')
    }

    return parsed.result
  }

  /** 带鉴权与超时的 fetch 封装 */
  private async rawFetch(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const onExternalAbort = (): void => controller.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    try {
      return await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(this.auth.headers || {}),
          ...(this.auth.token ? { Authorization: `Bearer ${this.auth.token}` } : {}),
          ...((init.headers as Record<string, string>) || {}),
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
