/**
 * 操作回放器（L5 智能工作流层）
 *
 * 职责：
 * 1. 回放录制脚本中的事件序列
 * 2. 支持多种回放速度（实时、快速、即时、自定义倍率）
 * 3. 支持事件间最小/最大间隔限制
 * 4. 错误处理与停止策略
 * 5. 与紧急停止机制集成，可随时中断回放
 * 6. 实时进度回调
 *
 * @module desktop-control/ActionReplayer
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import {
  getEmergencyStopController,
  EmergencyStopError,
} from './EmergencyStop'
import { getDesktopControlManager } from './DesktopControlManager'
import type { DesktopControlManager } from './DesktopControlManager'
import {
  type RecordingScript,
  type RecordedEvent,
  type ReplayConfig,
  type ReplayProgress,
  type ReplayResult,
  type ReplayError,
  RecordedEventType,
} from './types/recording'

// ============================================
// 事件类型常量
// ============================================

export const REPLAYER_EVENT_PROGRESS = 'replayer:progress'
export const REPLAYER_EVENT_COMPLETED = 'replayer:completed'
export const REPLAYER_EVENT_ERROR = 'replayer:error'
export const REPLAYER_EVENT_ABORTED = 'replayer:aborted'

// ============================================
// 默认配置
// ============================================

const DEFAULT_CONFIG: ReplayConfig = {
  speed: 'realtime',
  stopOnError: true,
  maxErrors: 5,
  minInterval: 10,
  maxInterval: 60_000,
}

// ============================================
// 回放器实现
// ============================================

/**
 * 操作回放器
 *
 * 使用方式：
 * ```ts
 * const replayer = new ActionReplayer(manager)
 * const result = await replayer.replay(script, {
 *   speed: 'fast',
 *   stopOnError: false,
 * })
 * ```
 */
export class ActionReplayer extends EventEmitter {
  private abortController: AbortController | null = null
  private isRunning = false
  private startTime = 0

  constructor(private readonly manager: DesktopControlManager) {
    super()
  }

  /** 当前是否正在回放 */
  get running(): boolean {
    return this.isRunning
  }

  /**
   * 回放录制脚本
   *
   * @param script 录制脚本
   * @param config 回放配置
   * @returns 回放结果
   */
  async replay(script: RecordingScript, config?: Partial<ReplayConfig>): Promise<ReplayResult> {
    if (this.isRunning) {
      throw new Error('Replayer is already running')
    }

    const mergedConfig: ReplayConfig = { ...DEFAULT_CONFIG, ...config }
    const events = this.sliceEvents(script.events, mergedConfig)

    if (events.length === 0) {
      return {
        success: true,
        executedCount: 0,
        successCount: 0,
        errorCount: 0,
        duration: 0,
        errors: [],
        aborted: false,
      }
    }

    this.isRunning = true
    this.startTime = Date.now()
    this.abortController = new AbortController()

    // 监听紧急停止
    const stopController = getEmergencyStopController()
    const onEmergencyStop = (): void => {
      logger.desktop.info('[ActionReplayer] Emergency stop triggered, aborting replay')
      this.abortController?.abort()
    }
    stopController.on('emergency-stop', onEmergencyStop)

    const errors: ReplayError[] = []
    let successCount = 0
    let executedCount = 0
    let aborted = false

    try {
      for (let i = 0; i < events.length; i++) {
        // 检查中止信号
        if (this.abortController.signal.aborted) {
          aborted = true
          break
        }

        const event = events[i]
        const progress = this.buildProgress(i, events.length, executedCount, successCount, errors.length, event)
        this.emit(REPLAYER_EVENT_PROGRESS, progress)

        // 计算等待时间
        const waitMs = this.calculateWaitTime(event, events[i + 1], mergedConfig)
        if (waitMs > 0) {
          await this.sleep(waitMs)
          if (this.abortController.signal.aborted) {
            aborted = true
            break
          }
        }

        // 执行事件
        try {
          await this.executeEvent(event)
          executedCount++
          successCount++
        } catch (err) {
          executedCount++
          const error: ReplayError = {
            eventIndex: i,
            event,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          }
          errors.push(error)
          this.emit(REPLAYER_EVENT_ERROR, error)

          logger.desktop.warn(
            `[ActionReplayer] Event ${i} (${event.type}) failed: ${error.error}`,
          )

          // 紧急停止错误直接中止
          if (err instanceof EmergencyStopError) {
            aborted = true
            break
          }

          // 达到最大错误数则停止
          if (mergedConfig.stopOnError && errors.length >= mergedConfig.maxErrors) {
            logger.desktop.warn(
              `[ActionReplayer] Max errors (${mergedConfig.maxErrors}) reached, stopping`,
            )
            break
          }
        }
      }
    } finally {
      stopController.off('emergency-stop', onEmergencyStop)
      this.isRunning = false
      this.abortController = null
    }

    const duration = Date.now() - this.startTime
    const result: ReplayResult = {
      success: errors.length === 0 && !aborted,
      executedCount,
      successCount,
      errorCount: errors.length,
      duration,
      errors,
      aborted,
    }

    this.emit(REPLAYER_EVENT_COMPLETED, result)
    return result
  }

