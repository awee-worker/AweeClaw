/**
 * 网络调度器 — 为 AI 请求注入统一的自定义 undici dispatcher
 *
 * 背景
 * ----
 * Node 内置 fetch 由 undici 驱动，其默认 dispatcher 带两个「按时间掐断」的阈值，
 * 与「AI 思考 / 长任务耗时不可预估」这一前提直接冲突：
 *
 * - `bodyTimeout`（默认 300s）：相邻响应体分片之间的最大间隔。模型长时间思考时
 *   SSE 流会完全静默，一旦静默超过该值，undici 会以 `UND_ERR_BODY_TIMEOUT`
 *   主动中止请求 —— 这是「AI 还在思考就被自动中断」的来源之一。
 * - `headersTimeout`（默认 300s）：等待响应头的最大时间。
 *
 * 本项目的既定策略是「不做任何时间判定，中止只由用户主动点击停止触发」，
 * 连接真正死掉的场景交给 `ConnectionHealth`（传输层错误 / 提前 EOF /
 * 静默期连通性探测）判定。因此这里把 undici 的两个时间阈值显式关闭
 * （`0` = 不限制），改用**非时间**的存活信号：
 *
 * - TCP keepalive（`SO_KEEPALIVE`）：由内核周期性发送探测包。既能让 NAT /
 *   防火墙 / 负载均衡不把长时间静默的连接当成死链回收，也能在链路真断时
 *   让 socket 立刻报错 —— 比任何固定超时都更早、更准，且不会误杀正常思考。
 * - 连接池保活（`keepAliveTimeout`）：工具循环会连续发起多轮请求，拉长空闲
 *   连接的存活时间可避免反复的 TCP + TLS 握手。
 *
 * 代价与边界
 * ----------
 * 关闭时间阈值后，「服务端可达但这条连接已僵死」这一类场景不再由 undici
 * 兜底，而是依赖 TCP keepalive 最终让 socket 报错，再由 `ConnectionHealth`
 * 判定为断开。应用层仍保留 StreamProcessor 的空闲守卫（非思考型模型）
 * 作为最后一道兜底。
 *
 * 使用方式
 * --------
 * 所有 Provider 工厂统一注入 `fetch: aiFetch`（见 `modelRegistry.ts`），
 * 云端模式的 401 自动刷新也复用同一条 fetch，保证全局只走一个调度器。
 */

import { logger } from '@shared/toolkit/LogEngine'

/* ------------------------------------------------------------------ */
/* 调度器参数                                                          */
/* ------------------------------------------------------------------ */

/** 请求体静默上限：0 = 不限制。长思考期间 SSE 会长时间静默，禁止按时间掐断 */
export const AI_BODY_TIMEOUT_MS = 0

/** 响应头等待上限：0 = 不限制，与 bodyTimeout 保持同一套「不按时间中断」策略 */
export const AI_HEADERS_TIMEOUT_MS = 0

/** 空闲连接在池中的存活时长（undici 默认 4s，对工具循环的多轮请求过短） */
export const AI_KEEP_ALIVE_TIMEOUT_MS = 60_000

/** 空闲连接存活时长的上限（服务端 keep-alive 提示不会超过它） */
export const AI_KEEP_ALIVE_MAX_TIMEOUT_MS = 600_000

/** 服务端 keep-alive 提示的容差，扣除网络往返带来的时间误差 */
export const AI_KEEP_ALIVE_TIMEOUT_THRESHOLD_MS = 1_000

/** TCP keepalive 首次探测延迟：静默 30s 后由内核开始发送探测包 */
export const AI_TCP_KEEP_ALIVE_INITIAL_DELAY_MS = 30_000

/** TCP 建连超时：只约束握手阶段，不约束响应时长 */
export const AI_CONNECT_TIMEOUT_MS = 30_000

/* ------------------------------------------------------------------ */
/* 模块状态                                                            */
/* ------------------------------------------------------------------ */

type UndiciModule = typeof import('undici')
type UndiciDispatcher = import('undici').Dispatcher

/** 懒加载缓存：undefined = 尚未加载；null = 加载失败 */
let undiciModule: UndiciModule | null | undefined

/** 全局唯一调度器，所有 AI 请求共享其连接池 */
let dispatcher: UndiciDispatcher | null = null

/** 加载失败只告警一次，避免每条请求刷屏 */
let loadFailureLogged = false

/**
 * 懒加载 undici。
 *
 * 刻意使用 `require` 而非顶层 `import`：
 * - undici 体积不小，没必要在不需要时占用启动开销；
 * - 一旦解析失败，顶层 import 会让整个主进程 bundle 启动即崩溃，而
 *   `require` 失败可以降级为 `globalThis.fetch`（行为与引入前一致），
 *   只记一条告警，不影响应用可用性。
 */
