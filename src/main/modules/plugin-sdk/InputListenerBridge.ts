/**
 * Input Listener Bridge — 输入监听桥接层
 *
 * 为外部插件提供"屏幕活动流"采集能力，用于录制用户操作（如 ai-macro-recorder 插件）。
 *
 * 设计决策（V1 截图流方案）：
 *   原方案计划用 uiohook-napi 监听全局鼠标/键盘事件，但该库为 native addon，
 *   在 Electron 39 + 多平台打包（macOS arm64/x64、Windows x64、Linux）下存在
 *   重建与 ABI 兼容风险，且 macOS 需额外申请"辅助功能"权限。
 *   为保证工业级稳定性与零额外权限，V1 采用"截图流"方案：
 *   - 定时截屏（默认 500ms），推送屏幕时间线给插件
 *   - 可选缩略图哈希变化检测，画面无变化时不推送，降低插件 VLM 分析负载
 *   - 跨平台一致，复用 DesktopControlManager.captureScreen（已处理屏幕录制权限）
 *
 * 分层约定：
 *   - Host Bridge 仅负责"采集原始屏幕帧"，不做语义理解
 *   - 语义化（推断用户做了什么）由插件的 semantic-parser 用 VLM 完成
 *
 * 扩展点（V2，未实现）：
 *   若未来需要精确输入事件，可动态加载 uiohook-napi 并通过 startNativeInputListening 暴露。
 *   届时需在 asarUnpack 与 electron-rebuild 配置中补充该 native 包。
 *
 * @module plugin-sdk/InputListenerBridge
 */

import { nativeImage } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { getDesktopControlManager } from '../desktop-control/DesktopControlManager'
import type { ScreenshotResult } from '../desktop-control/types/actions'

// ============================================
// 类型定义
// ============================================

/** 截图流事件：每次采集到的屏幕帧 */
export interface ScreenStreamEvent {
  /** 流 ID（startScreenshotStream 返回） */
  streamId: string
  /** 截图时间戳（ms） */
  timestamp: number
  /** base64 编码的 PNG 图片（与 ScreenshotResult.dataUrl 一致） */
  dataUrl: string
  /** 显示器 ID */
  displayId: number
  /** 截图区域 */
  region: { x: number; y: number; width: number; height: number }
  /** 本次帧相对上一帧是否发生变化（仅 onlyOnChange=true 时有意义） */
  changed: boolean
  /** 变化比例（0-1，changed=true 时填充，否则为 0） */
  changeRatio: number
}

/** 截图流启动选项 */
export interface StreamOptions {
  /** 采样间隔（ms），默认 500，最小 200（防止过载） */
  intervalMs?: number
  /** 显示器 ID（默认 0 主屏） */
  displayId?: number
  /** 仅在画面变化时推送（默认 true，降低插件负载） */
  onlyOnChange?: boolean
  /** 变化判定阈值（0-1，默认 0.02 即 2% 像素变化才推送） */
  changeThreshold?: number
  /** 缩略图采样宽度（用于变化检测，默认 160，越小越快但越不敏感） */
  sampleWidth?: number
}

/** 流状态 */
type StreamState = 'active' | 'paused' | 'stopped'

/** 内部流记录 */
interface StreamRecord {
  id: string
  options: Required<StreamOptions>
  callback: (event: ScreenStreamEvent) => void
  timer: ReturnType<typeof setInterval> | null
  state: StreamState
  /** 上一帧缩略图灰度数组（用于变化检测，null 表示首帧） */
  prevSamples: Uint8Array | null
  /** 已推送帧数 */
  frameCount: number
}

// ============================================
// InputListenerBridge 实现
// ============================================

export class InputListenerBridge {
  private static _instance: InputListenerBridge | null = null
  /** 所有活跃的截图流（streamId -> record） */
  private streams = new Map<string, StreamRecord>()
  /** 流 ID 自增计数器 */
  private seq = 0

  private constructor() {
    logger.system?.info('[InputListenerBridge] Initialized (screenshot-stream mode)')
  }

  /** 获取单例 */
  static getInstance(): InputListenerBridge {
    if (!InputListenerBridge._instance) {
      InputListenerBridge._instance = new InputListenerBridge()
    }
    return InputListenerBridge._instance
  }

