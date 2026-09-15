/**
 * VMC 协议出站发送器
 *
 * 负责将 AweeClaw 的 VRM 动作数据通过 UDP 发送给外部应用。
 * 支持：
 * - 骨骼位置/旋转数据
 * - 表情混合形状数据
 * - 心跳包（/VMC/Ext/OK）
 * - 时间戳同步
 *
 * 性能优化：
 * - 使用 Bundle 打包多帧数据
 * - 复用 UDP socket
 * - 缓存最新帧数据
 *
 * @module vmc/VmcSender
 */

import * as dgram from 'dgram'
import { logger } from '@shared/toolkit/LogEngine'
import { getVmcStore, type VmcConfig } from './VmcStore'
import {
  encodeOscBundle,
  createHeartbeatMessage,
  createTimestampMessage,
  createBoneMessage,
  createRootBoneMessage,
  createBlendMessage,
  createBlendApplyMessage,
  type OscMessage,
  type VmcFrameData,
} from './VmcCodec'

// ============================================
// 类型定义
// ============================================

/** 发送器状态 */
export interface VmcSenderState {
  active: boolean
  targetHost: string
  targetPort: number
  lastSendTime: number
  sentFrames: number
  errors: number
}

// ============================================
// 发送器类
// ============================================

class VmcSender {
  private socket: dgram.Socket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private state: VmcSenderState = {
    active: false,
    targetHost: '',
    targetPort: 0,
    lastSendTime: 0,
    sentFrames: 0,
    errors: 0,
  }

  /** 初始化发送器 */
  init(): void {
    try {
      this.socket = dgram.createSocket('udp4')
      
      this.socket.on('error', (err) => {
        logger.system.error('[VmcSender] Socket error:', err)
        this.state.errors++
      })

      this.socket.unref() // 不阻止进程退出
      
      logger.system.info('[VmcSender] Initialized')
    } catch (err) {
      logger.system.error('[VmcSender] Init failed:', err)
    }
  }

  /** 启动发送器 */
  start(config: VmcConfig['send']): boolean {
    if (this.state.active) {
      logger.system.warn('[VmcSender] Already active')
      return true
    }

    if (!this.socket) {
      logger.system.error('[VmcSender] Socket not initialized')
      return false
    }

    this.state.targetHost = config.host
    this.state.targetPort = config.port
    this.state.active = true
    this.state.sentFrames = 0
    this.state.errors = 0

    // 启动心跳
    this.startHeartbeat()

    logger.system.info('[VmcSender] Started', {
      host: config.host,
      port: config.port,
    })

    return true
  }

  /** 停止发送器 */
  stop(): void {
    if (!this.state.active) {
      return
    }

    this.stopHeartbeat()
    this.state.active = false

    logger.system.info('[VmcSender] Stopped')
  }

  /** 发送 VMC 帧数据 */
  sendFrame(frameData: VmcFrameData): boolean {
    if (!this.state.active || !this.socket) {
      return false
    }

    try {
      const messages: OscMessage[] = []

      // 1. 添加时间戳
      if (frameData.timestamp) {
        messages.push(createTimestampMessage(frameData.timestamp))
      }

      // 2. 添加根骨骼
      const rootBone = frameData.bones.find(b => b.boneName === 'root')
      if (rootBone) {
        messages.push(createRootBoneMessage(rootBone))
      }

      // 3. 添加其他骨骼
      for (const bone of frameData.bones) {
        if (bone.boneName !== 'root') {
          messages.push(createBoneMessage(bone))
        }
      }

      // 4. 添加表情
      for (const blend of frameData.blends) {
        messages.push(createBlendMessage(blend))
      }

      // 5. 添加表情应用
      if (frameData.blends.length > 0) {
        messages.push(createBlendApplyMessage())
      }

      // 6. 添加心跳
      messages.push(createHeartbeatMessage())

      // 7. 打包并发送
      const bundle = {
        timeTag: BigInt(Date.now()) * 1000000n, // 转换为纳秒
        packets: messages,
      }

      const buffer = encodeOscBundle(bundle)
      
      this.socket.send(buffer, this.state.targetPort, this.state.targetHost, (err) => {
        if (err) {
          logger.system.error('[VmcSender] Send error:', err)
          this.state.errors++
        } else {
          this.state.sentFrames++
          this.state.lastSendTime = Date.now()
        }
      })

      return true
    } catch (err) {
      logger.system.error('[VmcSender] Send frame failed:', err)
      this.state.errors++
      return false
    }
  }

