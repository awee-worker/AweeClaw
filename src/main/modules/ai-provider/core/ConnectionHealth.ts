/**
 * 连接健康监测 — 区分「模型正在思考」与「连接已经断开」
 *
 * 背景：
 * AI 思考 / 长任务耗时不可预估，流式请求已取消一切「空闲超时」，
 * 中止只由用户主动点击「停止」触发。但这带来一个缺口：若底层连接真的
 * 死掉（拔网线、代理挂掉、NAT 老化、服务端静默关闭），请求会永久挂起，
 * 界面一直停在「思考冒泡中💭」，既不报错也不恢复。
 *
 * 本模块提供三类「非时间阈值」的断开信号：
 *
 * 1. 传输层错误（`isConnectionDropError`）
 *    socket 层已明确报错：ECONNRESET / EPIPE / ETIMEDOUT / UND_ERR_SOCKET 等。
 *    这是最强证据，命中即判定断开。
 *
 * 2. 提前 EOF（由 StreamProcessor 判定）
 *    流在未收到 `finish` 事件的情况下结束，说明响应被截断。
 *
 * 3. 静默期连通性探测（`probeTcpReachable` + `resolveProbeTarget`）
 *    长时间完全静默时，对目标主机做一次 TCP 连接探测：
 *    - 探测通过 → 只是模型在思考，继续无限等待（不做任何中断）
 *    - 连续探测失败 → 判定连接已断开并中止请求
 *
 * ⚠️ 第 3 项的边界：探测回答的是「目标主机是否可达」，并不等价于
 * 「当前这条 HTTP 连接是否存活」。若只是单条 TCP 连接被中间设备静默
 * 丢弃（而主机整体可达），探测会通过、请求仍可能挂起。它主要覆盖
 * 「网络整体断开」这一类场景。
 */

import { connect as netConnect } from 'node:net'
import type { LLMConfig } from '@protocols'
import { BUILTIN_PROVIDERS, isBuiltinProvider } from '@shared/configuration/aiProviders'

/* ------------------------------------------------------------------ */
/* 探测参数                                                            */
/* ------------------------------------------------------------------ */

/**
 * 静默多久发起一次连通性探测（毫秒）。
 *
 * 注意：这里的时间只用于**决定何时探测**，不用于决定是否中断。
 * 是否中断完全取决于探测结果，因此不会误杀正常思考。
 */
export const CONNECTION_PROBE_INTERVAL_MS = 45_000

/** 单次 TCP 探测自身的收敛超时（毫秒）—— 不是请求超时 */
export const CONNECTION_PROBE_TIMEOUT_MS = 5_000

/** 连续探测失败多少次才判定连接断开（避免偶发抖动误判） */
export const CONNECTION_PROBE_FAILURE_THRESHOLD = 2

/* ------------------------------------------------------------------ */
/* 探针目标解析                                                        */
/* ------------------------------------------------------------------ */

export interface ConnectionProbeTarget {
  host: string
  port: number
  /** 用于日志展示的目标描述 */
  label: string
}

/**
 * 解析本次请求的探测目标（host:port）。
 *
 * 云端模式探测后端网关，本地模式探测 Provider 的 baseUrl；
 * 无法解析时返回 null，此时退化为「纯无限等待」，不做任何时间判定。
 */
export function resolveProbeTarget(config: LLMConfig): ConnectionProbeTarget | null {
  let raw: string | undefined

  if (config.cloudMode) {
    raw = config.serverUrl
  } else {
    raw = config.baseUrl
    if (!raw && isBuiltinProvider(config.provider)) {
      raw = BUILTIN_PROVIDERS[config.provider].baseUrl
    }
  }

  if (!raw) return null

  try {
    const url = new URL(raw)
    const port = url.port
      ? Number(url.port)
      : url.protocol === 'https:'
        ? 443
        : url.protocol === 'http:'
          ? 80
          : Number.NaN

    if (!url.hostname || !Number.isFinite(port)) return null

    return { host: url.hostname, port, label: `${url.hostname}:${port}` }
  } catch {
    return null
  }
}

/**
 * 对目标做一次 TCP 连接探测（不发送任何 HTTP 数据）。
 *
 * 只回答「能否建立 TCP 连接」，成功即 resolve(true)，失败/超时 resolve(false)，
 * 永不 reject —— 探测本身不应影响主流程的错误语义。
 */
