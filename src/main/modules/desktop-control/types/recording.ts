/**
 * 操作录制器类型定义（L5 智能工作流层）
 *
 * 定义录制事件、录制脚本、回放配置等数据结构
 *
 * @module desktop-control/types/recording
 */

import type { MouseButton, ClickType } from './actions'

// ============================================
// 录制事件类型
// ============================================

/** 录制事件类型枚举 */
export enum RecordedEventType {
  MouseClick = 'mouse_click',
  MouseMove = 'mouse_move',
  MouseScroll = 'mouse_scroll',
  MouseDrag = 'mouse_drag',
  KeyPress = 'key_press',
  KeyCombo = 'key_combo',
  TypeText = 'type_text',
  WindowFocus = 'window_focus',
  AppLaunch = 'app_launch',
  Wait = 'wait',
}

/** 录制事件基础结构 */
export interface RecordedEventBase {
  /** 事件唯一 ID */
  id: string
  /** 事件类型 */
  type: RecordedEventType
  /** 相对录制开始的毫秒时间戳 */
  timestamp: number
  /** 事件来源（user / agent） */
  source: 'user' | 'agent'
}

/** 鼠标点击事件 */
export interface MouseClickEvent extends RecordedEventBase {
  type: RecordedEventType.MouseClick
  x: number
  y: number
  button: MouseButton
  clickType: ClickType
}

/** 鼠标移动事件 */
export interface MouseMoveEvent extends RecordedEventBase {
  type: RecordedEventType.MouseMove
  x: number
  y: number
}

/** 鼠标滚动事件 */
export interface MouseScrollEvent extends RecordedEventBase {
  type: RecordedEventType.MouseScroll
  x: number
  y: number
  amount: number
}

/** 鼠标拖拽事件 */
export interface MouseDragEvent extends RecordedEventBase {
  type: RecordedEventType.MouseDrag
  fromX: number
  fromY: number
  toX: number
  toY: number
  button: MouseButton
}

/** 按键事件 */
export interface KeyPressEvent extends RecordedEventBase {
  type: RecordedEventType.KeyPress
  key: string
}

/** 组合键事件 */
export interface KeyComboEvent extends RecordedEventBase {
  type: RecordedEventType.KeyCombo
  keys: string[]
}

/** 文本输入事件 */
export interface TypeTextEvent extends RecordedEventBase {
  type: RecordedEventType.TypeText
  text: string
}

/** 窗口聚焦事件 */
export interface WindowFocusEvent extends RecordedEventBase {
  type: RecordedEventType.WindowFocus
  windowId: string
  windowTitle: string
  appName: string
}

/** 应用启动事件 */
export interface AppLaunchEvent extends RecordedEventBase {
  type: RecordedEventType.AppLaunch
  appName: string
  args?: string[]
}

/** 显式等待事件 */
export interface WaitEvent extends RecordedEventBase {
  type: RecordedEventType.Wait
  duration: number
}

/** 录制事件联合类型 */
export type RecordedEvent =
  | MouseClickEvent
  | MouseMoveEvent
  | MouseScrollEvent
  | MouseDragEvent
  | KeyPressEvent
  | KeyComboEvent
  | TypeTextEvent
  | WindowFocusEvent
  | AppLaunchEvent
  | WaitEvent

// ============================================
// 录制脚本
// ============================================

/** 录制脚本元信息 */
export interface RecordingMetadata {
  /** 脚本名称 */
  name: string
  /** 描述 */
  description: string
  /** 创建时间 */
  createdAt: number
  /** 最后更新时间 */
  updatedAt: number
  /** 录制时长（ms） */
  duration: number
  /** 事件总数 */
  eventCount: number
  /** 录制平台 */
  platform: NodeJS.Platform
  /** 屏幕分辨率（用于跨设备适配） */
  screenResolution?: { width: number; height: number }
  /** 标签 */
  tags: string[]
  /** 创建者 */
  createdBy?: string
}

/** 录制脚本 */
export interface RecordingScript {
  /** 脚本 ID */
  id: string
  /** 元信息 */
  metadata: RecordingMetadata
  /** 事件序列 */
  events: RecordedEvent[]
  /** 条件分支定义（事件 ID -> 分支条件） */
  branches?: Record<string, BranchCondition>
  /** 变量定义 */
  variables?: Record<string, WorkflowVariable>
}

// ============================================
// 条件分支
// ============================================

/** 分支条件 */
export interface BranchCondition {
  /** 条件表达式 */
  expression: string
  /** 满足条件时跳转到的事件 ID */
  trueEventId?: string
  /** 不满足条件时跳转到的事件 ID */
  falseEventId?: string
  /** 最大循环次数（用于循环分支） */
  maxIterations?: number
}

/** 工作流变量 */
export interface WorkflowVariable {
  /** 变量名 */
  name: string
  /** 变量类型 */
  type: 'string' | 'number' | 'boolean' | 'object'
  /** 默认值 */
  defaultValue: unknown
  /** 描述 */
  description?: string
}

// ============================================
// 回放配置与结果
// ============================================

/** 回放速度模式 */
export type ReplaySpeed = 'realtime' | 'fast' | 'instant' | 'custom'

/** 回放配置 */
export interface ReplayConfig {
  /** 回放速度 */
  speed: ReplaySpeed
  /** 自定义速度倍率（speed=custom 时生效，1.0 = 原速） */
  speedMultiplier?: number
  /** 事件间最小间隔（ms） */
  minInterval?: number
  /** 事件间最大间隔（ms），超过则截断 */
  maxInterval?: number
  /** 是否在错误时停止 */
  stopOnError: boolean
  /** 最大错误次数 */
  maxErrors: number
  /** 起始事件索引 */
  startIndex?: number
  /** 结束事件索引 */
  endIndex?: number
  /** 变量覆盖 */
  variables?: Record<string, unknown>
}

/** 回放进度 */
export interface ReplayProgress {
  /** 当前事件索引 */
  currentIndex: number
  /** 总事件数 */
  totalEvents: number
  /** 已执行事件数 */
  executedCount: number
  /** 成功事件数 */
  successCount: number
  /** 失败事件数 */
  errorCount: number
  /** 已耗时（ms） */
  elapsed: number
  /** 预计剩余时间（ms） */
  estimatedRemaining: number
  /** 当前事件 */
  currentEvent?: RecordedEvent
}

/** 回放结果 */
export interface ReplayResult {
  success: boolean
  /** 执行的事件数 */
  executedCount: number
  /** 成功事件数 */
  successCount: number
  /** 失败事件数 */
  errorCount: number
  /** 总耗时（ms） */
  duration: number
  /** 错误列表 */
  errors: ReplayError[]
  /** 是否被紧急停止中断 */
  aborted: boolean
}

/** 回放错误 */
export interface ReplayError {
  eventIndex: number
  event: RecordedEvent
  error: string
  timestamp: number
}

/** 录制状态 */
export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped'

/** 录制会话信息 */
export interface RecordingSession {
  id: string
  state: RecordingState
  startedAt: number
  pausedAt?: number
  totalPausedDuration: number
  eventCount: number
  metadata: Partial<RecordingMetadata>
}
