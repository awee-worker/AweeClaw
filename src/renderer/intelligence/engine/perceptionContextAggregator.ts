/**
 * 感知上下文聚合器（阶段9 s9-01 新增）
 *
 * 职责：
 * - 从 IoT / Causal / Monitoring 三个主进程模块聚合轻量级摘要
 * - 与 perceptionContextLoader 协作：loader 负责场景+预测+代码影响，
 *   aggregator 负责扩展的三源摘要
 * - 每源独立加载 + 超时保护 + 失败静默，任一源失败不影响其他源
 *
 * 性能保护：
 * - 整体超时 1500ms（与 loader 的 2000ms 并行，总等待不超过 2s）
 * - 单源超时 800ms
 * - 使用 Promise.allSettled 确保隔离失败
 *
 * 数据流：
 *   渲染层 perceptionContextAggregator
 *     ├─ window.electronAPI.iot.getStatus() + listEntitySnapshots()
 *     │   + sensorFusion.getRecentAnomalies()
 *     ├─ window.electronAPI.causal.getStats() + listQueries()
 *     └─ window.electronAPI.monitoring.isRunning() + getActiveAnomalies()
 *         + getLatestMetrics()
 *
 * @module intelligence/engine/perceptionContextAggregator
 */

import { logger } from '@toolkit/LogEngine'
import type {
  IoTContextSummary,
  CausalContextSummary,
  MonitoringContextSummary,
} from '../prompt-engine/PromptComposer'

/** 单源加载超时（毫秒） */
const SINGLE_SOURCE_TIMEOUT_MS = 800

/** 最近异常/查询的时间窗口（24h，毫秒） */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 聚合扩展感知上下文
 *
 * 并行加载 IoT / Causal / Monitoring 三源摘要，任一失败返回 null。
 * 调用方（perceptionContextLoader）将结果合并到 PerceptionContext。
 *
 * @returns 三源摘要对象，字段为 null 表示该源不可用或加载失败
 */
export async function aggregateExtendedContext(): Promise<{
  iotContext: IoTContextSummary | null
  causalContext: CausalContextSummary | null
  monitoringContext: MonitoringContextSummary | null
}> {
  const [iotResult, causalResult, monitoringResult] = await Promise.allSettled([
    loadIoTContext(),
    loadCausalContext(),
    loadMonitoringContext(),
  ])

  return {
    iotContext: iotResult.status === 'fulfilled' ? iotResult.value : null,
    causalContext:
      causalResult.status === 'fulfilled' ? causalResult.value : null,
    monitoringContext:
      monitoringResult.status === 'fulfilled' ? monitoringResult.value : null,
  }
}

// ============================================================
// IoT 上下文聚合
// ============================================================

/**
 * 加载 IoT 上下文摘要
 *
 * 聚合来源：
 * 1. window.electronAPI.iot.getStatus() → BridgeStatus（providers/totalEntities）
 * 2. window.electronAPI.iot.listEntitySnapshots() → 实体快照（取最近变化的 5 个）
 * 3. window.electronAPI.sensorFusion.getRecentAnomalies(3) → 最近传感器异常
 */
