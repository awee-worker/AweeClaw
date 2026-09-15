/**
 * A2A 编排器（主进程）
 *
 * 职责：
 *   1. **出站**：Agent Card 探测与缓存、连通性测试、把外部 agent 当工具调用
 *   2. **入站**：按配置启停 A2aServer，并把入站请求接到本机 LLM
 *   3. **状态**：为设置页提供统一的服务器状态 / 调用记录
 *   4. **通知**：配置变化时推送给渲染层，让工具提供者即时刷新工具定义
 *
 * 与 external-agent 模块的关系（重要）：
 *   `modules/external-agent` 的 `ExternalAgentAdapter` 是**CLI 子进程**抽象
 *   （preflight/buildCommand/parseLine/finalize，面向 stdout 流）。A2A 是网络协议，
 *   抽象不匹配 —— 强行复用会引入一堆「假命令」。因此此处独立实现，只复用它的
 *   **设置页交互模式**（列表 / 凭证 / 连通性测试）。
 *
 * 与 MCP 模块的关系：MCP 是工具级协议（远端能力即函数），A2A 是智能体级协议
 * （远端 agent 即同事）。两者在「模型可见的工具列表」这一层汇合，但实现互不依赖。
 *
 * @module a2a/A2aManager
 */

import { logger } from '@shared/toolkit/LogEngine'
import { A2A_CALL_TIMEOUT_MS, A2aClient, A2aError, extractTextFromResult } from './A2aClient'
import { A2aServer, type A2aChatContext } from './A2aServer'
import {
  getConfig,
  normalizeAgentUrl,
  removeServer as removeServerEntry,
  resetConfig as resetStoreConfig,
  shouldFallbackToLoopback,
  updateConfig as updateStoreConfig,
  upsertServer as upsertServerEntry,
  validateConfig,
} from './A2aStore'
import { getConfigStore } from '../../bootstrap/stores'
import { getMainWindow } from '../../bootstrap/windowManager'
import { resolveRuntimeLLMConfig } from '@shared/configuration/modelConfigResolver'
import type {
  A2aAgentCard,
  A2aCallRecord,
  A2aConfig,
  A2aInboundStatus,
  A2aServerEntry,
  A2aServerState,
  A2aStatus,
} from '@shared/protocols/a2aProtocol'
import type { LLMConfig, LLMMessage } from '@protocols'

/** 配置变化推送通道（preload 侧同名订阅） */
export const A2A_CHANGED_CHANNEL = 'a2a:changed'

/** Card 缓存有效期 */
const CARD_TTL_MS = 5 * 60 * 1000

/** 最近调用记录上限 */
const RECENT_LIMIT = 20

/** 查询摘要在记录里的截断长度 */
const QUERY_SUMMARY_LIMIT = 120

/** 入站 skill 清单（对外声明） */
const INBOUND_SKILLS: Array<{ id: string; name: string; description: string; tags?: string[] }> = [
  {
    id: 'chat',
    name: 'chat',
    description: '与本机 AweeClaw 进行一次对话，使用用户当前配置的大模型。',
    tags: ['chat', 'llm', 'general'],
  },
]

interface CardCacheEntry {
  card: A2aAgentCard
  fetchedAt: number
}

/** 推送给渲染层的载荷（工具提供者据此生成 a2a_tool_call 定义） */
export interface A2aChangePayload {
  status: A2aStatus
  /** 工具定义所需的精简信息，避免渲染层再算一遍 */
  tool: {
    enabled: boolean
    agents: Array<{ url: string; description: string; skills: string[] }>
  }
}

export class A2aManager {
  private static instance: A2aManager | null = null

  private readonly server: A2aServer
  private readonly cardCache = new Map<string, CardCacheEntry>()
  private readonly recent: A2aCallRecord[] = []

  /** 运行期探测结果（不落盘：重启后重新探测，避免「上次能连」的假象） */
  private readonly probeState = new Map<string, { reachable: boolean; latencyMs: number; error: string | null; at: number }>()

