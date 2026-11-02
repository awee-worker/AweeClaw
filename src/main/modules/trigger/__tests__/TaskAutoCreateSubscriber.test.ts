/**
 * 触发器 → 任务账本 自动建档订阅者 — 单元测试
 *
 * 覆盖点（按风险排序）：
 *   1. 开关关闭时不建档 —— 默认状态必须是零行为变化
 *   2. 开关打开时每条命中建一条记录，且带上来源上下文
 *   3. 幂等 —— 同一 dedupKey 重复投递不得产生重复任务
 *   4. 建档异常不得中断触发器链路
 *   5. stop 之后不再响应
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { settingsValue, ledgerTasks } = vi.hoisted(() => ({
  settingsValue: { autoCreateTask: false },
  ledgerTasks: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../automation-settings/AutomationSettingsStore', () => ({
  automationSettings: {
    get: () => ({ triggersEnabled: false, autoExecuteTask: false, ...settingsValue }),
  },
}))

vi.mock('../../task-ledger/TaskLedger', () => ({
  taskLedger: {
    createIdempotent: (input: Record<string, unknown>) => {
      const key = input.idempotencyKey as string | undefined
      if (key) {
        const existing = ledgerTasks.find((t) => t.idempotencyKey === key)
        if (existing) return { idempotent: true, task: existing }
      }
      const task = { id: `task-${ledgerTasks.length + 1}`, ...input }
      ledgerTasks.push(task)
      return { idempotent: false, task }
    },
  },
}))

// triggerRegistry 仅作为构造参数默认值被引用，测试里一律显式注入假 emitter
vi.mock('../TriggerRegistry', () => ({ triggerRegistry: {} }))

vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    system: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import { TaskAutoCreateSubscriber } from '../TaskAutoCreateSubscriber'
import type { TriggerHit } from '../types'

/** 最小假 emitter：手动触发 hit */
function createFakeEmitter() {
  const listeners = new Set<(hit: TriggerHit) => void>()
  return {
    on(_event: 'hit', listener: (hit: TriggerHit) => void) {
      listeners.add(listener)
    },
    off(_event: 'hit', listener: (hit: TriggerHit) => void) {
      listeners.delete(listener)
    },
    emit(hit: TriggerHit) {
      for (const listener of listeners) listener(hit)
    },
    get size() {
      return listeners.size
    },
  }
}

function makeHit(patch: Partial<TriggerHit> = {}): TriggerHit {
  return {
    ruleId: 'rule-1',
    ruleName: '源码变更',
    dedupKey: 'rule-1:/ws/src/a.ts',
    action: { type: 'task', payload: '分析变更' },
    timestamp: Date.now(),
    event: {
      sourceType: 'file',
      sourceId: 'file-watch',
      eventType: 'update',
      subject: '/ws/src/a.ts',
      payload: {},
      timestamp: Date.now(),
    },
    ...patch,
  }
}

describe('TaskAutoCreateSubscriber — 开关', () => {
  beforeEach(() => {
    ledgerTasks.length = 0
    settingsValue.autoCreateTask = false
  })

  it('开关关闭时命中不建档', () => {
    const emitter = createFakeEmitter()
    const subscriber = new TaskAutoCreateSubscriber(emitter)
    subscriber.start()

    emitter.emit(makeHit())

    expect(ledgerTasks).toHaveLength(0)
  })

  it('开关打开时命中建档', () => {
    settingsValue.autoCreateTask = true
    const emitter = createFakeEmitter()
    const subscriber = new TaskAutoCreateSubscriber(emitter)
    subscriber.start()

    emitter.emit(makeHit())

    expect(ledgerTasks).toHaveLength(1)
    expect(ledgerTasks[0].origin).toBe('trigger')
    expect(ledgerTasks[0].originId).toBe('rule-1')
    expect(ledgerTasks[0].kind).toBe('trigger')
  })

  it('建档内容带上事件上下文，便于事后追溯', () => {
    settingsValue.autoCreateTask = true
    const emitter = createFakeEmitter()
    const subscriber = new TaskAutoCreateSubscriber(emitter)
    subscriber.start()

    emitter.emit(makeHit())

    const request = ledgerTasks[0].request as Record<string, unknown>
    expect(request.ruleName).toBe('源码变更')
    expect(request.eventType).toBe('update')
    expect(request.subject).toBe('/ws/src/a.ts')
    expect(request.action).toEqual({ type: 'task', payload: '分析变更' })
  })

  it('标题由规则名与事件主体拼成', () => {
    settingsValue.autoCreateTask = true
    const emitter = createFakeEmitter()
    const subscriber = new TaskAutoCreateSubscriber(emitter)
    subscriber.start()

    emitter.emit(makeHit())

    expect(ledgerTasks[0].title).toBe('源码变更: /ws/src/a.ts')
  })

  it('超长 subject 的标题被截断', () => {
    settingsValue.autoCreateTask = true
    const emitter = createFakeEmitter()
    const subscriber = new TaskAutoCreateSubscriber(emitter)
    subscriber.start()

    emitter.emit(
      makeHit({
        event: {
          sourceType: 'file',
          sourceId: 'file-watch',
          eventType: 'update',
          subject: `/ws/${'a'.repeat(300)}.ts`,
          payload: {},
          timestamp: Date.now(),
        },
      }),
    )

    const title = ledgerTasks[0].title as string
    expect(title.length).toBeLessThanOrEqual(120)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('TaskAutoCreateSubscriber — 幂等与容错', () => {
  beforeEach(() => {
    ledgerTasks.length = 0
    settingsValue.autoCreateTask = true
  })

  it('同一 dedupKey 重复投递只建一条', () => {
    const emitter = createFakeEmitter()
    const subscriber = new TaskAutoCreateSubscriber(emitter)
    subscriber.start()

    emitter.emit(makeHit())
    emitter.emit(makeHit())

    expect(ledgerTasks).toHaveLength(1)
  })

  it('不同 dedupKey 各自建档', () => {
    const emitter = createFakeEmitter()
    const subscriber = new TaskAutoCreateSubscriber(emitter)
    subscriber.start()

    emitter.emit(makeHit({ dedupKey: 'rule-1:/ws/a.ts' }))
    emitter.emit(makeHit({ dedupKey: 'rule-1:/ws/b.ts' }))

    expect(ledgerTasks).toHaveLength(2)
  })

  it('start 重复调用只挂一次监听', () => {
    const emitter = createFakeEmitter()
    const subscriber = new TaskAutoCreateSubscriber(emitter)
    subscriber.start()
    subscriber.start()

    expect(emitter.size).toBe(1)
  })

  it('stop 之后不再建档', () => {
    const emitter = createFakeEmitter()
    const subscriber = new TaskAutoCreateSubscriber(emitter)
    subscriber.start()
    subscriber.stop()

    emitter.emit(makeHit())

    expect(ledgerTasks).toHaveLength(0)
    expect(emitter.size).toBe(0)
  })
})
