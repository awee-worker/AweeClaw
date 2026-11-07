/**
 * 任务执行画面采集
 *
 * 画面帧只服务一个目的：让用户在手机上看清桌面端在做什么。
 * 因此采集策略围绕「省流量」设计，而不是围绕「画面完整」：
 *
 * - 变化触发：画面相对上一帧没变化，就不再发；变化了才发，且两次之间
 *   至少隔 800ms（下限节流），避免高频重绘把带宽吃满。
 * - 静默补帧：连续 5s 没有发送时补一帧心跳帧（changed=false），
 *   让移动端知道「还在跑，只是画面没动」，而不是误以为断流。
 * - 单帧上限 200KB：超了先降质量，再降分辨率，不丢帧 ——
 *   丢帧会让观看端看到的画面时间戳出现空洞，比低清更难解释。
 *
 * 帧不进模型上下文，也不落盘；事后回放走任务产物。
 *
 * @module device-link/TaskFrameStreamer
 */
import { nativeImage, type NativeImage } from 'electron'
import { createHash } from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import {
  TASK_FRAME_HEARTBEAT_MS,
  TASK_FRAME_MAX_BYTES,
  TASK_FRAME_MIN_INTERVAL_MS,
  type TaskFrame,
} from '@shared/protocols/deviceTaskProtocol'
import { getDesktopControlManager } from '../desktop-control'
import { getDeviceLinkClient } from './DeviceLinkClient'

/** 采样节拍：比最小发送间隔更密，保证变化能被及时发现，又不会空转 */
const SAMPLE_TICK_MS = 250

/** 质量降级阶梯：按顺序尝试，取第一个满足体积上限的组合 */
const QUALITY_STEPS = [60, 45, 35]
/** 宽度降级阶梯：目标 1280 ≈ 720p 横向；质量降到底仍超限时再降分辨率 */
const WIDTH_STEPS = [1280, 960, 720]
/** 连续采集失败多少次后自动停流（避免对着没权限的屏幕死循环） */
const MAX_CAPTURE_FAILURES = 5

interface StreamState {
  timer: NodeJS.Timeout
  seq: number
  /** 上一帧的内容哈希；首次为 null */
  lastHash: string | null
  lastSentAt: number
  width: number
  height: number
  inFlight: boolean
  failures: number
  changedSinceLastSend: boolean
}

/** 启动结果 */
export interface FrameStreamStartResult {
  ok: boolean
  /** 拒绝原因：already_streaming / screenshot_not_allowed */
  error?: string
  width?: number
  height?: number
}

class TaskFrameStreamer {
  private readonly streams = new Map<string, StreamState>()

  /**
   * 开始为某个任务采集画面
   *
   * @param taskId           任务 id（帧按它路由给订阅者）
   * @param allowScreenshot  是否允许截图（沿用设备联动的截图权限开关）
   */
  start(taskId: string, allowScreenshot: boolean): FrameStreamStartResult {
    if (!taskId) return { ok: false, error: 'missing_task_id' }
    if (this.streams.has(taskId)) return { ok: false, error: 'already_streaming' }
    if (!allowScreenshot) return { ok: false, error: 'screenshot_not_allowed' }

    const state: StreamState = {
      timer: setInterval(() => void this.tick(taskId), SAMPLE_TICK_MS),
      seq: 0,
      lastHash: null,
      lastSentAt: 0,
      width: 0,
      height: 0,
      inFlight: false,
      failures: 0,
      changedSinceLastSend: false,
    }
    this.streams.set(taskId, state)
    logger.deviceLink.info(`[FrameStream] Started task=${taskId}`)
    // 首帧立刻采，避免用户点开画面后等一个节拍
    void this.tick(taskId)
    return { ok: true }
  }

  /** 停止某任务的采集 */
  stop(taskId: string): boolean {
    const state = this.streams.get(taskId)
    if (!state) return false
    clearInterval(state.timer)
    this.streams.delete(taskId)
    logger.deviceLink.info(`[FrameStream] Stopped task=${taskId} frames=${state.seq}`)
    return true
  }

  /** 是否正在采集 */
  isStreaming(taskId: string): boolean {
    return this.streams.has(taskId)
  }

  /** 停止全部采集（退出或断连时调用） */
  stopAll(): void {
    for (const taskId of Array.from(this.streams.keys())) this.stop(taskId)
  }

  // ---------------------------------------------------------------------------
  // 采集循环
  // ---------------------------------------------------------------------------

