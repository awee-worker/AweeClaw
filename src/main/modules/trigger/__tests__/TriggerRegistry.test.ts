/**
 * 事件触发器注册表单元测试
 *
 * 覆盖方案中约定的算法契约（不依赖 electron / 文件系统）：
 *   1. 规则漏斗：sourceType / eventTypes / include / ignore
 *   2. 冷却去重：同 dedupKey 在窗口内只命中一次，且被语义拒绝的事件不占用冷却窗口
 *   3. 语义漏斗：未注入时全放行，注入后按判定结果过滤，判定器异常按放行处理
 *   4. 持久化：规则写入存储、重启后可从存储恢复
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { storeState } = vi.hoisted(() => ({ storeState: new Map<string, unknown>() }))

vi.mock('../../persistence/ModuleDataStore', () => ({
  moduleDataStore: {
    get: (key: string) => storeState.get(key),
    set: (key: string, value: unknown) => storeState.set(key, value),
    delete: (key: string) => storeState.delete(key),
    has: (key: string) => storeState.has(key),
  },
  STORE_KEYS: {
    TRIGGER_RULES: 'trigger_rules',
    TRIGGER_COOLDOWN: 'trigger_cooldown',
    TASK_LEDGER: 'task_ledger',
  },
}))

vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    system: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import { TriggerRegistry, matchesAnyPattern } from '../TriggerRegistry'
import type { TriggerEvent, TriggerRule } from '../types'

function makeRule(patch: Partial<TriggerRule> = {}): TriggerRule {
  return {
    id: 'rule-1',
    name: '源码变更',
    enabled: true,
    sourceType: 'file',
    include: ['/ws/src/**'],
    ignore: [],
    eventTypes: ['create', 'update'],
    cooldownMs: 60_000,
    action: { type: 'task', payload: '分析变更' },
    createdAt: Date.now(),
    ...patch,
  }
}

function makeEvent(patch: Partial<TriggerEvent> = {}): TriggerEvent {
  return {
    sourceType: 'file',
    sourceId: 'file-watch',
    eventType: 'update',
    subject: '/ws/src/a.ts',
    payload: {},
    timestamp: Date.now(),
    ...patch,
  }
}

describe('globToRegExp / matchesAnyPattern', () => {
  it('单个 * 不跨目录，** 可跨目录', () => {
    expect(matchesAnyPattern('/ws/src/a.ts', ['/ws/*/a.ts'])).toBe(true)
    expect(matchesAnyPattern('/ws/src/deep/a.ts', ['/ws/*/a.ts'])).toBe(false)
    expect(matchesAnyPattern('/ws/src/deep/a.ts', ['/ws/**/a.ts'])).toBe(true)
  })

  it('无通配符的模式按前缀匹配', () => {
    expect(matchesAnyPattern('/ws/src/a.ts', ['/ws/src'])).toBe(true)
    expect(matchesAnyPattern('/ws/other/a.ts', ['/ws/src'])).toBe(false)
  })

  it('Windows 反斜杠与正斜杠视为等价', () => {
    expect(matchesAnyPattern('C:\\ws\\src\\a.ts', ['C:/ws/src/**'])).toBe(true)
  })
})

describe('TriggerRegistry — 规则漏斗', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    storeState.clear()
    registry = new TriggerRegistry()
  })

  it('sourceType 不匹配时不命中', async () => {
    registry.upsertRule(makeRule())
    const hits = await registry.handleEvent(makeEvent({ sourceType: 'hook' }))
    expect(hits).toHaveLength(0)
  })

  it('eventTypes 不在白名单时不命中', async () => {
    registry.upsertRule(makeRule())
    const hits = await registry.handleEvent(makeEvent({ eventType: 'delete' }))
    expect(hits).toHaveLength(0)
  })

  it('include 未命中时不命中', async () => {
    registry.upsertRule(makeRule())
    const hits = await registry.handleEvent(makeEvent({ subject: '/ws/docs/readme.md' }))
    expect(hits).toHaveLength(0)
  })

  it('ignore 命中时即使 include 通过也丢弃', async () => {
    registry.upsertRule(makeRule({ ignore: ['/ws/src/generated/**'] }))
    const hits = await registry.handleEvent(makeEvent({ subject: '/ws/src/generated/x.ts' }))
    expect(hits).toHaveLength(0)
  })

  it('include 为空表示不限路径', async () => {
    registry.upsertRule(makeRule({ include: [] }))
    const hits = await registry.handleEvent(makeEvent({ subject: '/anywhere/b.ts' }))
    expect(hits).toHaveLength(1)
    expect(hits[0].ruleId).toBe('rule-1')
  })

  it('规则禁用后不参与匹配', async () => {
    registry.upsertRule(makeRule({ enabled: false }))
    const hits = await registry.handleEvent(makeEvent())
    expect(hits).toHaveLength(0)
  })

  it('命中后发射 hit 事件', async () => {
    registry.upsertRule(makeRule())
    const received: string[] = []
    registry.on('hit', (hit) => received.push(hit.ruleId))
    await registry.handleEvent(makeEvent())
    expect(received).toEqual(['rule-1'])
  })
})

