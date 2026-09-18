/**
 * 流式帧调度器
 *
 * 验证的是调度语义本身，而不是计数器：同帧合并、同任务去重、取最早登记、
 * 可取消、空闲不留残留，以及页面隐藏时退化为定时器（后台流式内容仍会写入）。
 * 其中「空闲不留残留」是这次改动的立身之本 —— 若调度器常驻一个帧循环，
 * 换来的就是持续的空闲唤醒。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 上报器会把 import 链拉到 LogEngine 与协议模块，而本文件只关心调度语义。
// 帧窗口是记账用的旁路：这里只需保证它可调用，不影响调度行为本身。
vi.mock('../../diagnostics/perfTraceReporter', () => ({
  bump: vi.fn(),
  beginFrameWindow: vi.fn(),
  endFrameWindow: vi.fn(),
  currentFrameWindowStart: vi.fn(() => null),
}))

import { cancelFrameTask, scheduleFrameTask } from '../streamFrameScheduler'

interface QueuedFrame {
  id: number
  cancelled: boolean
  run: () => void
}

let frameQueue: QueuedFrame[] = []
let nextFrameId = 1

/** 手动驱动一次动画帧：把当前排队的回调全部执行掉 */
function flushAnimationFrame(): void {
  const queued = frameQueue
  frameQueue = []
  for (const frame of queued) {
    if (frame.cancelled) continue
    frame.run()
  }
}

/** 等待真实定时器把延迟任务投递到帧队列 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  frameQueue = []
  nextFrameId = 1

  vi.stubGlobal('document', { visibilityState: 'visible' })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId++
    frameQueue.push({ id, cancelled: false, run: () => callback(performance.now()) })
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    const frame = frameQueue.find((item) => item.id === id)
    if (frame) frame.cancelled = true
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('scheduleFrameTask', () => {
  it('把同一帧内登记的任务合并到一次帧回调里', () => {
    const order: string[] = []

    scheduleFrameTask(() => order.push('flush'))
    scheduleFrameTask(() => order.push('tick'))

    // 关键断言：两个任务只排出一个帧回调，因此只会产生一次提交
    expect(frameQueue).toHaveLength(1)

    flushAnimationFrame()
    expect(order).toEqual(['flush', 'tick'])
  })

  it('同一任务重复登记只执行一次', () => {
    const task = vi.fn()

    scheduleFrameTask(task)
    scheduleFrameTask(task)
    scheduleFrameTask(task)

    expect(frameQueue).toHaveLength(1)
    flushAnimationFrame()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('一次性任务执行后不留残留，空闲时不产生任何唤醒', () => {
    const task = vi.fn()

    scheduleFrameTask(task)
    flushAnimationFrame()

    expect(task).toHaveBeenCalledTimes(1)
    // 没有待执行任务就不该有排入的帧回调
    expect(frameQueue).toHaveLength(0)
  })

  it('重复登记推迟不了已排定的执行（周期任务不会被自己的登记延后）', async () => {
    const task = vi.fn()

    scheduleFrameTask(task, 10)
    scheduleFrameTask(task, 200) // 更晚的登记不应覆盖更早的
    await wait(40)

    expect(frameQueue).toHaveLength(1)
    flushAnimationFrame()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('更早的登记会把已排定的唤醒提前', async () => {
    const task = vi.fn()

    scheduleFrameTask(task, 5000)
    scheduleFrameTask(task, 5)
    await wait(30)

    flushAnimationFrame()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('任务在自身末尾续期时会保持循环（流式插值依赖这一点）', () => {
    let runs = 0
    const task = (): void => {
      runs++
      if (runs < 3) scheduleFrameTask(task, 0)
    }

    scheduleFrameTask(task, 0)
    flushAnimationFrame()
    flushAnimationFrame()
    flushAnimationFrame()

    expect(runs).toBe(3)
    // 已达终止条件，循环自然停止，不再有排入的帧回调
    expect(frameQueue).toHaveLength(0)
  })

  it('单个任务抛错不影响同帧内的其他任务', () => {
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const second = vi.fn()

    scheduleFrameTask(() => {
      throw new Error('boom')
    })
    scheduleFrameTask(second)

    expect(() => flushAnimationFrame()).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
    warnings.mockRestore()
  })

  it('页面隐藏时退化为定时器，保证后台流式内容仍会写入', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    const task = vi.fn()

    scheduleFrameTask(task, 0)

    // 隐藏时不应占用动画帧（此时它根本不会触发）
    expect(frameQueue).toHaveLength(0)
    await wait(60)
    expect(task).toHaveBeenCalledTimes(1)
  })
})

describe('cancelFrameTask', () => {
  it('取消后任务不再执行', () => {
    const task = vi.fn()

    scheduleFrameTask(task)
    cancelFrameTask(task)
    flushAnimationFrame()

    expect(task).not.toHaveBeenCalled()
  })

  it('取消未登记的任务是空操作', () => {
    expect(() => cancelFrameTask(() => {})).not.toThrow()
  })
})
