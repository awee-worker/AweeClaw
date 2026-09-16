/**
 * LLM 连接池管理器
 *
 * ⚠️ 当前未被任何生产路径使用（仅导出 `globalConnectionPool`，无调用方）。
 * 如需接入，请先移除 `runWithConnection` 里的 `requestTimeoutMs`（默认 120s）
 * 「整请求总耗时」竞速超时：它与「AI 长思考不设总超时」的既定策略冲突，
 * 会把正常的长思考/长任务判为 `Request timeout` 并中断（等价于历史上的
 * 「AI 一思考就自动中断」根因）。连接存活应交给 TCP keepalive + 传输层错误判定，
 * 参见 ./core/NetworkDispatcher.ts。
 *
 * 设计目标：
 * 1. 复用 HTTP 连接，减少 TCP 握手开销
 * 2. 限制并发请求数，避免触发服务商限流
 * 3. 支持多 provider 隔离
 * 4. 健康检查与自动恢复
 * 5. 请求排队与优先级调度
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { LLMConfig } from '@protocols'

interface PooledConnection {
  id: string
  provider: string
  model: string
  baseURL?: string
  inUse: boolean
  lastUsedAt: number
  createdAt: number
  requestCount: number
  errorCount: number
  healthy: boolean
}

interface QueuedRequest {
  id: string
  provider: string
  model: string
  priority: number
  execute: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  enqueuedAt: number
}

interface ConnectionPoolConfig {
  /** 每个 provider 的最大连接数 */
  maxConnectionsPerProvider: number
  /** 全局最大并发请求数 */
  maxGlobalConcurrent: number
  /** 连接空闲超时（ms） */
  idleTimeoutMs: number
  /** 连接最大生命周期（ms） */
  maxLifetimeMs: number
  /** 健康检查间隔（ms） */
  healthCheckIntervalMs: number
  /** 请求超时（ms） */
  requestTimeoutMs: number
  /** 队列最大长度 */
  maxQueueSize: number
}

const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  maxConnectionsPerProvider: 3,
  maxGlobalConcurrent: 10,
  idleTimeoutMs: 60000,
  maxLifetimeMs: 300000,
  healthCheckIntervalMs: 30000,
  requestTimeoutMs: 120000,
  maxQueueSize: 100,
}

/**
 * 从配置生成 provider 标识
 */
function getProviderKey(config: LLMConfig): string {
  return `${config.provider}:${config.model}:${config.baseUrl || 'default'}`
}