function loadUndici(): UndiciModule | null {
  if (undiciModule !== undefined) return undiciModule

  try {
    undiciModule = require('undici') as UndiciModule
  } catch (error) {
    undiciModule = null
    if (!loadFailureLogged) {
      loadFailureLogged = true
      logger.llm.warn('[NetworkDispatcher] undici 加载失败，回退到全局 fetch（无法自定义 dispatcher）', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return undiciModule
}

/**
 * 获取全局共享的自定义 dispatcher（首次调用时创建）。
 *
 * 返回 null 表示 undici 不可用，调用方应回退到全局 fetch。
 */
export function getAiDispatcher(): UndiciDispatcher | null {
  if (dispatcher) return dispatcher

  const undici = loadUndici()
  if (!undici) return null

  try {
    dispatcher = new undici.Agent({
      // 关闭「按时间掐断」—— 长思考期间 SSE 会长时间静默
      bodyTimeout: AI_BODY_TIMEOUT_MS,
      headersTimeout: AI_HEADERS_TIMEOUT_MS,

      // 连接池保活：工具循环连续多轮请求时避免反复握手
      keepAliveTimeout: AI_KEEP_ALIVE_TIMEOUT_MS,
      keepAliveMaxTimeout: AI_KEEP_ALIVE_MAX_TIMEOUT_MS,
      keepAliveTimeoutThreshold: AI_KEEP_ALIVE_TIMEOUT_THRESHOLD_MS,

      // TCP 层保活 + 建连超时（只作用于握手，不影响响应时长）
      connect: {
        keepAlive: true,
        keepAliveInitialDelay: AI_TCP_KEEP_ALIVE_INITIAL_DELAY_MS,
        timeout: AI_CONNECT_TIMEOUT_MS,
      },
    })

    logger.llm.info('[NetworkDispatcher] 已创建自定义 undici dispatcher', {
      bodyTimeout: AI_BODY_TIMEOUT_MS,
      headersTimeout: AI_HEADERS_TIMEOUT_MS,
      keepAliveTimeout: AI_KEEP_ALIVE_TIMEOUT_MS,
      keepAliveMaxTimeout: AI_KEEP_ALIVE_MAX_TIMEOUT_MS,
      tcpKeepAliveInitialDelay: AI_TCP_KEEP_ALIVE_INITIAL_DELAY_MS,
      connectTimeout: AI_CONNECT_TIMEOUT_MS,
    })
  } catch (error) {
    dispatcher = null
    logger.llm.warn('[NetworkDispatcher] dispatcher 创建失败，回退到全局 fetch', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return dispatcher
}

/* ------------------------------------------------------------------ */
/* 注入 dispatcher 的 fetch                                            */
/* ------------------------------------------------------------------ */

/** undici 在标准 RequestInit 之外扩展的 `dispatcher` 字段 */
type FetchInitWithDispatcher = RequestInit & { dispatcher?: unknown }

/**
 * 带自定义 dispatcher 的 fetch，供所有 AI Provider 工厂注入使用。
 *
 * 行为：
 * - undici 可用 → 在每个请求上注入共享 dispatcher（调用方已指定则尊重调用方）
 * - undici 不可用 → 直接透传 `globalThis.fetch`，不改变原有语义
 */
export const aiFetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const undici = loadUndici()
  const activeDispatcher = getAiDispatcher()

  if (!undici || !activeDispatcher) {
    return globalThis.fetch(input, init)
  }

  const merged: FetchInitWithDispatcher = { ...(init ?? {}) }
  if (merged.dispatcher == null) {
    merged.dispatcher = activeDispatcher
  }

  const result = await undici.fetch(
    input as unknown as Parameters<typeof undici.fetch>[0],
    merged as unknown as Parameters<typeof undici.fetch>[1],
  )

  return result as unknown as Response
}) as typeof globalThis.fetch

/* ------------------------------------------------------------------ */
/* 资源释放                                                            */
/* ------------------------------------------------------------------ */

/**
 * 关闭调度器并释放连接池。
 *
 * 应用退出时调用：连接池会持有 keep-alive socket，主动关闭可让退出更干净。
 * 幂等，重复调用安全。
 */
export async function disposeAiDispatcher(): Promise<void> {
  const current = dispatcher
  dispatcher = null

  if (!current) return

  try {
    await current.close()
    logger.system.info('[NetworkDispatcher] dispatcher 已关闭')
  } catch (error) {
    logger.system.warn('[NetworkDispatcher] dispatcher 关闭异常（可忽略）', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
