/**
 * ScenarioMonitor - 场景监控与日志系统
 *
 * 提供场景运行时的监控、日志收集和健康检查能力：
 * - 场景级日志：每个场景拥有独立日志通道
 * - 健康检查：定期或按需检查场景健康状态
 * - 性能指标：追踪场景激活耗时、工具执行耗时等
 * - 事件追踪：记录场景生命周期事件
 * - 错误收集：集中收集场景运行错误
 */

import type {
  ScenarioHealthReport,
  ScenarioHealthCheck,
  ScenarioLifecycleState,
  ScenarioLogger,
  ScenarioHealthReporter,
} from '@shared/types/scenario-arch'
import { logger } from '@shared/utils/Logger'

interface ScenarioMetrics {
  activationCount: number
  deactivationCount: number
  totalActiveTime: number
  lastActivationDuration?: number
  toolExecutionCount: number
  toolExecutionTotalTime: number
  toolErrorCount: number
  ipcCallCount: number
  ipcErrorCount: number
  errorCount: number
  lastError?: string
  lastErrorAt?: number
}

interface ScenarioLogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  scenarioId: string
  message: string
  args: unknown[]
}

interface ScenarioEventEntry {
  timestamp: number
  scenarioId: string
  event: string
  details?: Record<string, unknown>
}

const MAX_LOG_ENTRIES = 500
const MAX_EVENT_ENTRIES = 200

class ScenarioMonitorClass {
  private metrics = new Map<string, ScenarioMetrics>()
  private healthChecks = new Map<string, ScenarioHealthCheck[]>()
  private logs: ScenarioLogEntry[] = []
  private events: ScenarioEventEntry[] = []
  private activationTimestamps = new Map<string, number>()

  createLogger(scenarioId: string): ScenarioLogger {
    return {
      info: (message: string, ...args: unknown[]) =>
        this.addLog(scenarioId, 'info', message, args),
      warn: (message: string, ...args: unknown[]) =>
        this.addLog(scenarioId, 'warn', message, args),
      error: (message: string, ...args: unknown[]) =>
        this.addLog(scenarioId, 'error', message, args),
      debug: (message: string, ...args: unknown[]) =>
        this.addLog(scenarioId, 'debug', message, args),
    }
  }

  createHealthReporter(scenarioId: string): ScenarioHealthReporter {
    return {
      reportCheck: (name: string, status: 'healthy' | 'degraded' | 'unhealthy', message?: string) => {
        this.addHealthCheck(scenarioId, { name, status, message })
      },
      reportError: (error: string) => {
        this.recordError(scenarioId, error)
      },
    }
  }

  recordStateChange(scenarioId: string, newState: ScenarioLifecycleState): void {
    const metrics = this.getOrCreateMetrics(scenarioId)

    switch (newState) {
      case 'activated': {
        metrics.activationCount++
        this.activationTimestamps.set(scenarioId, Date.now())
        this.addEvent(scenarioId, 'activated')
        break
      }
      case 'deactivated': {
        metrics.deactivationCount++
        const startTs = this.activationTimestamps.get(scenarioId)
        if (startTs) {
          const duration = Date.now() - startTs
          metrics.totalActiveTime += duration
          metrics.lastActivationDuration = duration
          this.activationTimestamps.delete(scenarioId)
        }
        this.addEvent(scenarioId, 'deactivated')
        break
      }
      case 'error': {
        this.addEvent(scenarioId, 'error')
        break
      }
    }
  }

  recordToolExecution(scenarioId: string, _toolName: string, duration: number, success: boolean): void {
    const metrics = this.getOrCreateMetrics(scenarioId)
    metrics.toolExecutionCount++
    metrics.toolExecutionTotalTime += duration
    if (!success) {
      metrics.toolErrorCount++
    }
  }

  recordIpcCall(scenarioId: string, channel: string, success: boolean): void {
    const metrics = this.getOrCreateMetrics(scenarioId)
    metrics.ipcCallCount++
    if (!success) {
      metrics.ipcErrorCount++
    }
  }

