/**
 * VTS 联动编排器（主进程）
 *
 * 职责：
 *   1. 按配置建立/维持与 VTS 的连接
 *   2. 音频 → PCM → 分帧（VtsAudioBridge）→ 算法（VtsLipSync）→ 注入（VtsClient）
 *   3. 帧发送节奏控制（**本模块最关键的工程点**，见下）
 *   4. 对外提供 start/stop/connect/disconnect/applyConfig/getStatus/pushAudio
 *
 * ── 节奏控制为什么不能用 setInterval ──
 *
 * 每帧 PCM 的播放时长是 35ms，因此必须每 35ms 发一帧，否则口型与声音会越走越偏。
 * `setInterval(35)` 在 JS 里会有两处系统性误差：
 *   · 定时器精度：实际触发在 35~50ms 之间抖，短音频听不出，长音频必然累积漂移
 *   · 回调本身耗时（FFT + WS 写）会进一步推迟下一次触发
 *
 * 因此采用**自校正循环**：维护 `nextAt` 绝对时间轴，每帧 `nextAt += FRAME_MS`，
 * 睡眠时长取 `nextAt - Date.now()`。单帧偶发超时会被下一帧自动吃掉（睡 0ms 追赶），
 * 长音频不会累积漂移。
 *
 * ── 队列语义 ──
 *
 *   pushAudio   → **追加**（AI 长回复会被切成多句 TTS，追加才能无缝衔接）
 *   clearAudio  → 清空（用户点「停止」，或开始一段新回复时打断旧音频）
 *
 * `mouthOpen` 状态**不随新音频复位**（对齐源项目：mouth_value 全程不复位），
 * 只在显式 clearAudio / 断开连接时归零，否则每句话开头都会出现一次「从 0 闭合起跳」。
 *
 * @module vts/VtsManager
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getMainWindow } from '../../bootstrap/windowManager'
import { VtsLipSync } from './VtsLipSync'
import { splitPcmIntoFrames, transcodeToPcm } from './VtsAudioBridge'
import { VtsClient } from './VtsClient'
import { getConfig, saveToken, updateConfig } from './VtsStore'
import {
  VTS_FRAME_MS,
  VTS_SAMPLE_RATE,
  type VtsConfig,
  type VtsConnectionState,
  type VtsExpression,
  type VtsHotkey,
  type VtsStatus,
} from './types'

/** 状态推送到渲染层的通道名（preload 侧同名订阅） */
export const VTS_STATUS_CHANNEL = 'vts:status'

/** 口型参数 ID（VTS 标准模型的嘴部开合参数名） */
const MOUTH_OPEN_PARAM = 'MouthOpen'

/** 队列上限（帧数）：≈60 秒音频。超出丢弃最旧的帧，避免内存与延迟无上限增长 */
const MAX_QUEUED_FRAMES = Math.ceil(60_000 / (VTS_FRAME_MS * 1000))

