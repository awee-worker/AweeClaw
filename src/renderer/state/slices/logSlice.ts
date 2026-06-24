/**
 * 工具调用日志与性能洞察状态切片
 *
 * 维护工具调用日志环形缓冲，并提供按工具聚合的统计与洞察。
 */

import { StateCreator } from 'zustand'

/** 日志环形缓冲容量 */
const LOG_CAPACITY = 200

/** 慢工具阈值（毫秒） */
const SLOW_TOOL_THRESHOLD_MS = 3000

/** 慢工具最低调用次数 */
const SLOW_TOOL_MIN_CALLS = 2

/** 高失败率阈值（成功率低于此值视为异常） */
const HIGH_FAILURE_THRESHOLD = 0.7

/** 高失败率最低调用次数 */
const HIGH_FAILURE_MIN_CALLS = 3

/** 高频工具阈值（调用次数） */
const FREQUENT_TOOL_THRESHOLD = 20

/** 严重级别排序权重 */
const SEVERITY_WEIGHT: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/* ------------------------------------------------------------------ */
/* 类型                                                              */
/* ------------------------------------------------------------------ */

/** 工具调用日志条目 */
export interface ToolCallLogEntry {
  id: string
  timestamp: Date
  threadId?: string
  type: 'request' | 'response'
  toolName: string
  data: unknown
  duration?: number
  success?: boolean
  error?: string
}

/** 工具聚合统计 */
export interface ToolStats {
  toolName: string
  totalCalls: number
  successCalls: number
  failedCalls: number
  successRate: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  totalDuration: number
}

/** 洞察严重级别 */
type InsightSeverity = 'info' | 'warning' | 'critical'

/** 洞察类型 */
type InsightKind = 'slow_tool' | 'high_failure' | 'frequent_tool'

/** 性能洞察 */
export interface PerformanceInsight {
  type: InsightKind
  severity: InsightSeverity
  toolName: string
  message: string
  messageZh: string
  value: number
}

/** 切片接口 */
export interface LogSlice {
  toolCallLogs: ToolCallLogEntry[]
  addToolCallLog: (entry: Omit<ToolCallLogEntry, 'id' | 'timestamp'>) => void
  clearToolCallLogs: (threadId?: string) => void
  getToolStats: (threadId?: string) => ToolStats[]
  getPerformanceInsights: (threadId?: string) => PerformanceInsight[]
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                          */
/* ------------------------------------------------------------------ */

/** 生成日志唯一标识 */
function generateLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 按工具名分组 */
function groupByTool(logs: ToolCallLogEntry[]): Map<string, ToolCallLogEntry[]> {
  const groups = new Map<string, ToolCallLogEntry[]>()
  for (const log of logs) {
    const list = groups.get(log.toolName)
    if (list) list.push(log)
    else groups.set(log.toolName, [log])
  }
  return groups
}

/** 计算单个工具的统计 */
function computeStats(toolName: string, entries: ToolCallLogEntry[]): ToolStats {
  const successEntries = entries.filter((e) => e.success !== false)
  const durations = entries.filter((e) => e.duration != null).map((e) => e.duration as number)
  const totalDuration = durations.reduce((sum, d) => sum + d, 0)

  return {
    toolName,
    totalCalls: entries.length,
    successCalls: successEntries.length,
    failedCalls: entries.length - successEntries.length,
    successRate: entries.length > 0 ? successEntries.length / entries.length : 0,
    avgDuration: durations.length > 0 ? totalDuration / durations.length : 0,
    minDuration: durations.length > 0 ? Math.min(...durations) : 0,
    maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
    totalDuration,
  }
}

/** 根据统计生成洞察 */
function deriveInsights(stat: ToolStats): PerformanceInsight[] {
  const insights: PerformanceInsight[] = []

  if (stat.avgDuration > SLOW_TOOL_THRESHOLD_MS && stat.totalCalls >= SLOW_TOOL_MIN_CALLS) {
    const rounded = Math.round(stat.avgDuration)
    insights.push({
      type: 'slow_tool',
      severity: stat.avgDuration > 8000 ? 'critical' : 'warning',
      toolName: stat.toolName,
      message: `Avg ${rounded}ms`,
      messageZh: `平均 ${rounded}ms`,
      value: stat.avgDuration,
    })
  }

  if (stat.successRate < HIGH_FAILURE_THRESHOLD && stat.totalCalls >= HIGH_FAILURE_MIN_CALLS) {
    const failureRate = 1 - stat.successRate
    const percent = Math.round(failureRate * 100)
    insights.push({
      type: 'high_failure',
      severity: stat.successRate < 0.4 ? 'critical' : 'warning',
      toolName: stat.toolName,
      message: `${percent}% failed`,
      messageZh: `${percent}% 失败`,
      value: failureRate,
    })
  }

  if (stat.totalCalls >= FREQUENT_TOOL_THRESHOLD) {
    insights.push({
      type: 'frequent_tool',
      severity: 'info',
      toolName: stat.toolName,
      message: `${stat.totalCalls} calls`,
      messageZh: `${stat.totalCalls} 次调用`,
      value: stat.totalCalls,
    })
  }

  return insights
}

/* ------------------------------------------------------------------ */
/* 切片实现                                                          */
/* ------------------------------------------------------------------ */

export const createLogSlice: StateCreator<LogSlice> = (set, get) => ({
  toolCallLogs: [],

  addToolCallLog: (entry) =>
    set((state) => {
      const newEntry: ToolCallLogEntry = {
        ...entry,
        id: generateLogId(),
        timestamp: new Date(),
      }
      // 环形缓冲：新日志插入头部，超出容量截断
      return { toolCallLogs: [newEntry, ...state.toolCallLogs].slice(0, LOG_CAPACITY) }
    }),

  clearToolCallLogs: (threadId) =>
    set((state) => ({
      toolCallLogs: threadId
        ? state.toolCallLogs.filter((log) => log.threadId !== threadId)
        : [],
    })),

  getToolStats: (threadId) => {
    const allLogs = get().toolCallLogs
    const logs = threadId ? allLogs.filter((l) => l.threadId === threadId) : allLogs
    const responseLogs = logs.filter((l) => l.type === 'response')

    const stats: ToolStats[] = []
    for (const [name, entries] of groupByTool(responseLogs)) {
      stats.push(computeStats(name, entries))
    }
    return stats.sort((a, b) => b.totalCalls - a.totalCalls)
  },

  getPerformanceInsights: (threadId) => {
    const stats = get().getToolStats(threadId)
    const insights: PerformanceInsight[] = []

    for (const stat of stats) {
      insights.push(...deriveInsights(stat))
    }

    return insights.sort((a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity])
  },
})
