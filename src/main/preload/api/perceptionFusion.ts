/**
 * 多模态融合感知 Preload API（阶段9 s9-05 新增）
 *
 * 暴露 PerceptionFusionService 的 IPC 调用到渲染进程。
 * 渲染进程通过 window.electronAPI.perceptionFusion.* 调用。
 *
 * @module preload/api/perceptionFusion
 */

import { ipcRenderer } from 'electron'

/** 统一的 IPC 响应格式 */
export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 融合通道名称 */
export type FusionChannelName = 'scene' | 'iot' | 'causal' | 'monitoring'

/** 单通道摘要 */
export interface ChannelSummary {
  name: FusionChannelName
  running: boolean
  lastUpdateAt: number | null
  anomalyCount: number
  summary: string
  stale: boolean
  data?: unknown
}

/** 跨通道洞察 */
export interface CrossChannelInsight {
  type:
    | 'high_load_during_coding'
    | 'sensor_anomaly_correlation'
    | 'causal_inquiry_spike'
    | 'monitoring_anomaly_burst'
    | 'iot_disconnected'
    | 'all_quiet'
  description: string
  severity: 'info' | 'warning' | 'critical'
  channels: FusionChannelName[]
}

/** 场景通道数据 */
export interface SceneChannelData {
  latestScene: {
    id: string
    timestamp: number
    app: string
    windowTitle: string
    activity: string
    textSummary: string
  } | null
  totalScenes: number
}

/** IoT 通道数据 */
export interface IoTChannelData {
  bridgeRunning: boolean
  totalProviders: number
  connectedProviders: number
  totalEntities: number
  recentAnomalyCount: number
  recentAnomalies: Array<{
    type: string
    severity: string
    description: string
    externalId: string
    timestamp: number
  }>
  recentEntities: Array<{
    externalId: string
    entityType: string
    state: string | number | boolean | null
    unit?: string
  }>
}

/** 因果通道数据 */
export interface CausalChannelData {
  enabled: boolean
  nodeCount: number
  edgeCount: number
  density: number
  recentQueryCount: number
  recentQueries: Array<{
    queryType: string
    success: boolean
    timestamp: number
  }>
}

/** 监控通道数据 */
export interface MonitoringChannelData {
  running: boolean
  activeAnomalyCount: number
  recentAnomalies: Array<{
    type: string
    severity: string
    description: string
    timestamp: number
  }>
  systemMetrics: {
    cpuUsage: number | null
    memoryUsage: number | null
    diskUsage: number | null
  } | null
}

/** 统一环境上下文 */
export interface EnvironmentContext {
  timestamp: number
  channels: ChannelSummary[]
  totalAnomalyCount: number
  attentionScore: number
  insights: CrossChannelInsight[]
  staleChannels: FusionChannelName[]
  scene: SceneChannelData | null
  iot: IoTChannelData | null
  causal: CausalChannelData | null
  monitoring: MonitoringChannelData | null
}

/** 融合感知 API 接口 */
export interface PerceptionFusionApi {
  /** 获取当前环境上下文（4 通道融合） */
  getEnvironmentContext: () => Promise<IpcResponse<EnvironmentContext>>
  /** 获取融合历史（最近 N 次） */
  getFusionHistory: (limit?: number) => Promise<IpcResponse<EnvironmentContext[]>>
  /** 获取最近一次融合结果（从缓存读取，无 IO 开销） */
  getLastContext: () => Promise<IpcResponse<EnvironmentContext | null>>
  /** 清空融合历史 */
  clearHistory: () => Promise<IpcResponse<void>>
}

/** 创建融合感知 API */
export function createPerceptionFusionApi(): PerceptionFusionApi {
  return {
    getEnvironmentContext: () =>
      ipcRenderer.invoke('perceptionFusion:getEnvironmentContext'),
    getFusionHistory: (limit = 20) =>
      ipcRenderer.invoke('perceptionFusion:getFusionHistory', limit),
    getLastContext: () =>
      ipcRenderer.invoke('perceptionFusion:getLastContext'),
    clearHistory: () =>
      ipcRenderer.invoke('perceptionFusion:clearHistory'),
  }
}
