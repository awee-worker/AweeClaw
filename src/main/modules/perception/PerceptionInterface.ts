/**
 * 感知层接口规范
 *
 * 定义 AweeClaw 物理感知能力的统一接口规范。
 * 所有感知通道（屏幕、语音、文件、进程、摄像头等）都遵循此接口。
 *
 * 设计原则：
 * - 单一职责：每个感知通道只负责采集和编码，不做业务决策
 * - 可插拔：通过插件方式注册和卸载，不硬编码到主进程
 * - 隐私优先：所有数据本地化处理，提供隐私模式开关
 * - 可观测：所有感知行为有日志，可审计
 *
 * @module perception/PerceptionInterface
 */

// ============================================================
// 基础类型定义
// ============================================================

/** 感知通道类型 */
export type PerceptionChannel =
  | 'screen'      // 屏幕感知
  | 'voice'       // 语音感知
  | 'file'        // 文件系统感知
  | 'process'     // 进程感知
  | 'camera'      // 摄像头感知
  | 'iot'         // IoT 传感器感知
  | 'network'     // 网络感知

/** 感知事件级别 */
export type PerceptionEventLevel =
  | 'info'        // 普通信息（场景变化）
  | 'warn'        // 警告（异常模式）
  | 'critical'    // 严重（系统异常）

/** 感知事件结构 */
export interface PerceptionEvent<T = unknown> {
  /** 事件唯一 ID */
  id: string
  /** 事件时间戳（毫秒） */
  timestamp: number
  /** 来源通道 */
  channel: PerceptionChannel
  /** 事件类型（由具体通道定义，如 screen.scene_captured） */
  type: string
  /** 事件级别 */
  level: PerceptionEventLevel
  /** 事件负载（通道特定结构） */
  payload: T
  /** 场景向量（用于相似检索，可选） */
  embedding?: number[]
}

/** 感知采样配置 */
export interface PerceptionSampleConfig {
  /** 采样间隔（毫秒） */
  intervalMs: number
  /** 是否启用 */
  enabled: boolean
  /** 空闲降频倍数（用户无操作时降低采样频率） */
  idleSlowdownFactor?: number
  /** 最大空闲间隔（毫秒，超过此时间停止采集） */
  maxIdleIntervalMs?: number
}

// ============================================================
// 场景数据结构
// ============================================================

/** 屏幕场景数据 */
export interface ScreenScene {
  /** 场景唯一 ID */
  id: string
  /** 时间戳 */
  timestamp: number
  /** 当前活跃应用 */
  app: string
  /** 窗口标题 */
  windowTitle: string
  /** 活动类型 */
  activity: ScreenActivity
  /** 场景文本摘要（OCR 或 VLM 生成） */
  textSummary: string
  /** 场景向量（用于相似检索） */
  embedding: number[]
  /** UI 元素清单（可选） */
  elements?: UIElement[]
  /** 截图数据 URL（可选，隐私模式下不保存） */
  screenshotDataUrl?: string
}

/** 屏幕活动类型 */
export type ScreenActivity =
  | 'coding'      // 编码
  | 'browsing'    // 浏览
  | 'chatting'    // 聊天
  | 'reading'     // 阅读
  | 'writing'     // 写作
  | 'debugging'   // 调试
  | 'idle'        // 空闲
  | 'unknown'     // 未知

/** UI 元素结构 */
export interface UIElement {
  type: 'button' | 'input' | 'menu' | 'text' | 'image' | 'panel'
  text: string
  bbox: { x: number; y: number; w: number; h: number }
  state: 'active' | 'disabled' | 'focused' | 'hidden'
}

/** 用户行为数据 */
export interface UserBehavior {
  /** 行为唯一 ID */
  id: string
  /** 时间戳 */
  timestamp: number
  /** 触发场景 ID */
  sceneId: string
  /** 场景向量（冗余存储，便于直接检索） */
  sceneEmbedding: number[]
  /** 场景描述快照 */
  scene: {
    app: string
    activity: ScreenActivity
    timeOfDay: TimeOfDay
    dayOfWeek: number  // 0-6（周日为 0）
    filesOpen?: string[]
    terminalCmds?: string[]
  }
  /** 用户实际动作 */
  action: UserAction
  /** 动作结果 */
  outcome?: 'success' | 'failure' | 'abandoned'
}

