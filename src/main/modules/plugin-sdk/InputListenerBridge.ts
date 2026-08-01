/**
 * Input Listener Bridge — 输入监听桥接层
 *
 * 为外部插件提供输入事件采集能力，用于录制用户操作（如 ai-macro-recorder 插件）。
 *
 * 双模式设计：
 *   1. 原生输入事件流（V2 主方案，推荐）：基于 uiohook-napi 监听系统级鼠标/键盘事件，
 *      精确捕获每次点击坐标、按键 code、滚轮量。类似 Codex/小艺的宏录制。
 *      macOS 需"辅助功能"权限，Windows/Linux 开箱即用。
 *   2. 截图流（V1 兼容方案）：定时截屏 + 变化检测，不依赖 native addon，
 *      但只能"猜"操作（不准确），保留作为降级方案。
 *
 * 分层约定：
 *   - Host Bridge 仅负责"采集原始输入事件"，不做语义理解
 *   - 插件根据事件流自行生成 macro steps（确定性操作序列）
 *
 * @module plugin-sdk/InputListenerBridge
 */

import { nativeImage, screen, shell, systemPreferences } from 'electron'
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
  /**
   * 鼠标光标全局坐标（screen.getCursorScreenPoint）。
   * 坐标系为全局屏幕坐标，需结合 region/displayId 判断鼠标是否在截图区域内。
   * 鼠标位置 + 画面变化 = 推断点击位置的关键依据。
   */
  cursor: { x: number; y: number }
}

// ============================================
// 原生输入事件类型（V2）
// ============================================

/** 鼠标按钮 */
export type MouseButton = 'left' | 'right' | 'middle'

/** 鼠标输入事件 */
export interface NativeMouseEvent {
  /** 事件类型 */
  type: 'mousedown' | 'mouseup' | 'mousemove' | 'click' | 'wheel'
  /** 时间戳（ms） */
  timestamp: number
  /** 全局 X 坐标 */
  x: number
  /** 全局 Y 坐标 */
  y: number
  /** 按钮（mousedown/up/click 时有值） */
  button?: MouseButton
  /** 点击次数（click 时有值，1=单击 2=双击） */
  clicks?: number
  /** 修饰键状态 */
  modifiers: {
    alt: boolean
    ctrl: boolean
    shift: boolean
    meta: boolean
  }
  /** 滚轮量（wheel 时有值，正=向上，负=向下） */
  rotation?: number
  /** 滚轮方向（wheel 时有值） */
  direction?: 'vertical' | 'horizontal'
}

/** 键盘输入事件 */
export interface NativeKeyboardEvent {
  /** 事件类型 */
  type: 'keydown' | 'keyup'
  /** 时间戳（ms） */
  timestamp: number
  /** 按键 code（标准化，如 'Enter', 'Escape', 'KeyA'） */
  key: string
  /** uiohook 原始 keycode */
  keycode: number
  /** 修饰键状态 */
  modifiers: {
    alt: boolean
    ctrl: boolean
    shift: boolean
    meta: boolean
  }
}

