/**
 * VTS 口型同步算法（RMS + FFT）
 *
 * 算法逐行对齐源项目 `py/vts_manager.py::vts_worker`，参数**不要改**（已按 TTS
 * 真实音量调优）：
 *
 *   rms = sqrt(mean(sample²))
 *   rms < 400           → 不驱动（静音段不抖嘴）
 *   volume_ratio = min(1, rms / 15000)
 *   volume_factor = volume_ratio ** 1.3
 *   fft_mag = |rfft(frame)|
 *   vowel_energy = mean(fft_mag[10:88])   cons_energy = mean(fft_mag[88:])
 *   vowel_ratio = vowel_energy / (vowel_energy + cons_energy)
 *   target_open  = min(1, volume_factor * (0.1 + vowel_ratio * 1.5))
 *   target_smile = min(1, volume_factor * cons_ratio * 1.5)
 *   mouth += (target - mouth) * 0.45            ← 跨帧累积状态
 *
 * ── FFT 实现说明（工程取舍，务必读懂再改） ──
 *
 * 源项目用 `np.fft.rfft(frame_float)`，frame 长度 840（= 24000Hz × 35ms），
 * 输出 421 个频点。Node 无内置 FFT，且 840 = 2³×3×5×7 **不是 2 的幂**，
 * 无法直接套 radix-2。
 *
 * 三条路里选了第二条：
 *   1. 引入 `fft.js` 依赖        —— 能算任意长度，但为一个 10k 次运算的循环新增依赖不划算
 *   2. **补零到 1024 + 频率轴重映射**（本实现）—— 零依赖、O(N log N)、比值口径不变
 *   3. 直接 DFT（O(N²)=35 万次/帧）—— 每帧计算量太大，会挤占主进程事件循环
 *
 * 补零不会改变「元音/辅音能量比」这个**比值**口径（末尾只用到 vowel_ratio），
 * 但会改变 bin 的频率刻度。因此区间端点按频率重映射：
 *
 *   源 bin i  ↔  频率 i × 24000/840
 *   本实现 bin ↔  频率 × 1024/24000
 *   ⇒ bin_padded(i) = i × 1024/840
 *     vowel_start: 10 → 12      vowel_end: 88 → 107
 *
 * 这样 `vowel_energy` 覆盖的物理频段与源项目一致（≈286Hz ~ ≈2514Hz，正是人声
 * 第一/第二共振峰所在区间），而不是简单地把 10/88 当成 1024-FFT 的 bin。
 *
 * @module vts/VtsLipSync
 */

import {
  VTS_FRAME_MS,
  VTS_RMS_FLOOR,
  VTS_RMS_THRESHOLD,
  VTS_SAMPLE_RATE,
  VTS_SMOOTH_FACTOR,
  type VtsLipSyncMode,
} from './types'

// ============================================
// 帧参数
// ============================================

/**
 * 每帧采样数。
 *
 * 注意：`frame_ms` 是**节流值**而非精确帧长，实际按 `sampleRate × frameMs` 计算
 * （源项目同样写法）。24000 × 0.035 = 840。
 */
export const SAMPLES_PER_FRAME = Math.floor(VTS_SAMPLE_RATE * VTS_FRAME_MS)

/** 每帧字节数（s16le：2 字节/采样） */
export const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2

// ============================================
// FFT 基础设施（模块级预计算，进程内只算一次）
// ============================================

/** FFT 长度：840 补零到 1024 */
const FFT_SIZE = 1024
const FFT_HALF = FFT_SIZE >> 1
/** 有效采样数（超出部分补零） */
const FFT_INPUT = SAMPLES_PER_FRAME

/**
 * 源 840-FFT 的 bin 区间 → 本 1024-FFT 的 bin 区间。
 *
 * vowel_start=10、vowel_end=88（源），乘 1024/840 后取整 = 12 / 107。
 */
const VOWEL_START_BIN = Math.round((10 * FFT_SIZE) / FFT_INPUT) // 12
const VOWEL_END_BIN = Math.round((88 * FFT_SIZE) / FFT_INPUT) // 107

/** twiddle 因子表（cos/sin 各一半） */
const TWIDDLE_COS = new Float64Array(FFT_HALF)
const TWIDDLE_SIN = new Float64Array(FFT_HALF)