  private inboundBusy = false

  /**
   * 入站配置变化的外部监听器（P0-5 网关用它接管监听）。
   *
   * 返回值语义：`true` = 「我已接管，本模块不要再自己监听」。
   * 用返回值而不是让监听器自己调 stop —— 谁启动谁负责停止，避免两边互相停对方的 server。
   */
  private readonly inboundListeners = new Set<() => boolean>()

  private constructor() {
    this.server = new A2aServer({
      getCardMeta: () => {
        const config = getConfig()
        return {
          name: config.inbound.agentName || 'AweeClaw',
          description: config.inbound.agentDescription,
          version: '1.0.0',
        }
      },
      getSkills: () => INBOUND_SKILLS,
      getAuthToken: () => getConfig().inbound.token,
      handleChat: (text, ctx) => this.handleInboundChat(text, ctx),
    })
  }

  static getInstance(): A2aManager {
    if (!A2aManager.instance) A2aManager.instance = new A2aManager()
    return A2aManager.instance
  }

  // ============================================
  // 生命周期
  // ============================================

  /** 模块启动：注册 IPC 由 index.ts 负责，这里只做入站服务的条件启动 */
  async start(): Promise<void> {
    await this.applyInbound('startup')
  }

  /** 模块卸载：停掉入站服务并清空缓存 */
  async stop(): Promise<void> {
    await this.server.stop()
    this.cardCache.clear()
    this.probeState.clear()
    this.recent.length = 0
  }

  // ============================================
  // 配置
  // ============================================

  getConfig(): A2aConfig {
    return getConfig()
  }

  /** 配置完整性问题（不阻断保存，仅用于 UI 引导） */
  getIssues(): string[] {
    return validateConfig(getConfig())
  }

  /**
   * 手动重启入站服务。
   *
   * 与 `stop()` 的区别：**不清空**探测状态、卡片缓存与调用记录 ——
   * 用户点「重启」只是想把端口重新绑一次（例如上一轮被占用而自动 +1），
   * 不该顺手丢掉排障信息。
   */
  async restartInbound(): Promise<A2aInboundStatus> {
    await this.server.stop()
    await this.applyInbound('manual-restart')
    const status = this.getInboundStatus()
    this.broadcastChange()
    return status
  }

  /**
   * 由外部（P0-5 网关）触发「重新评估入站监听」。
   *
   * 用途：网关启停会改变端口归属，A2A 需要相应地在「托管」与「独立监听」之间切换。
   * 与 `restartInbound()` 的区别：这里**不强制重启**，只让 applyInbound 按当前
   * 归属重新判断 —— 托管时它会直接 return，不会去抢网关的端口。
   */
  async reapplyInbound(reason: string): Promise<void> {
    await this.applyInbound(`external:${reason}`)
  }

  /** 整表更新（servers 为完整新表时的语义；增量增删走后两个方法） */
  async applyConfig(patch: unknown): Promise<A2aConfig> {
    const before = getConfig()
    const next = updateStoreConfig(patch)
    await this.afterConfigChange(before, next, 'update')
    return next
  }

  async upsertServer(url: string, patch: Partial<A2aServerEntry>): Promise<A2aConfig> {
    const before = getConfig()
    const normalized = normalizeAgentUrl(url)

    // 空 token 视为「沿用已保存的凭证」，而不是「清空凭证」。
    // 理由：设置页为了避免把解密后的密钥平铺进 DOM，编辑时 token 输入框是空的；
    // 若把空串当清空，用户改一下「用途描述」就会顺手把凭证抹掉。
    const safePatch: Partial<A2aServerEntry> = { ...patch }
    if ((safePatch.token === undefined || safePatch.token === '') && before.servers[normalized]?.token) {
      // 必须 delete 而不是置 undefined：置 undefined 在展开合并时仍会覆盖旧值
      delete safePatch.token
    }

    const next = upsertServerEntry(url, safePatch)
    // 配置改了（换了 token / 地址），旧卡片的缓存放不住
    this.cardCache.delete(normalizeAgentUrl(url))
    await this.afterConfigChange(before, next, 'upsert')
    return next
  }

