/**
 * 对外 API 网关的鉴权与 CORS（主进程）
 *
 * 鉴权模型：
 *   - **绝大多数端点**要求 `Authorization: Bearer <apiKey>`。
 *   - **Agent Card**（`/.well-known/agent.json`）保持开放：A2A 规范要求它可被
 *     标准客户端发现，卡住它等于让对方连「这个 agent 会什么」都看不到。
 *   - `/openapi/status` 不要求 apiKey，但**只允许环回来源**：它是本机排障入口，
 *     一旦被局域网可读就成了信息泄露（暴露端口、密钥是否配置、最近请求路径）。
 *
 * CORS 模型：
 *   默认只放行本机来源（localhost / 127.0.0.1 / ::1），外部来源需逐个加入白名单。
 *   回显具体 Origin 而不是 `*` —— 带 `Authorization` 的请求在规范下不允许与
 *   通配符共存，用 `*` 会让浏览器直接拒绝带凭据的跨域请求。
 *
 * @module openapi/OpenApiAuth
 */

import type * as http from 'http'
import { isLoopbackHost, normalizeOrigin } from './OpenApiStore'
import type { OpenApiConfig } from '@shared/protocols/openApiProtocol'

/** 无需 apiKey 的路径（精确匹配） */
const PUBLIC_PATHS = new Set(['/.well-known/agent.json', '/.well-known/agent-card.json'])

/** 仅允许环回来源访问的路径（精确匹配） */
const LOCAL_ONLY_PATHS = new Set(['/openapi/status'])

/** 预检缓存时长（秒） */
const PREFLIGHT_MAX_AGE = 86400

/** 路径是否免鉴权 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname)
}

/** 路径是否只允许本机访问 */
export function isLocalOnlyPath(pathname: string): boolean {
  return LOCAL_ONLY_PATHS.has(pathname)
}

/**
 * 判断请求是否来自本机。
 *
 * 注意 `::ffff:127.0.0.1`：Node 在双栈 socket 上会把 IPv4 映射成 IPv6 形式，
 * 只比对 `127.0.0.1` 会让「本机访问」被误判成外部。
 */
export function isLoopbackRequest(req: http.IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress || ''
  if (!addr) return false
  const normalized = addr.startsWith('::ffff:') ? addr.slice(7) : addr
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

/** 来源是否被允许（白名单 + 本机来源） */
export function isOriginAllowed(origin: string | undefined, config: OpenApiConfig): boolean {
  if (!origin) return false // 无 Origin = 非浏览器请求（curl / 桌面客户端），不受 CORS 约束
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false

  try {
    const { hostname } = new URL(normalized)
    if (isLoopbackHost(hostname)) return true
  } catch {
    return false
  }

  return config.corsOrigins.includes(normalized)
}

/** 写入 CORS 响应头（未命中白名单时不写 Allow-Origin，由浏览器自行拦截） */
export function applyCors(req: http.IncomingMessage, res: http.ServerResponse, config: OpenApiConfig): void {
  const origin = req.headers.origin
  if (origin && isOriginAllowed(origin, config)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  // Vary 必须写：同一 URL 对不同 Origin 返回不同 CORS 头，缺失会让缓存串味
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-Requested-With')
  res.setHeader('Access-Control-Max-Age', String(PREFLIGHT_MAX_AGE))
}

/** 鉴权失败响应体（OpenAI 风格 error 对象，第三方客户端能直接展示 message） */
export interface AuthFailure {
  status: number
  body: { error: { message: string; type: string; code: string } }
}

/**
 * 校验 Bearer apiKey。
 *
 * @returns `null` 表示通过
 */
export function checkApiKey(req: http.IncomingMessage, config: OpenApiConfig): AuthFailure | null {
  if (!config.apiKey) return null // 未配置密钥 = 不校验（此时仅可能监听环回，见 Store 联动规则）

  const header = req.headers.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (match && match[1].trim() === config.apiKey) return null

  return {
    status: 401,
    body: {
      error: {
        message: '缺少或无效的 Authorization: Bearer <apiKey>，请在「设置 → 对外 API」中查看准入密钥',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    },
  }
}

/** 环回限制失败响应体 */
export function localOnlyFailure(): AuthFailure {
  return {
    status: 403,
    body: {
      error: {
        message: '该端点仅允许本机（127.0.0.1）访问',
        type: 'invalid_request_error',
        code: 'forbidden',
      },
    },
  }
}
