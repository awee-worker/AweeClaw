/**
 * 直播事件总线单元测试
 *
 * 重点回归总线自身的三个核心语义（不涉及 electron / 文件系统，可直接跑）：
 *   1. 去重：同一 `id` 只投递一次，重复命中计入 `duplicatedEvents`
 *   2. 洪水保护：1s 窗口超阈值后丢弃低优先级类型（like / enter_room），
 *      保住 danmaku / gift 等高价值事件
 *   3. 订阅隔离：单个订阅者抛错不影响其他订阅者与发布流程；取消订阅后不再接收
 */

import { describe, it, expect, vi } from 'vitest'
import { LiveEventBus, createLiveEvent, RECENT_EVENT_LIMIT } from '../LiveEventBus'
import type { LiveEvent } from '../types'

/** 快速生成 N 条指定类型的事件并发布，返回发布结果 */
function publishMany(bus: LiveEventBus, count: number, danmu_type: LiveEvent['danmu_type']): boolean[] {
  const results: boolean[] = []
  for (let i = 0; i < count; i++) {
    results.push(bus.publish(createLiveEvent('bilibili', danmu_type, `msg-${i}`)))
  }
  return results
}

describe('LiveEventBus', () => {
  it('发布的事件完整分发给订阅者，字段符合归一化契约', () => {
    const bus = new LiveEventBus()
    const received: LiveEvent[] = []
    bus.onEvent(event => received.push(event))

    const ok = bus.publish(createLiveEvent('youtube', 'gift', '谢谢老板'))

    expect(ok).toBe(true)
    expect(received).toHaveLength(1)
    const event = received[0]
    expect(event.id).toBeTruthy()
    expect(event.type).toBe('message')
    expect(event.content).toBe('谢谢老板')
    expect(event.danmu_type).toBe('gift')
    expect(event.platform).toBe('youtube')
    expect(event.ts).toBeGreaterThan(0)
  })

  it('同一 id 重复发布被去重，只投递一次', () => {
    const bus = new LiveEventBus()
    const received: LiveEvent[] = []
    bus.onEvent(event => received.push(event))

    const event = createLiveEvent('twitch', 'danmaku', 'hello')
    expect(bus.publish(event)).toBe(true)
    expect(bus.publish({ ...event })).toBe(false)

    expect(received).toHaveLength(1)
    expect(bus.getStats().duplicatedEvents).toBe(1)
    expect(bus.getStats().totalEvents).toBe(1)
  })

  it('去重表达到上限后逐出最旧的 id，允许其再次通过', () => {
    const bus = new LiveEventBus()
    const make = (id: string): LiveEvent => ({
      id,
      type: 'message',
      content: id,
      danmu_type: 'danmaku',
      platform: 'bilibili',
      ts: Date.now(),
    })

    // 灌满去重表（上限 1000）
    for (let i = 0; i < 1000; i++) {
      bus.publish(make(`id-${i}`))
    }
    expect(bus.getStats().totalEvents).toBe(1000)

    // 第 1001 条把最旧的 id-0 挤出 LRU
    expect(bus.publish(make('id-1000'))).toBe(true)

    // id-0 已被逐出，可再次通过
    expect(bus.publish(make('id-0'))).toBe(true)
    // 逐出发生在「插入之后」：id-0 重新入表时把次旧的 id-1 挤出，
    // 因此 id-1 此刻同样可再次通过（容量恒为上限，无重复命中）
    expect(bus.publish(make('id-1'))).toBe(true)
    expect(bus.getStats().duplicatedEvents).toBe(0)
  })

  it('洪水保护：1s 窗口超阈值后丢弃低优先级类型，保留弹幕', () => {
    const bus = new LiveEventBus()
    const received: LiveEvent[] = []
    bus.onEvent(event => received.push(event))

    // 前 20 条为阈值内：低优先级也正常投递
    const inWindow = publishMany(bus, 20, 'like')
    expect(inWindow.every(ok => ok)).toBe(true)

    // 第 21 条起：低优先级被丢弃，弹幕仍投递
    expect(bus.publish(createLiveEvent('bilibili', 'like', 'flooded-like'))).toBe(false)
    expect(bus.publish(createLiveEvent('bilibili', 'enter_room', 'flooded-enter'))).toBe(false)
    expect(bus.publish(createLiveEvent('bilibili', 'danmaku', 'kept-danmaku'))).toBe(true)
    expect(bus.publish(createLiveEvent('bilibili', 'gift', 'kept-gift'))).toBe(true)

    const stats = bus.getStats()
    expect(stats.droppedEvents).toBe(2)
    const contents = received.map(event => event.content)
    expect(contents).toContain('kept-danmaku')
    expect(contents).toContain('kept-gift')
    expect(contents).not.toContain('flooded-like')
  })

  it('最近事件缓存：最新在前，受上限约束', () => {
    const bus = new LiveEventBus()

    for (let i = 0; i < RECENT_EVENT_LIMIT + 5; i++) {
      bus.publish(createLiveEvent('bilibili', 'danmaku', `recent-${i}`))
    }

    const recent = bus.getRecentEvents(RECENT_EVENT_LIMIT)
    expect(recent).toHaveLength(RECENT_EVENT_LIMIT)
    // 最新一条是最后发布的 recent-N
    expect(recent[0].content).toBe(`recent-${RECENT_EVENT_LIMIT + 4}`)
    expect(recent[recent.length - 1].content).toBe(`recent-5`)

    // limit 生效
    expect(bus.getRecentEvents(3)).toHaveLength(3)
  })

  it('单个订阅者抛错不影响其他订阅者与发布流程', () => {
    const bus = new LiveEventBus()
    const received: LiveEvent[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    bus.onEvent(() => {
      throw new Error('boom')
    })
    bus.onEvent(event => received.push(event))

    expect(bus.publish(createLiveEvent('bilibili', 'danmaku', 'survivor'))).toBe(true)
    expect(received).toHaveLength(1)
    expect(received[0].content).toBe('survivor')

    warn.mockRestore()
  })

  it('取消订阅后不再接收事件', () => {
    const bus = new LiveEventBus()
    const received: LiveEvent[] = []
    const unsubscribe = bus.onEvent(event => received.push(event))

    bus.publish(createLiveEvent('bilibili', 'danmaku', 'first'))
    unsubscribe()
    bus.publish(createLiveEvent('bilibili', 'danmaku', 'second'))

    expect(received).toHaveLength(1)
    expect(received[0].content).toBe('first')
  })

  it('reset 清空去重表 / 缓存 / 计数器，同一 id 可重新发布', () => {
    const bus = new LiveEventBus()
    const event = createLiveEvent('bilibili', 'danmaku', 'reusable')

    expect(bus.publish(event)).toBe(true)
    expect(bus.publish({ ...event })).toBe(false)

    bus.reset()

    expect(bus.publish(event)).toBe(true)
    expect(bus.getStats()).toEqual({ totalEvents: 1, droppedEvents: 0, duplicatedEvents: 0 })
    expect(bus.getRecentEvents()).toHaveLength(1)
  })
})
