/**
 * 对外 API 网关编排器（主进程）
 *
 * 职责：
 *   1. 按配置启停 OpenApiServer
 *   2. 与 A2A 模块协商**监听归属**（谁监听那个端口）
 *   3. 为设置页组装状态
 *   4. 配置变化时推送渲染层
 *
 * ⚠️ 端口归属是这里最容易出错的地方，规则明确写死为「网关优先」：
 *
 *   | 网关 enabled | A2A inbound enabled | 谁监听端口          | A2A 路由 |
 *   |---|---|---|---|
 *   | ✅ | ✅ | 网关                | 挂在 /a2a |
 *   | ✅ | ❌ | 网关                | 404（未启用） |
 *   | ❌ | ✅ | A2A 自己            | 自己的 /（兼容 P0-4） |
 *   | ❌ | ❌ | 无人监听            | — |
 *
 * 实现方式：A2A 在每次要监听前先问外部监听器「你要接管吗」
 * （`onInboundChange` 返回 true 即接管），网关关闭时再反过来
 * 让 A2A 重新评估（`reapplyInbound`）。两边都不直接操作对方的 server。
 *
 * @module openapi/OpenApiManager
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getMainWindow } from '../../bootstrap/windowManager'
import { getA2aManager } from '../a2a'
import { OpenApiServer, type A2aHandlerLike } from './OpenApiServer'
import {
  generateApiKey,
  getConfig,
  resetConfig as resetStoreConfig,
  shouldFallbackToLoopback,
  updateConfig,
  validateConfig,
} from './OpenApiStore'
import type { OpenApiConfig, OpenApiRequestRecord, OpenApiStatus } from '@shared/protocols/openApiProtocol'
import { OPEN_API_CHANGED_CHANNEL } from '@shared/protocols/openApiProtocol'

/** A2A 在网关上的挂载前缀 */
const A2A_BASE_PATH = '/a2a'

export class OpenApiManager {
  private static instance: OpenApiManager | null = null

  private readonly server: OpenApiServer

  /** 取消订阅 A2A 入站变化 */
  private unsubscribeA2a: (() => void) | null = null

  /** 防重入：apply 内部可能触发 A2A 的 reapply，而后者又回调本类的监听器 */
  private applying = false

  private constructor() {
    this.server = new OpenApiServer({
      getConfig: () => getConfig(),
      getA2aHandler: () => this.resolveA2aHandler(),
      getStatus: () => this.getStatus(),
    })
  }

  static getInstance(): OpenApiManager {
    if (!OpenApiManager.instance) OpenApiManager.instance = new OpenApiManager()
    return OpenApiManager.instance
  }

  // ============================================
  // 生命周期
  // ============================================

  async start(): Promise<void> {
    // 订阅 A2A 的入站变化：A2A 想监听前会问我们，网关启用时接管
    this.unsubscribeA2a = getA2aManager().onInboundChange(() => {
      void this.apply('a2a-inbound-change')
      return this.isGatewayManaging()
    })

    await this.apply('startup')
  }

  /** 模块卸载：停网关 + 交还监听权给 A2A */
  async stop(): Promise<void> {
    this.unsubscribeA2a?.()
    this.unsubscribeA2a = null

    await this.server.stop()
    // 网关退场，A2A 的公开地址必须清掉 —— 否则 Card 一直指向一个已经关闭的端口
    getA2aManager().getInboundServer().setPublicEndpoint(null)

    // 交还监听权：A2A 若启用则自己重新监听（P0-4 的独立模式）
    await getA2aManager().reapplyInbound('gateway-stopped')
  }

  // ============================================
  // 配置
  // ============================================

  getConfig(): OpenApiConfig {
    return getConfig()
  }

  getIssues(): string[] {
    return validateConfig(getConfig())
  }

  /** 生成一个新的准入密钥（不自动保存，由 UI 决定何时写入） */
  generateKey(): string {
    return generateApiKey()
  }

  async applyConfig(patch: unknown): Promise<OpenApiConfig> {
    const next = updateConfig(patch)
    await this.apply('update-config')
    this.broadcastChange()
    return next
  }

  async resetConfig(): Promise<OpenApiConfig> {
    const next = resetStoreConfig()
    await this.apply('reset-config')
    this.broadcastChange()
    return next
  }

  /** 手动重启（端口被占用后想重新绑回原端口时用） */
  async restart(): Promise<OpenApiStatus> {
    if (this.server.isRunning()) await this.server.stop()
    getA2aManager().getInboundServer().setPublicEndpoint(null)
    await this.apply('manual-restart')
    this.broadcastChange()
    return this.getStatus()
  }

  // ============================================
  // 内部：启停
  // ============================================

  /** 网关是否正在托管 A2A（A2A 据此决定要不要自己监听） */
  private isGatewayManaging(): boolean {
    return getConfig().enabled && this.server.isRunning()
  }