describe('TriggerRegistry — 冷却去重', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    storeState.clear()
    registry = new TriggerRegistry()
  })

  it('同 dedupKey 在窗口内只命中一次', async () => {
    registry.upsertRule(makeRule({ cooldownMs: 60_000 }))

    const first = await registry.handleEvent(makeEvent())
    const second = await registry.handleEvent(makeEvent())

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(registry.getStats().suppressedByCooldown).toBe(1)
  })

  it('不同 subject 使用不同 dedupKey，互不影响', async () => {
    registry.upsertRule(makeRule({ cooldownMs: 60_000 }))

    const a = await registry.handleEvent(makeEvent({ subject: '/ws/src/a.ts' }))
    const b = await registry.handleEvent(makeEvent({ subject: '/ws/src/b.ts' }))

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('cooldownMs=0 表示不去重', async () => {
    registry.upsertRule(makeRule({ cooldownMs: 0 }))

    const first = await registry.handleEvent(makeEvent())
    const second = await registry.handleEvent(makeEvent())

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
  })
})

describe('TriggerRegistry — 语义漏斗', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    storeState.clear()
    registry = new TriggerRegistry()
  })

  it('未注入判定器时全部放行', async () => {
    registry.upsertRule(makeRule())
    const hits = await registry.handleEvent(makeEvent())
    expect(hits).toHaveLength(1)
  })

  it('判定器拒绝时不派发', async () => {
    registry.upsertRule(makeRule())
    registry.setSemanticChecker(() => ({ accept: false, reason: '无关变更' }))

    const hits = await registry.handleEvent(makeEvent())

    expect(hits).toHaveLength(0)
    expect(registry.getStats().rejectedBySemantic).toBe(1)
  })

  it('被拒绝的事件不占用冷却窗口，后续可通过', async () => {
    registry.upsertRule(makeRule({ cooldownMs: 60_000 }))

    registry.setSemanticChecker(() => ({ accept: false }))
    await registry.handleEvent(makeEvent())

    registry.setSemanticChecker(() => ({ accept: true }))
    const hits = await registry.handleEvent(makeEvent())

    expect(hits).toHaveLength(1)
  })

  it('判定器抛错时按放行处理，不吞事件', async () => {
    registry.upsertRule(makeRule())
    registry.setSemanticChecker(() => {
      throw new Error('model unavailable')
    })

    const hits = await registry.handleEvent(makeEvent())
    expect(hits).toHaveLength(1)
  })
})

