/**
 * VMC 协议配置存储（主进程）
 *
 * 存储布局：
 *   <userData>/vmc/vmc_config.json
 *
 * VMC（Virtual Motion Capture）协议用于 VRM 模型动作数据的双向传输：
 * - 出站：将 AweeClaw 的 VRM 动作发送给外部应用（VSeeFace、Warudo 等）
 * - 入站：接收外部 VMC 数据驱动 AweeClaw 的 VRM 模型
 *
 * @module vmc/VmcStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 类型定义
// ============================================

/** VMC 配置 */
export interface VmcConfig {
  /** 模块总开关 */
  enabled: boolean
  /** 出站配置 */
  send: {
    /** 出站开关 */
    enabled: boolean
    /** 目标主机 */
    host: string
    /** 目标端口 */
    port: number
  }
  /** 入站配置 */
  receive: {
    /** 入站开关 */
    enabled: boolean
    /** 监听端口 */
    port: number
    /** 允许的来源 IP 列表（默认仅 127.0.0.1） */
    allowedIps: string[]
    /** 是否同步表情 */
    syncExpression: boolean
  }
  /** 心跳配置 */
  heartbeat: {
    /** 心跳开关 */
    enabled: boolean
    /** 心跳间隔（毫秒） */
    intervalMs: number
  }
}

/** VMC 状态 */
export interface VmcState {
  /** 出站是否运行 */
  senderActive: boolean
  /** 入站是否运行 */
  receiverActive: boolean
  /** 最后心跳时间 */
  lastHeartbeat: number
  /** 最后入站数据时间 */
  lastIncomingData: number
  /** 统计信息 */
  stats: {
    /** 发送帧数 */
    sentFrames: number
    /** 接收帧数 */
    receivedFrames: number
    /** 错误次数 */
    errors: number
  }
}

// ============================================
// 常量
// ============================================

const VMC_DIR_NAME = 'vmc'
const CONFIG_FILE_NAME = 'vmc_config.json'

/** 默认配置 */
export const DEFAULT_VMC_CONFIG: VmcConfig = {
  enabled: false,
  send: {
    enabled: false,
    host: '127.0.0.1',
    port: 39540,
  },
  receive: {
    enabled: false,
    port: 39539,
    allowedIps: ['127.0.0.1'],
    syncExpression: true,
  },
  heartbeat: {
    enabled: true,
    intervalMs: 1000,
  },
}

/** 默认状态 */
export const DEFAULT_VMC_STATE: VmcState = {
  senderActive: false,
  receiverActive: false,
  lastHeartbeat: 0,
  lastIncomingData: 0,
  stats: {
    sentFrames: 0,
    receivedFrames: 0,
    errors: 0,
  },
}

// ============================================
// 存储类
// ============================================

class VmcStore {
  private config: VmcConfig
  private state: VmcState
  private configPath: string
  private initialized = false

  constructor() {
    this.config = { ...DEFAULT_VMC_CONFIG }
    this.state = { ...DEFAULT_VMC_STATE }
    this.configPath = ''
  }

  /** 初始化存储 */
  init(): void {
    if (this.initialized) return

    try {
      const userDataPath = app.getPath('userData')
      const vmcDir = path.join(userDataPath, VMC_DIR_NAME)
      
      // 确保目录存在
      if (!fs.existsSync(vmcDir)) {
        fs.mkdirSync(vmcDir, { recursive: true })
      }

      this.configPath = path.join(vmcDir, CONFIG_FILE_NAME)
      this.loadConfig()
      this.initialized = true

      logger.system.info('[VmcStore] Initialized', {
        configPath: this.configPath,
        enabled: this.config.enabled,
      })
    } catch (err) {
      logger.system.error('[VmcStore] Init failed:', err)
    }
  }

  /** 加载配置 */
  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8')
        const saved = JSON.parse(data)
        
        // 合并配置，保留默认值
        this.config = {
          ...DEFAULT_VMC_CONFIG,
          ...saved,
          send: { ...DEFAULT_VMC_CONFIG.send, ...saved.send },
          receive: { ...DEFAULT_VMC_CONFIG.receive, ...saved.receive },
          heartbeat: { ...DEFAULT_VMC_CONFIG.heartbeat, ...saved.heartbeat },
        }
        
        logger.system.info('[VmcStore] Config loaded')
      } else {
        // 首次运行，保存默认配置
        this.saveConfig()
        logger.system.info('[VmcStore] Default config created')
      }
    } catch (err) {
      logger.system.error('[VmcStore] Load config failed:', err)
      this.config = { ...DEFAULT_VMC_CONFIG }
    }
  }

  /** 保存配置 */
  private saveConfig(): void {
    try {
      const data = JSON.stringify(this.config, null, 2)
      fs.writeFileSync(this.configPath, data, 'utf-8')
      logger.system.info('[VmcStore] Config saved')
    } catch (err) {
      logger.system.error('[VmcStore] Save config failed:', err)
    }
  }

  /** 获取配置 */
  getConfig(): VmcConfig {
    return { ...this.config }
  }

  /** 更新配置 */
  updateConfig(update: Partial<VmcConfig>): VmcConfig {
    this.config = {
      ...this.config,
      ...update,
      send: { ...this.config.send, ...update.send },
      receive: { ...this.config.receive, ...update.receive },
      heartbeat: { ...this.config.heartbeat, ...update.heartbeat },
    }
    this.saveConfig()
    return this.getConfig()
  }

  /** 获取状态 */
  getState(): VmcState {
    return { ...this.state }
  }

  /** 更新状态 */
  updateState(update: Partial<VmcState>): void {
    this.state = { ...this.state, ...update }
  }

  /** 更新统计信息 */
  updateStats(update: Partial<VmcState['stats']>): void {
    this.state.stats = { ...this.state.stats, ...update }
  }

  /** 重置统计信息 */
  resetStats(): void {
    this.state.stats = { ...DEFAULT_VMC_STATE.stats }
  }

  /** 重置配置为默认值 */
  resetConfig(): VmcConfig {
    this.config = { ...DEFAULT_VMC_CONFIG }
    this.saveConfig()
    return this.getConfig()
  }
}

// 单例
let instance: VmcStore | null = null

/** 获取 VmcStore 单例 */
export function getVmcStore(): VmcStore {
  if (!instance) {
    instance = new VmcStore()
  }
  return instance
}