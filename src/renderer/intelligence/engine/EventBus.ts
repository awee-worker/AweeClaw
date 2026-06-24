/**
 * 事件总线统一入口
 *
 * 本文件提供两种事件总线：
 * 1. EventBus — 全局智能事件总线实例（来自 EventDispatcher，强类型）
 * 2. FlexibleEventBus — 灵活的事件总线类（字符串事件名，供继承使用）
 *
 * 新代码推荐使用 EventDispatcher 中的强类型 API。
 */

import { EventBus as IntelligenceEventBusInstance, IntelligenceEventBus } from './EventDispatcher'

/* ------------------------------------------------------------------ */
/* 灵活事件总线（字符串事件名，供继承使用）                            */
/* ------------------------------------------------------------------ */

export type EventCallback = (...args: any[]) => void

/**
 * 灵活事件总线
 *
 * 使用字符串事件名，适用于自定义事件场景
 */
export class FlexibleEventBus {
  private listeners = new Map<string, Set<EventCallback>>()

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
    return () => this.off(event, callback)
  }

  off(event: string, callback?: EventCallback): void {
    if (callback) {
      this.listeners.get(event)?.delete(callback)
    } else {
      this.listeners.delete(event)
    }
  }

  emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach(cb => cb(...args))
  }

  once(event: string, callback: EventCallback): () => void {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper)
      callback(...args)
    }
    return this.on(event, wrapper)
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event)
    } else {
      this.listeners.clear()
    }
  }
}

/* ------------------------------------------------------------------ */
/* 统一导出                                                            */
/* ------------------------------------------------------------------ */

/** 全局智能事件总线实例（强类型，推荐使用） */
export const EventBus = IntelligenceEventBusInstance

/** 全局事件总线实例别名（向后兼容） */
export const globalEventBus = IntelligenceEventBusInstance

/** 智能事件总线类（强类型） */
export { IntelligenceEventBus, IntelligenceEventBus as EventBusClass }