describe('TriggerRegistry — 统计口径（成对计数）', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    storeState.clear()
    registry = new TriggerRegistry()
  })

  it('单条规则命中后通过数与出口数守恒', async () => {
    registry.upsertRule(makeRule())
    await registry.handleEvent(makeEvent())

    const s = registry.getStats()
    expect(s.receivedEvents).toBe(1)
    expect(s.passedRules).toBe(1)
    expect(s.dispatchedHits).toBe(1)
    expect(s.unaccountedDrops).toBe(0)
  })

  it('同一事件命中多条规则时按规则累加，守恒仍成立', async () => {
    registry.upsertRule(makeRule({ id: 'r1', cooldownMs: 0 }))
    registry.upsertRule(makeRule({ id: 'r2', cooldownMs: 0 }))
    registry.upsertRule(makeRule({ id: 'r3', cooldownMs: 0 }))

    const hits = await registry.handleEvent(makeEvent())
    const s = registry.getStats()

    // passedRules 是（事件 × 规则）次数，不是事件数
    expect(hits).toHaveLength(3)
    expect(s.receivedEvents).toBe(1)
    expect(s.passedRules).toBe(3)
    expect(s.dispatchedHits).toBe(3)
    expect(s.unaccountedDrops).toBe(0)
  })

  it('派发 / 冷却抑制 / 语义拒绝三个出口混合时守恒仍成立', async () => {
    // r1 每轮都派发，r2 第二轮进冷却，r3 每轮被语义拒绝
    registry.upsertRule(makeRule({ id: 'r1', cooldownMs: 0 }))
    registry.upsertRule(makeRule({ id: 'r2', cooldownMs: 60_000 }))
    registry.upsertRule(makeRule({ id: 'r3', cooldownMs: 0 }))
    registry.setSemanticChecker((hit) =>
      hit.ruleId === 'r3' ? { accept: false, reason: 'noise' } : { accept: true },
    )

    await registry.handleEvent(makeEvent())
    await registry.handleEvent(makeEvent())

    const s = registry.getStats()
    expect(s.passedRules).toBe(6) // 2 轮 × 3 条规则
    expect(s.dispatchedHits).toBe(3) // 首轮 r1/r2，二轮 r1
    expect(s.suppressedByCooldown).toBe(1) // 二轮 r2
    expect(s.rejectedBySemantic).toBe(2) // 两轮 r3
    expect(s.unaccountedDrops).toBe(0)
  })

  it('全部被冷却抑制时守恒仍成立', async () => {
    registry.upsertRule(makeRule({ cooldownMs: 60_000 }))

    await registry.handleEvent(makeEvent())
    await registry.handleEvent(makeEvent())

    const s = registry.getStats()
    expect(s.passedRules).toBe(2)
    expect(s.dispatchedHits).toBe(1)
    expect(s.suppressedByCooldown).toBe(1)
    expect(s.unaccountedDrops).toBe(0)
  })
})

describe('TriggerRegistry — 持久化与恢复', () => {
  beforeEach(() => {
    storeState.clear()
  })

  it('规则写入存储，新实例 start 后可恢复', async () => {
    const first = new TriggerRegistry()
    first.upsertRule(makeRule())

    const second = new TriggerRegistry()
    await second.start()

    expect(second.listRules()).toHaveLength(1)
    expect(second.getRule('rule-1')?.name).toBe('源码变更')
    await second.stop()
  })

  it('冷却状态跨实例保留，避免重启后重复告警', async () => {
    const first = new TriggerRegistry()
    first.upsertRule(makeRule({ cooldownMs: 60_000 }))
    await first.handleEvent(makeEvent())

    const second = new TriggerRegistry()
    await second.start()
    const hits = await second.handleEvent(makeEvent())

    expect(hits).toHaveLength(0)
    await second.stop()
  })
})

describe('TriggerRegistry — 事件源管理', () => {
  beforeEach(() => {
    storeState.clear()
  })

  it('注册源后 start 会启动它；已启动时注册立即启动', async () => {
    const registry = new TriggerRegistry()
    const started: string[] = []

    const source = {
      id: 'mock-source',
      type: 'custom' as const,
      start: () => {
        started.push('start')
      },
      stop: () => {
        started.push('stop')
      },
    }

    await registry.registerSource(source)
    expect(started).toEqual([])

    await registry.start()
    expect(started).toEqual(['start'])
    expect(registry.listSources()).toEqual([{ id: 'mock-source', type: 'custom' }])

    await registry.stop()
    expect(started).toEqual(['start', 'stop'])
  })

  it('事件源 start 抛错不影响注册表启动', async () => {
    const registry = new TriggerRegistry()
    await registry.registerSource({
      id: 'broken',
      type: 'custom',
      start: () => {
        throw new Error('boom')
      },
      stop: () => undefined,
    })

    await expect(registry.start()).resolves.toBeUndefined()
    expect(registry.isRunning()).toBe(true)
    await registry.stop()
  })
})
