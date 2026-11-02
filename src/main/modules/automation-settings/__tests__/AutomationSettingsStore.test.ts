/**
 * 本地自动化开关 — 单元测试
 *
 * 覆盖点（按风险排序）：
 *   1. 默认全关 —— 新装用户不得因为这次改动产生任何行为变化
 *   2. 只接受 boolean —— 渲染层传错类型不能把开关置成奇怪的值
 *   3. 未知字段忽略 —— 拼错字段名不报错，但也不生效
 *   4. 持久化恢复 —— 关了再开应用，开关状态要还在
 *   5. 配置文件被改坏时回落默认值，不能让整个开关系统失效
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
    AUTOMATION_SETTINGS: 'automation_settings',
  },
}))

vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    system: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import { AutomationSettingsStore } from '../AutomationSettingsStore'
import { DEFAULT_AUTOMATION_SETTINGS } from '../types'

describe('AutomationSettingsStore — 默认值', () => {
  beforeEach(() => {
    storeState.clear()
  })

  it('全新安装时三层开关全部关闭', () => {
    const store = new AutomationSettingsStore()
    store.load()
    expect(store.get()).toEqual({
      triggersEnabled: false,
      autoCreateTask: false,
      autoExecuteTask: false,
    })
  })

  it('未调用 load 也能读到默认值（懒加载）', () => {
    const store = new AutomationSettingsStore()
    expect(store.get()).toEqual({ ...DEFAULT_AUTOMATION_SETTINGS })
  })

  it('get 返回副本，改它不影响内部状态', () => {
    const store = new AutomationSettingsStore()
    const snapshot = store.get()
    snapshot.autoExecuteTask = true
    expect(store.get().autoExecuteTask).toBe(false)
  })
})

describe('AutomationSettingsStore — 更新与校验', () => {
  beforeEach(() => {
    storeState.clear()
  })

  it('可以单独打开某一层，其他层保持不变', () => {
    const store = new AutomationSettingsStore()
    const next = store.update({ autoCreateTask: true })

    expect(next).toEqual({
      triggersEnabled: false,
      autoCreateTask: true,
      autoExecuteTask: false,
    })
  })

  it('非 boolean 值被忽略，不写入', () => {
    const store = new AutomationSettingsStore()
    // 模拟渲染层传错类型
    const next = store.update({ triggersEnabled: 'yes' as unknown as boolean })

    expect(next.triggersEnabled).toBe(false)
  })

  it('未知字段被忽略，不抛错也不生效', () => {
    const store = new AutomationSettingsStore()
    const next = store.update({
      autoExecuteTask: true,
      somethingElse: true,
    } as Partial<{ autoExecuteTask: boolean }>)

    expect(next.autoExecuteTask).toBe(true)
    expect(Object.keys(next).sort()).toEqual(
      ['autoCreateTask', 'autoExecuteTask', 'triggersEnabled'].sort(),
    )
  })

  it('传 null / 非对象时原样返回', () => {
    const store = new AutomationSettingsStore()
    expect(store.update(null as unknown as Record<string, boolean>)).toEqual({
      ...DEFAULT_AUTOMATION_SETTINGS,
    })
  })

  it('值没变化时不重复持久化', () => {
    const store = new AutomationSettingsStore()
    store.update({ autoCreateTask: true })
    const before = storeState.get('automation_settings')

    store.update({ autoCreateTask: true })
    const after = storeState.get('automation_settings')

    // 引用相同说明没有触发新的写入
    expect(after).toBe(before)
  })

  it('reset 恢复全关', () => {
    const store = new AutomationSettingsStore()
    store.update({ triggersEnabled: true, autoCreateTask: true, autoExecuteTask: true })

    const reset = store.reset()
    expect(reset).toEqual({ ...DEFAULT_AUTOMATION_SETTINGS })
  })
})

describe('AutomationSettingsStore — 持久化', () => {
  beforeEach(() => {
    storeState.clear()
  })

  it('更新后写入存储，新实例可恢复', () => {
    const first = new AutomationSettingsStore()
    first.update({ triggersEnabled: true, autoExecuteTask: true })

    const second = new AutomationSettingsStore()
    second.load()

    expect(second.get().triggersEnabled).toBe(true)
    expect(second.get().autoExecuteTask).toBe(true)
    expect(second.get().autoCreateTask).toBe(false)
  })

  it('存储里是坏数据时回落默认值，不抛错', () => {
    storeState.set('automation_settings', { version: 1, settings: 'not-an-object' })

    const store = new AutomationSettingsStore()
    store.load()

    expect(store.get()).toEqual({ ...DEFAULT_AUTOMATION_SETTINGS })
  })

  it('存储里缺字段时按默认值补齐', () => {
    storeState.set('automation_settings', {
      version: 1,
      settings: { autoCreateTask: true },
    })

    const store = new AutomationSettingsStore()
    store.load()

    expect(store.get()).toEqual({
      triggersEnabled: false,
      autoCreateTask: true,
      autoExecuteTask: false,
    })
  })
})