/** 睡眠工具 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class VtsManager {
  private static instance: VtsManager | null = null

  private readonly client: VtsClient
  private readonly lipSync: VtsLipSync

  /** 待发送的 PCM 帧队列 */
  private queue: Int16Array[] = []

  /** 发送循环是否在跑（防止重复启动多个循环） */
  private draining = false

  /** 是否处于运行中（start 后未 stop） */
  private started = false

  /** 最近一次生效的连接指纹（用于判断配置变更是否需要重连） */
  private appliedSignature = ''

  private framesSent = 0
  private framesDropped = 0
  private lastFrameAt: number | null = null

  private constructor() {
    this.lipSync = new VtsLipSync(getConfig().lipSyncMode)
    this.client = new VtsClient({
      onToken: token => {
        // token 落盘（safeStorage 加密）——授权成功后必须立即持久化，
        // 否则重启应用又要弹一次授权窗
        saveToken(token)
      },
      onModelData: (expressions, hotkeys) => {
        this.notifyStatus(expressions, hotkeys)
      },
      onStateChange: () => {
        this.notifyStatus()
      },
    })
  }

  static getInstance(): VtsManager {
    if (!VtsManager.instance) VtsManager.instance = new VtsManager()
    return VtsManager.instance
  }

  // ============================================
  // 生命周期
  // ============================================

  /** 按当前配置启动（幂等）。连接失败**不抛错**，只体现在 status 上 */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    const config = getConfig()
    this.lipSync.setMode(config.lipSyncMode)

    if (!config.enabled) {
      logger.system.info('[VTS] 未启用，跳过连接')
      return
    }

    this.appliedSignature = this.signatureOf(config)
    try {
      await this.client.connect(this.connectionParams(config))
    } catch (err) {
      // 首次连接失败是可预期的常态（VTS 没开 / 没开 API / 用户还没授权），
      // 不该打断应用启动流程，也不该刷 error 级日志
      logger.system.warn('[VTS] 连接失败：', err instanceof Error ? err.message : err)
    }
  }

  /** 断开并释放（幂等） */
  async stop(): Promise<void> {
    this.started = false
    this.appliedSignature = ''
    this.clearAudio()
    await this.client.disconnect()
  }

  /** 手动连接（UI 按钮 / 授权重试） */
  async connect(): Promise<void> {
    const config = getConfig()
    this.lipSync.setMode(config.lipSyncMode)
    this.appliedSignature = this.signatureOf(config)
    await this.client.connect(this.connectionParams(config))
  }

  /** 手动断开（保留配置与 token） */
  async disconnect(): Promise<void> {
    this.clearAudio()
    this.appliedSignature = ''
    await this.client.disconnect()
  }

  /**
   * 重连：先断开再连（用于 token 被清空后重新发起授权）。
   *
   * 必须显式断开：`connect()` 内部虽然也会 disconnect，但这里先断能保证
   * 「重新授权」的语义清晰 —— 用户点这个按钮就是要拿到新 token。
   */
  async reconnect(): Promise<void> {
    await this.disconnect()
    await this.connect()
  }

  // ============================================
  // 配置
  // ============================================

  /** 影响连接的配置字段（改这些才需要重连） */
  private signatureOf(config: VtsConfig): string {
    return JSON.stringify([
      config.enabled,
      config.url,
      config.token,
      config.pluginName,
      config.pluginDeveloper,
    ])
  }

  private connectionParams(config: VtsConfig): {
    url: string
    token: string
    pluginName: string
    pluginDeveloper: string
  } {
    return {
      url: config.url,
      token: config.token,
      pluginName: config.pluginName,
      pluginDeveloper: config.pluginDeveloper,
    }
  }

  /**
   * 写入配置并按需重连。
   *
   * 只有「影响连接的字段」变化才重连 —— 用户调口型模式、开关表情触发
   * 不该把已经建好的连接抖掉（VTS 重连会重新弹授权窗，代价很高）。
   */
  async applyConfig(patch: unknown): Promise<VtsConfig> {
    const next = updateConfig(patch)

    // 不影响连接的选项：就地生效，不重连
    this.lipSync.setMode(next.lipSyncMode)

    const signature = this.signatureOf(next)
    if (signature === this.appliedSignature) return next

    this.appliedSignature = signature

    if (!next.enabled) {
      this.clearAudio()
      await this.client.disconnect()
      this.notifyStatus()
      return next
    }

    try {
      await this.client.connect(this.connectionParams(next))
    } catch (err) {
      logger.system.warn('[VTS] 配置变更后重连失败：', err instanceof Error ? err.message : err)
    }
    this.notifyStatus()
    return next
  }

  // ============================================
  // 口型驱动
  // ============================================

  /**
   * 推入一段 TTS 音频（主路径）。
   *
   * 流程：转码 → 分帧 → 追加队列 → 触发发送循环。
   * 转码是异步的（spawn ffmpeg，通常 50~200ms），期间不阻塞调用方。
   *
   * @param audio 音频字节
   * @param mimeType 可选 MIME（提升 ffmpeg 输入格式探测准确率）
   * @returns 本次入队的帧数
   */
  async pushAudio(audio: Buffer, mimeType?: string): Promise<number> {
    const config = getConfig()

    if (!config.enabled || !config.autoLipSync) return 0
    if (!this.client.isAuthenticated()) {
      // 未连接时直接丢弃：入队只会堆积一批「连接恢复后突然喷出来」的陈旧口型
      this.framesDropped += 1
      return 0
    }

    const { pcm } = await transcodeToPcm(audio, mimeType)
    if (!pcm.length) return 0

    const frames = splitPcmIntoFrames(pcm)
    if (!frames.length) return 0

    // 背压：超上限时丢弃最旧的帧（宁可丢旧口型，也不要无限增长的内存与延迟）
    if (this.queue.length + frames.length > MAX_QUEUED_FRAMES) {
      const overflow = this.queue.length + frames.length - MAX_QUEUED_FRAMES
      this.queue.splice(0, overflow)
      this.framesDropped += overflow
      logger.system.warn(`[VTS] 帧队列溢出，丢弃最旧的 ${overflow} 帧`)
    }

    this.queue.push(...frames)
    void this.drainQueue()
    return frames.length
  }

  /**
   * 按音量直接驱动（降级路径）。
   *
   * 用于音频无法走 ffmpeg 的场景（例如实时流式 TTS 拿不到完整音频体）。
   * 当前有音频帧在播时直接忽略，避免两路数据源抢同一个参数造成抖动。
   */
  pushVolume(volume: number): void {
    const config = getConfig()
    if (!config.enabled || !config.autoLipSync) return
    if (!this.client.isAuthenticated()) return
    if (this.draining || this.queue.length > 0) return

    this.lipSync.processVolume(volume)
    if (this.client.injectParameter(MOUTH_OPEN_PARAM, this.lipSync.getMouthOpen())) {
      this.framesSent += 1
      this.lastFrameAt = Date.now()
    }
  }

  /** 清空待发送帧并复位口型（用户中断 / 新回复打断旧音频） */
  clearAudio(): void {
    const dropped = this.queue.length
    this.queue = []
    this.framesDropped += dropped
    this.lipSync.reset()

    // 主动把嘴合上：否则中断瞬间 VTS 会保持最后一个张开的嘴型（源项目同样问题）
    if (this.client.isAuthenticated()) {
      this.client.injectParameter(MOUTH_OPEN_PARAM, 0)
    }
  }

  /**
   * 帧发送循环（自校正节奏）。
   *
   * `draining` 保证同一时刻只有一个循环；队列空了自然退出，
   * 下次 pushAudio 再拉起 —— 不用常驻定时器，空闲时零开销。
   */
  private async drainQueue(): Promise<void> {
    if (this.draining) return
    this.draining = true

    // 时间轴基准：以「循环开始时刻」为原点，逐帧累加固定步长
    let nextAt = Date.now()

    try {
      while (this.queue.length > 0) {
        // 每帧都重新取配置：用户中途关掉开关应立即停止发送
        const config = getConfig()
        if (!config.enabled || !config.autoLipSync) {
          this.queue = []
          break
        }
        if (!this.client.isAuthenticated()) {
          const dropped = this.queue.length
          this.queue = []
          this.framesDropped += dropped
          break
        }

        const frame = this.queue.shift()
        if (!frame) break

        const { open } = this.lipSync.process(frame)
        if (this.client.injectParameter(MOUTH_OPEN_PARAM, open)) {
          this.framesSent += 1
          this.lastFrameAt = Date.now()
        } else {
          this.framesDropped += 1
        }

        nextAt += VTS_FRAME_MS * 1000
        const delay = nextAt - Date.now()
        if (delay > 0) {
          await sleep(delay)
        } else if (delay < -200) {
          // 落后超过 200ms 说明主进程被长时间阻塞（GC / 大任务），
          // 此时时间轴已失去意义，重新对齐，否则后面会连续「睡 0ms」补帧造成喷帧
          nextAt = Date.now()
        }
      }
    } catch (err) {
      logger.system.error('[VTS] 帧发送循环异常：', err)
      this.queue = []
    } finally {
      this.draining = false
    }
  }

  // ============================================
  // 表情 / 热键
  // ============================================

  /** 按名字触发（表情优先，回退热键） */
  trigger(name: string): { kind: 'expression' | 'hotkey'; name: string } | null {
    const config = getConfig()
    return this.client.trigger(name, config.enabledExpressions, config.enabledMotions)
  }

  /** 从完整回复文本中提取 `<名字>` 标签并触发 */
  triggerFromText(text: string): Array<{ kind: 'expression' | 'hotkey'; name: string }> {
    const config = getConfig()
    if (!config.enabled) return []
    return this.client.triggerFromText(text, config.enabledExpressions, config.enabledMotions)
  }

  /** 重新拉取模型表情 / 热键清单 */
  refreshModelData(): void {
    this.client.refreshModelData()
  }

  // ============================================
  // 自测
  // ============================================

  /**
   * 合成一段正弦波走完整口型链路（验收自测，不依赖 TTS）。
   *
   * 用 440Hz 纯音（落在元音频段内）而非白噪声：FFT 模式下元音占比高，
   * 嘴型打开明显，肉眼可判；白噪声会走辅音分支，看起来像「微张」不好确认。
   *
   * @param durationMs 时长（默认 1.5s）
   * @returns 入队帧数
   */
  async selfTest(durationMs = 1500): Promise<number> {
    if (!this.client.isAuthenticated()) {
      throw new Error('尚未连接 VTS，请先连接并完成授权')
    }

    const sampleCount = Math.floor((VTS_SAMPLE_RATE * durationMs) / 1000)
    const pcm = Buffer.alloc(sampleCount * 2)
    const amplitude = 12000 // 接近 rms_threshold(15000)，能明显驱动但不会削顶
    const angular = (2 * Math.PI * 440) / VTS_SAMPLE_RATE

    for (let i = 0; i < sampleCount; i += 1) {
      // 首尾各 80ms 做淡入淡出，避免起止爆音在 VTS 上表现为「嘴猛地弹一下」
      const fadeSamples = Math.floor(VTS_SAMPLE_RATE * 0.08)
      let envelope = 1
      if (i < fadeSamples) envelope = i / fadeSamples
      else if (i > sampleCount - fadeSamples) envelope = (sampleCount - i) / fadeSamples

      const value = Math.round(Math.sin(angular * i) * amplitude * envelope)
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2)
    }

    const frames = splitPcmIntoFrames(pcm)
    this.queue.push(...frames)
    void this.drainQueue()
    return frames.length
  }

  // ============================================
  // 状态
  // ============================================

  getStatus(): VtsStatus {
    const config = getConfig()
    return {
      enabled: config.enabled,
      running: this.started && config.enabled,
      state: this.client.getState() as VtsConnectionState,
      message: this.client.getStateMessage(),
      url: config.url,
      authenticated: this.client.isAuthenticated(),
      lastFrameAt: this.lastFrameAt,
      framesSent: this.framesSent,
      framesDropped: this.framesDropped,
      mouthOpen: Math.round(this.lipSync.getMouthOpen() * 1000) / 1000,
      pendingFrames: this.queue.length,
      expressions: this.client.getExpressions(),
      hotkeys: this.client.getHotkeys(),
      activeExpressions: this.client.getActiveExpressionNames(),
    }
  }

  /** 把状态推给渲染层（窗口不在/已销毁时静默跳过） */
  private notifyStatus(expressions?: VtsExpression[], hotkeys?: VtsHotkey[]): void {
    try {
      const win = getMainWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(VTS_STATUS_CHANNEL, {
        status: this.getStatus(),
        ...(expressions ? { expressions } : {}),
        ...(hotkeys ? { hotkeys } : {}),
      })
    } catch (err) {
      logger.system.debug('[VTS] 状态推送失败：', err)
    }
  }
}

/** 单例 */
let instance: VtsManager | null = null

export function getVtsManager(): VtsManager {
  if (!instance) instance = VtsManager.getInstance()
  return instance
}
