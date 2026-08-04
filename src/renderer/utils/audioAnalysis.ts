/**
 * 音频分析工具
 *
 * 提供 VAD（语音活动检测）所需的特征计算：
 * - RMS（响度均方根）：判断是否有人声
 * - 频谱质心 / 过零率 / 低频能量比：区分人声与环境音
 *
 * 设计原则：
 * - 纯函数，无副作用，便于单元测试
 * - 输入为 AnalyserNode 的时域/频域数据，避免重复采集
 * - 阈值常量集中在文件头，便于调参
 */

// ============================================
// 阈值常量（基于实验调参）
// ============================================

/** 静音 RMS 阈值，低于此值视为静音 */
export const RMS_SILENCE = 0.008
/** 说话触发 RMS 阈值（高于此值视为有语音活动） */
export const RMS_SPEECH = 0.012
/** 强响度（高置信度语音）阈值 */
export const RMS_STRONG = 0.025

/** 人声频谱质心范围（Hz，典型人声 300-3000Hz） */
export const CENTROID_HUMAN_MIN = 200
export const CENTROID_HUMAN_MAX = 4000

/** 过零率阈值（环境音通常较高，如键盘敲击 > 0.1） */
export const ZCR_ENVIRONMENT = 0.085

/** 低频能量占比阈值（人声低频较丰富，> 0.25 视为人声特征） */
export const LOW_FREQ_RATIO_THRESHOLD = 0.25

/** 人声概率综合阈值（>= 此值判定为人声） */
export const VOICE_LIKELIHOOD_THRESHOLD = 0.5

// ============================================
// 时域特征
// ============================================

/**
 * 计算 RMS（响度均方根）
 *
 * @param timeData AnalyserNode.getByteTimeDomainData() 的结果（0-255）
 * @returns 0-1 的 RMS 值
 */
export function computeRMS(timeData: Uint8Array<ArrayBuffer>): number {
  let sumSquares = 0
  for (let i = 0; i < timeData.length; i++) {
    const v = (timeData[i] - 128) / 128 // 归一化到 -1 ~ 1
    sumSquares += v * v
  }
  return Math.sqrt(sumSquares / timeData.length)
}

/**
 * 计算过零率（Zero-Crossing Rate）
 *
 * 信号穿过零点的频率，环境音（如键盘敲击、玻璃破碎）通常 ZCR 较高；
 * 元音（人声主要成分）ZCR 较低。
 *
 * @param timeData AnalyserNode.getByteTimeDomainData() 的结果
 * @returns 0-1 的过零率
 */
export function computeZCR(timeData: Uint8Array<ArrayBuffer>): number {
  if (timeData.length < 2) return 0
  let crossings = 0
  let prev = (timeData[0] - 128) / 128
  for (let i = 1; i < timeData.length; i++) {
    const curr = (timeData[i] - 128) / 128
    if ((prev >= 0 && curr < 0) || (prev < 0 && curr >= 0)) {
      crossings++
    }
    prev = curr
  }
  return crossings / (timeData.length - 1)
}

// ============================================
// 频域特征
// ============================================

/**
 * 计算频谱质心（Spectral Centroid）
 *
 * 频谱的「重心」，描述音色的明暗。
 * 人声通常在 300-3000Hz，环境音可能更分散或更高。
 *
 * @param freqData AnalyserNode.getByteFrequencyData() 的结果（0-255）
 * @param sampleRate 采样率
 * @param fftSize FFT 大小
 * @returns 频率（Hz）
 */
export function computeSpectralCentroid(
  freqData: Uint8Array<ArrayBuffer>,
  sampleRate: number,
  fftSize: number,
): number {
  let weightedSum = 0
  let magnitudeSum = 0
  const binCount = freqData.length
  // 每个 bin 的频率间隔 = sampleRate / fftSize
  const binHz = sampleRate / fftSize

  for (let i = 0; i < binCount; i++) {
    const magnitude = freqData[i] / 255
    weightedSum += i * binHz * magnitude
    magnitudeSum += magnitude
  }
  return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0
}

/**
 * 计算低频能量占比（0-250Hz 能量 / 总能量）
 *
 * 人声低频较丰富（男性嗓音基频 85-180Hz，女性 165-255Hz）。
 *
 * @param freqData AnalyserNode.getByteFrequencyData() 的结果
 * @param sampleRate 采样率
 * @param fftSize FFT 大小
 * @returns 0-1 的低频能量占比
 */
export function computeLowFrequencyRatio(
  freqData: Uint8Array<ArrayBuffer>,
  sampleRate: number,
  fftSize: number,
): number {
  const binHz = sampleRate / fftSize
  const lowBinEnd = Math.max(1, Math.floor(250 / binHz))
  let lowEnergy = 0
  let totalEnergy = 0
  for (let i = 0; i < freqData.length; i++) {
    const mag = (freqData[i] / 255) ** 2
    if (i < lowBinEnd) lowEnergy += mag
    totalEnergy += mag
  }
  return totalEnergy > 0 ? lowEnergy / totalEnergy : 0
}

/**
 * 计算频谱平坦度（Spectral Flatness）
 *
 * 接近 1 表示白噪声（环境音），接近 0 表示有调性（人声/乐音）。
 *
 * @param freqData AnalyserNode.getByteFrequencyData() 的结果
 * @returns 0-1 的平坦度
 */
