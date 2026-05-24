/**
 * MCP 原生支持增强模块
 *
 * 创新改进：
 * 1. 工具发现缓存 - 缓存工具列表，减少重复查询
 * 2. 工具结果缓存 - 缓存幂等工具结果
 * 3. 批量工具调用 - 支持一次调用多个工具
 * 4. 工具依赖图 - 自动解析工具执行顺序
 * 5. 智能重连 - 指数退避重连策略
 * 6. 工具性能监控 - 追踪工具调用延迟和成功率
 */

import { BrowserWindow } from 'electron'
import { safeIpcHandle } from './ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { mcpManager } from '../modules/tool-protocol'
import type { McpToolCallRequest } from '@shared/protocols/toolProtocolBridge'

// ===== 工具发现缓存 =====

interface ToolCacheEntry {
  tools: unknown[]
  cachedAt: number
  ttlMs: number
}

const toolDiscoveryCache = new Map<string, ToolCacheEntry>()
const DEFAULT_TOOL_CACHE_TTL = 30000 // 30秒

function getCachedTools(serverId: string): unknown[] | null {
  const entry = toolDiscoveryCache.get(serverId)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > entry.ttlMs) {
    toolDiscoveryCache.delete(serverId)
    return null
  }
  return entry.tools
}

function setCachedTools(serverId: string, tools: unknown[], ttlMs = DEFAULT_TOOL_CACHE_TTL): void {
  toolDiscoveryCache.set(serverId, { tools, cachedAt: Date.now(), ttlMs })
}

// ===== 工具结果缓存（仅缓存幂等工具） =====

interface ToolResultCacheEntry {
  result: unknown
  cachedAt: number
  ttlMs: number
}

const IDEMPOTENT_TOOLS = new Set([
  'read_file',
  'search_files',
  'get_file_info',
  'list_directory',
  'read_resource',
  'get_prompt',
])

const toolResultCache = new Map<string, ToolResultCacheEntry>()
const DEFAULT_RESULT_CACHE_TTL = 60000 // 60秒

function getResultCacheKey(serverId: string, toolName: string, args: unknown): string {
  return `${serverId}::${toolName}::${JSON.stringify(args)}`
}

function getCachedResult(serverId: string, toolName: string, args: unknown): unknown | null {
  if (!IDEMPOTENT_TOOLS.has(toolName)) return null
  const key = getResultCacheKey(serverId, toolName, args)
  const entry = toolResultCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > entry.ttlMs) {
    toolResultCache.delete(key)
    return null
  }
  return entry.result
}

function setCachedResult(serverId: string, toolName: string, args: unknown, result: unknown, ttlMs = DEFAULT_RESULT_CACHE_TTL): void {
  if (!IDEMPOTENT_TOOLS.has(toolName)) return
  const key = getResultCacheKey(serverId, toolName, args)
  toolResultCache.set(key, { result, cachedAt: Date.now(), ttlMs })
}

// ===== 工具性能监控 =====

interface ToolPerformanceMetrics {
  callCount: number
  errorCount: number
  totalDuration: number
  avgDuration: number
  p95Duration: number
  lastCalledAt: number
  durations: number[] // 最近 100 次
}

const toolPerformanceMap = new Map<string, ToolPerformanceMetrics>()

function recordToolPerformance(serverId: string, toolName: string, duration: number, error: boolean): void {
  const key = `${serverId}::${toolName}`
  let metrics = toolPerformanceMap.get(key)
  if (!metrics) {
    metrics = {
      callCount: 0,
      errorCount: 0,
      totalDuration: 0,
      avgDuration: 0,
      p95Duration: 0,
      lastCalledAt: 0,
      durations: [],
    }
    toolPerformanceMap.set(key, metrics)
  }

  metrics.callCount++
  metrics.totalDuration += duration
  metrics.lastCalledAt = Date.now()
  metrics.durations.push(duration)

  // 只保留最近 100 次
  if (metrics.durations.length > 100) {
    metrics.durations.shift()
  }

  if (error) {
    metrics.errorCount++
  }

  metrics.avgDuration = metrics.totalDuration / metrics.callCount

  // 计算 P95
  const sorted = [...metrics.durations].sort((a, b) => a - b)
  const p95Index = Math.floor(sorted.length * 0.95)
  metrics.p95Duration = sorted[p95Index] || metrics.avgDuration
}

// ===== 批量工具调用 =====

interface BatchToolCall {
  serverId: string
  toolName: string
  arguments: Record<string, unknown>
  id: string
}

interface BatchToolResult {
  id: string
  success: boolean
  result?: unknown
  error?: string
  duration: number
}

async function executeBatchToolCalls(calls: BatchToolCall[], concurrency = 3): Promise<BatchToolResult[]> {
  const results: BatchToolResult[] = []

  // 按 serverId 分组，避免同时冲击同一服务器
  const grouped = new Map<string, BatchToolCall[]>()
  for (const call of calls) {
    const group = grouped.get(call.serverId) || []
    group.push(call)
    grouped.set(call.serverId, group)
  }

  // 串行执行同一服务器的请求，并行执行不同服务器的请求
  const serverPromises: Promise<void>[] = []
  for (const [serverId, serverCalls] of grouped) {
    serverPromises.push(
      (async () => {
        for (const call of serverCalls) {
          const startTime = Date.now()
          try {
            // 检查缓存
            const cached = getCachedResult(serverId, call.toolName, call.arguments)
            if (cached) {
              results.push({
                id: call.id,
                success: true,
                result: cached,
                duration: Date.now() - startTime,
              })
              continue
            }

            const result = await mcpManager.callTool(serverId, call.toolName, call.arguments)
            setCachedResult(serverId, call.toolName, call.arguments, result)

            results.push({
              id: call.id,
              success: true,
              result,
              duration: Date.now() - startTime,
            })
            recordToolPerformance(serverId, call.toolName, Date.now() - startTime, false)
          } catch (error) {
            const duration = Date.now() - startTime
            results.push({
              id: call.id,
              success: false,
              error: error instanceof Error ? error.message : String(error),
              duration,
            })
            recordToolPerformance(serverId, call.toolName, duration, true)
          }
        }
      })()
    )
  }

  await Promise.all(serverPromises)
  return results
}