  private async tick(taskId: string): Promise<void> {
    const state = this.streams.get(taskId)
    if (!state || state.inFlight) return

    if (state.seq === 0) {
      // 首帧必发，不受节流限制
    } else if (Date.now() - state.lastSentAt < TASK_FRAME_MIN_INTERVAL_MS && !state.changedSinceLastSend) {
      return
    }

    state.inFlight = true
    try {
      const captured = await getDesktopControlManager().captureScreen(0)
      if (!captured.success || !captured.dataUrl) {
        this.onCaptureFailure(taskId, state, captured.error || 'capture_failed')
        return
      }
      state.failures = 0

      const image = nativeImage.createFromDataURL(captured.dataUrl)
      if (image.isEmpty()) {
        this.onCaptureFailure(taskId, state, 'empty_image')
        return
      }

      const encoded = this.encode(image)
      if (!encoded) {
        this.onCaptureFailure(taskId, state, 'encode_failed')
        return
      }

      const changed = state.lastHash === null || encoded.hash !== state.lastHash
      const now = Date.now()
      const sinceLast = now - state.lastSentAt

      // 发送判定：首帧 / 有变化且过了下限 / 静默补帧
      const isFirst = state.seq === 0
      const shouldSendChanged = changed && sinceLast >= TASK_FRAME_MIN_INTERVAL_MS
      const shouldHeartbeat = sinceLast >= TASK_FRAME_HEARTBEAT_MS

      if (!isFirst && !shouldSendChanged && !shouldHeartbeat) {
        // 画面变了但仍在节流窗口内：记下来，等窗口过去再发，
        // 避免「变化恰好发生在间隔末尾」被整帧丢掉
        if (changed) state.changedSinceLastSend = true
        return
      }

      state.lastHash = encoded.hash
      state.lastSentAt = now
      state.changedSinceLastSend = false
      state.width = encoded.width
      state.height = encoded.height

      const frame: TaskFrame = {
        taskId,
        seq: ++state.seq,
        ts: now,
        width: encoded.width,
        height: encoded.height,
        format: 'jpeg',
        data: encoded.base64,
        changed: isFirst ? true : changed,
      }
      getDeviceLinkClient()?.reportTaskFrame(frame)
    } finally {
      state.inFlight = false
    }
  }

  /** 采集失败计数；连续失败到上限自动停流，避免无谓的空转与日志刷屏 */
  private onCaptureFailure(taskId: string, state: StreamState, reason: string): void {
    state.failures += 1
    logger.deviceLink.warn(
      `[FrameStream] Capture failed task=${taskId} reason=${reason} (${state.failures}/${MAX_CAPTURE_FAILURES})`,
    )
    if (state.failures >= MAX_CAPTURE_FAILURES) {
      logger.deviceLink.warn(`[FrameStream] Auto-stopped task=${taskId} after repeated failures`)
      this.stop(taskId)
    }
  }

  /**
   * 编码为 JPEG，并从质量 / 分辨率两个维度降级到体积上限内
   *
   * @returns 编码结果；无法编码时 null
   */
  private encode(image: NativeImage): { base64: string; hash: string; width: number; height: number } | null {
    const size = image.getSize()
    if (!size.width || !size.height) return null

    let last: { base64: string; hash: string; width: number; height: number } | null = null

    for (const width of WIDTH_STEPS) {
      const scale = Math.min(1, width / size.width)
      const targetWidth = Math.max(1, Math.round(size.width * scale))
      const resized = scale < 1
        ? image.resize({ width: targetWidth, quality: 'good' })
        : image
      const resizedSize = resized.getSize()

      for (const quality of QUALITY_STEPS) {
        let buffer: Buffer
        try {
          buffer = resized.toJPEG(quality)
        } catch (err) {
          logger.deviceLink.warn(`[FrameStream] toJPEG failed: ${(err as Error).message}`)
          return last
        }
        const result = {
          base64: buffer.toString('base64'),
          hash: createHash('sha1').update(buffer).digest('hex'),
          width: resizedSize.width,
          height: resizedSize.height,
        }
        last = result
        if (buffer.byteLength <= TASK_FRAME_MAX_BYTES) return result
      }
    }

    // 全部降级后仍超限：发最低档，不丢帧（观看端看到低清好过看到空洞）
    if (last) {
      logger.deviceLink.warn('[FrameStream] Frame still above limit after downscaling, sending lowest quality')
    }
    return last
  }
}

export const taskFrameStreamer = new TaskFrameStreamer()