export function computeSpectralFlatness(freqData: Uint8Array<ArrayBuffer>): number {
  let logSum = 0
  let linearSum = 0
  let nonZeroCount = 0
  for (let i = 0; i < freqData.length; i++) {
    const mag = freqData[i] / 255
    if (mag > 0.001) {
      logSum += Math.log(mag)
      linearSum += mag
      nonZeroCount++
    }
  }
  if (nonZeroCount === 0) return 0
  const geometricMean = Math.exp(logSum / nonZeroCount)
  const arithmeticMean = linearSum / nonZeroCount
  return arithmeticMean > 0 ? geometricMean / arithmeticMean : 0
}

// ============================================
// 综合判定
// ============================================

export interface AudioFeatures {
  /** RMS 响度 0-1 */
  rms: number
  /** 过零率 0-1 */
  zcr: number
  /** 频谱质心（Hz） */
  centroid: number
  /** 低频能量占比 0-1 */
  lowFreqRatio: number
  /** 频谱平坦度 0-1 */
  flatness: number
}

export interface VoiceDetectionResult {
  /** 综合人声概率 0-1 */
  voiceLikelihood: number
  /** 是否判定为环境音 */
  isEnvironment: boolean
  /** 是否为静音 */
  isSilent: boolean
  /** 特征数据 */
  features: AudioFeatures
}

/**
 * 综合计算音频特征
 */
export function extractFeatures(
  timeData: Uint8Array<ArrayBuffer>,
  freqData: Uint8Array<ArrayBuffer>,
  sampleRate: number,
  fftSize: number,
): AudioFeatures {
  return {
    rms: computeRMS(timeData),
    zcr: computeZCR(timeData),
    centroid: computeSpectralCentroid(freqData, sampleRate, fftSize),
    lowFreqRatio: computeLowFrequencyRatio(freqData, sampleRate, fftSize),
    flatness: computeSpectralFlatness(freqData),
  }
}

/**
 * 基于多维特征判定人声概率与环境音
 *
 * 判定规则：
 * 1. RMS < RMS_SILENCE → 静音
 * 2. 明确环境音：高 ZCR + 高平坦度（键盘/敲击/白噪），或极高平坦度 + 极低概率
 * 3. 其余有声音帧：计算人声概率，但不单独判定为环境音
 *    （是否为环境音段由 useVadSegmenter 基于段内环境音帧占比综合判定）
 *
 * 设计原则：
 * - isEnvironment 判定保守：只在明确噪声特征时为 true，避免误判人声
 * - voiceLikelihood 仅作为段级判定的参考，单帧不直接跳过 STT
 *
 * 返回综合概率 [0, 1]。
 */
export function detectVoice(features: AudioFeatures): VoiceDetectionResult {
  const { rms, zcr, centroid, lowFreqRatio, flatness } = features

  // 静音判定
  if (rms < RMS_SILENCE) {
    return {
      voiceLikelihood: 0,
      isEnvironment: false,
      isSilent: true,
      features,
    }
  }

  // 计算人声概率（多个特征的加权融合）
  let score = 0
  let weight = 0

  // RMS：响度越高越可能是人声
  if (rms >= RMS_STRONG) {
    score += 0.3
    weight += 0.3
  } else if (rms >= RMS_SPEECH) {
    score += 0.15
    weight += 0.2
  } else {
    score += 0.05
    weight += 0.1
  }

  // 频谱质心：在人声范围内加分
  if (centroid >= CENTROID_HUMAN_MIN && centroid <= CENTROID_HUMAN_MAX) {
    score += 0.3
    weight += 0.3
  } else if (centroid > CENTROID_HUMAN_MAX && centroid < 8000) {
    // 偏高频但仍可能是女声/童声
    score += 0.15
    weight += 0.2
  } else {
    weight += 0.2
  }

  // 低频能量比：丰富低频为人声特征
  if (lowFreqRatio >= LOW_FREQ_RATIO_THRESHOLD) {
    score += 0.25
    weight += 0.25
  } else {
    weight += 0.15
  }

  // 平坦度：越低越有调性（人声）
  if (flatness < 0.1) {
    score += 0.2
    weight += 0.2
  } else if (flatness < 0.25) {
    score += 0.1
    weight += 0.15
  } else {
    weight += 0.1
  }

  // 归一化为 0-1 概率
  const likelihood = weight > 0 ? Math.min(1, score / weight) : 0

  // 环境音判定（保守策略）：
  // 只在明确噪声特征时标记为环境音，避免误判人声
  // 1. 高 ZCR + 高平坦度：白噪/键盘/敲击等瞬态噪声
  // 2. 极高平坦度（> 0.45）+ 极低人声概率（< 0.3）：持续白噪声/风扇声
  // 不再用 likelihood < 0.5 的激进判定（会把正常说话的低置信帧误判为环境音）
  const isEnvironment =
    (zcr > ZCR_ENVIRONMENT && flatness > 0.3) || (flatness > 0.45 && likelihood < 0.3)

  return {
    voiceLikelihood: likelihood,
    isEnvironment,
    isSilent: false,
    features,
  }
}