  // ============================================
  // 截图流 API
  // ============================================

  /**
   * 启动截图流
   *
   * 启动后按指定间隔采集屏幕帧，通过 callback 推送给插件。
   * 若 onlyOnChange=true，仅在画面变化超过阈值时推送。
   *
   * @returns streamId，用于 stopScreenshotStream / pause / resume
   */
  startScreenshotStream(
    options: StreamOptions,
    callback: (event: ScreenStreamEvent) => void,
  ): string {
    // 参数规范化与边界校验
    const intervalMs = Math.max(200, options.intervalMs ?? 500)
    const opts: Required<StreamOptions> = {
      intervalMs,
      displayId: options.displayId ?? 0,
      onlyOnChange: options.onlyOnChange ?? true,
      changeThreshold: clamp(options.changeThreshold ?? 0.02, 0, 1),
      sampleWidth: Math.max(40, options.sampleWidth ?? 160),
    }

    const streamId = `stream-${Date.now()}-${++this.seq}`
    const record: StreamRecord = {
      id: streamId,
      options: opts,
      callback,
      timer: null,
      state: 'active',
      prevSamples: null,
      frameCount: 0,
    }

    this.streams.set(streamId, record)
    this.runStream(record)
    logger.system?.info(
      `[InputListenerBridge] Stream started: ${streamId} (interval=${opts.intervalMs}ms, onlyOnChange=${opts.onlyOnChange})`,
    )
    return streamId
  }

  /** 停止截图流并释放资源 */
  stopScreenshotStream(streamId: string): boolean {
    const record = this.streams.get(streamId)
    if (!record) return false

    if (record.timer) {
      clearInterval(record.timer)
      record.timer = null
    }
    record.state = 'stopped'
    record.prevSamples = null
    this.streams.delete(streamId)
    logger.system?.info(
      `[InputListenerBridge] Stream stopped: ${streamId} (frames=${record.frameCount})`,
    )
    return true
  }

  /** 暂停截图流（保留 prevSamples，可恢复） */
  pauseScreenshotStream(streamId: string): boolean {
    const record = this.streams.get(streamId)
    if (!record || record.state !== 'active') return false
    if (record.timer) {
      clearInterval(record.timer)
      record.timer = null
    }
    record.state = 'paused'
    logger.system?.debug(`[InputListenerBridge] Stream paused: ${streamId}`)
    return true
  }

  /** 恢复已暂停的截图流 */
  resumeScreenshotStream(streamId: string): boolean {
    const record = this.streams.get(streamId)
    if (!record || record.state !== 'paused') return false
    record.state = 'active'
    this.runStream(record)
    logger.system?.debug(`[InputListenerBridge] Stream resumed: ${streamId}`)
    return true
  }

  /** 查询流状态 */
  getStreamState(streamId: string): StreamState | null {
    return this.streams.get(streamId)?.state ?? null
  }

  /** 当前活跃流数量 */
  getActiveStreamCount(): number {
    let n = 0
    for (const r of this.streams.values()) if (r.state === 'active') n++
    return n
  }

  /** 停止所有流（应用退出或插件卸载时调用） */
  stopAll(): void {
    for (const id of Array.from(this.streams.keys())) {
      this.stopScreenshotStream(id)
    }
  }

  // ============================================
  // 能力探测（V2 扩展预留）
  // ============================================

  /**
   * 是否支持原生输入监听（鼠标/键盘事件级精度）。
   * V1 恒返回 false，仅提供截图流能力。
   * V2 若动态加载 uiohook-napi 成功则返回 true。
   */
  isNativeInputSupported(): boolean {
    return false
  }

  // ============================================
  // 内部实现
  // ============================================

  /** 启动定时采集循环 */
  private runStream(record: StreamRecord): void {
    // 立即采集一帧（首帧不跳过，建立基线）
    this.captureAndPush(record).catch((err) => {
      logger.system?.warn(`[InputListenerBridge] Initial capture failed: ${err}`)
    })

    record.timer = setInterval(() => {
      this.captureAndPush(record).catch((err) => {
        logger.system?.warn(`[InputListenerBridge] Capture error: ${err}`)
      })
    }, record.options.intervalMs)
  }

