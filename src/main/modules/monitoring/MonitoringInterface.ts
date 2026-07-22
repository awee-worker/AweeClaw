/**
 * 系统指标类型定义
 *
 * 定义监控层（阶段 3）的所有数据结构：
 * - SystemMetrics：单次采样的系统指标快照
 * - MetricType / MetricSeverity：指标分类与严重度
 * - AnomalyEvent：异常告警事件
 * - MonitoringConfig：监控配置
 *
 * @module monitoring/MonitoringInterface
 */

// ============================================================
// 系统指标
// ============================================================

/** 系统指标类型 */
export type MetricType =
  | 'cpu_usage'         // CPU 使用率（%）
  | 'cpu_load_avg'      // CPU 负载均值（1/5/15 分钟）
  | 'memory_usage'      // 内存使用率（%）
  | 'memory_available'  // 可用内存（MB）
  | 'disk_usage'        // 磁盘使用率（%）
  | 'disk_io_read'      // 磁盘读速率（KB/s）
  | 'disk_io_write'     // 磁盘写速率（KB/s）
  | 'network_rx'        // 网络下行速率（KB/s）
  | 'network_tx'        // 网络上行速率（KB/s）
  | 'process_count'     // 进程数
  | 'temperature'       // CPU 温度（℃，可选）
  | 'battery'           // 电池电量（%，可选）

/** 指标严重度等级 */
export type MetricSeverity = 'normal' | 'warning' | 'critical' | 'unknown'

/** 单次系统指标采样快照 */
export interface SystemMetrics {
  /** 采样时间戳（ms） */
  timestamp: number
  /** CPU 使用率（0-100） */
  cpuUsage: number
  /** CPU 负载均值（1 分钟） */
  cpuLoadAvg1: number
  /** CPU 负载均值（5 分钟） */
  cpuLoadAvg5: number
  /** CPU 负载均值（15 分钟） */
  cpuLoadAvg15: number
  /** 内存使用率（0-100） */
  memoryUsage: number
  /** 可用内存（MB） */
  memoryAvailableMB: number
  /** 总内存（MB） */
  memoryTotalMB: number
  /** 系统盘使用率（0-100） */
  diskUsage: number
  /** 磁盘读速率（KB/s） */
  diskIoReadKBps: number
  /** 磁盘写速率（KB/s） */
  diskIoWriteKBps: number
  /** 网络下行速率（KB/s） */
  networkRxKBps: number
  /** 网络上行速率（KB/s） */
  networkTxKBps: number
  /** 进程数 */
  processCount: number
  /** CPU 温度（℃，获取失败为 -1） */
  cpuTemperature: number
  /** 电池电量（0-100，无电池为 -1） */
  batteryPercent: number
  /** 是否充电（无电池为 false） */
  batteryCharging: boolean
}

// ============================================================
// 异常事件
// ============================================================

/** 异常类型 */
export type AnomalyType =
  | 'high_cpu'          // CPU 持续高负载
  | 'high_memory'       // 内存使用过高
  | 'memory_leak'       // 内存泄漏（持续上升）
  | 'disk_full'         // 磁盘空间不足
  | 'disk_io_high'      // 磁盘 IO 异常高
  | 'network_anomaly'   // 网络流量异常
  | 'process_explosion' // 进程数激增
  | 'high_temperature'  // CPU 温度过高
  | 'low_battery'       // 电量过低
  | 'unknown'

/** 异常严重度 */
export type AnomalySeverity = 'info' | 'warning' | 'critical'

/** 异常告警事件 */
export interface AnomalyEvent {
  /** 事件唯一 ID */
  id: string
  /** 检测时间戳（ms） */
  timestamp: number
  /** 异常类型 */
  type: AnomalyType
  /** 严重度 */
  severity: AnomalySeverity
  /** 触发指标类型 */
  metricType: MetricType
  /** 当前指标值 */
  currentValue: number
  /** 预测峰值（如适用） */
  predictedPeak?: number
  /** 预计触发时间（ms，如适用，提前预警） */
  predictedTriggerAt?: number
  /** 异常描述（人类可读） */
  description: string
  /** 建议操作 */
  recommendation: string
  /** 状态 */
  status: 'active' | 'resolved' | 'acknowledged'
  /** 关联的指标采样时间范围 */
  evidenceWindow: {
    start: number
    end: number
  }
  /** 涉及的指标采样数据（精简版，用于复盘） */
  samples?: Array<{ timestamp: number; value: number }>
}

// ============================================================
// 监控配置
// ============================================================

/** 监控配置 */
export interface MonitoringConfig {
  /** 是否启用系统监控 */
  enabled: boolean
  /** 采样间隔（秒，默认 30） */
  sampleIntervalSec: number
  /** 数据保留期（天，默认 7） */
  retentionDays: number
  /** 是否启用异常检测 */
  anomalyDetectionEnabled: boolean
  /** 是否启用提前预警 */
  predictiveAlertEnabled: boolean
  /** 预测窗口（分钟，默认 60，即提前 1 小时预警） */
  predictiveWindowMin: number
  /** 阈值配置 */
  thresholds: {
    cpuWarning: number        // CPU 警告阈值（%，默认 80）
    cpuCritical: number       // CPU 严重阈值（%，默认 95）
    memoryWarning: number     // 内存警告阈值（%，默认 85）
    memoryCritical: number    // 内存严重阈值（%，默认 95）
    diskWarning: number       // 磁盘警告阈值（%，默认 85）
    diskCritical: number      // 磁盘严重阈值（%，默认 95）
    temperatureWarning: number // 温度警告阈值（℃，默认 80）
    temperatureCritical: number // 温度严重阈值（℃，默认 90）
    batteryLow: number        // 低电量阈值（%，默认 20）
    processExplosion: number  // 进程数激增阈值（默认 500）
  }
  /** 是否启用通知（toast + 桌面通知） */
  notificationsEnabled: boolean
  /** 是否上报到云端管理后台（默认 false，纯本地） */
  cloudReportingEnabled: boolean
}

/** 默认监控配置 */
export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  enabled: false,
  sampleIntervalSec: 30,
  retentionDays: 7,
  anomalyDetectionEnabled: true,
  predictiveAlertEnabled: true,
  predictiveWindowMin: 60,
  thresholds: {
    cpuWarning: 80,
    cpuCritical: 95,
    memoryWarning: 85,
    memoryCritical: 95,
    diskWarning: 85,
    diskCritical: 95,
    temperatureWarning: 80,
    temperatureCritical: 90,
    batteryLow: 20,
    processExplosion: 500,
  },
  notificationsEnabled: true,
  cloudReportingEnabled: false,
}