  async removeServer(url: string): Promise<A2aConfig> {
    const before = getConfig()
    const next = removeServerEntry(url)
    const normalized = normalizeAgentUrl(url)
    this.cardCache.delete(normalized)
    this.probeState.delete(normalized)
    await this.afterConfigChange(before, next, 'remove')
    return next
  }

  async resetConfig(): Promise<A2aConfig> {
    const before = getConfig()
    const next = resetStoreConfig()
    this.cardCache.clear()
    this.probeState.clear()
    await this.afterConfigChange(before, next, 'reset')
    return next
  }

  /** 统一的「配置变化后」处理：入站服务按需启停 + 推送渲染层 */
  private async afterConfigChange(before: A2aConfig, next: A2aConfig, reason: string): Promise<void> {
    const inboundChanged =
      before.inbound.enabled !== next.inbound.enabled ||
      before.inbound.host !== next.inbound.host ||
      before.inbound.port !== next.inbound.port ||
      before.inbound.token !== next.inbound.token ||
      before.inbound.allowExternal !== next.inbound.allowExternal ||
      before.inbound.agentName !== next.inbound.agentName ||
      before.inbound.agentDescription !== next.inbound.agentDescription

    if (inboundChanged) {
      logger.system.info(`[A2A] inbound config changed (${reason}), reapplying`)
      await this.applyInbound(reason)
    }

    this.broadcastChange()
  }

  /**
   * 按配置启停入站服务。
   *
   * 安全降级：监听非环回地址但未显式允许外部访问时，**强制回退 127.0.0.1**，
   * 而不是拒绝保存 —— 用户配置不该因为一条安全策略就丢掉。
   */
  private async applyInbound(reason: string): Promise<void> {
    if (this.inboundBusy) {
      logger.system.warn('[A2A] inbound apply skipped: previous apply still running')
      return
    }
    this.inboundBusy = true

    try {
      const { inbound } = getConfig()
      const running = this.server.isRunning()

      if (!inbound.enabled) {
        if (running) await this.server.stop()
        this.notifyInboundChange()
        return
      }

      // 先问外部（P0-5 网关）要不要接管。接管时本模块**必须**停止自己的监听：
      // 两个 http.Server 抢同一个端口，后起的那个直接 EADDRINUSE 起不来
      if (this.notifyInboundChange()) {
        if (running) await this.server.stop()
        return
      }

      const host = shouldFallbackToLoopback(inbound) ? '127.0.0.1' : inbound.host
      const address = this.server.getAddress()

      if (running && address.host === host && address.port === inbound.port) return
      if (running) await this.server.stop()
      await this.server.start(host, inbound.port)
    } catch (err) {
      logger.system.error(`[A2A] inbound apply failed (${reason}):`, err)
    } finally {
      this.inboundBusy = false
    }
  }

  // ============================================
  // 出站：探测 / 调用
  // ============================================

  /** 取 Agent Card（优先缓存） */
  async getAgentCard(url: string, force = false): Promise<A2aAgentCard> {
    const normalized = normalizeAgentUrl(url)
    if (!normalized) throw new Error('无效的 A2A 智能体地址（必须以 http:// 或 https:// 开头）')

    const cached = this.cardCache.get(normalized)
    if (!force && cached && Date.now() - cached.fetchedAt < CARD_TTL_MS) return cached.card

    const entry = getConfig().servers[normalized]
    const client = new A2aClient(normalized, {
      token: entry?.token || undefined,
      headers: entry?.headers,
    })

    const { card } = await client.fetchAgentCard()
    this.cardCache.set(normalized, { card, fetchedAt: Date.now() })
    return card
  }