  /**
   * 中止当前回放
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  // ============================================
  // 内部方法
  // ============================================

  /** 按起止索引切片事件 */
  private sliceEvents(events: RecordedEvent[], config: ReplayConfig): RecordedEvent[] {
    const start = config.startIndex ?? 0
    const end = config.endIndex !== undefined ? config.endIndex + 1 : events.length
    return events.slice(start, end)
  }

  /** 计算当前事件后应等待的时间 */
  private calculateWaitTime(
    current: RecordedEvent,
    next: RecordedEvent | undefined,
    config: ReplayConfig,
  ): number {
    // 显式等待事件
    if (current.type === RecordedEventType.Wait) {
      return this.scaleDuration(current.duration, config)
    }

    if (!next) return 0

    // 计算与下一事件的间隔
    const rawInterval = next.timestamp - current.timestamp
    let interval = rawInterval

    // 应用速度倍率
    interval = this.scaleDuration(interval, config)

    // 应用最小/最大限制
    if (config.minInterval !== undefined) {
      interval = Math.max(interval, config.minInterval)
    }
    if (config.maxInterval !== undefined) {
      interval = Math.min(interval, config.maxInterval)
    }

    return Math.max(0, interval)
  }

  /** 根据速度模式缩放时间 */
  private scaleDuration(ms: number, config: ReplayConfig): number {
    switch (config.speed) {
      case 'instant':
        return 0
      case 'fast':
        return Math.floor(ms * 0.3)
      case 'custom':
        return Math.floor(ms / (config.speedMultiplier ?? 1))
      case 'realtime':
      default:
        return ms
    }
  }

  /** 执行单个事件 */
  private async executeEvent(event: RecordedEvent): Promise<void> {
    switch (event.type) {
      case RecordedEventType.MouseClick:
        await this.manager.inputSimulator.click({
          x: event.x,
          y: event.y,
          button: event.button,
          clickType: event.clickType,
        })
        break

      case RecordedEventType.MouseMove:
        await this.manager.inputSimulator.move({ x: event.x, y: event.y })
        break

      case RecordedEventType.MouseScroll:
        await this.manager.inputSimulator.scroll({
          x: event.x,
          y: event.y,
          amount: event.amount,
        })
        break

      case RecordedEventType.MouseDrag:
        await this.manager.inputSimulator.drag({
          fromX: event.fromX,
          fromY: event.fromY,
          toX: event.toX,
          toY: event.toY,
          button: event.button,
        })
        break

      case RecordedEventType.KeyPress:
        await this.manager.inputSimulator.pressKey(event.key)
        break

      case RecordedEventType.KeyCombo:
        await this.manager.inputSimulator.keyCombo(event.keys)
        break

      case RecordedEventType.TypeText:
        await this.manager.inputSimulator.typeText(event.text)
        break

      case RecordedEventType.WindowFocus:
        await this.manager.windowManager.focus(event.windowId)
        break

      case RecordedEventType.AppLaunch:
        await this.manager.launcher.launch(event.appName, event.args)
        break

      case RecordedEventType.Wait:
        // 等待已在 calculateWaitTime 中处理
        break

      default:
        logger.desktop.warn(`[ActionReplayer] Unknown event type: ${(event as RecordedEvent).type}`)
    }
  }

  /** 构建进度对象 */
  private buildProgress(
    currentIndex: number,
    totalEvents: number,
    executedCount: number,
    successCount: number,
    errorCount: number,
    currentEvent: RecordedEvent,
  ): ReplayProgress {
    const elapsed = Date.now() - this.startTime
    const avgPerEvent = executedCount > 0 ? elapsed / executedCount : 0
    const remaining = (totalEvents - currentIndex) * avgPerEvent

    return {
      currentIndex,
      totalEvents,
      executedCount,
      successCount,
      errorCount,
      elapsed,
      estimatedRemaining: remaining,
      currentEvent,
    }
  }

  /** 可中断的 sleep */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (ms <= 0) {
        resolve()
        return
      }
      const timer = setTimeout(resolve, ms)
      this.abortController?.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }
}

// 单例
let _replayer: ActionReplayer | null = null

/** 获取 ActionReplayer 单例 */
export function getActionReplayer(): ActionReplayer {
  if (!_replayer) {
    _replayer = new ActionReplayer(getDesktopControlManager())
  }
  return _replayer
}
