import { describe, it, expect, beforeEach } from 'vitest'
import { STEER_MAX_LENGTH, STEER_MAX_PER_TASK } from '@shared/protocols/deviceTaskProtocol'
import {
  enqueueLocalSteer,
  drainLocalSteers,
  discardLocalSteers,
  pendingLocalSteerCount,
  subscribeLocalSteer,
} from '../localSteer'

const THREAD = 'thread-steer-test'
const OTHER = 'thread-steer-other'

describe('localSteer 队列', () => {
  beforeEach(() => {
    drainLocalSteers(THREAD)
    drainLocalSteers(OTHER)
    discardLocalSteers(THREAD)
    discardLocalSteers(OTHER)
  })

  it('入队后按先进先出取走，取走即清空', () => {
    expect(enqueueLocalSteer(THREAD, '先查日志')).toEqual({ accepted: true, queued: 1 })
    expect(enqueueLocalSteer(THREAD, '再跑一次测试')).toEqual({ accepted: true, queued: 2 })
    expect(pendingLocalSteerCount(THREAD)).toBe(2)

    expect(drainLocalSteers(THREAD)).toEqual(['先查日志', '再跑一次测试'])
    expect(pendingLocalSteerCount(THREAD)).toBe(0)
    expect(drainLocalSteers(THREAD)).toEqual([])
  })

  it('只对队尾去重：取走之后同一句话再说依然有效', () => {
    enqueueLocalSteer(THREAD, '换个方案')
    // 还在队列里时连点两下是误触，拒绝
    expect(enqueueLocalSteer(THREAD, '换个方案')).toEqual({ accepted: false, reason: 'duplicate' })

    // 取走（已注入）之后再说一遍是新的补充说明，必须能入队
    expect(drainLocalSteers(THREAD)).toEqual(['换个方案'])
    expect(enqueueLocalSteer(THREAD, '换个方案').accepted).toBe(true)
    expect(drainLocalSteers(THREAD)).toEqual(['换个方案'])
  })

  it('空内容与超长内容被拒绝', () => {
    expect(enqueueLocalSteer(THREAD, '   ')).toEqual({ accepted: false, reason: 'empty' })
    expect(enqueueLocalSteer('', '有内容但没有线程')).toEqual({ accepted: false, reason: 'empty' })
    expect(enqueueLocalSteer(THREAD, 'x'.repeat(STEER_MAX_LENGTH + 1))).toEqual({
      accepted: false,
      reason: 'too_long',
    })
  })

  it('超过单任务上限后拒绝入队', () => {
    for (let i = 0; i < STEER_MAX_PER_TASK; i++) {
      expect(enqueueLocalSteer(THREAD, `第 ${i} 条`).accepted).toBe(true)
    }
    expect(enqueueLocalSteer(THREAD, '再来一条')).toEqual({ accepted: false, reason: 'full' })
  })

  it('按线程隔离', () => {
    enqueueLocalSteer(THREAD, '给 A 的话')
    enqueueLocalSteer(OTHER, '给 B 的话')
    expect(drainLocalSteers(THREAD)).toEqual(['给 A 的话'])
    expect(drainLocalSteers(OTHER)).toEqual(['给 B 的话'])
  })

  it('丢弃返回丢弃条数，取走之后已无内容可丢', () => {
    enqueueLocalSteer(THREAD, '第一条')
    enqueueLocalSteer(THREAD, '第二条')

    // 取走即已注入：此时队列已空，丢弃不该再报告任何残留
    expect(drainLocalSteers(THREAD)).toEqual(['第一条', '第二条'])
    expect(discardLocalSteers(THREAD)).toBe(0)

    enqueueLocalSteer(THREAD, '第三条')
    expect(discardLocalSteers(THREAD)).toBe(1)
    expect(pendingLocalSteerCount(THREAD)).toBe(0)
    expect(drainLocalSteers(THREAD)).toEqual([])
  })

  it('入队与取走都会通知订阅者，供界面收起待生效条', () => {
    let notified = 0
    const unsubscribe = subscribeLocalSteer(() => { notified += 1 })

    enqueueLocalSteer(THREAD, '盯一下这个')
    expect(notified).toBe(1)

    drainLocalSteers(THREAD)
    expect(notified).toBe(2)

    // 退订之后不再收到通知
    unsubscribe()
    enqueueLocalSteer(THREAD, '退订后的话')
    expect(notified).toBe(2)
    expect(discardLocalSteers(THREAD)).toBe(1)
  })
})
