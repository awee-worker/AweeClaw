/**
 * 钩子事件源
 *
 * 把既有的插件钩子事件（before-tool-call / after-tool-call / on-channel-error 等）
 * 译为触发器事件，让"Agent 生命周期里发生的事"也能驱动任务创建。
 *
 * 事件主体用钩子事件名（如 `after-tool-call`），规则里直接写 eventTypes 即可筛选。
 *
 * @module trigger/sources/HookEventSource
 */

import { logger } from '@shared/toolkit/LogEngine'
import { hookEngine } from '@shared/plugin-sdk/hooks'
import { TRIGGER_LOG_PREFIX, type TriggerEvent, type TriggerSource, type TriggerSourceType } from '../types'

export interface HookEventSourceOptions {
  id?: string
  /** 只订阅这些钩子事件，空数组表示全部 */
  events?: string[]
  /** 把钩子事件名映射为触发器 eventType，默认原样透传 */
  mapEventType?: (hookEvent: string) => string
}

export class HookEventSource implements TriggerSource {
  readonly id: string
  readonly type: TriggerSourceType = 'hook'

  private readonly allowEvents: Set<string>
  private readonly mapEventType: (hookEvent: string) => string
  private unsubscribe: (() => void) | null = null

  constructor(options: HookEventSourceOptions = {}) {
    this.id = options.id ?? 'hook-events'
    this.allowEvents = new Set(options.events ?? [])
    this.mapEventType = options.mapEventType ?? ((name) => name)
  }

  start(onEvent: (event: TriggerEvent) => void): void {
    if (this.unsubscribe) return

    this.unsubscribe = hookEngine.onEvent((event, result) => {
      if (this.allowEvents.size > 0 && !this.allowEvents.has(event)) return

      onEvent({
        sourceType: 'hook',
        sourceId: this.id,
        eventType: this.mapEventType(event),
        // 钩子事件名即主体，便于规则按来源筛选
        subject: event,
        payload: {
          hookEvent: event,
          proceed: result?.proceed ?? true,
          reason: result?.reason ?? null,
        },
        timestamp: Date.now(),
      })
    })

    logger.system.info(`${TRIGGER_LOG_PREFIX} 钩子事件源已接入: ${this.id}`)
  }

  stop(): void {
    if (!this.unsubscribe) return
    this.unsubscribe()
    this.unsubscribe = null
    logger.system.info(`${TRIGGER_LOG_PREFIX} 钩子事件源已断开: ${this.id}`)
  }
}
