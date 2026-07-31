/**
 * InputListenerBridge 单元测试
 *
 * 覆盖：
 *   - 单例语义
 *   - startScreenshotStream / stop / pause / resume 状态机
 *   - 参数边界校验（intervalMs 最小值、changeThreshold 钳制）
 *   - onlyOnChange 变化检测逻辑（mock 截图）
 *   - 能力探测 isNativeInputSupported
 *   - stopAll 批量停止
 *
 * Mock 策略：
 *   - getDesktopControlManager：返回 captureScreen 的 mock
 *   - electron nativeImage：mock createFromDataURL/resize/toBitmap/toGetSize
 *   - logger：mock
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock logger
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

// Mock desktop-control（避免依赖 Electron 屏幕录制权限与 native adapter）
const captureScreenMock = vi.fn()
vi.mock('@modules/desktop-control/DesktopControlManager', () => ({
  getDesktopControlManager: () => ({
    captureScreen: captureScreenMock,
  }),
}))

// Mock electron nativeImage（用于缩略图变化检测）
const FAKE_BITMAP = Buffer.alloc(4 * 4 * 4, 128) // 4x4 BGRA，固定灰度
vi.mock('electron', () => ({
  nativeImage: {
    createFromDataURL: vi.fn().mockReturnValue({
      getSize: () => ({ width: 800, height: 600 }),
      resize: () => ({
        toBitmap: () => FAKE_BITMAP,
      }),
    }),
  },
}))

import { InputListenerBridge } from '@modules/plugin-sdk/InputListenerBridge'

// 构造一个成功截图结果
function makeScreenshot(dataUrl = 'data:image/png;base64,AAAA'): {
  success: boolean
  dataUrl: string
  region: { x: number; y: number; width: number; height: number }
  displayId: number
  timestamp: number
} {
  return {
    success: true,
    dataUrl,
    region: { x: 0, y: 0, width: 800, height: 600 },
    displayId: 0,
    timestamp: Date.now(),
  }
}

describe('InputListenerBridge', () => {
  let bridge: InputListenerBridge

  beforeEach(() => {
    vi.useFakeTimers()
    ;(InputListenerBridge as any)._instance = null
    bridge = InputListenerBridge.getInstance()
    captureScreenMock.mockReset()
    captureScreenMock.mockResolvedValue(makeScreenshot())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('单例', () => {
    it('getInstance 返回同一实例', () => {
      const a = InputListenerBridge.getInstance()
      const b = InputListenerBridge.getInstance()
      expect(a).toBe(b)
    })
  })

  describe('能力探测', () => {
    it('isNativeInputSupported V1 恒返回 false', () => {
      expect(bridge.isNativeInputSupported()).toBe(false)
    })
  })

  describe('startScreenshotStream / stop', () => {
    it('启动后立即推送首帧并返回 streamId', async () => {
      const cb = vi.fn()
      const id = bridge.startScreenshotStream({ intervalMs: 500 }, cb)
      expect(id).toMatch(/^stream-\d+-\d+$/)

      // 首帧异步推送，等待微任务
      await vi.advanceTimersByTimeAsync(10)
      expect(captureScreenMock).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb.mock.calls[0][0]).toHaveProperty('streamId', id)
      expect(cb.mock.calls[0][0]).toHaveProperty('dataUrl')

      bridge.stopScreenshotStream(id)
    })

    it('按 intervalMs 定时推送后续帧', async () => {
      const cb = vi.fn()
      const id = bridge.startScreenshotStream(
        { intervalMs: 500, onlyOnChange: false }, // 关闭变化检测确保每帧推送
        cb,
      )
      await vi.advanceTimersByTimeAsync(10) // 首帧
      expect(cb).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(500)
      expect(cb).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(500)
      expect(cb).toHaveBeenCalledTimes(3)

      bridge.stopScreenshotStream(id)
    })

    it('停止后不再推送', async () => {
      const cb = vi.fn()
      const id = bridge.startScreenshotStream({ intervalMs: 500, onlyOnChange: false }, cb)
      await vi.advanceTimersByTimeAsync(10)
      expect(cb).toHaveBeenCalledTimes(1)

      bridge.stopScreenshotStream(id)
      await vi.advanceTimersByTimeAsync(1000)
      expect(cb).toHaveBeenCalledTimes(1) // 停止后无新增
    })

    it('停止不存在的流返回 false', () => {
      expect(bridge.stopScreenshotStream('not-exist')).toBe(false)
    })

    it('停止后流状态为 null（已删除）', async () => {
      const id = bridge.startScreenshotStream({ intervalMs: 500 }, vi.fn())
      await vi.advanceTimersByTimeAsync(10)
      bridge.stopScreenshotStream(id)
      expect(bridge.getStreamState(id)).toBeNull()
    })
  })

  describe('参数边界校验', () => {
    it('intervalMs 小于 200 被钳制为 200（200ms 间隔触发后续帧）', async () => {
      const cb = vi.fn()
      const id = bridge.startScreenshotStream(
        { intervalMs: 50, onlyOnChange: false }, // 会被钳制为 200
        cb,
      )
      await vi.advanceTimersByTimeAsync(10) // 首帧
      expect(cb).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(200) // 200ms 后触发第二帧
      expect(cb).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(200) // 再 200ms 触发第三帧
      expect(cb).toHaveBeenCalledTimes(3)
      bridge.stopScreenshotStream(id)
    })

    it('onlyOnChange=true 且画面无变化时不推送第二帧', async () => {
      // 固定 bitmap，所有帧灰度相同，变化检测应判定无变化
      const cb = vi.fn()
      const id = bridge.startScreenshotStream(
        { intervalMs: 500, onlyOnChange: true, changeThreshold: 0.02 },
        cb,
      )
      await vi.advanceTimersByTimeAsync(10) // 首帧（建立基线，推送）
      expect(cb).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(500)
      // 后续帧无变化，不推送
      expect(cb).toHaveBeenCalledTimes(1)
      bridge.stopScreenshotStream(id)
    })

    it('onlyOnChange=false 时无论是否变化都推送', async () => {
      const cb = vi.fn()
      const id = bridge.startScreenshotStream(
        { intervalMs: 500, onlyOnChange: false },
        cb,
      )
      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(500)
      expect(cb).toHaveBeenCalledTimes(3)
      bridge.stopScreenshotStream(id)
    })
  })

  describe('pause / resume', () => {
    it('暂停后不再推送', async () => {
      const cb = vi.fn()
      const id = bridge.startScreenshotStream({ intervalMs: 500, onlyOnChange: false }, cb)
      await vi.advanceTimersByTimeAsync(10)
      expect(cb).toHaveBeenCalledTimes(1)

      expect(bridge.pauseScreenshotStream(id)).toBe(true)
      expect(bridge.getStreamState(id)).toBe('paused')

      await vi.advanceTimersByTimeAsync(2000)
      expect(cb).toHaveBeenCalledTimes(1) // 暂停期间无推送
    })

    it('恢复后继续推送', async () => {
      const cb = vi.fn()
      const id = bridge.startScreenshotStream({ intervalMs: 500, onlyOnChange: false }, cb)
      await vi.advanceTimersByTimeAsync(10)
      bridge.pauseScreenshotStream(id)
      await vi.advanceTimersByTimeAsync(1000)

      bridge.resumeScreenshotStream(id)
      await vi.advanceTimersByTimeAsync(10) // 恢复首帧
      expect(cb).toHaveBeenCalledTimes(2)
      bridge.stopScreenshotStream(id)
    })

    it('暂停不存在的流返回 false', () => {
      expect(bridge.pauseScreenshotStream('not-exist')).toBe(false)
    })
  })

  describe('stopAll', () => {
    it('停止所有活跃流', async () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      const id1 = bridge.startScreenshotStream({ intervalMs: 500 }, cb1)
      const id2 = bridge.startScreenshotStream({ intervalMs: 500 }, cb2)
      await vi.advanceTimersByTimeAsync(10)

      bridge.stopAll()
      await vi.advanceTimersByTimeAsync(2000)
      // stopAll 后两个流都停止，不再推送
      expect(bridge.getStreamState(id1)).toBeNull()
      expect(bridge.getStreamState(id2)).toBeNull()
    })
  })

  describe('getActiveStreamCount', () => {
    it('返回活跃流数量', async () => {
      expect(bridge.getActiveStreamCount()).toBe(0)
      const id1 = bridge.startScreenshotStream({ intervalMs: 500 }, vi.fn())
      const id2 = bridge.startScreenshotStream({ intervalMs: 500 }, vi.fn())
      await vi.advanceTimersByTimeAsync(10)
      expect(bridge.getActiveStreamCount()).toBe(2)
      bridge.stopScreenshotStream(id1)
      expect(bridge.getActiveStreamCount()).toBe(1)
      bridge.stopScreenshotStream(id2)
    })
  })

  describe('异常容错', () => {
    it('截图失败不中断流，记录警告后继续', async () => {
      captureScreenMock.mockRejectedValueOnce(new Error('screen busy'))
      const cb = vi.fn()
      const id = bridge.startScreenshotStream({ intervalMs: 500, onlyOnChange: false }, cb)
      // 首帧失败，但不影响后续
      await vi.advanceTimersByTimeAsync(10)
      // 首帧失败不推送，但流仍存活
      await vi.advanceTimersByTimeAsync(500)
      expect(cb).toHaveBeenCalled()
      bridge.stopScreenshotStream(id)
    })

    it('回调抛错不中断采集流', async () => {
      const cb = vi.fn().mockImplementation(() => {
        throw new Error('plugin callback boom')
      })
      const id = bridge.startScreenshotStream({ intervalMs: 500, onlyOnChange: false }, cb)
      await vi.advanceTimersByTimeAsync(10) // 首帧抛错
      // 第二帧仍应被采集（流未中断）
      await vi.advanceTimersByTimeAsync(500)
      expect(captureScreenMock).toHaveBeenCalledTimes(2)
      bridge.stopScreenshotStream(id)
    })
  })
})