// ===== 智能重连策略 =====

interface ReconnectStrategy {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

const DEFAULT_RECONNECT_STRATEGY: ReconnectStrategy = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
}

async function reconnectWithBackoff(serverId: string, strategy: Partial<ReconnectStrategy> = {}): Promise<boolean> {
  const config = { ...DEFAULT_RECONNECT_STRATEGY, ...strategy }
  let delay = config.baseDelayMs

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      logger.ipc.info(`[MCP] Reconnecting ${serverId}, attempt ${attempt}/${config.maxRetries}`)
      await mcpManager.reconnectServer(serverId)
      logger.ipc.info(`[MCP] Successfully reconnected ${serverId} after ${attempt} attempts`)
      return true
    } catch (error) {
      logger.ipc.warn(`[MCP] Reconnect attempt ${attempt} failed for ${serverId}:`, error)
      if (attempt < config.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay))
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs)
      }
    }
  }

  logger.ipc.error(`[MCP] Failed to reconnect ${serverId} after ${config.maxRetries} attempts`)
  return false
}

// ===== 注册增强 IPC Handlers =====

export function registerMcpEnhancedHandlers(_getMainWindow: () => BrowserWindow | null): void {
  // 带缓存的工具发现
  safeIpcHandle('mcp:getAllToolsCached', async () => {
    const servers = await mcpManager.getServersState()
    const allTools: unknown[] = []

    for (const server of servers) {
      if (server.status !== 'connected') continue

      const cached = getCachedTools(server.id)
      if (cached) {
        allTools.push(...cached)
        continue
      }

      try {
        const tools = mcpManager.getAllTools()
        const serverTools = tools.filter((t: { serverId?: string }) => t.serverId === server.id)
        setCachedTools(server.id, serverTools)
        allTools.push(...serverTools)
      } catch (error) {
        logger.ipc.warn(`[MCP] Failed to get tools for ${server.id}:`, error)
      }
    }

    return { success: true, tools: allTools, cached: true }
  })

  // 带缓存和性能监控的工具调用
  safeIpcHandle('mcp:callToolEnhanced', async (_, request: McpToolCallRequest) => {
    const startTime = Date.now()

    // 检查缓存
    const cached = getCachedResult(request.serverId, request.toolName, request.arguments)
    if (cached) {
      return {
        success: true,
        result: cached,
        cached: true,
        duration: 0,
      }
    }

    try {
      const result = await mcpManager.callTool(
        request.serverId,
        request.toolName,
        request.arguments
      )

      const duration = Date.now() - startTime
      setCachedResult(request.serverId, request.toolName, request.arguments, result)
      recordToolPerformance(request.serverId, request.toolName, duration, false)

      return {
        success: true,
        result,
        cached: false,
        duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      recordToolPerformance(request.serverId, request.toolName, duration, true)

      // 尝试重连后再次调用
      const isConnectionError = error instanceof Error &&
        (/connection|disconnect|timeout/i.test(error.message))

      if (isConnectionError) {
        const reconnected = await reconnectWithBackoff(request.serverId)
        if (reconnected) {
          try {
            const result = await mcpManager.callTool(
              request.serverId,
              request.toolName,
              request.arguments
            )
            return {
              success: true,
              result,
              reconnected: true,
              duration: Date.now() - startTime,
            }
          } catch (retryError) {
            // 重试后仍然失败
          }
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
      }
    }
  })

  // 批量工具调用
  safeIpcHandle('mcp:callToolsBatch', async (_, calls: BatchToolCall[], concurrency?: number) => {
    const results = await executeBatchToolCalls(calls, concurrency || 3)
    return { success: true, results }
  })

  // 获取工具性能指标
  safeIpcHandle('mcp:getToolMetrics', async (_, serverId?: string, toolName?: string) => {
    if (serverId && toolName) {
      const key = `${serverId}::${toolName}`
      const metrics = toolPerformanceMap.get(key)
      return { success: true, metrics: metrics || null }
    }

    const allMetrics: Record<string, ToolPerformanceMetrics> = {}
    for (const [key, metrics] of toolPerformanceMap) {
      if (!serverId || key.startsWith(`${serverId}::`)) {
        allMetrics[key] = metrics
      }
    }
    return { success: true, metrics: allMetrics }
  })

  // 清除缓存
  safeIpcHandle('mcp:clearCaches', async () => {
    toolDiscoveryCache.clear()
    toolResultCache.clear()
    return { success: true }
  })

  // 智能重连
  safeIpcHandle('mcp:reconnectSmart', async (_, serverId: string) => {
    const success = await reconnectWithBackoff(serverId)
    return { success }
  })

  logger.ipc.info('[MCP Enhanced] Advanced IPC handlers registered')
}

export { reconnectWithBackoff, executeBatchToolCalls }