export class LLMConnectionPool {
  private connections = new Map<string, PooledConnection[]>()
  private queue: QueuedRequest[] = []
  private activeRequests = 0
  private config: ConnectionPoolConfig
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config }
    this.startHealthChecks()
    this.startCleanupTimer()
  }

  /**
   * 获取或创建连接
   */
  private acquireConnection(providerKey: string): PooledConnection | null {
    const connections = this.connections.get(providerKey) || []

    // 查找空闲且健康的连接
    const available = connections.find(c => !c.inUse && c.healthy)
    if (available) {
      available.inUse = true
      available.lastUsedAt = Date.now()
      available.requestCount++
      return available
    }

    // 检查是否达到上限
    const activeCount = connections.filter(c => c.inUse).length
    if (activeCount >= this.config.maxConnectionsPerProvider) {
      return null // 达到上限，需要排队
    }

    // 创建新连接
    const [provider, model, baseUrl] = providerKey.split(':')
    const newConnection: PooledConnection = {
      id: crypto.randomUUID(),
      provider,
      model,
      baseURL: baseUrl === 'default' ? undefined : baseUrl,
      inUse: true,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      requestCount: 1,
      errorCount: 0,
      healthy: true,
    }

    connections.push(newConnection)
    this.connections.set(providerKey, connections)
    logger.ipc.info(`[ConnectionPool] Created new connection: ${providerKey} (${connections.length} total)`)
    return newConnection
  }

  /**
   * 释放连接
   */
  private releaseConnection(connection: PooledConnection): void {
    connection.inUse = false
    connection.lastUsedAt = Date.now()
    this.processQueue()
  }

  /**
   * 标记连接错误
   */
  private markConnectionError(connection: PooledConnection): void {
    connection.errorCount++
    if (connection.errorCount >= 3) {
      connection.healthy = false
      logger.ipc.warn(`[ConnectionPool] Connection marked unhealthy: ${connection.id}`)
    }
  }

  /**
   * 执行请求（带连接池管理）
   */
  async execute<T>(
    config: LLMConfig,
    executeFn: () => Promise<T>,
    priority = 5
  ): Promise<T> {
    const providerKey = getProviderKey(config)

    // 检查全局并发
    if (this.activeRequests >= this.config.maxGlobalConcurrent) {
      return this.enqueueRequest(providerKey, executeFn, priority)
    }

    const connection = this.acquireConnection(providerKey)
    if (!connection) {
      return this.enqueueRequest(providerKey, executeFn, priority)
    }

    return this.runWithConnection(connection, executeFn)
  }

  /**
   * 使用连接执行请求
   */
  private async runWithConnection<T>(
    connection: PooledConnection,
    executeFn: () => Promise<T>
  ): Promise<T> {
    this.activeRequests++

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), this.config.requestTimeoutMs)
      })

      const result = await Promise.race([executeFn(), timeoutPromise])
      return result as T
    } catch (error) {
      this.markConnectionError(connection)
      throw error
    } finally {
      this.activeRequests--
      this.releaseConnection(connection)
    }
  }

  /**
   * 请求入队
   */
  private enqueueRequest<T>(
    providerKey: string,
    executeFn: () => Promise<T>,
    priority: number
  ): Promise<T> {
    if (this.queue.length >= this.config.maxQueueSize) {
      return Promise.reject(new Error('Connection pool queue full'))
    }

    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        id: crypto.randomUUID(),
        provider: providerKey,
        model: '',
        priority,
        execute: executeFn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
      }

      // 按优先级插入队列
      const insertIndex = this.queue.findIndex(r => r.priority < priority)
      if (insertIndex === -1) {
        this.queue.push(request)
      } else {
        this.queue.splice(insertIndex, 0, request)
      }

      logger.ipc.debug(`[ConnectionPool] Request queued: ${providerKey}, queue length: ${this.queue.length}`)
    })
  }

  /**
   * 处理队列
   */
  private processQueue(): void {
    if (this.queue.length === 0) return
    if (this.activeRequests >= this.config.maxGlobalConcurrent) return

    const request = this.queue.shift()!
    const connection = this.acquireConnection(request.provider)

    if (!connection) {
      // 放回队列头部
      this.queue.unshift(request)
      return
    }

    // 检查等待时间
    const waitTime = Date.now() - request.enqueuedAt
    if (waitTime > this.config.requestTimeoutMs) {
      request.reject(new Error('Request timeout while waiting in queue'))
      this.releaseConnection(connection)
      this.processQueue()
      return
    }

    this.runWithConnection(connection, request.execute as () => Promise<unknown>)
      .then(request.resolve)
      .catch(request.reject)
  }

  /**
   * 健康检查
   */
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(() => {
      for (const [providerKey, connections] of this.connections.entries()) {
        const healthyConnections = connections.filter(c => c.healthy)
        const unhealthyConnections = connections.filter(c => !c.healthy)

        // 移除长期不健康的连接
        if (unhealthyConnections.length > 0) {
          const now = Date.now()
          const toRemove = unhealthyConnections.filter(
            c => now - c.lastUsedAt > this.config.idleTimeoutMs
          )
          if (toRemove.length > 0) {
            this.connections.set(
              providerKey,
              connections.filter(c => !toRemove.includes(c))
            )
            logger.ipc.info(`[ConnectionPool] Removed ${toRemove.length} unhealthy connections for ${providerKey}`)
          }
        }

        // 如果健康连接不足，恢复部分不健康连接
        if (healthyConnections.length === 0 && unhealthyConnections.length > 0) {
          const toRecover = unhealthyConnections.slice(0, 1)
          toRecover.forEach(c => {
            c.healthy = true
            c.errorCount = 0
          })
          logger.ipc.info(`[ConnectionPool] Recovered ${toRecover.length} connections for ${providerKey}`)
        }
      }
    }, this.config.healthCheckIntervalMs)
  }

  /**
   * 清理过期连接
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now()
      let totalCleaned = 0

      for (const [providerKey, connections] of this.connections.entries()) {
        const toKeep = connections.filter(c => {
          // 保留使用中的连接
          if (c.inUse) return true
          // 移除超生命周期的连接
          if (now - c.createdAt > this.config.maxLifetimeMs) return false
          // 移除长期空闲的连接
          if (now - c.lastUsedAt > this.config.idleTimeoutMs) return false
          return true
        })

        const cleaned = connections.length - toKeep.length
        if (cleaned > 0) {
          totalCleaned += cleaned
          this.connections.set(providerKey, toKeep)
        }
      }

      if (totalCleaned > 0) {
        logger.ipc.info(`[ConnectionPool] Cleaned up ${totalCleaned} expired connections`)
      }
    }, this.config.idleTimeoutMs)
  }

  /**
   * 获取池统计信息
   */
  getStats(): {
    totalConnections: number
    activeConnections: number
    healthyConnections: number
    queueLength: number
    activeRequests: number
    providerStats: Record<string, { total: number; active: number; healthy: number }>
  } {
    let totalConnections = 0
    let activeConnections = 0
    let healthyConnections = 0
    const providerStats: Record<string, { total: number; active: number; healthy: number }> = {}

    for (const [providerKey, connections] of this.connections.entries()) {
      const total = connections.length
      const active = connections.filter(c => c.inUse).length
      const healthy = connections.filter(c => c.healthy).length

      totalConnections += total
      activeConnections += active
      healthyConnections += healthy
      providerStats[providerKey] = { total, active, healthy }
    }

    return {
      totalConnections,
      activeConnections,
      healthyConnections,
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      providerStats,
    }
  }

  /**
   * 销毁连接池
   */
  dispose(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.connections.clear()
    this.queue = []
  }
}

/**
 * 全局连接池实例
 */
export const globalConnectionPool = new LLMConnectionPool()
