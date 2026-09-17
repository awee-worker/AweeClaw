/**
 * VMC 协议管理器
 *
 * 负责协调 VMC 模块的各个组件：
 * - 配置管理
 * - 出站发送
 * - 入站接收
 * - 骨骼映射
 * - 状态监控
 * - 生命周期管理
 *
 * 核心职责：
 * 1. 初始化和销毁所有子模块
 * 2. 处理入站数据并驱动 VRM 模型
 * 3. 处理出站数据并发送到外部应用
 * 4. 管理待机动画的暂停和恢复
 * 5. 提供状态查询接口
 *
 * @module vmc/VmcManager
 */

import { BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { getVmcStore, type VmcConfig } from './VmcStore'
import { getVmcSender, type VmcSenderState } from './VmcSender'
import { getVmcReceiver, type VmcReceiverState } from './VmcReceiver'
import { getVmcMapper } from './VmcMapper'
import type { VmcBoneData, VmcBlendData } from './VmcCodec'

// ============================================
// 类型定义
// ============================================

/** VMC 管理器状态 */
export interface VmcManagerState {
  /** 模块是否初始化 */
  initialized: boolean
  /** 模块是否启用 */
  enabled: boolean
  /** 出站是否运行 */
  senderActive: boolean
  /** 入站是否运行 */
  receiverActive: boolean
  /** 最后入站数据时间 */
  lastIncomingData: number
  /** 统计信息 */
  stats: {
    sentFrames: number
    receivedFrames: number
    errors: number
  }
}

/** VMC 帧数据（用于 IPC 传输） */
export interface VmcFramePayload {
  bones: VmcBoneData[]
  blends: VmcBlendData[]
}

// ============================================
// 管理器类
// ============================================

class VmcManager {
  private initialized = false
  private idleAnimationPaused = false
  private idleAnimationTimer: ReturnType<typeof setTimeout> | null = null

  /** 初始化 VMC 模块 */
  init(): void {
    if (this.initialized) {
      logger.system.warn('[VmcManager] Already initialized')
      return
    }

    try {
      const store = getVmcStore()
      store.init()

      const sender = getVmcSender()
      sender.init()

      const receiver = getVmcReceiver()
      receiver.init()

      // 设置接收器事件回调
      receiver.setEvents({
        onBoneData: (bone) => this.handleIncomingBone(bone),
        onBlendData: (blend) => this.handleIncomingBlend(blend),
        onFrameReceived: (frameCount) => this.handleFrameReceived(frameCount),
        onError: (error) => this.handleReceiverError(error),
        onBlocked: (ip) => this.handleBlockedIp(ip),
      })

      this.initialized = true
      logger.system.info('[VmcManager] Initialized')

      // 检查是否需要自动启动
      const config = store.getConfig()
      if (config.enabled) {
        this.startFromConfig(config)
      }
    } catch (err) {
      logger.system.error('[VmcManager] Init failed:', err)
    }
  }

  /** 根据配置启动 */
  private startFromConfig(config: VmcConfig): void {
    if (config.send.enabled) {
      this.startSender(config.send)
    }
    if (config.receive.enabled) {
      this.startReceiver(config.receive)
    }
  }

  /** 启动出站发送 */
  startSender(config: VmcConfig['send']): boolean {
    const sender = getVmcSender()
    const success = sender.start(config)
    
    if (success) {
      this.notifyRenderer('vmc-state-changed', this.getState())
    }
    
    return success
  }

  /** 停止出站发送 */
  stopSender(): void {
    const sender = getVmcSender()
    sender.stop()
    this.notifyRenderer('vmc-state-changed', this.getState())
  }

  /** 启动入站接收 */
  startReceiver(config: VmcConfig['receive']): boolean {
    const receiver = getVmcReceiver()
    const success = receiver.start(config)
    
    if (success) {
      this.notifyRenderer('vmc-state-changed', this.getState())
    }
    
    return success
  }

  /** 停止入站接收 */
  stopReceiver(): void {
    const receiver = getVmcReceiver()
    receiver.stop()
    this.notifyRenderer('vmc-state-changed', this.getState())
  }

  /** 发送 VMC 帧数据 */
  sendFrame(frameData: VmcFramePayload): boolean {
    const sender = getVmcSender()
    const mapper = getVmcMapper()

    // 映射骨骼名称
    const mappedBones = frameData.bones.map(bone => {
      const result = mapper.mapBoneData(bone)
      return result.data
    })

    // 映射表情名称
    const mappedBlends = frameData.blends.map(blend => {
      const result = mapper.mapBlendData(blend)
      return result.data
    })

    return sender.sendFrame({
      bones: mappedBones,
      blends: mappedBlends,
      timestamp: Date.now() / 1000,
    })
  }

  /** 发送单个骨骼数据 */
  sendBone(boneName: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }): boolean {
    const sender = getVmcSender()
    const mapper = getVmcMapper()

    const mappedName = mapper.mapBoneName(boneName)
    return sender.sendBone(mappedName, position, rotation)
  }

  /** 发送单个表情数据 */
  sendBlend(blendName: string, weight: number): boolean {
    const sender = getVmcSender()
    const mapper = getVmcMapper()

    const mappedName = mapper.mapBlendName(blendName)
    return sender.sendBlend(mappedName, weight)
  }

  /** 处理入站骨骼数据 */
  private handleIncomingBone(bone: VmcBoneData): void {
    // 更新最后接收时间
    const store = getVmcStore()
    store.updateState({ lastIncomingData: Date.now() })

    // 暂停待机动画
    this.pauseIdleAnimation()

    // 发送到渲染进程驱动 VRM 模型
    this.notifyRenderer('vmc-bone', bone)
  }

  /** 处理入站表情数据 */
  private handleIncomingBlend(blend: VmcBlendData): void {
    // 检查是否同步表情
    const store = getVmcStore()
    const config = store.getConfig()
    
    if (!config.receive.syncExpression) {
      return
    }

    // 发送到渲染进程驱动 VRM 模型
    this.notifyRenderer('vmc-blend', blend)
  }

  /** 处理帧接收 */
  private handleFrameReceived(frameCount: number): void {
    // 定期通知渲染进程（每 10 帧）
    if (frameCount % 10 === 0) {
      this.notifyRenderer('vmc-state-changed', this.getState())
    }
  }

  /** 处理接收器错误 */
  private handleReceiverError(error: Error): void {
    logger.system.error('[VmcManager] Receiver error:', error)
    this.notifyRenderer('vmc-error', { message: error.message })
  }

  /** 处理被阻止的 IP */
  private handleBlockedIp(ip: string): void {
    logger.system.warn('[VmcManager] Blocked IP:', ip)
    this.notifyRenderer('vmc-blocked', { ip })
  }

  /** 暂停待机动画 */
  private pauseIdleAnimation(): void {
    if (this.idleAnimationPaused) {
      // 已经暂停，重置定时器
      this.resetIdleAnimationTimer()
      return
    }

    this.idleAnimationPaused = true
    this.notifyRenderer('vmc-idle-paused', { paused: true })
    this.resetIdleAnimationTimer()
  }

  /** 恢复待机动画 */
  private resumeIdleAnimation(): void {
    if (!this.idleAnimationPaused) {
      return
    }

    this.idleAnimationPaused = false
    this.idleAnimationTimer = null
    this.notifyRenderer('vmc-idle-paused', { paused: false })
  }

  /** 重置待机动画定时器 */
  private resetIdleAnimationTimer(): void {
    if (this.idleAnimationTimer) {
      clearTimeout(this.idleAnimationTimer)
    }

    // 2 秒无数据后恢复待机动画
    this.idleAnimationTimer = setTimeout(() => {
      this.resumeIdleAnimation()
    }, 2000)
  }

  /** 通知渲染进程 */
  private notifyRenderer(channel: string, data: any): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }

  /** 获取配置 */
  getConfig(): VmcConfig {
    const store = getVmcStore()
    return store.getConfig()
  }

  /** 更新配置 */
  updateConfig(update: Partial<VmcConfig>): VmcConfig {
    const store = getVmcStore()
    const newConfig = store.updateConfig(update)

    // 根据新配置启停模块
    this.applyConfig(newConfig)

    // 通知渲染进程
    this.notifyRenderer('vmc-config-changed', newConfig)

    return newConfig
  }

  /** 应用配置 */
  private applyConfig(config: VmcConfig): void {
    // 出站
    if (config.send.enabled) {
      this.startSender(config.send)
    } else {
      this.stopSender()
    }

    // 入站
    if (config.receive.enabled) {
      this.startReceiver(config.receive)
    } else {
      this.stopReceiver()
    }
  }

  /** 获取状态 */
  getState(): VmcManagerState {
    const store = getVmcStore()
    const senderState = getVmcSender().getState()
    const receiverState = getVmcReceiver().getState()

    return {
      initialized: this.initialized,
      enabled: store.getConfig().enabled,
      senderActive: senderState.active,
      receiverActive: receiverState.active,
      lastIncomingData: receiverState.lastReceiveTime,
      stats: {
        sentFrames: senderState.sentFrames,
        receivedFrames: receiverState.receivedFrames,
        errors: senderState.errors + receiverState.errors,
      },
    }
  }

  /** 获取发送器状态 */
  getSenderState(): VmcSenderState {
    return getVmcSender().getState()
  }

  /** 获取接收器状态 */
  getReceiverState(): VmcReceiverState {
    return getVmcReceiver().getState()
  }

  /** 获取未映射的骨骼名 */
  getUnmappedBones(): string[] {
    return getVmcMapper().getUnmappedBones()
  }

  /** 获取未映射的表情名 */
  getUnmappedBlends(): string[] {
    return getVmcMapper().getUnmappedBlends()
  }

  /** 重置统计信息 */
  resetStats(): void {
    getVmcSender().resetStats()
    getVmcReceiver().resetStats()
    getVmcMapper().clearUnmappedRecords()
  }

  /** 销毁 VMC 模块 */
  destroy(): void {
    this.stopSender()
    this.stopReceiver()
    this.resumeIdleAnimation()

    if (this.idleAnimationTimer) {
      clearTimeout(this.idleAnimationTimer)
      this.idleAnimationTimer = null
    }

    getVmcSender().destroy()
    getVmcReceiver().destroy()

    this.initialized = false
    logger.system.info('[VmcManager] Destroyed')
  }
}

// 单例
let instance: VmcManager | null = null

/** 获取 VmcManager 单例 */
export function getVmcManager(): VmcManager {
  if (!instance) {
    instance = new VmcManager()
  }
  return instance
}