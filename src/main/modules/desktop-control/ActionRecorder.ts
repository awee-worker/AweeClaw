/**
 * 操作录制器（L5 智能工作流层）
 *
 * 职责：
 * 1. 录制用户桌面操作序列（鼠标、键盘、窗口切换）
 * 2. 时间戳精确到毫秒
 * 3. 操作去重与压缩（连续移动合并为路径）
 * 4. 导出为 JSON 脚本，可编辑、可回放
 * 5. 支持条件分支（如"如果出现弹窗则点击确定"）
 *
 * 设计要点：
 * - 单例模式，全局唯一录制器
 * - 继承 EventEmitter，支持状态变化通知
 * - 与紧急停止机制集成，录制中可随时停止
 * - 不直接监听系统事件，由调用方（IPC/Agent）推送事件
 *
 * @module desktop-control/ActionRecorder
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import {
  getEmergencyStopController,
  EmergencyStopError,
} from './EmergencyStop'
import {
  type RecordedEvent,
  type RecordingScript,
  type RecordingMetadata,
  type RecordingState,
  type RecordingSession,
  type MouseClickEvent,
  type MouseMoveEvent,
  type MouseScrollEvent,
  type MouseDragEvent,
  type KeyPressEvent,
  type KeyComboEvent,
  type TypeTextEvent,
  type WindowFocusEvent,
  type AppLaunchEvent,
  type WaitEvent,
  RecordedEventType,
} from './types/recording'
import type {
  MouseButton,
  ClickType,
} from './types/actions'

// ============================================
// 事件类型常量
// ============================================

export const RECORDER_EVENT_CHANGE = 'recorder:state-change'
export const RECORDER_EVENT_RECORDED = 'recorder:event-recorded'
export const RECORDER_EVENT_ERROR = 'recorder:error'

// ============================================
// 压缩配置
// ============================================

interface CompressionConfig {
  /** 鼠标移动合并阈值（ms），间隔小于此值的连续移动合并 */
  moveMergeInterval: number
  /** 鼠标移动最小位移（px），小于此值的移动忽略 */
  moveMinDelta: number
  /** 文本输入合并阈值（ms），间隔小于此值的连续输入合并 */
  textMergeInterval: number
  /** 文本合并最大长度 */
  textMergeMaxLength: number
}

const DEFAULT_COMPRESSION: CompressionConfig = {
  moveMergeInterval: 50,
  moveMinDelta: 2,
  textMergeInterval: 100,
  textMergeMaxLength: 1000,
}

// ============================================
// 录制器实现
// ============================================

/**
 * 操作录制器
 *
 * 使用方式：
 * ```ts
 * const recorder = getActionRecorder()
 * recorder.start({ name: '登录流程', description: '录制登录操作' })
 * recorder.recordMouseClick({ x: 100, y: 200, button: 'left', clickType: 'single' })
 * recorder.recordKeyPress('Enter')
 * const script = recorder.stop()
 * ```
 */
export class ActionRecorder extends EventEmitter {
  private session: RecordingSession | null = null
  private events: RecordedEvent[] = []
  private compression: CompressionConfig = DEFAULT_COMPRESSION
  private lastMoveEvent: MouseMoveEvent | null = null
  private lastTextEvent: TypeTextEvent | null = null
  private movePathBuffer: Array<{ x: number; y: number; t: number }> = []

  constructor() {
    super()
    // 监听紧急停止
    const stopController = getEmergencyStopController()
    stopController.on('emergency-stop', () => {
      if (this.session?.state === 'recording') {
        logger.desktop.info('[ActionRecorder] Emergency stop triggered, pausing recording')
        this.pause()
      }
    })
  }

  /** 当前录制状态 */
  get state(): RecordingState {
    return this.session?.state ?? 'idle'
  }

  /** 当前会话 */
  get currentSession(): RecordingSession | null {
    return this.session
  }

  /** 已录制事件数 */
  get eventCount(): number {
    return this.events.length
  }

  // ============================================
  // 录制控制
  // ============================================