  recordError(scenarioId: string, error: string): void {
    const metrics = this.getOrCreateMetrics(scenarioId)
    metrics.errorCount++
    metrics.lastError = error
    metrics.lastErrorAt = Date.now()
  }

  getHealthReport(
    scenarioId: string,
    state: ScenarioLifecycleState,
    toolCount: number,
    ipcHandlerCount: number,
    componentCount: number,
    customChecks?: ScenarioHealthCheck[]
  ): ScenarioHealthReport {
    const metrics = this.getOrCreateMetrics(scenarioId)
    const checks = [...(this.healthChecks.get(scenarioId) || []), ...(customChecks || [])]
    const startTs = this.activationTimestamps.get(scenarioId)

    return {
      scenarioId,
      status: state,
      uptime: startTs ? Date.now() - startTs : undefined,
      lastError: metrics.lastError,
      lastActivatedAt: startTs || undefined,
      toolCount,
      ipcHandlerCount,
      componentCount,
      checks,
    }
  }

  getMetrics(scenarioId: string): ScenarioMetrics | undefined {
    return this.metrics.get(scenarioId)
  }

  getLogs(scenarioId?: string, level?: string, limit: number = 50): ScenarioLogEntry[] {
    let filtered = this.logs
    if (scenarioId) {
      filtered = filtered.filter(l => l.scenarioId === scenarioId)
    }
    if (level) {
      filtered = filtered.filter(l => l.level === level)
    }
    return filtered.slice(-limit)
  }

  getEvents(scenarioId?: string, limit: number = 50): ScenarioEventEntry[] {
    let filtered = this.events
    if (scenarioId) {
      filtered = filtered.filter(e => e.scenarioId === scenarioId)
    }
    return filtered.slice(-limit)
  }

  cleanupScenario(scenarioId: string): void {
    this.metrics.delete(scenarioId)
    this.healthChecks.delete(scenarioId)
    this.activationTimestamps.delete(scenarioId)
    logger.agent.info(`[ScenarioMonitor] Cleaned up monitoring for "${scenarioId}"`)
  }

  private getOrCreateMetrics(scenarioId: string): ScenarioMetrics {
    let metrics = this.metrics.get(scenarioId)
    if (!metrics) {
      metrics = {
        activationCount: 0,
        deactivationCount: 0,
        totalActiveTime: 0,
        toolExecutionCount: 0,
        toolExecutionTotalTime: 0,
        toolErrorCount: 0,
        ipcCallCount: 0,
        ipcErrorCount: 0,
        errorCount: 0,
      }
      this.metrics.set(scenarioId, metrics)
    }
    return metrics
  }

  private addLog(scenarioId: string, level: ScenarioLogEntry['level'], message: string, args: unknown[]): void {
    this.logs.push({
      timestamp: Date.now(),
      level,
      scenarioId,
      message,
      args,
    })
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.shift()
    }

    const prefix = `[Scenario:${scenarioId}]`
    switch (level) {
      case 'error':
        logger.agent.error(`${prefix} ${message}`, ...args)
        break
      case 'warn':
        logger.agent.warn(`${prefix} ${message}`, ...args)
        break
      case 'debug':
        logger.agent.debug?.(`${prefix} ${message}`, ...args)
        break
      default:
        logger.agent.info(`${prefix} ${message}`, ...args)
    }
  }

  private addHealthCheck(scenarioId: string, check: ScenarioHealthCheck): void {
    let checks = this.healthChecks.get(scenarioId)
    if (!checks) {
      checks = []
      this.healthChecks.set(scenarioId, checks)
    }
    const existing = checks.findIndex(c => c.name === check.name)
    if (existing >= 0) {
      checks[existing] = check
    } else {
      checks.push(check)
    }
  }

  private addEvent(scenarioId: string, event: string, details?: Record<string, unknown>): void {
    this.events.push({
      timestamp: Date.now(),
      scenarioId,
      event,
      details,
    })
    if (this.events.length > MAX_EVENT_ENTRIES) {
      this.events.shift()
    }
  }
}

export const scenarioMonitor = new ScenarioMonitorClass()