  /** 发送单个骨骼数据 */
  sendBone(boneName: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }): boolean {
    if (!this.state.active || !this.socket) {
      return false
    }

    try {
      const message = boneName === 'root' 
        ? createRootBoneMessage({ boneName, position, rotation })
        : createBoneMessage({ boneName, position, rotation })

      const buffer = encodeOscBundle({
        timeTag: BigInt(Date.now()) * 1000000n,
        packets: [message, createHeartbeatMessage()],
      })

      this.socket.send(buffer, this.state.targetPort, this.state.targetHost, (err) => {
        if (err) {
          logger.system.error('[VmcSender] Send bone error:', err)
          this.state.errors++
        }
      })

      return true
    } catch (err) {
      logger.system.error('[VmcSender] Send bone failed:', err)
      this.state.errors++
      return false
    }
  }

  /** 发送单个表情数据 */
  sendBlend(blendName: string, weight: number): boolean {
    if (!this.state.active || !this.socket) {
      return false
    }

    try {
      const message = createBlendMessage({ blendName, weight })
      const applyMessage = createBlendApplyMessage()

      const buffer = encodeOscBundle({
        timeTag: BigInt(Date.now()) * 1000000n,
        packets: [message, applyMessage, createHeartbeatMessage()],
      })

      this.socket.send(buffer, this.state.targetPort, this.state.targetHost, (err) => {
        if (err) {
          logger.system.error('[VmcSender] Send blend error:', err)
          this.state.errors++
        }
      })

      return true
    } catch (err) {
      logger.system.error('[VmcSender] Send blend failed:', err)
      this.state.errors++
      return false
    }
  }

  /** 启动心跳 */
  private startHeartbeat(): void {
    const store = getVmcStore()
    const config = store.getConfig()
    
    if (!config.heartbeat.enabled) {
      return
    }

    this.heartbeatTimer = setInterval(() => {
      if (!this.state.active || !this.socket) {
        return
      }

      try {
        const heartbeatMessage = createHeartbeatMessage()
        const buffer = encodeOscBundle({
          timeTag: BigInt(Date.now()) * 1000000n,
          packets: [heartbeatMessage],
        })

        this.socket.send(buffer, this.state.targetPort, this.state.targetHost, (err) => {
          if (err) {
            logger.system.error('[VmcSender] Heartbeat error:', err)
          }
        })
      } catch (err) {
        logger.system.error('[VmcSender] Heartbeat failed:', err)
      }
    }, config.heartbeat.intervalMs)

    // 防止定时器阻止进程退出
    if (this.heartbeatTimer) {
      this.heartbeatTimer.unref()
    }
  }

  /** 停止心跳 */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** 获取状态 */
  getState(): VmcSenderState {
    return { ...this.state }
  }

  /** 重置统计信息 */
  resetStats(): void {
    this.state.sentFrames = 0
    this.state.errors = 0
  }

  /** 销毁发送器 */
  destroy(): void {
    this.stop()
    
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }

    logger.system.info('[VmcSender] Destroyed')
  }
}

// 单例
let instance: VmcSender | null = null

/** 获取 VmcSender 单例 */
export function getVmcSender(): VmcSender {
  if (!instance) {
    instance = new VmcSender()
  }
  return instance
}