  /**
   * 连通性测试：能拉到合法 Agent Card 即视为可用。
   *
   * 结果同时写入 probeState（供状态面板展示），失败信息已翻译为中文。
   */
  async testConnection(url: string): Promise<A2aServerState> {
    const normalized = normalizeAgentUrl(url)
    if (!normalized) throw new Error('无效的 A2A 智能体地址（必须以 http:// 或 https:// 开头）')

    const startedAt = Date.now()
    try {
      await this.getAgentCard(normalized, true)
      this.probeState.set(normalized, {
        reachable: true,
        latencyMs: Date.now() - startedAt,
        error: null,
        at: Date.now(),
      })
    } catch (err) {
      this.probeState.set(normalized, {
        reachable: false,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
        at: Date.now(),
      })
    }

    this.broadcastChange()
    return this.toServerState(normalized)
  }

  /**
   * 调用一个外部 A2A 智能体。
   *
   * 这是 `a2a_tool_call` 的落地实现：返回值直接作为工具结果回给模型，
   * 因此**失败也必须返回可读文本**（而不是抛异常让模型看到堆栈）。
   */
  async callAgent(
    url: string,
    query: string,
    options: { contextId?: string; timeoutMs?: number } = {},
  ): Promise<{ ok: boolean; text: string; error?: string; durationMs: number }> {
    const startedAt = Date.now()
    const normalized = normalizeAgentUrl(url)

    if (!normalized) {
      const error = '无效的 A2A 智能体地址：必须以 http:// 或 https:// 开头'
      this.recordCall({ url, query, ok: false, durationMs: 0, error })
      return { ok: false, text: '', error, durationMs: 0 }
    }

    const entry = getConfig().servers[normalized]
    if (!entry) {
      const error = `未配置该 A2A 智能体：${normalized}。请先在「设置 → A2A 协议」中添加。`
      this.recordCall({ url: normalized, query, ok: false, durationMs: 0, error })
      return { ok: false, text: '', error, durationMs: 0 }
    }

    const client = new A2aClient(normalized, {
      token: entry.token || undefined,
      headers: entry.headers,
    })

    try {
      const result = await client.sendMessage(query, {
        contextId: options.contextId,
        timeoutMs: options.timeoutMs ?? A2A_CALL_TIMEOUT_MS,
      })
      const text = result.text || extractTextFromResult(result.task) || '(对方未返回文本内容)'
      const durationMs = Date.now() - startedAt
      this.recordCall({ url: normalized, query, ok: true, durationMs })
      // 调用成功顺带刷新可达状态，省掉一次独立探测
      this.probeState.set(normalized, { reachable: true, latencyMs: durationMs, error: null, at: Date.now() })
      return { ok: true, text, durationMs }
    } catch (err) {
      const durationMs = Date.now() - startedAt
      const error =
        err instanceof A2aError
          ? err.message
          : `调用 A2A 智能体失败：${err instanceof Error ? err.message : String(err)}`
      logger.system.warn('[A2A] callAgent failed:', error)
      this.probeState.set(normalized, { reachable: false, latencyMs: durationMs, error, at: Date.now() })
      this.recordCall({ url: normalized, query, ok: false, durationMs, error })
      return { ok: false, text: '', error, durationMs }
    }
  }

  private recordCall(input: { url: string; query: string; ok: boolean; durationMs: number; error?: string }): void {
    this.recent.unshift({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      url: input.url,
      query: input.query.slice(0, QUERY_SUMMARY_LIMIT),
      ok: input.ok,
      durationMs: input.durationMs,
      at: Date.now(),
      error: input.error,
    })
    if (this.recent.length > RECENT_LIMIT) this.recent.length = RECENT_LIMIT
  }

  // ============================================
  // 状态
  // ============================================

