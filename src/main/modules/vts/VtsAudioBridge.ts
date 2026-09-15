/**
 * VTS 音频桥（ffmpeg-static 转码 → PCM 分帧）
 *
 * 为什么必须转码：
 *   AweeClaw 的 TTS 是云端 API 返回的**有损压缩音频**（mp3 / opus / aac / …），
 *   而 VTS 的口型算法建立在**原始采样**上（RMS 依赖绝对幅值、FFT 依赖频谱）。
 *   直接拿压缩字节喂算法没有任何物理意义 —— 必须先解成 24kHz/16bit/mono PCM。
 *
 * 转码链路（对齐源项目语义）：
 *   音频字节(任意格式)
 *     → ffmpeg -f <hint> -i pipe:0 -f s16le -acodec pcm_s16le -ar 24000 -ac 1 pipe:1
 *     → 24kHz / 16bit / 单声道 PCM
 *     → 按 840 采样（35ms @24kHz）切帧 → Int16Array[]
 *
 * 与源项目的差异：源项目是「文件落盘 → ffmpeg -i 文件」，这里直接走 stdin/stdout
 * 管道，省掉一次磁盘落盘 + 一次读取。ffmpeg 从管道同样能探测格式，且我们额外
 * 把 mimeType 映射成 `-f` 提示来提升探测准确率（管道输入没有扩展名可依据）。
 *
 * @module vts/VtsAudioBridge
 */

import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import { logger } from '@shared/toolkit/LogEngine'
import { BYTES_PER_FRAME, SAMPLES_PER_FRAME } from './VtsLipSync'
import { VTS_SAMPLE_RATE } from './types'

/** ffmpeg 二进制路径（由 ffmpeg-static 提供，静态编译无外部依赖） */
const FFMPEG_PATH = ffmpegStatic

/** 转码超时（ms）：一段 TTS 通常 < 10s，30s 已是极宽松的上限 */
const TRANSCODE_TIMEOUT_MS = 30_000

/**
 * mimeType → ffmpeg 输入格式名。
 *
 * 只在能可靠映射时才传 `-f`：猜错格式比不传更糟（ffmpeg 会按错误解复用器解析
 * 而报出莫名的错），所以映射表刻意保持保守。
 */
const MIME_TO_FORMAT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
  'audio/mp4': 'mp4',
  'audio/m4a': 'mp4',
  'audio/x-m4a': 'mp4',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
}

/** 转码结果 */
export interface TranscodeResult {
  /** 24kHz / 16bit / mono PCM 原始字节 */
  pcm: Buffer
  /** 采样总数 */
  sampleCount: number
  /** 音频时长（ms，按采样数换算） */
  durationMs: number
}

/**
 * 把任意格式音频字节转成 24kHz/16bit/mono PCM。
 *
 * @param audio 原始音频字节
 * @param mimeType 可选 MIME（用于给 ffmpeg 输入格式提示）
 * @returns PCM 与统计信息
 * @throws ffmpeg 不可用 / 转码失败 / 超时
 */
export async function transcodeToPcm(audio: Buffer, mimeType?: string): Promise<TranscodeResult> {
  if (!audio.length) {
    return { pcm: Buffer.alloc(0), sampleCount: 0, durationMs: 0 }
  }
  if (!FFMPEG_PATH) {
    throw new Error('ffmpeg binary not found. Please ensure ffmpeg-static is installed.')
  }

  const hint = mimeType ? MIME_TO_FORMAT[mimeType.toLowerCase().split(';')[0].trim()] : undefined

  try {
    const pcm = await runFfmpeg(audio, hint)
    const sampleCount = Math.floor(pcm.length / 2)
    return {
      pcm,
      sampleCount,
      durationMs: Math.round((sampleCount / VTS_SAMPLE_RATE) * 1000),
    }
  } catch (err) {
    // 带格式提示失败 → 去掉提示重试一次。
    // 常见于后端把 mp3 标成 audio/octet-stream，或 mimeType 与实际内容不符。
    if (hint) {
      logger.system.warn(`[VTS] 带格式提示（-f ${hint}）转码失败，回退自动探测：`, err)
      const pcm = await runFfmpeg(audio, undefined)
      const sampleCount = Math.floor(pcm.length / 2)
      return {
        pcm,
        sampleCount,
        durationMs: Math.round((sampleCount / VTS_SAMPLE_RATE) * 1000),
      }
    }
    throw err
  }
}