  /**
   * 开始录制
   *
   * @param metadata 脚本元信息
   * @throws 若已在录制中
   */
  start(metadata?: Partial<RecordingMetadata>): void {
    if (this.session?.state === 'recording' || this.session?.state === 'paused') {
      throw new Error(`Recording already in progress (state=${this.session.state})`)
    }

    const now = Date.now()
    this.session = {
      id: randomUUID(),
      state: 'recording',
      startedAt: now,
      totalPausedDuration: 0,
      eventCount: 0,
      metadata: {
        name: metadata?.name ?? `Recording ${new Date().toLocaleString()}`,
        description: metadata?.description ?? '',
        createdAt: now,
        updatedAt: now,
        platform: process.platform,
        tags: metadata?.tags ?? [],
        createdBy: metadata?.createdBy,
        screenResolution: metadata?.screenResolution,
      },
    }
    this.events = []
    this.lastMoveEvent = null
    this.lastTextEvent = null
    this.movePathBuffer = []

    logger.desktop.info(`[ActionRecorder] Recording started: ${this.session.id}`)
    this.emit(RECORDER_EVENT_CHANGE, this.session.state)
  }

  /**
   * 暂停录制
   */
  pause(): void {
    if (!this.session || this.session.state !== 'recording') return

    this.session.state = 'paused'
    this.session.pausedAt = Date.now()
    this.flushMoveBuffer()

    logger.desktop.info('[ActionRecorder] Recording paused')
    this.emit(RECORDER_EVENT_CHANGE, this.session.state)
  }

  /**
   * 恢复录制
   */
  resume(): void {
    if (!this.session || this.session.state !== 'paused') return

    const pausedDuration = Date.now() - (this.session.pausedAt ?? Date.now())
    this.session.totalPausedDuration += pausedDuration
    this.session.pausedAt = undefined
    this.session.state = 'recording'

    logger.desktop.info('[ActionRecorder] Recording resumed')
    this.emit(RECORDER_EVENT_CHANGE, this.session.state)
  }

  /**
   * 停止录制并返回脚本
   *
   * @param discard 是否丢弃录制内容（不生成脚本）
   * @returns 录制脚本，若 discard=true 或无事件则返回 null
   */
  stop(discard = false): RecordingScript | null {
    if (!this.session) return null

    // 刷新缓冲区
    this.flushMoveBuffer()
    this.flushTextBuffer()

    const now = Date.now()
    const duration = now - this.session.startedAt - this.session.totalPausedDuration

    const script: RecordingScript | null = discard || this.events.length === 0
      ? null
      : {
          id: this.session.id,
          metadata: {
            name: this.session.metadata.name ?? 'Untitled',
            description: this.session.metadata.description ?? '',
            createdAt: this.session.metadata.createdAt ?? now,
            updatedAt: now,
            duration,
            eventCount: this.events.length,
            platform: this.session.metadata.platform ?? process.platform,
            screenResolution: this.session.metadata.screenResolution,
            tags: this.session.metadata.tags ?? [],
            createdBy: this.session.metadata.createdBy,
          },
          events: [...this.events],
        }

    logger.desktop.info(
      `[ActionRecorder] Recording stopped: ${this.events.length} events, duration=${duration}ms, discarded=${discard}`,
    )

    this.session = null
    this.events = []
    this.lastMoveEvent = null
    this.lastTextEvent = null
    this.movePathBuffer = []

    this.emit(RECORDER_EVENT_CHANGE, 'idle')
    return script
  }

  // ============================================
  // 事件录制 API
  // ============================================

  /**
   * 录制鼠标点击
   */
  recordMouseClick(params: {
    x: number
    y: number
    button: MouseButton
    clickType: ClickType
    source?: 'user' | 'agent'
  }): void {
    this.ensureRecording()

    // 点击前刷新移动缓冲
    this.flushMoveBuffer()

    const event: MouseClickEvent = {
      id: randomUUID(),
      type: RecordedEventType.MouseClick,
      timestamp: this.getRelativeTime(),
      source: params.source ?? 'user',
      x: params.x,
      y: params.y,
      button: params.button,
      clickType: params.clickType,
    }

    this.appendEvent(event)
  }

  /**
   * 录制鼠标移动
   *
   * 内部使用缓冲合并：连续移动在阈值内合并为单一路径
   */
  recordMouseMove(params: {
    x: number
    y: number
    source?: 'user' | 'agent'
  }): void {
    this.ensureRecording()

    const now = this.getRelativeTime()

    // 与上一次移动比较
    if (this.lastMoveEvent) {
      const dx = Math.abs(params.x - this.lastMoveEvent.x)
      const dy = Math.abs(params.y - this.lastMoveEvent.y)
      const dt = now - this.lastMoveEvent.timestamp

      // 位移过小则忽略
      if (dx < this.compression.moveMinDelta && dy < this.compression.moveMinDelta) {
        return
      }

      // 间隔过大则刷新缓冲
      if (dt > this.compression.moveMergeInterval) {
        this.flushMoveBuffer()
      }
    }

    // 加入缓冲
    this.movePathBuffer.push({ x: params.x, y: params.y, t: now })

    // 更新最后移动事件（用于下次比较）
    this.lastMoveEvent = {
      id: randomUUID(),
      type: RecordedEventType.MouseMove,
      timestamp: now,
      source: params.source ?? 'user',
      x: params.x,
      y: params.y,
    }
  }