  /** 单个 agent 的运行时状态 */
  private toServerState(url: string): A2aServerState {
    const entry = getConfig().servers[url]
    const probe = this.probeState.get(url)
    const card = this.cardCache.get(url)?.card ?? null

    return {
      url,
      enabled: entry?.enabled === true,
      description: entry?.description ?? '',
      skills: entry?.skills ?? [],
      hasToken: Boolean(entry?.token),
      addedAt: entry?.addedAt || null,
      reachable: probe?.reachable ?? null,
      latencyMs: probe?.latencyMs ?? null,
      lastCheckedAt: probe?.at ?? null,
      lastError: probe?.error ?? null,
      card,
    }
  }

  /** 全部 agent 的状态（按添加时间倒序，新加的排前面） */
  listServerStates(): A2aServerState[] {
    return Object.keys(getConfig().servers)
      .sort((a, b) => (getConfig().servers[b]?.addedAt ?? 0) - (getConfig().servers[a]?.addedAt ?? 0))
      .map((url) => this.toServerState(url))
  }

  /**
   * 订阅入站配置变化。
   *
   * @returns 取消订阅函数
   */
  onInboundChange(listener: () => boolean): () => void {
    this.inboundListeners.add(listener)
    return () => this.inboundListeners.delete(listener)
  }

  /**
   * 取入站 handler（P0-5 网关挂载用）。
   *
   * 只暴露 A2aServer 实例本身，不暴露本类的内部状态 —— 网关只需要 `handle()`。
   */
  getInboundServer(): A2aServer {
    return this.server
  }

  /** 通知外部监听器；返回 true 表示已有外部接管监听 */
  private notifyInboundChange(): boolean {
    let managed = false
    for (const listener of this.inboundListeners) {
      try {
        if (listener()) managed = true
      } catch (err) {
        logger.system.warn('[A2A] inbound listener failed:', err)
      }
    }
    return managed
  }

  /** 入站服务状态 */
  getInboundStatus(): A2aInboundStatus {
    const { inbound } = getConfig()
    const endpoint = this.server.getEffectiveEndpoint()
    const counters = this.server.getCounters()

    // 托管到 P0-5 网关时，地址以网关为准（自己没监听，bind 地址是 0）
    const bound = this.server.isRunning() || endpoint.managed
    const host = bound ? endpoint.host : shouldFallbackToLoopback(inbound) ? '127.0.0.1' : inbound.host
    const port = bound ? endpoint.port : inbound.port
    // 托管时 JSON-RPC 挂在网关的 /a2a 前缀下
    const base = `http://${host}:${port}${endpoint.basePath}`

    return {
      enabled: inbound.enabled,
      running: this.server.isRunning() || endpoint.managed,
      host,
      port,
      url: base,
      // Agent Card 必须在根级（A2A 规范），不能带 basePath
      cardUrl: `http://${host}:${port}/.well-known/agent.json`,
      tokenRequired: Boolean(inbound.token),
      requests: counters.requests,
      errors: counters.errors,
      lastRequestAt: counters.lastRequestAt,
    }
  }

  getStatus(): A2aStatus {
    const config = getConfig()
    const servers = this.listServerStates()
    return {
      enabled: config.enabled,
      totalCount: servers.length,
      enabledCount: servers.filter((s) => s.enabled).length,
      servers,
      inbound: this.getInboundStatus(),
      recent: [...this.recent],
    }
  }

  /**
   * 工具暴露载荷。
   *
   * `enabled` 为 false 或没有任何启用项时，渲染层**不注册** `a2a_tool_call`
   * （与源项目「无可用 agent 时返回 None」的行为一致）。
   */
  getToolPayload(): A2aChangePayload['tool'] {
    const config = getConfig()
    if (!config.enabled) return { enabled: false, agents: [] }

    const agents = Object.entries(config.servers)
      .filter(([, entry]) => entry.enabled)
      .map(([url, entry]) => ({
        url,
        description: entry.description,
        skills: entry.skills,
      }))

    return { enabled: agents.length > 0, agents }
  }

