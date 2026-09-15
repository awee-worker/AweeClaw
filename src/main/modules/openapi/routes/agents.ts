/**
 * `GET /v1/agents` — 已配置的智能体 / 角色列表（AweeClaw 自有扩展）
 *
 * 为什么需要这个端点：OpenAI 协议里没有「智能体」概念，第三方客户端只能选模型。
 * 而 AweeClaw 的核心资产是用户配好的自定义智能体（人格 + 工具集）。
 * 用 `model: "agent:<id>"` 就能把它们接进任意 OpenAI 客户端 —— 这是零改造接管的关键。
 *
 * 返回的 `id` 已带 `agent:` 前缀，客户端直接把它填进 model 字段即可，
 * 不需要客户端理解前缀规则。
 *
 * @module openapi/routes/agents
 */

import type * as http from 'http'
import { listAgents } from '../OpenApiModelSource'
import type { OpenAiAgentList } from '@shared/protocols/openApiProtocol'
import type { RouteContext } from './routeTypes'

export function handleAgents(_req: http.IncomingMessage, res: http.ServerResponse, ctx: RouteContext): void {
  try {
    const body: OpenAiAgentList = { object: 'list', data: listAgents() }
    ctx.respondJson(res, 200, body)
  } catch (err) {
    ctx.reportError(err, 'GET /v1/agents')
    ctx.respondJson(res, 500, {
      error: { message: '读取智能体列表失败', type: 'server_error', code: 'internal_error' },
    })
  }
}