export function probeTcpReachable(
  target: ConnectionProbeTarget,
  timeoutMs: number = CONNECTION_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let socket: ReturnType<typeof netConnect> | null = null

    const finish = (reachable: boolean) => {
      if (settled) return
      settled = true
      try {
        socket?.destroy()
      } catch {
        /* 探测清理失败无需处理 */
      }
      resolve(reachable)
    }

    try {
      socket = netConnect({ host: target.host, port: target.port })
      socket.setTimeout(timeoutMs, () => finish(false))
      socket.once('connect', () => finish(true))
      socket.once('error', () => finish(false))
    } catch {
      finish(false)
    }
  })
}

/* ------------------------------------------------------------------ */
/* 传输层错误识别                                                      */
/* ------------------------------------------------------------------ */

/**
 * 明确的「连接已断开」错误码。
 *
 * 刻意不含 `UND_ERR_ABORTED`：用户主动取消与 SDK 内部 abort 都会落到该码上，
 * 无法与断开区分，交由上层按 abortSignal 判定。
 */
const DROP_ERROR_CODES = new Set<string>([
  // Node.js socket 层
  'ECONNRESET',
  'ECONNABORTED',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ENETRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EADDRNOTAVAIL',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_STREAM_DESTROYED',
  // undici（Node 内置 fetch 的底层实现）
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CLOSED',
  'UND_ERR_DESTROYED',
])

/** 错误消息中的传输层断开特征（小写匹配） */
const DROP_MESSAGE_PATTERNS: readonly string[] = [
  'socket hang up',
  'other side closed',
  'premature close',
  'connection reset',
  'connection closed',
  'connection terminated',
  'connection error',
  'network error',
  'network connection was lost',
  'the network connection was lost',
  'fetch failed',
  'broken pipe',
  'econnreset',
  'econnaborted',
  'etimedout',
  'und_err_',
]

/**
 * 判断错误是否为「连接已断开」（传输层).
 *
 * 覆盖三种承载位置：错误自身的 code / message、嵌套的 `cause`（undici 会把
 * 底层 socket 错误挂在 cause 上）、以及 `AggregateError.errors`。
 */
export function isConnectionDropError(error: unknown): boolean {
  if (!error) return false

  const err = error as NodeJS.ErrnoException & {
    cause?: unknown
    errors?: unknown[]
    name?: string
  }

  // 用户主动取消不算断开
  if (err.name === 'AbortError') return false

  if (typeof err.code === 'string' && DROP_ERROR_CODES.has(err.code.toUpperCase())) {
    return true
  }

  if (typeof err.message === 'string') {
    const message = err.message.toLowerCase()
    if (DROP_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))) {
      return true
    }
  }

  // 递归检查 cause（注意防止自引用导致死循环）
  if (err.cause && err.cause !== error && isConnectionDropError(err.cause)) {
    return true
  }

  if (Array.isArray(err.errors) && err.errors.some((nested) => isConnectionDropError(nested))) {
    return true
  }

  return false
}

/** 把连接断开错误翻译成面向用户的中文描述 */
export function describeConnectionDropError(error: unknown): string {
  const err = error as NodeJS.ErrnoException | undefined
  const code = typeof err?.code === 'string' ? err.code.toUpperCase() : ''

  switch (code) {
    case 'ECONNRESET':
      return '连接被对端重置（ECONNRESET）'
    case 'ECONNABORTED':
      return '连接已中断（ECONNABORTED）'
    case 'ECONNREFUSED':
      return '连接被拒绝（ECONNREFUSED），请检查服务地址或代理设置'
    case 'EPIPE':
      return '连接已断开（EPIPE）'
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return '网络传输超时（ETIMEDOUT）'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return '域名解析失败（ENOTFOUND），请检查网络或代理设置'
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
    case 'ENETDOWN':
      return '网络不可达，请检查网络连接'
    case 'UND_ERR_SOCKET':
    case 'UND_ERR_CLOSED':
    case 'UND_ERR_DESTROYED':
      return '与模型服务的 socket 连接已断开'
    case 'UND_ERR_CONNECT_TIMEOUT':
      return '无法与模型服务建立连接'
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return '模型服务响应传输中断'
    default:
      return '与模型服务的连接已断开'
  }
}
