/**
 * 路由处理器的公共依赖与工具契约（主进程）
 *
 * routes/* 里的每个 handler 都是**纯函数式**的：接收 (req, res, ctx)，不自己持有
 * server 实例、不自己读配置。这样可以：
 *   - 单测时直接构造 ctx + 假 req/res，不需要起真实端口
 *   - 端口/配置变化时不需要重建 handler
 *
 * @module openapi/routes/routeTypes
 */

import type * as http from 'http'
import type { OpenApiConfig } from '@shared/protocols/openApiProtocol'

/** 路由上下文（由 OpenApiServer 注入） */
export interface RouteContext {
  /** 当前生效配置（每次请求实时读取，配置改动立即生效） */
  config: OpenApiConfig
  /**
   * 读取并解析请求体。
   *
   * @returns 解析后的对象；`null` 表示读取失败（超长/超时/非法 JSON），
   *          此时 handler 应直接返回 400 而不继续处理。
   */
  readJsonBody: (req: http.IncomingMessage) => Promise<Record<string, unknown> | null>
  /**
   * 读取原始请求体文本。
   *
   * MCP 端点需要自己解析 JSON-RPC（可能是数组、也可能是无 id 的通知），
   * 用 `readJsonBody` 的「必须是对象」约束会把合法的批量请求挡掉。
   *
   * @returns 原始文本；`null` 表示读取失败（超长/超时）
   */
  readJsonBodyRaw: (req: http.IncomingMessage) => Promise<string | null>
  /** 发送 JSON 响应 */
  respondJson: (res: http.ServerResponse, status: number, body: unknown) => void
  /** 记录一次错误（写日志 + 计数） */
  reportError: (err: unknown, note: string) => void
}

/** OpenAI 风格错误响应体 */
export interface OpenAiErrorBody {
  error: {
    message: string
    type: string
    code: string
  }
}

/** 构造 OpenAI 风格错误体 */
export function openAiError(message: string, code = 'internal_error', type = 'server_error'): OpenAiErrorBody {
  return { error: { message, type, code } }
}