  getChangePayload(): A2aChangePayload {
    return { status: this.getStatus(), tool: this.getToolPayload() }
  }

  /** 推送配置/状态变化（渲染层工具提供者据此刷新工具定义） */
  broadcastChange(): void {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    try {
      win.webContents.send(A2A_CHANGED_CHANNEL, this.getChangePayload())
    } catch (err) {
      logger.system.warn('[A2A] broadcast change failed:', err)
    }
  }

  // ============================================
  // 入站：把请求接到本机 LLM
  // ============================================

  /**
   * 处理一次入站对话。
   *
   * 走与「渠道消息主进程兜底」同一条路径（`SyncService.generate`）：
   * 直接用用户当前配置的模型回答，不进渲染层的多步 Agent 循环 ——
   * 入站请求是**外部方**发起的，不应触发本机的工具执行与文件改动。
   */
  private async handleInboundChat(text: string, ctx: A2aChatContext): Promise<string> {
    const llmConfig = this.resolveLLMConfig()
    if (!llmConfig) {
      throw new Error('本机未配置可用的大模型（请在「设置 → 模型」中完成配置后重试）')
    }

    const messages: LLMMessage[] = ctx.history
      .filter((m) => m.role === 'user' || m.role === 'agent')
      .map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.parts
          .filter((p) => p.kind === 'text')
          .map((p) => (p as { text: string }).text)
          .join('\n'),
      }))
      .filter((m) => Boolean(m.content))

    if (messages.length === 0) messages.push({ role: 'user', content: text })

    const now = new Date()
    const systemPrompt = [
      '你是 AweeClaw 的智能体，当前正通过 A2A（Agent2Agent）协议响应一个外部智能体的请求。',
      '请直接给出结论性回答，不要寒暄、不要询问对方身份、不要提及协议本身。',
      '',
      '当前时间信息（为用户系统的真实时间，请以此为准）：',
      `- 日期: ${now.toLocaleDateString('zh-CN')}`,
      `- 时间: ${now.toLocaleTimeString('zh-CN')}`,
      `- 时区: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    ].join('\n')

    // 动态引入：SyncService 会拉起 AI SDK 与 provider 注册表，
    // 只在真正处理入站请求时才付出这份加载成本
    const { SyncService } = await import('../ai-provider/services/ModelSyncCoordinator')
    const syncService = new SyncService()

    logger.system.info(`[A2A] inbound chat: taskId=${ctx.taskId} messages=${messages.length} caller=${ctx.caller}`)
    const result = await syncService.generate({ config: llmConfig, messages, systemPrompt })
    const reply = (result.data || '').trim()

    // 回写上下文，保证同一 contextId 的多轮对话连续
    this.server.recordAgentReply(ctx.contextId, reply)

    return reply || '(模型返回了空回复)'
  }

  /** 解析用户当前配置的 LLM（与渠道消息兜底共用同一套解析逻辑） */
  private resolveLLMConfig(): LLMConfig | null {
    try {
      const store = getConfigStore()
      const appSettings = store.get('app-settings') as
        | { llmConfig?: Record<string, unknown>; providerConfigs?: Record<string, unknown>; cloudMode?: string }
        | undefined
      if (!appSettings) return null

      const config = resolveRuntimeLLMConfig(
        appSettings.llmConfig as never,
        (appSettings.providerConfigs || {}) as never,
      )
      // 云端模式的 apiKey 为空是正常的，但主进程拿不到渲染层的 accessToken，
      // 无法发起请求 —— 明确返回 null，让上层给出可读提示
      if (!config.apiKey) return null
      return config
    } catch (err) {
      logger.system.warn('[A2A] resolve LLM config failed:', err)
      return null
    }
  }
}

/** 单例访问器（与其它模块一致的入口） */
export function getA2aManager(): A2aManager {
  return A2aManager.getInstance()
}