/** 原生输入事件（鼠标或键盘的联合类型） */
export type NativeInputEvent = NativeMouseEvent | NativeKeyboardEvent

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

  // ===== 原生输入事件监听状态（V2）=====
  /** uiohook-napi 模块实例（懒加载） */
  private uiohook: any | null = null
  /** uiohook 加载状态：pending | available | unavailable */
  private uiohookStatus: 'pending' | 'available' | 'unavailable' = 'pending'
  /** uiohook 加载失败的详细错误信息（供 UI 诊断展示） */
  private uiohookError: string | null = null
  /** 原生输入事件监听器集合 */
  private nativeListeners = new Set<(event: NativeInputEvent) => void>()
  /** 原生监听是否已启动 */
  private nativeListening = false
  /**
   * 回放抑制 flag：为 true 时丢弃所有原生输入事件。
   * MacroPlayer 回放宏时设置 true，防止回放模拟的鼠标/键盘操作被录进去。
   */
  private suppressNativeInput = false

  private constructor() {
    logger.system?.info('[InputListenerBridge] Initialized (screenshot-stream + native-input mode)')
    // 懒加载 uiohook-napi（不阻塞主线程，首次使用原生监听时才检查）
    void this.tryLoadUiohook()
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
  // 原生输入事件监听（V2 主方案）
  // ============================================

  /**
   * 尝试加载 uiohook-napi 模块
   *
   * 该库为 native addon（N-API + prebuildify），提供系统级鼠标/键盘事件监听。
   * macOS 需"辅助功能"权限；Windows/Linux 开箱即用。
   * 加载失败（未安装/平台不支持/权限缺失）时降级为 unavailable，不影响截图流。
   *
   * 常见失败原因：
   *   1. 模块未安装（npm install 缺失）
   *   2. 打包配置错误：Rollup 将 native 模块打包进 chunk，导致 node-gyp-build 路径解析失败
   *      → 需要在 vite.config.ts 的 EXTERNAL_DEPS 中声明 'uiohook-napi'
   *   3. 平台二进制缺失（prebuilds 目录无对应平台 .node 文件）
   *   4. macOS 权限未授予（模块可加载但 start() 后无事件，不影响 import）
   */
  private async tryLoadUiohook(): Promise<void> {
    try {
      const mod = await import('uiohook-napi')
      // uiohook-napi 导出 uIOhook 单例对象（非 class，无需 new）
      // 直接使用 mod.uIOhook.on('mousedown', ...) / .start() / .stop()
      const hook = mod.uIOhook || mod.default?.uIOhook
      if (!hook || typeof hook.on !== 'function' || typeof hook.start !== 'function') {
        throw new Error(
          `uIOhook singleton not found in module exports. ` +
          `Available exports: [${Object.keys(mod).join(', ')}]. ` +
          `This usually means the module was incorrectly bundled by Rollup. ` +
          `Ensure 'uiohook-napi' is listed in vite.config.ts EXTERNAL_DEPS.`,
        )
      }
      this.uiohook = hook
      this.uiohookStatus = 'available'
      this.uiohookError = null
      logger.system?.info('[InputListenerBridge] uiohook-napi loaded (native input monitoring available)')
    } catch (err) {
      this.uiohookStatus = 'unavailable'
      const errMsg = err instanceof Error ? err.message : String(err)
      this.uiohookError = errMsg
      logger.system?.error(
        `[InputListenerBridge] uiohook-napi unavailable, native input monitoring disabled.`,
      )
      logger.system?.error(`[InputListenerBridge] Load error: ${errMsg}`)
      // 打印堆栈以便诊断打包/路径问题
      if (err instanceof Error && err.stack) {
        logger.system?.error(`[InputListenerBridge] Stack: ${err.stack}`)
      }
    }
  }

  /**
   * 重新尝试加载 uiohook-napi 模块
   *
   * 适用场景：
   *   - 首次加载时模块尚未就绪（如打包后首次运行路径未解压）
   *   - 用户在 UI 上点击"重新检测"时触发重试
   *   - 应用从睡眠/挂起恢复后 native 模块需要重新初始化
   *
   * @returns 是否加载成功
   */
  async retryLoadUiohook(): Promise<boolean> {
    if (this.uiohookStatus === 'available' && this.uiohook) {
      return true
    }
    logger.system?.info('[InputListenerBridge] Retrying uiohook-napi load...')
    this.uiohookStatus = 'pending'
    await this.tryLoadUiohook()
    // tryLoadUiohook 内部会将状态改为 'available' 或 'unavailable'，
    // 但 TypeScript 无法追踪方法调用后的属性变更，需显式断言读取
    return (this.uiohookStatus as 'pending' | 'available' | 'unavailable') === 'available'
  }

  /**
   * 是否支持原生输入监听（鼠标/键盘事件级精度）。
   *
   * 必须满足：
   *   1. uiohook-napi 模块加载成功
   *   2. macOS 辅助功能权限已授予（Windows/Linux 无此要求）
   *
   * 插件应在调用 startNativeInputListening 前检查此方法。
   * macOS 未授权时返回 false，调用方可提示用户去系统设置授权。
   */
  isNativeInputSupported(): boolean {
    if (this.uiohookStatus !== 'available' || this.uiohook === null) {
      return false
    }
    // macOS 需辅助功能权限，否则 uiohook.start() 静默不产生事件
    if (process.platform === 'darwin') {
      try {
        return systemPreferences.isTrustedAccessibilityClient(false)
      } catch {
        // API 不可用时降级为允许（让 start() 自行失败）
        return true
      }
    }
    return true
  }

  /**
   * 检查 macOS 辅助功能权限，可选弹出系统授权对话框。
   *
   * prompt=true 时的行为：
   *   - 先调用 isTrustedAccessibilityClient(true) 尝试弹出系统授权对话框（仅首次有效）
   *   - 如果权限仍未授予（用户之前拒绝过 / 非首次），直接打开系统设置的辅助功能面板
   *   - 这样无论用户之前是否拒绝过，都能引导到正确的设置页面
   *
   * @param prompt 是否弹出系统授权对话框（仅 macOS 有效）
   * @returns 权限状态：'granted' | 'denied' | 'not-applicable'
   */
  checkAccessibilityPermission(prompt = false): 'granted' | 'denied' | 'not-applicable' {
    if (process.platform !== 'darwin') return 'not-applicable'
    try {
      // 先检查当前权限状态
      const trusted = systemPreferences.isTrustedAccessibilityClient(prompt)
      if (trusted) return 'granted'

      // 权限未授予：如果 prompt=true，直接打开系统设置的辅助功能面板
      // isTrustedAccessibilityClient(true) 仅首次请求时弹窗，用户拒绝过就不再弹
      // 所以这里主动打开系统设置，确保用户能找到授权入口
      if (prompt) {
        void shell
          .openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
          .catch((err) => {
            logger.system?.warn(`[InputListenerBridge] Failed to open Accessibility settings: ${err}`)
          })
      }
      return 'denied'
    } catch {
      return 'not-applicable'
    }
  }

  /** uiohook 加载状态（供 UI 展示降级原因） */
  getNativeInputStatus(): 'pending' | 'available' | 'unavailable' {
    return this.uiohookStatus
  }

  /** uiohook 加载失败的详细错误信息（供 UI 诊断展示，加载成功时为 null） */
  getNativeInputError(): string | null {
    return this.uiohookError
  }

  /**
   * 设置回放抑制 flag。
   *
   * MacroPlayer 回放宏时调用 setSuppressNativeInput(true)，
   * 回放结束后调用 setSuppressNativeInput(false)。
   * 抑制期间所有原生输入事件被丢弃，防止回放模拟的操作被录进去。
   */
  setSuppressNativeInput(suppress: boolean): void {
    this.suppressNativeInput = suppress
    if (suppress) {
      logger.system?.info('[InputListenerBridge] Native input suppressed (playback mode)')
    } else {
      logger.system?.info('[InputListenerBridge] Native input resumed')
    }
  }

  /**
   * 启动原生输入事件监听
   *
   * 监听系统级鼠标和键盘事件，每次事件触发时调用 callback。
   * 事件包含精确的坐标、按钮、按键 code、修饰键状态。
   *
   * macOS 注意：
   * - 需"辅助功能"权限（System Settings → Privacy & Security → Accessibility）
   * - 未授权时 uiohook.start() 会崩溃，调用方应先检查 isNativeInputSupported()
   *
   * @param callback 事件回调（鼠标点击/移动/滚轮、键盘按键）
   * @returns 是否成功启动
   */
  startNativeInputListening(callback: (event: NativeInputEvent) => void): boolean {
    if (this.uiohookStatus !== 'available' || !this.uiohook) {
      logger.system?.warn('[InputListenerBridge] startNativeInputListening: uiohook not available')
      return false
    }

    this.nativeListeners.add(callback)

    // 首次订阅时启动 uiohook
    if (!this.nativeListening) {
      try {
        this.attachUiohookHandlers()
        this.uiohook.start()
        this.nativeListening = true
        logger.system?.info('[InputListenerBridge] Native input listening started')
      } catch (err) {
        logger.system?.error(`[InputListenerBridge] Failed to start uiohook: ${err}`)
        this.nativeListeners.delete(callback)
        return false
      }
    }

    return true
  }

  /**
   * 停止原生输入事件监听
   *
   * 移除 callback。当最后一个监听器移除后，自动停止 uiohook 释放系统资源。
   */
  stopNativeInputListening(callback: (event: NativeInputEvent) => void): void {
    this.nativeListeners.delete(callback)

    // 无监听器时停止 uiohook
    if (this.nativeListeners.size === 0 && this.nativeListening) {
      try {
        this.uiohook?.stop()
        this.nativeListening = false
        logger.system?.info('[InputListenerBridge] Native input listening stopped')
      } catch (err) {
        logger.system?.warn(`[InputListenerBridge] Failed to stop uiohook: ${err}`)
      }
    }
  }

  /**
   * 绑定 uiohook 事件处理器，将原始事件归一化为 NativeInputEvent
   *
   * uiohook 事件字段说明：
   * - 鼠标：type, x, y, button(1=left,2=right,3=middle), clicks, altKey/ctrlKey/metaKey/shiftKey
   * - 键盘：type, keycode, altKey/ctrlKey/metaKey/shiftKey
   * - 滚轮：type, amount, rotation, direction
   */
  private attachUiohookHandlers(): void {
    if (!this.uiohook) return

    const dispatch = (event: NativeInputEvent) => {
      // 回放抑制：MacroPlayer 回放时丢弃所有事件，防止模拟操作被录进去
      if (this.suppressNativeInput) return
      for (const cb of this.nativeListeners) {
        try {
          cb(event)
        } catch (err) {
          logger.system?.warn(`[InputListenerBridge] Native input listener error: ${err}`)
        }
      }
    }

    // 鼠标按下
    this.uiohook.on('mousedown', (e: any) => {
      dispatch({
        type: 'mousedown',
        timestamp: Date.now(),
        x: e.x,
        y: e.y,
        button: mapMouseButton(e.button),
        clicks: e.clicks || 1,
        modifiers: extractModifiers(e),
      })
    })

    // 鼠标释放
    this.uiohook.on('mouseup', (e: any) => {
      dispatch({
        type: 'mouseup',
        timestamp: Date.now(),
        x: e.x,
        y: e.y,
        button: mapMouseButton(e.button),
        clicks: e.clicks || 1,
        modifiers: extractModifiers(e),
      })
    })

    // 鼠标点击（uiohook 的 click 事件含 click count）
    this.uiohook.on('click', (e: any) => {
      dispatch({
        type: 'click',
        timestamp: Date.now(),
        x: e.x,
        y: e.y,
        button: mapMouseButton(e.button),
        clicks: e.clicks || 1,
        modifiers: extractModifiers(e),
      })
    })

    // 鼠标移动（默认不监听以减少噪声，录制拖拽时由插件按需开启）
    // 注意：mousemove 事件量极大，仅在插件明确需要时才应处理
    this.uiohook.on('mousemove', (e: any) => {
      dispatch({
        type: 'mousemove',
        timestamp: Date.now(),
        x: e.x,
        y: e.y,
        modifiers: extractModifiers(e),
      })
    })

    // 滚轮
    this.uiohook.on('wheel', (e: any) => {
      dispatch({
        type: 'wheel',
        timestamp: Date.now(),
        x: e.x,
        y: e.y,
        rotation: e.rotation,
        direction: e.direction === 3 ? 'horizontal' : 'vertical',
        modifiers: extractModifiers(e),
      })
    })

    // 键盘按下
    this.uiohook.on('keydown', (e: any) => {
      dispatch({
        type: 'keydown',
        timestamp: Date.now(),
        key: mapKeycode(e.keycode),
        keycode: e.keycode,
        modifiers: extractModifiers(e),
      })
    })

    // 键盘释放
    this.uiohook.on('keyup', (e: any) => {
      dispatch({
        type: 'keyup',
        timestamp: Date.now(),
        key: mapKeycode(e.keycode),
        keycode: e.keycode,
        modifiers: extractModifiers(e),
      })
    })
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

    // 获取鼠标光标全局坐标（Electron 内置 API，无需 native addon / 额外权限）。
    // 鼠标位置是推断用户操作（点击/拖拽/移动）的关键依据，
    // 配合画面变化可精确定位操作目标，避免 AI 纯靠截图猜测。
    let cursor = { x: 0, y: 0 }
    try {
      const point = screen.getCursorScreenPoint()
      cursor = { x: point.x, y: point.y }
    } catch {
      // 多显示器边界场景下可能抛错，保持默认 (0,0)
    }

    const event: ScreenStreamEvent = {
      streamId: record.id,
      timestamp: result.timestamp || Date.now(),
      dataUrl: result.dataUrl,
      displayId: result.displayId,
      region: result.region,
      changed,
      changeRatio,
      cursor,
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

/**
 * uiohook 按钮编号映射为统一标识
 * uiohook: 1=left, 2=right, 3=middle
 */
function mapMouseButton(button: number): MouseButton {
  switch (button) {
    case 1:
      return 'left'
    case 2:
      return 'right'
    case 3:
      return 'middle'
    default:
      return 'left'
  }
}

/** 从 uiohook 事件提取修饰键状态 */
function extractModifiers(e: any): {
  alt: boolean
  ctrl: boolean
  shift: boolean
  meta: boolean
} {
  return {
    alt: !!e.altKey,
    ctrl: !!e.ctrlKey,
    shift: !!e.shiftKey,
    meta: !!e.metaKey,
  }
}

/**
 * uiohook keycode 映射为标准化 key 名称
 *
 * uiohook 在 macOS 上使用 Carbon/HIToolbox 虚拟键码（kVK_*），
 * 参考 https://developer.apple.com/library/archive/technotes/tn2450/
 *
 * 注意：此映射必须与 darwin.ts 的 keyToKeyCode() 保持一致，
 * 否则录制端记录的按键名与回放端的键码映射不匹配，导致输入错误内容。
 *
 * 仅映射常用键，未映射的返回 `Key_${keycode}` 占位。
 */
function mapKeycode(keycode: number): string {
  // macOS Carbon keycodes（uiohook 在 macOS 上用这套编码）
  const macMap: Record<number, string> = {
    // ===== 字母键（第一行 QWERTY 布局）=====
    0: 'a', 1: 's', 2: 'd', 3: 'f', 4: 'h', 5: 'g', 6: 'z', 7: 'x',
    8: 'c', 9: 'v', 11: 'b', 12: 'q', 13: 'w', 14: 'e', 15: 'r',
    16: 'y', 17: 't',
    // ===== 数字键（顶排）=====
    // 注意：macOS 键码顺序与数字大小不一致，5/6 和 8/9 位置互换
    18: '1', 19: '2', 20: '3', 21: '4', 23: '5', 22: '6',
    26: '7', 28: '8', 25: '9', 29: '0',
    // ===== 标点符号 =====
    27: '-', 24: '=', 30: ']', 33: '[', 39: "'",
    41: ';', 42: '\\', 43: ',', 47: '.', 44: '/', 50: '`',
    // ===== 字母键（第二、三行）=====
    31: 'o', 32: 'u', 34: 'i', 35: 'p',
    37: 'l', 38: 'j', 40: 'k',
    45: 'n', 46: 'm',
    // ===== 特殊键 =====
    36: 'Enter',      // kVK_Return
    48: 'Tab',        // kVK_Tab
    49: 'Space',      // kVK_Space
    51: 'Backspace',  // kVK_Delete（macOS 的 Delete 即 Backspace）
    53: 'Escape',     // kVK_Escape
    76: 'Enter',      // kVK_ANSI_KeypadEnter
    // ===== 修饰键 =====
    55: 'Meta',       // kVK_Command
    56: 'Shift',      // kVK_Shift
    57: 'CapsLock',   // kVK_CapsLock
    58: 'Alt',        // kVK_Option
    59: 'Control',    // kVK_Control
    60: 'Shift',      // kVK_RightShift
    61: 'Alt',        // kVK_RightOption
    62: 'Control',    // kVK_RightControl
    63: 'Fn',         // kVK_Function
    // ===== 功能键 =====
    122: 'F1', 120: 'F2', 99: 'F3', 118: 'F4',
    96: 'F5', 97: 'F6', 98: 'F7', 100: 'F8',
    101: 'F9', 109: 'F10', 103: 'F11', 111: 'F12',
    105: 'F13', 107: 'F14', 113: 'F15', 106: 'F16',
    // ===== 导航键 =====
    115: 'Home', 116: 'PageUp', 119: 'End', 121: 'PageDown',
    123: 'ArrowLeft', 124: 'ArrowRight', 125: 'ArrowDown', 126: 'ArrowUp',
  }

  const key = macMap[keycode]
  if (key) return key

  // Windows/Linux keycode 映射（与 macOS 不同）
  // 这里用通用 fallback，插件可自行根据 keycode 进一步映射
  return `Key_${keycode}`
}

// ============================================
// 导出
// ============================================

/** 全局单例便捷获取 */
export function getInputListenerBridge(): InputListenerBridge {
  return InputListenerBridge.getInstance()
}
