/**
 * `GET /v1/models` — 可用模型列表（OpenAI 格式）
 *
 * 第三方客户端（Cherry Studio / ChatBox 等）接上 baseUrl 后第一件事就是拉这个
 * 端点填充模型下拉框，因此它必须**在零配置下也能返回合法结构**：
 * 返回空列表而不是报错 —— 报错会让客户端直接判定「服务不可用」，
 * 而空列表能让用户进到设置里看到「请先配置模型」的引导。
 *
 * @module openapi/routes/models
 */

import type * as http from 'http'
import { listAvailableModels } from '../OpenApiModelSource'
import type { OpenAiModelList } from '@shared/protocols/openApiProtocol'
import type { RouteContext } from './routeTypes'

/** 模型对象的 created 字段：无真实创建时间时用固定基准（客户端只做展示） */
const FIXED_CREATED = 1700000000

export function handleModels(_req: http.IncomingMessage, res: http.ServerResponse, ctx: RouteContext): void {
  try {
    const models = listAvailableModels()
    const body: OpenAiModelList = {
      object: 'list',
      data: models.map((m) => ({
        id: m.id,
        object: 'model',
        created: FIXED_CREATED,
        owned_by: m.provider || 'aweeclaw',
      })),
    }
    ctx.respondJson(res, 200, body)
  } catch (err) {
    ctx.reportError(err, 'GET /v1/models')
    ctx.respondJson(res, 500, {
      error: { message: '读取模型列表失败', type: 'server_error', code: 'internal_error' },
    })
  }
}