  /** 采集一帧并按策略推送 */
  private async captureAndPush(record: StreamRecord): Promise<void> {
    if (record.state !== 'active') return

    const desktop = getDesktopControlManager()
    const result: ScreenshotResult = await desktop.captureScreen(record.options.displayId)

    if (!result.success || !result.dataUrl) {
      logger.system?.warn(`[InputListenerBridge] Screenshot failed: ${result.error ?? 'unknown'}`)
      return
    }

    // 变化检测
    let changed = true
    let changeRatio = 1
    if (record.options.onlyOnChange) {
      const samples = await this.computeThumbnailSamples(result.dataUrl, record.options.sampleWidth)
      if (record.prevSamples && samples) {
        const diff = this.computeDiffRatio(record.prevSamples, samples)
        changed = diff >= record.options.changeThreshold
        changeRatio = diff
      }
      // 更新基线（无论是否推送，都更新基线以便下次对比）
      if (samples) record.prevSamples = samples
    }

    // 不变化则跳过推送
    if (record.options.onlyOnChange && !changed) return

    record.frameCount++
    const event: ScreenStreamEvent = {
      streamId: record.id,
      timestamp: result.timestamp || Date.now(),
      dataUrl: result.dataUrl,
      displayId: result.displayId,
      region: result.region,
      changed,
      changeRatio,
    }

    try {
      record.callback(event)
    } catch (err) {
      // 插件回调异常不应中断采集流，记录后继续
      logger.system?.warn(`[InputListenerBridge] Stream callback error: ${err}`)
    }
  }

  /**
   * 将 base64 PNG 转为缩略图灰度采样数组。
   *
   * 用 Electron nativeImage 解码 PNG 并降采样为低分辨率灰度图（无需额外依赖）：
   *   1. nativeImage.createFromDataURL 解析图片
   *   2. resize 缩放到目标宽度
   *   3. toBitmap 取 BGRA 原始像素，转灰度（ITU-R BT.601）
   *
   * 若 nativeImage 不可用（非 Electron 环境，如单测），返回 null 跳过变化检测。
   */
  private async computeThumbnailSamples(
    dataUrl: string,
    targetWidth: number,
  ): Promise<Uint8Array | null> {
    try {
      const img = nativeImage.createFromDataURL(dataUrl)
      const size = img.getSize()
      if (size.width === 0 || size.height === 0) return null

      // 计算缩略图尺寸
      const scale = targetWidth / size.width
      const thumbW = targetWidth
      const thumbH = Math.max(1, Math.round(size.height * scale))

      // 缩放（nativeImage.resize 内部用高质量算法）
      const resized = img.resize({ width: thumbW, height: thumbH })
      const bitmap = resized.toBitmap() // BGRA 原始像素

      // BGRA -> 灰度（ITU-R BT.601）
      const samples = new Uint8Array(thumbW * thumbH)
      for (let i = 0; i < samples.length; i++) {
        const offset = i * 4
        const b = bitmap[offset]
        const g = bitmap[offset + 1]
        const r = bitmap[offset + 2]
        samples[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      }
      return samples
    } catch (err) {
      logger.system?.debug(`[InputListenerBridge] Thumbnail sampling skipped: ${err}`)
      return null
    }
  }

  /**
   * 计算两帧灰度采样的差异比例。
   * 使用绝对差值求和（SAD）归一化，O(n) 复杂度，适合实时检测。
   */
  private computeDiffRatio(a: Uint8Array, b: Uint8Array): number {
    if (a.length !== b.length) return 1 // 尺寸变化视为完全变化
    if (a.length === 0) return 0

    let sumAbsDiff = 0
    for (let i = 0; i < a.length; i++) {
      sumAbsDiff += Math.abs(a[i] - b[i])
    }
    // 归一化到 0-1（255 为最大单像素差值）
    return sumAbsDiff / (a.length * 255)
  }
}

// ============================================
// 工具函数
// ============================================

/** 数值钳制到 [min, max] */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

// ============================================
// 导出
// ============================================

/** 全局单例便捷获取 */
export function getInputListenerBridge(): InputListenerBridge {
  return InputListenerBridge.getInstance()
}