  /**
   * 录制鼠标滚动
   */
  recordMouseScroll(params: {
    x: number
    y: number
    amount: number
    source?: 'user' | 'agent'
  }): void {
    this.ensureRecording()
    this.flushMoveBuffer()

    const event: MouseScrollEvent = {
      id: randomUUID(),
      type: RecordedEventType.MouseScroll,
      timestamp: this.getRelativeTime(),
      source: params.source ?? 'user',
      x: params.x,
      y: params.y,
      amount: params.amount,
    }

    this.appendEvent(event)
  }

  /**
   * 录制鼠标拖拽
   */
  recordMouseDrag(params: {
    fromX: number
    fromY: number
    toX: number
    toY: number
    button: MouseButton
    source?: 'user' | 'agent'
  }): void {
    this.ensureRecording()
    this.flushMoveBuffer()

    const event: MouseDragEvent = {
      id: randomUUID(),
      type: RecordedEventType.MouseDrag,
      timestamp: this.getRelativeTime(),
      source: params.source ?? 'user',
      fromX: params.fromX,
      fromY: params.fromY,
      toX: params.toX,
      toY: params.toY,
      button: params.button,
    }

    this.appendEvent(event)
  }

  /**
   * 录制按键
   */
  recordKeyPress(key: string, source?: 'user' | 'agent'): void {
    this.ensureRecording()
    this.flushMoveBuffer()
    this.flushTextBuffer()

    const event: KeyPressEvent = {
      id: randomUUID(),
      type: RecordedEventType.KeyPress,
      timestamp: this.getRelativeTime(),
      source: source ?? 'user',
      key,
    }

    this.appendEvent(event)
  }

  /**
   * 录制组合键
   */
  recordKeyCombo(keys: string[], source?: 'user' | 'agent'): void {
    this.ensureRecording()
    this.flushMoveBuffer()
    this.flushTextBuffer()

    const event: KeyComboEvent = {
      id: randomUUID(),
      type: RecordedEventType.KeyCombo,
      timestamp: this.getRelativeTime(),
      source: source ?? 'user',
      keys,
    }

    this.appendEvent(event)
  }

  /**
   * 录制文本输入
   *
   * 内部使用缓冲合并：连续输入在阈值内合并为单一文本事件
   */
  recordTypeText(text: string, source?: 'user' | 'agent'): void {
    this.ensureRecording()
    this.flushMoveBuffer()

    const now = this.getRelativeTime()

    // 尝试合并到上一次文本事件
    if (this.lastTextEvent) {
      const dt = now - this.lastTextEvent.timestamp
      if (
        dt <= this.compression.textMergeInterval &&
        this.lastTextEvent.text.length + text.length <= this.compression.textMergeMaxLength
      ) {
        this.lastTextEvent.text += text
        this.lastTextEvent.timestamp = now
        return
      }
      // 间隔过大，刷新缓冲
      this.flushTextBuffer()
    }

    // 创建新的文本事件
    this.lastTextEvent = {
      id: randomUUID(),
      type: RecordedEventType.TypeText,
      timestamp: now,
      source: source ?? 'user',
      text,
    }
  }

  /**
   * 录制窗口聚焦
   */
  recordWindowFocus(params: {
    windowId: string
    windowTitle: string
    appName: string
    source?: 'user' | 'agent'
  }): void {
    this.ensureRecording()
    this.flushMoveBuffer()
    this.flushTextBuffer()

    const event: WindowFocusEvent = {
      id: randomUUID(),
      type: RecordedEventType.WindowFocus,
      timestamp: this.getRelativeTime(),
      source: params.source ?? 'user',
      windowId: params.windowId,
      windowTitle: params.windowTitle,
      appName: params.appName,
    }

    this.appendEvent(event)
  }

  /**
   * 录制应用启动
   */
  recordAppLaunch(params: {
    appName: string
    args?: string[]
    source?: 'user' | 'agent'
  }): void {
    this.ensureRecording()
    this.flushMoveBuffer()
    this.flushTextBuffer()

    const event: AppLaunchEvent = {
      id: randomUUID(),
      type: RecordedEventType.AppLaunch,
      timestamp: this.getRelativeTime(),
      source: params.source ?? 'user',
      appName: params.appName,
      args: params.args,
    }

    this.appendEvent(event)
  }

