/**
 * A2A 工具提供者（渲染层）
 *
 * 把「已启用的外部 A2A 智能体」以**单个工具** `a2a_tool_call(agent_url, query)`
 * 暴露给模型 —— 与源项目 `py/a2a_tool.py` 的语义严格对齐：
 *   - 工具描述里带上当前可用的 agent 清单（url / 用途 / 技能），模型据此选目标
 *   - **没有任何启用项时不注册该工具**（源项目返回 None 的行为）
 *
 * 为什么不做成「一个 agent 一个工具」：
 *   A2A 是**智能体级**协议而非工具级协议。把远端 agent 摊平成一堆工具，
 *   会让模型把它们当成本地函数去猜参数，而 A2A 的调用面就是 (agent, 问题)。
 *
 * 数据流：主进程 `A2aManager.getToolPayload()` → 本提供者缓存 →
 *   `getToolDefinitions()`（每轮对话实时求值）。配置变化时主进程推 `a2a:changed`，
 *   本提供者随即刷新缓存，无需重载应用。
 *
 * @module intelligence/toolkit/providers/A2aToolRegistry
 */

import { logger } from '@toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { api } from '@renderer/adapters/electronBridge'
import {
  A2A_TOOL_DESCRIPTION_LIMIT,
  A2A_TOOL_NAME,
} from '@shared/protocols/a2aProtocol'
import type { A2aToolPayload } from '@shared/protocols/a2aProtocol'
import type { ToolProvider } from '@intelligence/providerTypes'
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolApprovalType,
} from '@intelligence/providerTypes'
import type { ToolLoadingContext } from '@configuration/toolCategoryDefs'

/** 未初始化时的空载荷（等价于「工具不可见」） */
const EMPTY_PAYLOAD: A2aToolPayload = { enabled: false, agents: [] }

export class A2aToolProvider implements ToolProvider {
  readonly id = 'a2a'
  readonly name = 'A2A Agents'

  /** 缓存的工具暴露载荷（同步读取，工具定义生成不能是异步的） */
  private payload: A2aToolPayload = EMPTY_PAYLOAD

  /** 是否已挂上主进程推送（避免重复订阅） */
  private wired = false

  private context: ToolLoadingContext = { mode: 'agent' }

  // ============================================
  // 初始化
  // ============================================

  /**
   * 挂载数据源：拉一次当前载荷，并订阅后续变化。
   *
   * 非阻塞：失败只是「工具暂不可见」，不该拖住应用启动。
   */
  init(): void {
    if (this.wired) return
    this.wired = true

    void this.refresh()

    try {
      api.a2a.onChanged((payload) => {
        this.payload = payload?.tool ?? EMPTY_PAYLOAD
        logger.agent.info(
          `[A2aToolProvider] payload updated: enabled=${this.payload.enabled} agents=${this.payload.agents.length}`,
        )
      })
    } catch (err) {
      logger.agent.warn('[A2aToolProvider] subscribe a2a:changed failed:', err)
    }
  }

  /** 手动刷新载荷（设置页保存后 / 排障用） */
  async refresh(): Promise<void> {
    try {
      const res = await api.a2a.getToolPayload()
      if (res.success && res.data) {
        this.payload = res.data.tool ?? EMPTY_PAYLOAD
      } else if (!res.success) {
        logger.agent.warn('[A2aToolProvider] getToolPayload failed:', res.error)
        this.payload = EMPTY_PAYLOAD
      }
    } catch (err) {
      logger.agent.warn('[A2aToolProvider] refresh failed:', err)
      this.payload = EMPTY_PAYLOAD
    }
  }

  /** 设置工具加载上下文（与其它提供者保持一致的接口） */
  setContext(context: ToolLoadingContext): void {
    this.context = context
  }

  /** 当前生效的载荷（供 UI / 测试读取） */
  getPayload(): A2aToolPayload {
    return this.payload
  }

  // ============================================
  // ToolProvider 接口
  // ============================================

  hasTool(toolName: string): boolean {
    return toolName === A2A_TOOL_NAME && this.payload.enabled
  }

  getToolDefinitions(): ToolDefinition[] {
    if (!this.payload.enabled) return []
    return [this.buildDefinition()]
  }