async function loadIoTContext(): Promise<IoTContextSummary | null> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.iot) {
      return null
    }

    const iot = window.electronAPI.iot
    const sensorFusion = window.electronAPI?.sensorFusion

    // 并行加载三源（任一失败不影响整体）
    const [statusResult, entitiesResult, anomaliesResult] =
      await Promise.allSettled([
        withTimeout(iot.getStatus(), SINGLE_SOURCE_TIMEOUT_MS, 'iot.getStatus'),
        withTimeout(
          iot.listEntitySnapshots(),
          SINGLE_SOURCE_TIMEOUT_MS,
          'iot.listEntitySnapshots',
        ),
        sensorFusion
          ? withTimeout(
              sensorFusion.getRecentAnomalies(3),
              SINGLE_SOURCE_TIMEOUT_MS,
              'sensorFusion.getRecentAnomalies',
            )
          : Promise.resolve(null),
      ])

    // status 是必需的，失败则整体返回 null
    if (statusResult.status !== 'fulfilled' || !statusResult.value?.success) {
      return null
    }
    const status = statusResult.value.data!
    if (!status.running) {
      return {
        bridgeRunning: false,
        connectedProviders: 0,
        totalProviders: 0,
        totalEntities: 0,
        providers: [],
        recentEntities: [],
        recentAnomalyCount: 0,
        recentAnomalies: [],
      }
    }

    // 实体快照（可选）
    const entities =
      entitiesResult.status === 'fulfilled' &&
      entitiesResult.value?.success &&
      Array.isArray(entitiesResult.value.data)
        ? entitiesResult.value.data
        : []

    // 传感器异常（可选）
    const anomalies =
      anomaliesResult.status === 'fulfilled' &&
      anomaliesResult.value?.success &&
      Array.isArray(anomaliesResult.value.data)
        ? anomaliesResult.value.data
        : []

    // 提取已连接 Provider 摘要（最多 5 个）
    const connectedProviders = status.providers.filter(
      (p) => p.state === 'connected',
    )
    const now = Date.now()
    const providers = connectedProviders.slice(0, 5).map((p) => ({
      name: p.providerName,
      protocol: p.protocol,
      state: p.state,
      entityCount: p.entityCount,
      secondsSinceLastReading:
        p.lastDataAt !== undefined && p.lastDataAt > 0
          ? Math.max(0, Math.round((now - p.lastDataAt) / 1000))
          : null,
    }))

    // 提取最近变化的实体（按 lastStateChangedAt 倒序，最多 5 个）
    const recentEntities = [...entities]
      .sort((a, b) => (b.lastStateChangedAt || 0) - (a.lastStateChangedAt || 0))
      .slice(0, 5)
      .map((e) => ({
        externalId: e.externalId,
        entityType: e.entityType,
        state: e.state,
        unit: e.unitOfMeasurement ?? null,
      }))

    // 传感器异常摘要（最多 3 个）
    const recentAnomalyCount = anomalies.length
    const recentAnomalies = anomalies.slice(0, 3).map((a) => ({
      type: String(a.type),
      severity: String(a.severity),
      description: String(a.description ?? ''),
      entityExternalId: String(a.externalId ?? ''),
    }))

    return {
      bridgeRunning: status.running,
      connectedProviders: connectedProviders.length,
      totalProviders: status.providers.length,
      totalEntities: status.totalEntities,
      providers,
      recentEntities,
      recentAnomalyCount,
      recentAnomalies,
    }
  } catch (e) {
    logger.agent?.warn(
      `[PerceptionAggregator] IoT 上下文加载失败: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

// ============================================================
// 因果推理上下文聚合
// ============================================================

/**
 * 加载因果推理上下文摘要
 *
 * 聚合来源：
 * 1. window.electronAPI.causal.getConfig() → enabled 状态
 * 2. window.electronAPI.causal.getStats() → 图统计
 * 3. window.electronAPI.causal.listQueries({ startDate }) → 最近 24h 查询
 */
async function loadCausalContext(): Promise<CausalContextSummary | null> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.causal) {
      return null
    }

    const causal = window.electronAPI.causal
    const now = Date.now()
    const startDate = now - RECENT_WINDOW_MS

    const [configResult, statsResult, queriesResult] = await Promise.allSettled([
      withTimeout(causal.getConfig(), SINGLE_SOURCE_TIMEOUT_MS, 'causal.getConfig'),
      withTimeout(causal.getStats(), SINGLE_SOURCE_TIMEOUT_MS, 'causal.getStats'),
      withTimeout(
        causal.listQueries({ startDate }),
        SINGLE_SOURCE_TIMEOUT_MS,
        'causal.listQueries',
      ),
    ])

    // config 是必需的
    if (configResult.status !== 'fulfilled' || !configResult.value?.success) {
      return null
    }
    const config = configResult.value.data!
    if (!config.enabled) {
      return {
        enabled: false,
        nodeCount: 0,
        edgeCount: 0,
        density: 0,
        hasCycle: false,
        recentQueryCount: 0,
        recentQueries: [],
      }
    }

    // 图统计（可选）
    const stats =
      statsResult.status === 'fulfilled' && statsResult.value?.success
        ? statsResult.value.data
        : null

    // 最近查询（可选）
    const queriesRaw =
      queriesResult.status === 'fulfilled' &&
      queriesResult.value?.success &&
      Array.isArray(queriesResult.value.data)
        ? (queriesResult.value.data as Array<Record<string, unknown>>)
        : []

    // 提取最近查询摘要（最多 3 个，按时间倒序）
    const recentQueries = [...queriesRaw]
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 3)
      .map((q) => {
        const result = (q.result ?? {}) as Record<string, unknown>
        return {
          queryType: String(q.queryType ?? 'unknown'),
          interventionVar: String(q.interventionVar ?? ''),
          observedVar: String(q.observedVar ?? ''),
          impactLevel: String(result.impactLevel ?? 'unknown'),
          success: Boolean(q.success),
        }
      })

    return {
      enabled: true,
      nodeCount: stats?.nodeCount ?? 0,
      edgeCount: stats?.edgeCount ?? 0,
      density: stats?.density ?? 0,
      hasCycle: stats?.hasCycle ?? false,
      recentQueryCount: queriesRaw.length,
      recentQueries,
    }
  } catch (e) {
    logger.agent?.warn(
      `[PerceptionAggregator] Causal 上下文加载失败: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

// ============================================================
// 监控上下文聚合
// ============================================================

/**
 * 加载监控上下文摘要
 *
 * 聚合来源：
 * 1. window.electronAPI.monitoring.isRunning() → 运行状态
 * 2. window.electronAPI.monitoring.getActiveAnomalies() → 活跃异常
 * 3. window.electronAPI.monitoring.getRecentAnomalies(3) → 最近异常
 * 4. window.electronAPI.monitoring.getLatestMetrics() → 最新系统指标
 */
async function loadMonitoringContext(): Promise<MonitoringContextSummary | null> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.monitoring) {
      return null
    }

    const monitoring = window.electronAPI.monitoring

    const [runningResult, activeResult, recentResult, metricsResult] =
      await Promise.allSettled([
        withTimeout(
          monitoring.isRunning(),
          SINGLE_SOURCE_TIMEOUT_MS,
          'monitoring.isRunning',
        ),
        withTimeout(
          monitoring.getActiveAnomalies(),
          SINGLE_SOURCE_TIMEOUT_MS,
          'monitoring.getActiveAnomalies',
        ),
        withTimeout(
          monitoring.getRecentAnomalies(3),
          SINGLE_SOURCE_TIMEOUT_MS,
          'monitoring.getRecentAnomalies',
        ),
        withTimeout(
          monitoring.getLatestMetrics(),
          SINGLE_SOURCE_TIMEOUT_MS,
          'monitoring.getLatestMetrics',
        ),
      ])

    // isRunning 是必需的
    if (
      runningResult.status !== 'fulfilled' ||
      !runningResult.value?.success
    ) {
      return null
    }
    const running = runningResult.value.data === true
    if (!running) {
      return {
        running: false,
        activeAnomalyCount: 0,
        recentAnomalies: [],
        systemMetrics: null,
      }
    }

    // 活跃异常（可选）
    const activeAnomalies =
      activeResult.status === 'fulfilled' &&
      activeResult.value?.success &&
      Array.isArray(activeResult.value.data)
        ? activeResult.value.data
        : []

    // 最近异常（可选）
    const recentAnomaliesRaw =
      recentResult.status === 'fulfilled' &&
      recentResult.value?.success &&
      Array.isArray(recentResult.value.data)
        ? (recentResult.value.data as Array<Record<string, unknown>>)
        : []

    // 最新系统指标（可选）
    const metrics =
      metricsResult.status === 'fulfilled' &&
      metricsResult.value?.success
        ? (metricsResult.value.data as Record<string, unknown> | null)
        : null

    // 提取最近异常摘要（最多 3 个，按时间倒序）
    const recentAnomalySummary = [...recentAnomaliesRaw]
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .slice(0, 3)
      .map((a) => ({
        type: String(a.type ?? 'unknown'),
        severity: String(a.severity ?? 'info'),
        description: String(a.description ?? ''),
        timestamp: Number(a.timestamp ?? Date.now()),
      }))

    // 系统指标摘要（仅关键 3 项）
    const systemMetrics = metrics
      ? {
          cpuUsage: typeof metrics.cpuUsage === 'number' ? metrics.cpuUsage : null,
          memoryUsage:
            typeof metrics.memoryUsage === 'number' ? metrics.memoryUsage : null,
          diskUsage:
            typeof metrics.diskUsage === 'number' ? metrics.diskUsage : null,
        }
      : null

    return {
      running: true,
      activeAnomalyCount: activeAnomalies.length,
      recentAnomalies: recentAnomalySummary,
      systemMetrics,
    }
  } catch (e) {
    logger.agent?.warn(
      `[PerceptionAggregator] Monitoring 上下文加载失败: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 带超时的 Promise 包装
 *
 * 超时或异常时返回 null，不抛错，确保不阻塞聚合主流程。
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T | null> {
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) =>
        setTimeout(() => {
          logger.agent?.warn(
            `[PerceptionAggregator] ${label} 超时 ${ms}ms`,
          )
          resolve(null)
        }, ms),
      ),
    ])
  } catch (e) {
    logger.agent?.warn(
      `[PerceptionAggregator] ${label} 异常: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}