/** 用户动作类型 */
export interface UserAction {
  /** 动作类型 */
  type: 'command' | 'file_edit' | 'app_switch' | 'search' | 'chat' | 'idle'
  /** 动作目标（命令/文件路径/应用名/搜索词/聊天内容） */
  target: string
  /** 动作持续时长（毫秒） */
  durationMs?: number
}

/** 一天中的时间段 */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

/** 预测结果 */
export interface Prediction {
  /** 预测唯一 ID */
  id: string
  /** 生成时间戳 */
  timestamp: number
  /** 预测类型 */
  type: PredictionType
  /** 预测内容 */
  predictedAction: UserAction
  /** 置信度（0-1） */
  confidence: number
  /** 基于的历史行为 ID 列表 */
  basedOnBehaviors: string[]
  /** 预测理由（人类可读） */
  reason: string
  /** 实际发生的动作（校准用，可选） */
  actualAction?: UserAction
  /** 用户反馈 */
  feedback?: 'accepted' | 'rejected' | 'ignored'
}

/** 预测类型 */
export type PredictionType = 'behavior' | 'impact' | 'anomaly' | 'causal'

// ============================================================
// 感知通道接口
// ============================================================

/**
 * 感知通道统一接口
 *
 * 所有感知通道（屏幕、语音、文件等）都实现此接口。
 * 通过插件方式注册到 PerceptionManager。
 */
export interface PerceptionChannelInterface {
  /** 通道类型 */
  readonly channel: PerceptionChannel

  /** 通道显示名称 */
  readonly displayName: string

  /** 初始化通道 */
  initialize(config: PerceptionSampleConfig): Promise<void>

  /** 启动感知 */
  start(): Promise<void>

  /** 停止感知 */
  stop(): Promise<void>

  /** 是否正在运行 */
  isRunning(): boolean

  /** 获取最近一次感知事件 */
  getLastEvent(): PerceptionEvent | null

  /** 释放资源 */
  dispose(): Promise<void>
}

// ============================================================
// 感知事件订阅接口
// ============================================================

/** 感知事件回调 */
export type PerceptionEventCallback = (event: PerceptionEvent) => void | Promise<void>

/** 事件订阅句柄 */
export interface EventSubscription {
  /** 取消订阅 */
  unsubscribe(): void
}

// ============================================================
// 隐私配置
// ============================================================

/** 感知层隐私配置 */
export interface PerceptionPrivacyConfig {
  /** 全局开关 */
  enablePerception: boolean
  /** 各通道开关 */
  channels: Record<PerceptionChannel, boolean>
  /** 数据保留期（天） */
  retentionDays: number
  /** 隐私模式（不记录任何数据，只做实时推理） */
  privacyMode: boolean
  /** 云端兜底（默认关闭） */
  cloudFallback: boolean
  /** 保存截图（默认关闭，节省磁盘） */
  saveScreenshots: boolean
}

/** 默认隐私配置 */
export const DEFAULT_PRIVACY_CONFIG: PerceptionPrivacyConfig = {
  enablePerception: false,  // 默认关闭，需要用户主动开启
  channels: {
    screen: false,
    voice: false,
    file: true,             // 文件感知风险低，默认开
    process: true,          // 进程感知风险低，默认开
    camera: false,
    iot: false,
    network: false,
  },
  retentionDays: 30,
  privacyMode: false,
  cloudFallback: false,
  saveScreenshots: false,
}

// ============================================================
// 工具函数
// ============================================================

/** 根据小时数获取时间段 */
export function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 6 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  return 'night'
}

/** 生成唯一 ID（时间戳 + 随机数） */
export function generatePerceptionId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}