  getApprovalType(toolName: string): ToolApprovalType {
    if (toolName !== A2A_TOOL_NAME) return 'dangerous'

    // Plan 模式与 chat 模式的工具本身是免审批的（见 toolCategoryDefs 的加载规则）；
    // agent 模式下调用会把本机数据发给外部服务，属于有副作用的行为，需要确认。
    return this.context.mode === 'agent' ? 'dangerous' : 'none'
  }

  validateArgs(_toolName: string, args: unknown): { valid: boolean; error?: string } {
    if (args === null || typeof args !== 'object') {
      return { valid: false, error: 'Arguments must be an object' }
    }
    const record = args as Record<string, unknown>

    if (typeof record.agent_url !== 'string' || !record.agent_url.trim()) {
      return { valid: false, error: 'agent_url is required' }
    }
    if (typeof record.query !== 'string' || !record.query.trim()) {
      return { valid: false, error: 'query is required' }
    }

    // 只允许调用「已配置且已启用」的 agent：
    // 模型完全可能凭上下文编一个 URL 出来，这里挡一道，避免把请求发到任意地址
    const known = this.payload.agents.some((a) => a.url === record.agent_url || a.url === normalizeInputUrl(record.agent_url as string))
    if (!known) {
      return {
        valid: false,
        error: `agent_url 不在已配置并启用的 A2A 智能体列表中：${record.agent_url}`,
      }
    }

    return { valid: true }
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (toolName !== A2A_TOOL_NAME) {
      return { success: false, result: '', error: `Unknown A2A tool: ${toolName}` }
    }

    const agentUrl = String(args.agent_url ?? '').trim()
    const query = String(args.query ?? '').trim()

    logger.agent.info(`[A2aToolProvider] calling ${agentUrl}`)

    try {
      const res = await api.a2a.call(agentUrl, query)

      if (!res.success || !res.data) {
        return {
          success: false,
          result: '',
          error: res.error || '调用 A2A 智能体失败',
        }
      }

      const { ok, text, error, durationMs } = res.data
      if (!ok) {
        // 失败原因已由主进程翻译成中文，直接回给模型 ——
        // 给它一个能理解的原因，它才会换策略或如实告知用户，而不是反复重试同一调用
        return {
          success: false,
          result: '',
          error: `${error || '调用失败'}（耗时 ${durationMs}ms）`,
        }
      }

      return {
        success: true,
        result: text || '(对方未返回文本内容)',
      }
    } catch (err) {
      logger.agent.error('[A2aToolProvider] execution failed:', err)
      return {
        success: false,
        result: '',
        error: toAppError(err).message,
      }
    }
  }

  // ============================================
  // 私有
  // ============================================

  /**
   * 生成工具定义。
   *
   * 描述里列出的 agent 数量有上限：工具描述会占用每一轮请求的输入 token，
   * 无上限地拼接等于给每次对话加税；超出部分只给数量提示。
   */
  private buildDefinition(): ToolDefinition {
    const all = this.payload.agents
    const shown = all.slice(0, A2A_TOOL_DESCRIPTION_LIMIT)
    const truncated = all.length - shown.length

    const list = JSON.stringify(
      shown.map((agent) => ({
        agent_url: agent.url,
        agent_description: agent.description,
        agent_skills: agent.skills,
      })),
      null,
      4,
    )

    const tail = truncated > 0 ? `\n（另有 ${truncated} 个已启用智能体未在下方列出：可在「设置 → A2A 协议」中查看）` : ''

    return {
      name: A2A_TOOL_NAME,
      description: `参考A2A智能体中的配置信息调用指定A2A服务，返回结果。当前可用的A2A服务器有：${list}${tail}`,
      parameters: {
        type: 'object',
        properties: {
          agent_url: {
            type: 'string',
            description: '需要调用的A2A智能体URL',
            enum: shown.map((a) => a.url),
          },
          query: {
            type: 'string',
            description: '需要向A2A智能体发送的问题',
          },
        },
        required: ['agent_url', 'query'],
      },
    }
  }
}

/**
 * 轻量 URL 归一化（与主进程 A2aStore.normalizeAgentUrl 保持一致的最小规则）。
 *
 * 渲染层不做完整校验 —— 真正的把关在主进程；这里只是为了让
 * 「模型回填的 URL 少个斜杠」不至于被判成非法调用。
 */
function normalizeInputUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

/** 单例 */
export const a2aToolProvider = new A2aToolProvider()