  /** 网关是否需要暴露 A2A 路由 */
  private resolveA2aHandler(): A2aHandlerLike | null {
    if (!this.server.isRunning()) return null
    if (!getA2aManager().getConfig().inbound.enabled) return null
    return getA2aManager().getInboundServer()
  }

  /**
   * 按配置启停网关，并同步 A2A 的监听归属。
   *
   * 安全降级：监听非环回地址但未显式允许外部访问时**强制回退 127.0.0.1**
   * （与 A2A 一致，降级而不是拒绝保存）。
   */
  private async apply(reason: string): Promise<void> {
    if (this.applying) {
      logger.system.warn('[OpenApi] apply skipped: previous apply still running')
      return
    }
    this.applying = true

    try {
      const config = getConfig()

      // --- 关闭：停服务并把监听权交还 A2A ---
      if (!config.enabled) {
        const wasRunning = this.server.isRunning()
        if (wasRunning) await this.server.stop()
        getA2aManager().getInboundServer().setPublicEndpoint(null)
        if (wasRunning) await getA2aManager().reapplyInbound('gateway-disabled')
        return
      }

      const host = shouldFallbackToLoopback(config) ? '127.0.0.1' : config.host

      // --- 已运行且地址未变：只同步 A2A 公开地址 ---
      if (this.server.isRunning()) {
        const address = this.server.getAddress()
        if (address.host === host && address.port === config.port) {
          this.syncA2aEndpoint()
          return
        }
        await this.server.stop()
        getA2aManager().getInboundServer().setPublicEndpoint(null)
      }

      // ⚠️ 必须在 start **之前**让 A2A 释放端口。
      // 否则：A2A 正独立监听着 8790（用户配置的端口）→ 网关 start(8790) 撞
      // EADDRINUSE → 按重试策略自动 +1 绑到 8791 → 用户看到「我配的是 8790，
      // 状态里却是 8791」，而配置里仍写着 8790。先释放再启动，端口就一致了。
      const a2aServer = getA2aManager().getInboundServer()
      if (a2aServer.isRunning()) {
        await a2aServer.stop()
        logger.system.info('[OpenApi] A2A released the port for the gateway')
      }

      await this.server.start(host, config.port)
      this.syncA2aEndpoint()

      // 告知 A2A 重新评估监听归属（此时网关已在运行 → 它会保持不监听）
      await getA2aManager().reapplyInbound('gateway-started')
      logger.system.info(`[OpenApi] gateway applied (${reason}) on port ${this.server.getAddress().port}`)
    } catch (err) {
      logger.system.error(`[OpenApi] apply failed (${reason}):`, err)
    } finally {
      this.applying = false
    }
  }

  /** 把网关的真实监听地址注入 A2A（A2A 的 Agent Card 依赖它） */
  private syncA2aEndpoint(): void {
    const a2a = getA2aManager().getInboundServer()
    const address = this.server.getAddress()

    if (this.server.isRunning() && getA2aManager().getConfig().inbound.enabled) {
      a2a.setPublicEndpoint({ host: address.host, port: address.port, basePath: A2A_BASE_PATH })
      return
    }
    a2a.setPublicEndpoint(null)
  }

  // ============================================
  // 状态
  // ============================================

  getStatus(): OpenApiStatus {
    const config = getConfig()
    const a2aConfig = getA2aManager().getConfig()
    const address = this.server.getAddress()
    const counters = this.server.getCounters()
    const running = this.server.isRunning()

    const bound = running
    const host = bound ? address.host : shouldFallbackToLoopback(config) ? '127.0.0.1' : config.host
    const port = bound ? address.port : config.port

    return {
      enabled: config.enabled,
      running,
      host,
      port,
      baseUrl: `http://${host}:${port}`,
      apiKeyRequired: Boolean(config.apiKey),
      corsOrigins: [...config.corsOrigins],
      a2aMounted: running && a2aConfig.inbound.enabled,
      a2aEnabled: a2aConfig.inbound.enabled,
      requests: counters.requests,
      errors: counters.errors,
      lastRequestAt: counters.lastRequestAt,
      recent: this.server.getRecent(),
    }
  }

  /** 最近请求记录（供排障） */
  getRecentRequests(): OpenApiRequestRecord[] {
    return this.server.getRecent()
  }

  /** 推送配置/状态变化（设置页据此刷新） */
  broadcastChange(): void {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    try {
      win.webContents.send(OPEN_API_CHANGED_CHANNEL, { status: this.getStatus() })
    } catch (err) {
      logger.system.warn('[OpenApi] broadcast change failed:', err)
    }
  }
}

/** 单例访问器（与其它模块一致的入口） */
export function getOpenApiManager(): OpenApiManager {
  return OpenApiManager.getInstance()
}
