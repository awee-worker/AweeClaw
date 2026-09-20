/**
 * 挂载任务持久化规范化测试
 *
 * 磁盘上的挂载任务可能来自旧版本或被手工改写，读取时必须保证：
 * 缺少执行情况（summary）的记录视为无效挂载直接丢弃，其余字段异常则降级为默认值，
 * 不因为一个字段不合法就丢掉整份整理好的执行情况。
 */

import { describe, it, expect } from 'vitest'

/** providerTypes 链路在模块顶层会触碰 window，这里补最小桩 */
function patchGlobals() {
  const g = globalThis as any
  if (typeof g.window === 'undefined') g.window = g

  const w = g.window as any
  w.addEventListener = w.addEventListener || (() => {})
  w.removeEventListener = w.removeEventListener || (() => {})
  w.dispatchEvent = w.dispatchEvent || (() => true)
}

const VALID_TASK = {
  mountedAt: 1_710_000_000_000,
  objective: '实现登录功能',
  pendingSteps: ['接入验证码'],
  summary: '## 任务目标\n实现登录功能',
  source: 'llm',
  resumedAt: 1_710_000_001_000,
}

describe('挂载任务规范化', () => {
  it('合法记录完整保留', async () => {
    patchGlobals()
    const { normalizeMountedTask } = await import('../sessionStorageAdapter')

    expect(normalizeMountedTask(VALID_TASK)).toEqual(VALID_TASK)
  })

  it('缺少执行情况的记录视为未挂载', async () => {
    patchGlobals()
    const { normalizeMountedTask } = await import('../sessionStorageAdapter')

    expect(normalizeMountedTask({ ...VALID_TASK, summary: '   ' })).toBeUndefined()
    expect(normalizeMountedTask({ ...VALID_TASK, summary: '' })).toBeUndefined()
    expect(normalizeMountedTask(undefined)).toBeUndefined()
    expect(normalizeMountedTask(null)).toBeUndefined()
    expect(normalizeMountedTask('mounted')).toBeUndefined()
    expect(normalizeMountedTask(['mounted'])).toBeUndefined()
  })

  it('字段异常时降级为默认值而非整体丢弃', async () => {
    patchGlobals()
    const { normalizeMountedTask } = await import('../sessionStorageAdapter')

    const task = normalizeMountedTask({
      summary: 's',
      pendingSteps: ['a', 1, null, 'b'],
      source: 'unknown-source',
      mountedAt: 'yesterday',
    })

    expect(task).toEqual({
      mountedAt: expect.any(Number),
      objective: '',
      pendingSteps: ['a', 'b'],
      summary: 's',
      source: 'rule_based',
      resumedAt: undefined,
    })
  })

  it('未续跑时 resumedAt 保持为空', async () => {
    patchGlobals()
    const { normalizeMountedTask } = await import('../sessionStorageAdapter')

    const task = normalizeMountedTask({ ...VALID_TASK, resumedAt: 'just-now' })

    expect(task?.resumedAt).toBeUndefined()
  })

  it('线程记录读写往返后挂载不丢失', async () => {
    patchGlobals()
    const { normalizePersistedChatThread, stripThreadMessagesForMetadata } = await import('../sessionStorageAdapter')

    const persisted = {
      id: 't1',
      createdAt: 1,
      lastModified: 2,
      messages: [],
      contextItems: [],
      contextSummary: null,
      mountedTask: VALID_TASK,
    } as any

    expect(normalizePersistedChatThread(persisted).mountedTask).toEqual(VALID_TASK)
    // 元数据裁剪（列表页只读摘要，不带消息体）不能顺手丢掉挂载，否则列表就没有挂载标识
    expect(stripThreadMessagesForMetadata(persisted).mountedTask).toEqual(VALID_TASK)
  })
})
