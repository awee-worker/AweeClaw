/**
 * 任务账本单元测试
 *
 * 风险排序（高 → 低）：
 *   1. 状态机非法迁移必须拒绝——放过去会产生"看起来完成其实没跑"的假记录（历史缺陷高发区）
 *   2. 进程重启后的僵尸任务收敛——运行中任务不可能存活，必须显式标记失败
 *   3. 幂等创建——触发器重复投递时不得产生重复任务
 *   4. 容量淘汰——不得淘汰运行中的任务
 *   5. trace 容量与进度上报的边界行为
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

import { TaskLedger } from '../TaskLedger'
import { DEFAULT_LEDGER_CONFIG, type CreateTaskInput } from '../types'

function makeInput(patch: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    origin: 'trigger',
    kind: 'trigger',
    title: '分析文件变更',
    ...patch,
  }
}

describe('TaskLedger — 创建与初始状态', () => {
  let ledger: TaskLedger

  beforeEach(() => {
    storeState.clear()
    ledger = new TaskLedger()
  })

  it('默认 low 风险直接进入 queued', () => {
    const task = ledger.create(makeInput())
    expect(task.status).toBe('queued')
    expect(task.risk).toBe('low')
    expect(task.trace).toHaveLength(1)
  })

  it('high 风险进入 pending_approval，未放行前不可执行', () => {
    const task = ledger.create(makeInput({ risk: 'high' }))
    expect(task.status).toBe('pending_approval')

    // pending_approval → running 不在允许迁移表内，必须抛错
    expect(() => ledger.start(task.id)).toThrow(/非法状态迁移/)
  })

  it('title 超长截断到 200 字符', () => {
    const task = ledger.create(makeInput({ title: 'x'.repeat(500) }))
    expect(task.title).toHaveLength(200)
  })
})

describe('TaskLedger — 状态机（核心风险）', () => {
  let ledger: TaskLedger

  beforeEach(() => {
    storeState.clear()
    ledger = new TaskLedger()
  })

  it('合法链路 queued → running → completed', () => {
    const task = ledger.create(makeInput())
    ledger.start(task.id)
    const done = ledger.succeed(task.id, { success: true, summary: '已修复' })

    expect(done.status).toBe('completed')
    expect(done.progress).toBe(100)
    expect(done.finishedAt).toBeTypeOf('number')
    expect(done.result?.summary).toBe('已修复')
  })

  it('queued 直接跳到 completed 被拒绝', () => {
    const task = ledger.create(makeInput())
    expect(() => ledger.succeed(task.id, { success: true })).toThrow(/非法状态迁移/)
  })

  it('completed 不可再迁移到 running', () => {
    const task = ledger.create(makeInput())
    ledger.start(task.id)
    ledger.succeed(task.id, { success: true })

    expect(() => ledger.start(task.id)).toThrow(/非法状态迁移/)
  })

  it('failed 可通过 retry 回到 queued，并清空上次结果', () => {
    const task = ledger.create(makeInput())
    ledger.start(task.id)
    ledger.fail(task.id, '编译失败')

    const retried = ledger.retry(task.id)

    expect(retried.status).toBe('queued')
    expect(retried.error).toBeNull()
    expect(retried.result).toBeNull()
    expect(retried.finishedAt).toBeNull()
  })

  it('queued 直接 retry 被拒绝', () => {
    const task = ledger.create(makeInput())
    expect(() => ledger.retry(task.id)).toThrow(/非法状态迁移/)
  })

  it('运行中任务可取消', () => {
    const task = ledger.create(makeInput())
    ledger.start(task.id)
    const cancelled = ledger.cancel(task.id)

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.finishedAt).toBeTypeOf('number')
  })

  it('操作不存在的任务抛错而非静默返回', () => {
    expect(() => ledger.start('not-exist')).toThrow(/任务不存在/)
  })

  it('终态后发射 finished 事件', () => {
    const task = ledger.create(makeInput())
    ledger.start(task.id)

    const finished: string[] = []
    ledger.on('finished', (t) => finished.push(t.status))
    ledger.succeed(task.id, { success: true })

    expect(finished).toEqual(['completed'])
  })
})

describe('TaskLedger — 进度与轨迹边界', () => {
  let ledger: TaskLedger

  beforeEach(() => {
    storeState.clear()
    ledger = new TaskLedger()
  })

  it('进度被夹在 0-100 并取整', () => {
    const task = ledger.create(makeInput())
    ledger.start(task.id)

    expect(ledger.updateProgress(task.id, 150)?.progress).toBe(100)
    expect(ledger.updateProgress(task.id, -20)?.progress).toBe(0)
    expect(ledger.updateProgress(task.id, 42.6)?.progress).toBe(43)
  })

  it('终态任务忽略进度更新，返回 null', () => {
    const task = ledger.create(makeInput())
    ledger.start(task.id)
    ledger.succeed(task.id, { success: true })

    expect(ledger.updateProgress(task.id, 50)).toBeNull()
  })

  it('trace 超过上限后保留最新 N 条', () => {
    const task = ledger.create(makeInput())
    for (let i = 0; i < DEFAULT_LEDGER_CONFIG.maxTracePerTask + 20; i++) {
      ledger.addTrace(task.id, 'system', `step-${i}`)
    }

    const fresh = ledger.get(task.id)!
    expect(fresh.trace.length).toBeLessThanOrEqual(DEFAULT_LEDGER_CONFIG.maxTracePerTask)
    // 最新一条必须在，最早一条已被裁剪
    expect(fresh.trace.at(-1)?.message).toBe(`step-${DEFAULT_LEDGER_CONFIG.maxTracePerTask + 19}`)
    expect(fresh.trace.some((t) => t.message === 'step-0')).toBe(false)
  })

  it('产物追加到 result.artifacts', () => {
    const task = ledger.create(makeInput())
    ledger.attachArtifact(task.id, { type: 'file', title: 'patch.diff', path: '/ws/p.diff' })

    const fresh = ledger.get(task.id)!
    expect(fresh.result?.artifacts).toHaveLength(1)
    expect(fresh.result?.artifacts?.[0].title).toBe('patch.diff')
  })
})

describe('TaskLedger — 幂等创建', () => {
  let ledger: TaskLedger

  beforeEach(() => {
    storeState.clear()
    ledger = new TaskLedger()
  })

  it('同幂等键在窗口内复用未结束任务', () => {
    const first = ledger.createIdempotent(makeInput({ idempotencyKey: 'k1' }))
    const second = ledger.createIdempotent(makeInput({ idempotencyKey: 'k1' }))

    expect(first.idempotent).toBe(false)
    expect(second.idempotent).toBe(true)
    expect(second.task.id).toBe(first.task.id)
    expect(ledger.list()).toHaveLength(1)
  })

  it('任务结束后同键可创建新任务', () => {
    const first = ledger.createIdempotent(makeInput({ idempotencyKey: 'k2' }))
    ledger.start(first.task.id)
    ledger.succeed(first.task.id, { success: true })

    const second = ledger.createIdempotent(makeInput({ idempotencyKey: 'k2' }))

    expect(second.idempotent).toBe(false)
    expect(second.task.id).not.toBe(first.task.id)
    expect(ledger.list()).toHaveLength(2)
  })

  it('不同幂等键互不影响', () => {
    const a = ledger.createIdempotent(makeInput({ idempotencyKey: 'a' }))
    const b = ledger.createIdempotent(makeInput({ idempotencyKey: 'b' }))

    expect(a.task.id).not.toBe(b.task.id)
  })

  it('未提供幂等键时等价于普通创建', () => {
    const first = ledger.createIdempotent(makeInput())
    const second = ledger.createIdempotent(makeInput())

    expect(first.idempotent).toBe(false)
    expect(second.idempotent).toBe(false)
    expect(second.task.id).not.toBe(first.task.id)
  })
})

describe('TaskLedger — 恢复与容量', () => {
  beforeEach(() => {
    storeState.clear()
  })

  it('进程重启后遗留的非终态任务收敛为 failed', () => {
    const first = new TaskLedger()
    const running = first.create(makeInput())
    first.start(running.id)

    // 模拟重启：新实例重新 initialize
    const second = new TaskLedger()
    second.initialize()

    const recovered = second.get(running.id)!
    expect(recovered.status).toBe('failed')
    expect(recovered.error).toBe('进程重启，任务中断')
    expect(recovered.result?.success).toBe(false)
  })

  it('已结束任务在重启后保持原状态', () => {
    const first = new TaskLedger()
    const task = first.create(makeInput())
    first.start(task.id)
    first.succeed(task.id, { success: true, summary: 'done' })

    const second = new TaskLedger()
    second.initialize()

    expect(second.get(task.id)?.status).toBe('completed')
    expect(second.get(task.id)?.result?.summary).toBe('done')
  })

  it('超出容量上限时淘汰最旧的终态任务，运行中任务保留', () => {
    const ledger = new TaskLedger()
    const running = ledger.create(makeInput())
    ledger.start(running.id)

    const oldestDone = ledger.create(makeInput())
    ledger.start(oldestDone.id)
    ledger.succeed(oldestDone.id, { success: true })

    // 填满并越过上限
    for (let i = 0; i < DEFAULT_LEDGER_CONFIG.maxTasks; i++) {
      const t = ledger.create(makeInput())
      ledger.start(t.id)
      ledger.succeed(t.id, { success: true })
    }

    const counts = ledger.countByStatus()
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0)

    expect(total).toBeLessThanOrEqual(DEFAULT_LEDGER_CONFIG.maxTasks)
    // 运行中任务不得被淘汰
    expect(ledger.get(running.id)?.status).toBe('running')
    // 最旧的终态任务应被优先淘汰
    expect(ledger.get(oldestDone.id)).toBeUndefined()
  })
})

describe('TaskLedger — 查询', () => {
  let ledger: TaskLedger

  beforeEach(() => {
    storeState.clear()
    ledger = new TaskLedger()
  })

  it('按状态过滤', () => {
    const a = ledger.create(makeInput())
    ledger.create(makeInput({ risk: 'high' }))

    const queued = ledger.list({ status: ['queued'] })
    expect(queued.map((t) => t.id)).toEqual([a.id])
  })

  it('按来源过滤', () => {
    ledger.create(makeInput({ origin: 'cron' }))
    ledger.create(makeInput({ origin: 'trigger' }))

    expect(ledger.list({ origin: 'cron' })).toHaveLength(1)
  })

  it('按创建时间倒序返回', () => {
    // 同一毫秒内连续创建时 createdAt 相同，无法断言"谁更新"，
    // 这里用可控时钟拉开时间差，验证的才是排序规则本身
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const first = ledger.create(makeInput({ title: 'first' }))
    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'))
    const second = ledger.create(makeInput({ title: 'second' }))
    vi.useRealTimers()

    const list = ledger.list()
    expect(list[0].id).toBe(second.id)
    expect(list[1].id).toBe(first.id)
  })

  it('同一毫秒创建的任务排序确定（不随插入顺序抖动）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    for (let i = 0; i < 5; i++) ledger.create(makeInput({ title: `t-${i}` }))
    vi.useRealTimers()

    const firstPass = ledger.list().map((t) => t.id)
    const secondPass = ledger.list().map((t) => t.id)
    expect(secondPass).toEqual(firstPass)
  })

  it('默认最多返回 50 条', () => {
    for (let i = 0; i < 60; i++) ledger.create(makeInput())
    expect(ledger.list()).toHaveLength(50)
  })

  it('findByOriginId 定位同一触发源产生的任务', () => {
    ledger.create(makeInput({ originId: 'rule-1' }))
    ledger.create(makeInput({ originId: 'rule-2' }))

    expect(ledger.findByOriginId('rule-1')).toHaveLength(1)
  })
})