/**
 * 执行一次 ffmpeg 转码（音频走 stdin，PCM 走 stdout）。
 *
 * @param audio 输入音频字节
 * @param inputFormat 可选输入格式提示（对应 `-f`，必须在 `-i` 之前）
 */
function runFfmpeg(audio: Buffer, inputFormat?: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      // 管道输入不可 seek，部分解复用器需要额外的探测缓冲，给足 5MB
      '-probesize',
      '5M',
      '-analyzeduration',
      '5M',
    ]
    if (inputFormat) args.push('-f', inputFormat)
    args.push(
      '-i',
      'pipe:0',
      '-vn',
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      '-ar',
      String(VTS_SAMPLE_RATE),
      '-ac',
      '1',
      'pipe:1',
    )

    const proc = spawn(FFMPEG_PATH as string, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    const chunks: Buffer[] = []
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      reject(new Error(`ffmpeg 转码超时（${TRANSCODE_TIMEOUT_MS}ms）`))
    }, TRANSCODE_TIMEOUT_MS)

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      // stderr 只保留尾部：排障够用，又不会因为长错误刷爆内存
      stderr = (stderr + chunk.toString()).slice(-2000)
    })

    proc.on('error', (err: Error) => {
      finish(() => reject(new Error(`无法启动 ffmpeg：${err.message}`)))
    })

    proc.on('close', (code: number | null) => {
      finish(() => {
        if (code === 0) {
          resolve(Buffer.concat(chunks))
          return
        }
        reject(new Error(`ffmpeg 转码失败（退出码 ${code}）：${stderr.trim() || '无错误输出'}`))
      })
    })

    // 写入音频数据；EPIPE 说明 ffmpeg 已经退出（多半是格式不认），交由 close 分支处理
    proc.stdin.on('error', () => {
      /* 忽略：close 分支会给出可读错误 */
    })
    proc.stdin.end(audio)
  })
}

/**
 * 把 24kHz/16bit/mono PCM 切成口型帧。
 *
 * 两条边界处理沿用源项目语义：
 *   1. 总字节数为奇数 → 丢弃最后 1 字节（s16 必须 2 字节对齐）
 *   2. 末尾不足一帧的残帧**保留**（源项目只丢弃 < 100 采样的极短帧，
 *      由 VtsLipSync 内部按同一阈值过滤）
 *
 * @param pcm 24kHz/16bit/mono PCM 字节
 * @returns 每帧一个 Int16Array，长度 ≈ SAMPLES_PER_FRAME
 */
export function splitPcmIntoFrames(pcm: Buffer): Int16Array[] {
  let usable = pcm
  if (usable.length % 2 !== 0) {
    // 源项目：单数个字节时丢弃最后 1 个
    usable = usable.subarray(0, usable.length - 1)
  }
  if (!usable.length) return []

  const frames: Int16Array[] = []
  for (let offset = 0; offset < usable.length; offset += BYTES_PER_FRAME) {
    const end = Math.min(offset + BYTES_PER_FRAME, usable.length)
    const frame = new Int16Array((end - offset) >> 1)
    for (let i = 0; i < frame.length; i += 1) {
      // 用 readInt16LE 而非 Int16Array(buffer) 视图：后者要求 byteOffset 2 字节对齐，
      // 而 Buffer.subarray 产生的视图 offset 是不确定的，会踩平台字节序坑。
      frame[i] = usable.readInt16LE(offset + i * 2)
    }
    frames.push(frame)
  }
  return frames
}

/** 对外暴露当前帧参数，便于 UI 展示与自测（840 采样 / 1680 字节） */
export const VTS_FRAME_INFO = {
  samplesPerFrame: SAMPLES_PER_FRAME,
  bytesPerFrame: BYTES_PER_FRAME,
  sampleRate: VTS_SAMPLE_RATE,
} as const
