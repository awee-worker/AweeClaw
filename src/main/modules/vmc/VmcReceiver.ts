/**
 * VMC 协议入站接收器
 *
 * 负责接收外部 VMC 数据并驱动 AweeClaw 的 VRM 模型。
 * 支持：
 * - UDP 监听
 * - IP 白名单安全检查
 * - 骨骼数据接收
 * - 表情数据接收
 * - 断流检测与恢复
 *
 * 安全设计：
 * - 默认仅允许 127.0.0.1
 * - 可配置允许的 IP 列表
 * - 异常来源记录日志
 *
 * @module vmc/VmcReceiver
 */

import * as dgram from 'dgram'
import { logger } from '@shared/toolkit/LogEngine'
import type { VmcConfig } from './VmcStore'
import {
  decodeOscBundle,
  decodeOscMessage,
  parseBoneMessage,
  parseBlendMessage,
  type OscMessage,
  type VmcBoneData,
  type VmcBlendData,
} from './VmcCodec'

// ============================================
// 类型定义
// ============================================

/** 接收器状态 */
export interface VmcReceiverState {
  active: boolean
  listenPort: number
  allowedIps: string[]
  lastReceiveTime: number
  receivedFrames: number
  errors: number
  blockedAttempts: number
}

/** 接收器事件回调 */
export interface VmcReceiverEvents {
  onBoneData?: (bone: VmcBoneData) => void
  onBlendData?: (blend: VmcBlendData) => void
  onFrameReceived?: (frameCount: number) => void
  onError?: (error: Error) => void
  onBlocked?: (ip: string) => void
}

// ============================================
// 接收器类
// ============================================

class VmcReceiver {
  private socket: dgram.Socket | null = null
  private state: VmcReceiverState = {
    active: false,
    listenPort: 0,
    allowedIps: [],
    lastReceiveTime: 0,
    receivedFrames: 0,
    errors: 0,
    blockedAttempts: 0,
  }
  private events: VmcReceiverEvents = {}
  private lastDataTimer: ReturnType<typeof setTimeout> | null = null

  /** 初始化接收器 */
  init(): void {
    try {
      this.socket = dgram.createSocket('udp4')
      
      this.socket.on('error', (err) => {
        logger.system.error('[VmcReceiver] Socket error:', err)
        this.state.errors++
        this.events.onError?.(err)
      })

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo)
      })

      this.socket.unref() // 不阻止进程退出
      
      logger.system.info('[VmcReceiver] Initialized')
    } catch (err) {
      logger.system.error('[VmcReceiver] Init failed:', err)
    }
  }

  /** 启动接收器 */
  start(config: VmcConfig['receive']): boolean {
    if (this.state.active) {
      logger.system.warn('[VmcReceiver] Already active')
      return true
    }

    if (!this.socket) {
      logger.system.error('[VmcReceiver] Socket not initialized')
      return false
    }

    this.state.listenPort = config.port
    this.state.allowedIps = [...config.allowedIps]
    this.state.active = true
    this.state.receivedFrames = 0
    this.state.errors = 0
    this.state.blockedAttempts = 0

    try {
      this.socket.bind(config.port, () => {
        logger.system.info('[VmcReceiver] Started', {
          port: config.port,
          allowedIps: config.allowedIps,
        })
      })

      return true
    } catch (err) {
      logger.system.error('[VmcReceiver] Bind failed:', err)
      this.state.active = false
      return false
    }
  }

  /** 停止接收器 */
  stop(): void {
    if (!this.state.active) {
      return
    }

    this.clearLastDataTimer()
    
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }

    this.state.active = false
    logger.system.info('[VmcReceiver] Stopped')
  }

  /** 设置事件回调 */
  setEvents(events: VmcReceiverEvents): void {
    this.events = events
  }

  /** 处理接收到的消息 */
  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    // 安全检查：IP 白名单
    if (!this.isAllowedIp(rinfo.address)) {
      this.state.blockedAttempts++
      logger.system.warn('[VmcReceiver] Blocked message from unauthorized IP', {
        ip: rinfo.address,
        port: rinfo.port,
      })
      this.events.onBlocked?.(rinfo.address)
      return
    }

    try {
      // 解析 OSC 消息
      let messages: OscMessage[] = []
      
      // 尝试解析为 Bundle
      try {
        const { bundle } = decodeOscBundle(msg, 0)
        messages = bundle.packets.filter(p => 'address' in p) as OscMessage[]
      } catch {
        // 如果不是 Bundle，尝试解析为单个消息
        try {
          const { message } = decodeOscMessage(msg, 0)
          messages = [message]
        } catch {
          logger.system.warn('[VmcReceiver] Invalid OSC message')
          return
        }
      }

      // 处理每个消息
      let boneCount = 0
      let blendCount = 0

      for (const message of messages) {
        // 处理骨骼数据
        const bone = parseBoneMessage(message)
        if (bone) {
          this.events.onBoneData?.(bone)
          boneCount++
          continue
        }

        // 处理表情数据
        const blend = parseBlendMessage(message)
        if (blend) {
          this.events.onBlendData?.(blend)
          blendCount++
          continue
        }

        // 处理心跳
        if (message.address === '/VMC/Ext/OK') {
          // 收到心跳，更新最后接收时间
          this.state.lastReceiveTime = Date.now()
          continue
        }

        // 处理时间戳
        if (message.address === '/VMC/Ext/T') {
          // 时间戳消息，暂时忽略
          continue
        }
      }

      // 更新统计
      if (boneCount > 0 || blendCount > 0) {
        this.state.receivedFrames++
        this.state.lastReceiveTime = Date.now()
        this.events.onFrameReceived?.(this.state.receivedFrames)
        
        // 重置断流检测定时器
        this.resetLastDataTimer()
      }

    } catch (err) {
      logger.system.error('[VmcReceiver] Message handling error:', err)
      this.state.errors++
      this.events.onError?.(err as Error)
    }
  }

  /** 检查 IP 是否在白名单中 */
  private isAllowedIp(ip: string): boolean {
    // 如果白名单为空，默认允许所有
    if (this.state.allowedIps.length === 0) {
      return true
    }
    
    return this.state.allowedIps.includes(ip)
  }

  /** 重置断流检测定时器 */
  private resetLastDataTimer(): void {
    this.clearLastDataTimer()
    
    // 2 秒无数据则认为断流
    this.lastDataTimer = setTimeout(() => {
      logger.system.info('[VmcReceiver] Data stream interrupted')
      // 这里可以触发断流事件，由 VmcManager 处理恢复逻辑
    }, 2000)
  }

  /** 清除断流检测定时器 */
  private clearLastDataTimer(): void {
    if (this.lastDataTimer) {
      clearTimeout(this.lastDataTimer)
      this.lastDataTimer = null
    }
  }

  /** 获取状态 */
  getState(): VmcReceiverState {
    return { ...this.state }
  }

  /** 重置统计信息 */
  resetStats(): void {
    this.state.receivedFrames = 0
    this.state.errors = 0
    this.state.blockedAttempts = 0
  }

  /** 销毁接收器 */
  destroy(): void {
    this.stop()
    this.clearLastDataTimer()
    this.events = {}
    
    logger.system.info('[VmcReceiver] Destroyed')
  }
}

// 单例
let instance: VmcReceiver | null = null

/** 获取 VmcReceiver 单例 */
export function getVmcReceiver(): VmcReceiver {
  if (!instance) {
    instance = new VmcReceiver()
  }
  return instance
}