  /**
   * 插入显式等待事件
   */
  recordWait(duration: number, source?: 'user' | 'agent'): void {
    this.ensureRecording()
    this.flushMoveBuffer()
    this.flushTextBuffer()

    if (duration < 0 || !Number.isFinite(duration)) {
      throw new Error(`Invalid wait duration: ${duration}`)
    }

    const event: WaitEvent = {
      id: randomUUID(),
      type: RecordedEventType.Wait,
      timestamp: this.getRelativeTime(),
      source: source ?? 'user',
      duration,
    }

    this.appendEvent(event)
  }

  // ============================================
  // 脚本导入导出
  // ============================================

  /**
   * 导出当前录制为脚本
   *
   * 注意：不会停止录制，用于实时获取快照
   */
  exportSnapshot(): RecordingScript | null {
    if (!this.session) return null

    this.flushMoveBuffer()
    this.flushTextBuffer()

    const now = Date.now()
    const duration = now - this.session.startedAt - this.session.totalPausedDuration

    return {
      id: this.session.id,
      metadata: {
        name: this.session.metadata.name ?? 'Untitled',
        description: this.session.metadata.description ?? '',
        createdAt: this.session.metadata.createdAt ?? now,
        updatedAt: now,
        duration,
        eventCount: this.events.length,
        platform: this.session.metadata.platform ?? process.platform,
        screenResolution: this.session.metadata.screenResolution,
        tags: this.session.metadata.tags ?? [],
        createdBy: this.session.metadata.createdBy,
      },
      events: [...this.events],
    }
  }

  /**
   * 序列化脚本为 JSON 字符串
   */
  static serialize(script: RecordingScript): string {
    return JSON.stringify(script, null, 2)
  }

  /**
   * 反序列化 JSON 字符串为脚本
   *
   * @throws 若 JSON 格式错误或字段缺失
   */
  static deserialize(json: string): RecordingScript {
    const parsed = JSON.parse(json) as RecordingScript
    if (!parsed.id || !parsed.metadata || !Array.isArray(parsed.events)) {
      throw new Error('Invalid recording script: missing required fields')
    }
    return parsed
  }

  // ============================================
  // 内部工具方法
  // ============================================

  /** 确保当前正在录制 */
  private ensureRecording(): void {
    if (!this.session || this.session.state !== 'recording') {
      throw new EmergencyStopError(
        `Recorder not active (state=${this.session?.state ?? 'idle'})`,
      )
    }

    // 检查紧急停止状态
    const stopController = getEmergencyStopController()
    if (stopController.getState().stopped) {
      throw new EmergencyStopError('Emergency stop is active, cannot record')
    }
  }

  /** 获取相对录制开始的毫秒时间戳 */
  private getRelativeTime(): number {
    if (!this.session) return 0
    return Date.now() - this.session.startedAt - this.session.totalPausedDuration
  }

  /** 追加事件到序列 */
  private appendEvent(event: RecordedEvent): void {
    this.events.push(event)
    if (this.session) {
      this.session.eventCount = this.events.length
    }
    this.emit(RECORDER_EVENT_RECORDED, event)
  }

  /** 刷新鼠标移动缓冲，将路径合并为单一移动事件 */
  private flushMoveBuffer(): void {
    if (this.movePathBuffer.length === 0) {
      this.lastMoveEvent = null
      return
    }

    // 取最后一个点作为终点
    const last = this.movePathBuffer[this.movePathBuffer.length - 1]
    const first = this.movePathBuffer[0]

    const event: MouseMoveEvent = {
      id: randomUUID(),
      type: RecordedEventType.MouseMove,
      timestamp: first.t,
      source: this.lastMoveEvent?.source ?? 'user',
      x: last.x,
      y: last.y,
    }

    this.appendEvent(event)
    this.movePathBuffer = []
    this.lastMoveEvent = null
  }

  /** 刷新文本输入缓冲 */
  private flushTextBuffer(): void {
    if (this.lastTextEvent) {
      this.appendEvent(this.lastTextEvent)
      this.lastTextEvent = null
    }
  }
}

// ============================================
// 单例
// ============================================

let recorderInstance: ActionRecorder | null = null

/** 获取录制器单例 */
export function getActionRecorder(): ActionRecorder {
  if (!recorderInstance) {
    recorderInstance = new ActionRecorder()
  }
  return recorderInstance
}
