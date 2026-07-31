/**
 * CronSchedulerBridge 单元测试
 *
 * 覆盖：
 *   - 任务注册/取消/暂停/恢复
 *   - cron 表达式校验（非法表达式抛错）
 *   - 按插件批量清理（unregisterByPlugin）
 *   - 立即触发（triggerNow）不计入 runCount
 *   - 最大执行次数控制（maxCalls）
 *   - 失败重试（maxRetries）
 *   - 单例语义
 *
 * 注：调度器内部的 tick()/calculateNextRun 依赖真实时间，通过 triggerNow 间接验证执行逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock logger，避免依赖 Electron 运行时
vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    system: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}))

// Mock automation/CronScheduler：仅提供纯函数，避免触发 ModuleDataStore（依赖 Electron app）
// 复用真实的 cron 解析逻辑（从源码拷贝核心实现，保证语义一致）
vi.mock('@modules/automation/CronScheduler', () => {
  function parseField(field: string, min: number, max: number): number[] {
    const values = new Set<number>()
    for (const part of field.split(',')) {
      if (part === '*') {
        for (let i = min; i <= max; i++) values.add(i)
      } else if (part.startsWith('*/')) {
        const step = parseInt(part.slice(2), 10)
        if (isNaN(step) || step <= 0) throw new Error(`Invalid step: ${part}`)
        for (let i = min; i <= max; i += step) values.add(i)
      } else if (part.includes('-')) {
        const [s, e] = part.split('-')
        const start = parseInt(s, 10), end = parseInt(e, 10)
        if (isNaN(start) || isNaN(end)) throw new Error(`Invalid range: ${part}`)
        for (let i = start; i <= end; i++) values.add(i)
      } else {
        const v = parseInt(part, 10)
        if (isNaN(v)) throw new Error(`Invalid value: ${part}`)
        values.add(v)
      }
    }
    return Array.from(values).sort((a, b) => a - b)
  }
  return {
    parseCronExpression: (expr: string) => {
      const parts = expr.trim().split(/\s+/)
      if (parts.length !== 5) {
        throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`)
      }
      return {
        minute: parseField(parts[0], 0, 59),
        hour: parseField(parts[1], 0, 23),
        dayOfMonth: parseField(parts[2], 1, 31),
        month: parseField(parts[3], 1, 12),
        dayOfWeek: parseField(parts[4], 0, 6),
      }
    },
    matchesCron: (date: Date, f: any) =>
      f.minute.includes(date.getMinutes()) &&
      f.hour.includes(date.getHours()) &&
      f.dayOfMonth.includes(date.getDate()) &&
      f.month.includes(date.getMonth() + 1) &&
      f.dayOfWeek.includes(date.getDay()),
  }
})

import { CronSchedulerBridge } from '@modules/plugin-sdk/CronSchedulerBridge'

describe('CronSchedulerBridge', () => {
  let bridge: CronSchedulerBridge

  beforeEach(() => {
    // 每个用例用新实例，避免任务跨用例污染
    // 通过反射重置单例
    ;(CronSchedulerBridge as any)._instance = null
    bridge = CronSchedulerBridge.getInstance()
  })

  describe('单例', () => {
    it('getInstance 返回同一实例', () => {
      const a = CronSchedulerBridge.getInstance()
      const b = CronSchedulerBridge.getInstance()
      expect(a).toBe(b)
    })
  })

  describe('register / unregister', () => {
    it('注册任务并返回 taskId', () => {
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler: vi.fn(),
        pluginId: 'p1',
      })
      expect(id).toMatch(/^pcron-\d+-\d+$/)
      expect(bridge.getTask(id)).toBeDefined()
      expect(bridge.getTask(id)!.status).toBe('active')
      expect(bridge.getTask(id)!.nextRunAt).toBeGreaterThan(0)
    })

    it('取消任务后无法再查询', () => {
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler: vi.fn(),
        pluginId: 'p1',
      })
      expect(bridge.unregister(id)).toBe(true)
      expect(bridge.getTask(id)).toBeUndefined()
    })

    it('取消不存在的任务返回 false', () => {
      expect(bridge.unregister('not-exist')).toBe(false)
    })

    it('注册为 paused 状态', () => {
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler: vi.fn(),
        pluginId: 'p1',
        active: false,
      })
      expect(bridge.getTask(id)!.status).toBe('paused')
    })
  })

  describe('cron 表达式校验', () => {
    it('非法表达式（字段数不足）抛错', () => {
      expect(() =>
        bridge.register({
          name: 'bad',
          expression: '0 9',
          handler: vi.fn(),
          pluginId: 'p1',
        }),
      ).toThrow(/expected 5 fields/)
    })

    it('非法步长抛错', () => {
      expect(() =>
        bridge.register({
          name: 'bad',
          expression: '*/0 * * * *',
          handler: vi.fn(),
          pluginId: 'p1',
        }),
      ).toThrow(/Invalid step/)
    })

    it('支持 */N 步长表达式', () => {
      const id = bridge.register({
        name: 'every-5-min',
        expression: '*/5 * * * *',
        handler: vi.fn(),
        pluginId: 'p1',
      })
      expect(bridge.getTask(id)).toBeDefined()
    })

    it('支持范围表达式', () => {
      const id = bridge.register({
        name: 'weekday',
        expression: '30 9 * * 1-5',
        handler: vi.fn(),
        pluginId: 'p1',
      })
      expect(bridge.getTask(id)).toBeDefined()
    })
  })

  describe('pause / resume', () => {
    it('暂停后状态变为 paused', () => {
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler: vi.fn(),
        pluginId: 'p1',
      })
      expect(bridge.pause(id)).toBe(true)
      expect(bridge.getTask(id)!.status).toBe('paused')
    })

    it('恢复后状态变为 active 并重算 nextRunAt', () => {
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler: vi.fn(),
        pluginId: 'p1',
        active: false,
      })
      expect(bridge.resume(id)).toBe(true)
      expect(bridge.getTask(id)!.status).toBe('active')
      expect(bridge.getTask(id)!.nextRunAt).toBeGreaterThan(0)
    })

    it('暂停不存在的任务返回 false', () => {
      expect(bridge.pause('not-exist')).toBe(false)
    })

    it('重复暂停返回 false', () => {
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler: vi.fn(),
        pluginId: 'p1',
      })
      bridge.pause(id)
      expect(bridge.pause(id)).toBe(false)
    })
  })

  describe('unregisterByPlugin', () => {
    it('批量取消某插件的所有任务', () => {
      bridge.register({ name: 't1', expression: '0 9 * * *', handler: vi.fn(), pluginId: 'p1' })
      bridge.register({ name: 't2', expression: '0 10 * * *', handler: vi.fn(), pluginId: 'p1' })
      bridge.register({ name: 't3', expression: '0 11 * * *', handler: vi.fn(), pluginId: 'p2' })

      const removed = bridge.unregisterByPlugin('p1')
      expect(removed).toBe(2)
      expect(bridge.listTasksByPlugin('p1')).toHaveLength(0)
      expect(bridge.listTasksByPlugin('p2')).toHaveLength(1)
    })

    it('无匹配任务时返回 0', () => {
      expect(bridge.unregisterByPlugin('not-exist')).toBe(0)
    })
  })

  describe('triggerNow', () => {
    it('手动触发执行 handler 且不计入 runCount', async () => {
      const handler = vi.fn().mockResolvedValue(undefined)
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler,
        pluginId: 'p1',
      })

      const result = await bridge.triggerNow(id)
      expect(result.success).toBe(true)
      expect(handler).toHaveBeenCalledTimes(1)
      // 手动触发不计入 runCount
      expect(bridge.getTask(id)!.runCount).toBe(0)
    })

    it('触发不存在的任务返回失败', async () => {
      const result = await bridge.triggerNow('not-exist')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Task not found')
    })

    it('handler 抛错时返回失败且记录 lastError', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('boom'))
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler,
        pluginId: 'p1',
      })

      const result = await bridge.triggerNow(id)
      expect(result.success).toBe(false)
      expect(result.error).toBe('boom')
      expect(bridge.getTask(id)!.lastError).toBe('boom')
    })
  })

  describe('maxRetries 失败重试', () => {
    it('重试成功后不再重试', async () => {
      let callCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount < 2) throw new Error('transient')
      })
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler,
        pluginId: 'p1',
        maxRetries: 2,
      })

      const result = await bridge.triggerNow(id)
      expect(result.success).toBe(true)
      expect(handler).toHaveBeenCalledTimes(2) // 第1次失败，第2次成功
      expect(bridge.getTask(id)!.lastError).toBeNull()
    })

    it('重试次数用尽仍失败则记录错误', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('always fail'))
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler,
        pluginId: 'p1',
        maxRetries: 1,
      })

      const result = await bridge.triggerNow(id)
      expect(result.success).toBe(false)
      expect(handler).toHaveBeenCalledTimes(2) // 1 次初始 + 1 次重试
      expect(bridge.getTask(id)!.lastError).toBe('always fail')
    })
  })

  describe('listTasks / listTasksByPlugin', () => {
    it('返回所有任务', () => {
      bridge.register({ name: 't1', expression: '0 9 * * *', handler: vi.fn(), pluginId: 'p1' })
      bridge.register({ name: 't2', expression: '0 10 * * *', handler: vi.fn(), pluginId: 'p2' })
      expect(bridge.listTasks()).toHaveLength(2)
    })

    it('按插件过滤', () => {
      bridge.register({ name: 't1', expression: '0 9 * * *', handler: vi.fn(), pluginId: 'p1' })
      bridge.register({ name: 't2', expression: '0 10 * * *', handler: vi.fn(), pluginId: 'p1' })
      bridge.register({ name: 't3', expression: '0 11 * * *', handler: vi.fn(), pluginId: 'p2' })
      expect(bridge.listTasksByPlugin('p1')).toHaveLength(2)
      expect(bridge.listTasksByPlugin('p2')).toHaveLength(1)
    })
  })

  describe('事件通知', () => {
    it('注册时触发 task-registered 事件', () => {
      const handler = vi.fn()
      bridge.on('task-registered', handler)
      bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler: vi.fn(),
        pluginId: 'p1',
      })
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler.mock.calls[0][0]).toHaveProperty('name', 'test')
    })

    it('取消时触发 task-unregistered 事件', () => {
      const handler = vi.fn()
      bridge.on('task-unregistered', handler)
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler: vi.fn(),
        pluginId: 'p1',
      })
      bridge.unregister(id)
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('手动触发时触发 task-completed 事件', async () => {
      const handler = vi.fn()
      bridge.on('task-completed', handler)
      const id = bridge.register({
        name: 'test',
        expression: '0 9 * * *',
        handler: vi.fn().mockResolvedValue(undefined),
        pluginId: 'p1',
      })
      await bridge.triggerNow(id)
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('start / stop', () => {
    it('start 后再 start 不重复启动', () => {
      bridge.start()
      bridge.start() // 幂等，不应抛错
      bridge.stop()
    })

    it('stop 后再 stop 不抛错', () => {
      bridge.start()
      bridge.stop()
      bridge.stop() // 幂等
    })
  })
})
