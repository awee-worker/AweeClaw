/**
 * VMC 协议 API — preload 侧桥接
 *
 * 将主进程的 VMC 协议能力暴露给渲染进程，
 * 渲染进程通过 window.electronAPI.vmc.* 调用。
 *
 * 消费方：
 * - 设置面板 VmcSettings.tsx：配置管理、状态监控
 * - VRM 伴侣窗口：接收外部骨骼数据驱动模型
 *
 * 事件订阅返回取消订阅函数，调用方负责清理。
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'

/** 统一 IPC 返回包装 */
interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** VMC 配置 */
export interface VmcConfig {
  enabled: boolean
  send: {
    enabled: boolean
    host: string
    port: number
  }
  receive: {
    enabled: boolean
    port: number
    allowedIps: string[]
    syncExpression: boolean
  }
  heartbeat: {
    enabled: boolean
    intervalMs: number
  }
}

/** VMC 状态 */
export interface VmcState {
  initialized: boolean
  enabled: boolean
  senderActive: boolean
  receiverActive: boolean
  lastIncomingData: number
  stats: {
    sentFrames: number
    receivedFrames: number
    errors: number
  }
}

/** VMC 骨骼数据 */
export interface VmcBoneData {
  boneName: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
}

/** VMC 表情数据 */
export interface VmcBlendData {
  blendName: string
  weight: number
}

/** VMC 帧数据 */
export interface VmcFramePayload {
  bones: VmcBoneData[]
  blends: VmcBlendData[]
}

/**
 * 创建 VMC API
 */
export function createVmcApi() {
  return {
    // --------------------------------------------
    // 配置管理
    // --------------------------------------------
    /** 获取 VMC 配置 */
    getConfig: invoke<IpcResponse<VmcConfig>>('vmc:get-config'),
    /** 更新 VMC 配置 */
    updateConfig: (update: Partial<VmcConfig>) =>
      ipcRenderer.invoke('vmc:update-config', update) as Promise<IpcResponse<VmcConfig>>,
    /** 重置 VMC 配置为默认值 */
    resetConfig: invoke<IpcResponse<VmcConfig>>('vmc:reset-config'),

    // --------------------------------------------
    // 状态查询
    // --------------------------------------------
    /** 获取 VMC 状态 */
    getState: invoke<IpcResponse<VmcState>>('vmc:get-state'),
    /** 获取发送器状态 */
    getSenderState: invoke<IpcResponse<VmcState>>('vmc:get-sender-state'),
    /** 获取接收器状态 */
    getReceiverState: invoke<IpcResponse<VmcState>>('vmc:get-receiver-state'),

    // --------------------------------------------
    // 模块控制
    // --------------------------------------------
    /** 启动发送器 */
    startSender: invoke<IpcResponse<boolean>>('vmc:start-sender'),
    /** 停止发送器 */
    stopSender: invoke<IpcResponse<boolean>>('vmc:stop-sender'),
    /** 启动接收器 */
    startReceiver: invoke<IpcResponse<boolean>>('vmc:start-receiver'),
    /** 停止接收器 */
    stopReceiver: invoke<IpcResponse<boolean>>('vmc:stop-receiver'),

    // --------------------------------------------
    // 数据发送
    // --------------------------------------------
    /** 发送 VMC 帧数据 */
    sendFrame: (frameData: VmcFramePayload) =>
      ipcRenderer.invoke('vmc:send-frame', frameData) as Promise<IpcResponse<boolean>>,
    /** 发送单个骨骼数据 */
    sendBone: (boneName: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }) =>
      ipcRenderer.invoke('vmc:send-bone', boneName, position, rotation) as Promise<IpcResponse<boolean>>,
    /** 发送单个表情数据 */
    sendBlend: (blendName: string, weight: number) =>
      ipcRenderer.invoke('vmc:send-blend', blendName, weight) as Promise<IpcResponse<boolean>>,

    // --------------------------------------------
    // 映射信息
    // --------------------------------------------
    /** 获取未映射的骨骼名 */
    getUnmappedBones: invoke<IpcResponse<string[]>>('vmc:get-unmapped-bones'),
    /** 获取未映射的表情名 */
    getUnmappedBlends: invoke<IpcResponse<string[]>>('vmc:get-unmapped-blends'),

    // --------------------------------------------
    // 统计信息
    // --------------------------------------------
    /** 重置统计信息 */
    resetStats: invoke<IpcResponse<boolean>>('vmc:reset-stats'),

    // --------------------------------------------
    // 事件订阅
    // --------------------------------------------
    /** 订阅骨骼数据（外部入站） */
    onBoneData: on<VmcBoneData>('vmc-bone'),
    /** 订阅表情数据（外部入站） */
    onBlendData: on<VmcBlendData>('vmc-blend'),
    /** 订阅状态变化 */
    onStateChanged: on<VmcState>('vmc-state-changed'),
    /** 订阅配置变化 */
    onConfigChanged: on<VmcConfig>('vmc-config-changed'),
    /** 订阅待机动画暂停/恢复 */
    onIdlePaused: on<{ paused: boolean }>('vmc-idle-paused'),
    /** 订阅错误 */
    onError: on<{ message: string }>('vmc-error'),
    /** 订阅被阻止的 IP */
    onBlocked: on<{ ip: string }>('vmc-blocked'),
  }
}