/** 位反转置换表 */
const BIT_REVERSE = new Uint16Array(FFT_SIZE)

let tablesReady = false

/** 预计算 twiddle 与位反转表（幂等） */
function ensureTables(): void {
  if (tablesReady) return

  for (let i = 0; i < FFT_HALF; i += 1) {
    const angle = (-2 * Math.PI * i) / FFT_SIZE
    TWIDDLE_COS[i] = Math.cos(angle)
    TWIDDLE_SIN[i] = Math.sin(angle)
  }

  // 位反转：位宽 = log2(1024) = 10
  const bits = 10
  for (let i = 0; i < FFT_SIZE; i += 1) {
    let reversed = 0
    for (let b = 0; b < bits; b += 1) {
      if (i & (1 << b)) reversed |= 1 << (bits - 1 - b)
    }
    BIT_REVERSE[i] = reversed
  }

  tablesReady = true
}

/**
 * 原地 radix-2 复数 FFT。
 *
 * @param re 实部（长度必须为 FFT_SIZE，非原地语义上会被改写）
 * @param im 虚部（同上）
 */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  // 1. 位反转置换
  for (let i = 0; i < FFT_SIZE; i += 1) {
    const j = BIT_REVERSE[i]
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  // 2. 蝶形运算（自底向上，len = 2, 4, 8, ... 1024）
  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const half = len >> 1
    const step = FFT_SIZE / len
    for (let base = 0; base < FFT_SIZE; base += len) {
      for (let j = 0; j < half; j += 1) {
        const tw = j * step
        const wr = TWIDDLE_COS[tw]
        const wi = TWIDDLE_SIN[tw]

        const a = base + j
        const b = a + half

        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr

        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

// ============================================
// 口型同步器
// ============================================

/** 单帧计算结果（供调试 / 状态展示） */
export interface LipSyncFrameResult {
  /** 平滑后应发送的 MouthOpen 值（0~1） */
  open: number
  /** 平滑后的 MouthSmile 值（0~1，当前不发往 VTS，保留备用） */
  smile: number
  /** 本帧 RMS（原始 s16 量纲） */
  rms: number
  /** 元音能量占比（rms 模式下恒为 0） */
  vowelRatio: number
}

/**
 * 口型同步器。
 *
 * 有状态：`mouthOpen` / `mouthSmile` 跨帧累积（源项目的 `self.mouth_value`）。
 * 因此 `reset()` 必须在「开始新一段音频」时调用，否则新音频会从上一段的
 * 残留口型开始收敛，表现为开头一瞬间的「黏嘴」。
 */
export class VtsLipSync {
  private mode: VtsLipSyncMode = 'fft'

  private mouthOpen = 0
  private mouthSmile = 0

  /** FFT 工作缓冲（复用以避免每帧 16KB 的分配） */
  private readonly re = new Float64Array(FFT_SIZE)
  private readonly im = new Float64Array(FFT_SIZE)

  constructor(mode: VtsLipSyncMode = 'fft') {
    this.mode = mode
    ensureTables()
  }

  /** 切换模式（'fft' 走频谱分离，'rms' 只用音量） */
  setMode(mode: VtsLipSyncMode): void {
    this.mode = mode
  }

  getMode(): VtsLipSyncMode {
    return this.mode
  }

  /** 复位平滑状态（新一段音频开始 / 用户中断时调用） */
  reset(): void {
    this.mouthOpen = 0
    this.mouthSmile = 0
  }

  /** 当前口型开合值（0~1） */
  getMouthOpen(): number {
    return this.mouthOpen
  }

  /** 当前口型微笑值（0~1） */
  getMouthSmile(): number {
    return this.mouthSmile
  }

  /**
   * 处理一帧 s16le PCM。
   *
   * @param frame 采样帧（长度建议 SAMPLES_PER_FRAME；短于 FFT_INPUT 时按实际长度计算，
   *              过短的帧（<100 采样）沿用源项目的丢弃语义，直接返回当前口型值）
   * @returns 本帧结果（`open` 即应发送的 MouthOpen）
   */
  process(frame: Int16Array): LipSyncFrameResult {
    // 源项目：len(frame) < 100 → continue（不驱动）
    if (frame.length < 100) {
      return { open: this.mouthOpen, smile: this.mouthSmile, rms: 0, vowelRatio: 0 }
    }

    // ---------- 1. RMS（用原始 s16 量纲，与源项目 np.float32 一致） ----------
    let sumSquares = 0
    for (let i = 0; i < frame.length; i += 1) {
      const v = frame[i]
      sumSquares += v * v
    }
    const rms = Math.sqrt(sumSquares / frame.length)

    let targetOpen = 0
    let targetSmile = 0
    let vowelRatio = 0

    if (rms >= VTS_RMS_FLOOR) {
      const volumeRatio = Math.min(1, rms / VTS_RMS_THRESHOLD)
      // 1.3 次幂：压缩中低音量、保留高音量冲击感（源项目调优值）
      const volumeFactor = Math.pow(volumeRatio, 1.3)

      if (this.mode === 'fft') {
        // ---------- 2. FFT：分离元音（低频集中）/ 辅音（高频分散） ----------
        const mags = this.computeMagnitude(frame)

        let vowelSum = 0
        for (let i = VOWEL_START_BIN; i < VOWEL_END_BIN; i += 1) vowelSum += mags[i]
        const vowelEnergy = vowelSum / (VOWEL_END_BIN - VOWEL_START_BIN)

        let consSum = 0
        const consEnd = Math.min(mags.length, FFT_HALF + 1)
        for (let i = VOWEL_END_BIN; i < consEnd; i += 1) consSum += mags[i]
        const consEnergy = consSum / Math.max(1, consEnd - VOWEL_END_BIN)

        const totalEnergy = vowelEnergy + consEnergy + 1e-6
        vowelRatio = vowelEnergy / totalEnergy
        const consRatio = consEnergy / totalEnergy

        targetOpen = Math.min(1, volumeFactor * (0.1 + vowelRatio * 1.5))
        targetSmile = Math.min(1, volumeFactor * consRatio * 1.5)
      } else {
        // rms 模式：不做频谱分离，直接按音量开合（效果略糙，省掉每帧 FFT）
        targetOpen = volumeFactor
      }
    }

    // ---------- 3. 平滑（指数逼近，避免逐帧跳变造成抖动） ----------
    this.mouthOpen += (targetOpen - this.mouthOpen) * VTS_SMOOTH_FACTOR
    this.mouthSmile += (targetSmile - this.mouthSmile) * VTS_SMOOTH_FACTOR

    return { open: this.mouthOpen, smile: this.mouthSmile, rms, vowelRatio }
  }

  /**
   * 直接按音量驱动（降级路径：音频无法转码时由渲染层推音量过来）。
   *
   * 走同一套平滑逻辑，保证两种数据源的手感一致。
   *
   * @param volume 归一化音量（0~1）
   */
  processVolume(volume: number): number {
    const clamped = Math.max(0, Math.min(1, volume))
    // 与 FFT 模式对齐：静音判定用同一地板值换算，避免两套阈值打架
    const targetOpen = clamped < VTS_RMS_FLOOR / VTS_RMS_THRESHOLD ? 0 : clamped
    this.mouthOpen += (targetOpen - this.mouthOpen) * VTS_SMOOTH_FACTOR
    this.mouthSmile += (0 - this.mouthSmile) * VTS_SMOOTH_FACTOR
    return this.mouthOpen
  }

  /** 计算幅度谱（840 点补零到 1024，返回 513 个幅度值，复用内部缓冲） */
  private computeMagnitude(frame: Int16Array): Float64Array {
    const re = this.re
    const im = this.im

    // 装载实部并补零（虚部必须清零，否则残留上一帧的虚部会污染结果）
    const n = Math.min(frame.length, FFT_INPUT)
    for (let i = 0; i < n; i += 1) re[i] = frame[i]
    re.fill(0, n)
    im.fill(0)

    fftInPlace(re, im)

    // 幅度谱：本帧复用一个 Float64Array，避免每帧分配 513 长度的新数组
    const mags = this.magnitudes
    for (let i = 0; i <= FFT_HALF; i += 1) {
      const r = re[i]
      const m = im[i]
      mags[i] = Math.sqrt(r * r + m * m)
    }
    return mags
  }

  /** 幅度谱缓冲（长度 FFT_HALF + 1 = 513） */
  private readonly magnitudes = new Float64Array(FFT_HALF + 1)
}
