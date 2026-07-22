/**
 * Monitoring API — 监控层 IPC 桥接
 *
 * 将主进程的 MonitoringService 能力暴露给渲染进程。
 * 渲染进程通过 window.electronAPI.monitoring.* 调用。
 *
 * 阶段3 接口：
 * - 配置管理：getConfig / updateConfig
 * - 状态查询：isRunning / getLatestMetrics / getMetricsByTimeRange
 * - 异常查询：getActiveAnomalies / getRecentAnomalies / getAnomaliesByTimeRange
 * - 异常管理：acknowledgeAnomaly / resolveAnomaly
 * - 事件订阅：subscribe（通过 ipcRenderer.on 接收推送）
 * - 诊断：getDetectorStats / clearAllData
 */

import { ipcRenderer, type IpcRendererEvent } from 'electron'

/** 统一的 IPC 响应格式 */
export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 系统指标类型 */
export interface SystemMetrics {
  timestamp: number
  cpuUsage: number
  cpuLoadAvg1: number
  cpuLoadAvg5: number
  cpuLoadAvg15: number
  memoryUsage: number
  memoryAvailableMB: number
  memoryTotalMB: number
  diskUsage: number
  diskIoReadKBps: number
  diskIoWriteKBps: number
  networkRxKBps: number
  networkTxKBps: number
  processCount: number
  cpuTemperature: number
  batteryPercent: number
  batteryCharging: boolean
}

/** 异常类型 */
export type AnomalyType =
  | 'high_cpu'
  | 'high_memory'
  | 'memory_leak'
  | 'disk_full'
  | 'disk_io_high'
  | 'network_anomaly'
  | 'process_explosion'
  | 'high_temperature'
  | 'low_battery'
  | 'unknown'

/** 异常严重度 */
export type AnomalySeverity = 'info' | 'warning' | 'critical'

/** 异常事件 */
export interface AnomalyEvent {
  id: string
  timestamp: number
  type: AnomalyType
  severity: AnomalySeverity
  metricType: string
  currentValue: number
  predictedPeak?: number
  predictedTriggerAt?: number
  description: string
  recommendation: string
  status: 'active' | 'resolved' | 'acknowledged'
  evidenceWindow: {
    start: number
    end: number
  }
  samples?: Array<{ timestamp: number; value: number }>
}

/** 监控配置 */
export interface MonitoringConfig {
  enabled: boolean
  sampleIntervalSec: number
  retentionDays: number
  anomalyDetectionEnabled: boolean
  predictiveAlertEnabled: boolean
  predictiveWindowMin: number
  thresholds: {
    cpuWarning: number
    cpuCritical: number
    memoryWarning: number
    memoryCritical: number
    diskWarning: number
    diskCritical: number
    temperatureWarning: number
    temperatureCritical: number
    batteryLow: number
    processExplosion: number
  }
  notificationsEnabled: boolean
  cloudReportingEnabled: boolean
}

/** 检测器统计 */
export interface DetectorStats {
  forestTrained: boolean
  forestTreeCount: number
  trainingSampleCount: number
  lastTrainedAt: number
  activeAnomalyCount: number
}

/** 监控层 API 接口 */
export interface MonitoringApi {
  // ===== 配置 =====
  /** 获取监控配置 */
  getConfig: () => Promise<IpcResponse<MonitoringConfig>>
  /** 更新监控配置 */
  updateConfig: (config: Partial<MonitoringConfig>) => Promise<IpcResponse<MonitoringConfig>>

  // ===== 状态查询 =====
  /** 监控服务是否运行中 */
  isRunning: () => Promise<IpcResponse<boolean>>
  /** 获取最新指标采样 */
  getLatestMetrics: () => Promise<IpcResponse<SystemMetrics | null>>
  /** 获取指定时间范围内的指标采样 */
  getMetricsByTimeRange: (
    startTime: number,
    endTime: number,
    limit?: number,
  ) => Promise<IpcResponse<SystemMetrics[]>>

  // ===== 异常查询 =====
  /** 获取所有 active 异常 */
  getActiveAnomalies: () => Promise<IpcResponse<AnomalyEvent[]>>
  /** 获取最近的异常事件 */
  getRecentAnomalies: (limit?: number) => Promise<IpcResponse<AnomalyEvent[]>>
  /** 获取指定时间范围内的异常事件 */
  getAnomaliesByTimeRange: (
    startTime: number,
    endTime: number,
    limit?: number,
  ) => Promise<IpcResponse<AnomalyEvent[]>>

  // ===== 异常管理 =====
  /** 确认异常（用户点击"已知晓"） */
  acknowledgeAnomaly: (anomalyId: string) => Promise<IpcResponse<boolean>>
  /** 标记异常为已解决 */
  resolveAnomaly: (anomalyId: string) => Promise<IpcResponse<boolean>>

  // ===== 事件订阅 =====
  /** 订阅异常事件推送 */
  subscribe: () => Promise<IpcResponse<boolean>>
  /** 监听主进程推送的异常事件 */
  onAnomalyEvent: (callback: (event: AnomalyEvent) => void) => () => void

  // ===== 诊断 =====
  /** 获取检测器统计 */
  getDetectorStats: () => Promise<IpcResponse<DetectorStats>>
  /** 清空所有数据 */
  clearAllData: () => Promise<IpcResponse<boolean>>
}

/** 创建监控层 API */
export function createMonitoringApi(): MonitoringApi {
  return {
    // ===== 配置 =====
    getConfig: () => ipcRenderer.invoke('monitoring:getConfig'),

    updateConfig: (config) => ipcRenderer.invoke('monitoring:updateConfig', config),

    // ===== 状态查询 =====
    isRunning: () => ipcRenderer.invoke('monitoring:isRunning'),

    getLatestMetrics: () => ipcRenderer.invoke('monitoring:getLatestMetrics'),

    getMetricsByTimeRange: (startTime, endTime, limit = 1000) =>
      ipcRenderer.invoke('monitoring:getMetricsByTimeRange', startTime, endTime, limit),

    // ===== 异常查询 =====
    getActiveAnomalies: () => ipcRenderer.invoke('monitoring:getActiveAnomalies'),

    getRecentAnomalies: (limit = 20) =>
      ipcRenderer.invoke('monitoring:getRecentAnomalies', limit),

    getAnomaliesByTimeRange: (startTime, endTime, limit = 100) =>
      ipcRenderer.invoke('monitoring:getAnomaliesByTimeRange', startTime, endTime, limit),

    // ===== 异常管理 =====
    acknowledgeAnomaly: (anomalyId) =>
      ipcRenderer.invoke('monitoring:acknowledgeAnomaly', anomalyId),

    resolveAnomaly: (anomalyId) =>
      ipcRenderer.invoke('monitoring:resolveAnomaly', anomalyId),

    // ===== 事件订阅 =====
    subscribe: () => ipcRenderer.invoke('monitoring:subscribe'),

    onAnomalyEvent: (callback) => {
      const handler = (_event: IpcRendererEvent, anomaly: AnomalyEvent) => {
        callback(anomaly)
      }
      ipcRenderer.on('monitoring:anomalyEvent', handler)
      return () => {
        ipcRenderer.removeListener('monitoring:anomalyEvent', handler)
      }
    },

    // ===== 诊断 =====
    getDetectorStats: () => ipcRenderer.invoke('monitoring:getDetectorStats'),

    clearAllData: () => ipcRenderer.invoke('monitoring:clearAllData'),
  }
}
