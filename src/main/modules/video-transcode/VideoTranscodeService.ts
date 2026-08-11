/**
 * 视频转码服务
 *
 * 使用 ffmpeg-static 静态二进制对视频进行探测和转码，
 * 解决 Chromium 媒体引擎不支持部分视频编码（如 H.265/HEVC）的问题。
 *
 * 核心能力：
 *   1. probe — 用 ffprobe 获取视频编码、分辨率、时长等信息
 *   2. isChromiumSupported — 判断编码是否被 Chromium 原生支持
 *   3. transcode — 将视频转码为 H.264 + AAC 的 MP4，支持进度回调
 *
 * 转码缓存策略：
 *   - 转码后的文件存放在 os.tmpdir()/aweeclaw-video-cache/
 *   - 文件名：{原文件名SHA1}.mp4
 *   - 如果缓存已存在且源文件未修改（mtime 对比），直接复用
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync, mkdirSync, renameSync, unlinkSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import ffmpegStatic from 'ffmpeg-static'

/**
 * ffmpeg 二进制路径（由 ffmpeg-static 包提供，静态编译的跨平台二进制）
 *
 * 类型为 string | null：null 表示当前平台无预编译二进制（极少见）。
 * 在 ensureFfmpeg() 中校验非空，使用处可安全断言为 string。
 */
const FFMPEG_PATH = ffmpegStatic

/** 转码缓存目录 */
const CACHE_DIR = join(tmpdir(), 'aweeclaw-video-cache')

/** Chromium 原生支持的视频编码（codecs） */
const CHROMIUM_SUPPORTED_VIDEO_CODECS = new Set([
  'h264',      // H.264 / AVC（最通用）
  'vp8',       // VP8
  'vp9',       // VP9
  'av1',       // AV1
  'theora',    // Ogg Theora
])

/** 视频探测结果 */
export interface VideoProbeResult {
  /** 视频流编码（小写，如 'h264', 'hevc', 'vp9'） */
  videoCodec: string | null
  /** 音频流编码（小写，如 'aac', 'mp3'） */
  audioCodec: string | null
  /** 视频宽度 */
  width: number | null
  /** 视频高度 */
  height: number | null
  /** 视频时长（秒） */
  duration: number | null
  /** 文件大小（字节） */
  fileSize: number | null
  /** 帧率 */
  fps: number | null
  /** 比特率 */
  bitrate: number | null
  /** 容器格式（如 'mov,mp4,m4a,3gp,3g2,mj2'） */
  format: string | null
}

/** 转码进度回调参数 */
export interface TranscodeProgress {
  /** 已转码时间（秒） */
  currentTime: number
  /** 总时长（秒） */
  duration: number
  /** 进度百分比（0-100） */
  percent: number
  /** 转码速度（如 '2.5x'） */
  speed: string | null
}

/** 转码结果 */
export interface TranscodeResult {
  /** 转码后文件路径 */
  outputPath: string
  /** 是否命中缓存（true 表示未实际转码，直接复用缓存） */
  fromCache: boolean
  /** 转码耗时（毫秒） */
  elapsedMs: number
}

/**
 * 确保 ffmpeg 二进制可用
 * @returns ffmpeg 二进制绝对路径
 */
function ensureFfmpeg(): string {
  if (!FFMPEG_PATH || !existsSync(FFMPEG_PATH)) {
    throw new Error('ffmpeg binary not found. Please ensure ffmpeg-static is installed.')
  }
  return FFMPEG_PATH
}

/**
 * 确保缓存目录存在
 */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

/**
 * 用 ffprobe 探测视频信息
 *
 * 使用 ffmpeg -i 输出 JSON 格式的流信息，解析后提取编码、分辨率等。
 * 不使用独立的 ffprobe 二进制（ffmpeg-static 不包含），改用 ffmpeg -i 实现。
 *
 * @param filePath 视频文件绝对路径
 * @returns 探测结果
 */
export function probeVideo(filePath: string): Promise<VideoProbeResult> {
  const ffmpegPath = ensureFfmpeg()

  return new Promise((resolve, reject) => {
    // 用 ffmpeg -i 获取文件信息（输出到 stderr）
    // 使用 -hide_banner -show_format -show_streams 格式（ffprobe 风格）
    // ffmpeg-static 不含 ffprobe，所以用 ffmpeg -i 解析 stderr
    const args = ['-i', filePath, '-hide_banner']

    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let stderrOutput = ''

    proc.stderr.on('data', (data: Buffer) => {
      stderrOutput += data.toString()
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`))
    })

    proc.on('close', () => {
      // ffmpeg -i 不带输出文件会返回非 0 退出码，但 stderr 中已包含信息
      try {
        const result = parseFfmpegOutput(stderrOutput, filePath)
        resolve(result)
      } catch (e) {
        reject(new Error(`Failed to parse ffmpeg output: ${(e as Error).message}`))
      }
    })
  })
}

/**
 * 解析 ffmpeg -i 的 stderr 输出
 *
 * 示例输出片段：
 *   Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'test.mp4':
 *     Duration: 00:00:05.00, start: 0.000000, bitrate: 1234 kb/s
 *     Stream #0:0(und): Video: hevc (Main), 1280x720, 30 fps, 1234 kb/s
 *     Stream #0:1(und): Audio: aac (LC), 44100 Hz, stereo, fltp, 128 kb/s
 */
function parseFfmpegOutput(stderr: string, filePath: string): VideoProbeResult {
  const result: VideoProbeResult = {
    videoCodec: null,
    audioCodec: null,
    width: null,
    height: null,
    duration: null,
    fileSize: null,
    fps: null,
    bitrate: null,
    format: null,
  }

  // 解析容器格式：Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'test.mp4':
  const formatMatch = stderr.match(/Input #0,\s*([^,]+)/)
  if (formatMatch) {
    result.format = formatMatch[1].trim()
  }

  // 解析时长和比特率：Duration: 00:00:05.00, start: 0.000000, bitrate: 1234 kb/s
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
  if (durationMatch) {
    const h = parseInt(durationMatch[1], 10)
    const m = parseInt(durationMatch[2], 10)
    const s = parseFloat(durationMatch[3])
    result.duration = h * 3600 + m * 60 + s
  }

  const bitrateMatch = stderr.match(/bitrate:\s*(\d+)\s*kb\/s/)
  if (bitrateMatch) {
    result.bitrate = parseInt(bitrateMatch[1], 10) * 1000
  }

  // 解析视频流：Stream #0:0(und): Video: hevc (Main), 1280x720, 30 fps, ...
  // 注意编码后面可能有标签如 (Main), (High), yuv420p 等
  const videoStreamMatch = stderr.match(/Stream #\d+:\d+.*?:\s*Video:\s*(\w+)/)
  if (videoStreamMatch) {
    result.videoCodec = videoStreamMatch[1].toLowerCase()
  }

  // 解析分辨率：1280x720
  const resolutionMatch = stderr.match(/Video:.*?,\s*(\d+)x(\d+)/)
  if (resolutionMatch) {
    result.width = parseInt(resolutionMatch[1], 10)
    result.height = parseInt(resolutionMatch[2], 10)
  }

  // 解析帧率：30 fps 或 29.97 fps
  const fpsMatch = stderr.match(/(\d+\.?\d*)\s*fps/)
  if (fpsMatch) {
    result.fps = parseFloat(fpsMatch[1])
  }

  // 解析音频流：Stream #0:1(und): Audio: aac (LC), 44100 Hz, ...
  const audioStreamMatch = stderr.match(/Stream #\d+:\d+.*?:\s*Audio:\s*(\w+)/)
  if (audioStreamMatch) {
    result.audioCodec = audioStreamMatch[1].toLowerCase()
  }

  // 获取文件大小
  try {
    const stats = statSync(filePath)
    result.fileSize = stats.size
  } catch {
    // ignore
  }

  return result
}

/**
 * 判断视频编码是否被 Chromium 原生支持
 *
 * Chromium 原生支持的视频编码：H.264, VP8, VP9, AV1, Theora
 * 常见不支持：H.265/HEVC, H.263, WMV, MPEG-1/2, DivX 等
 *
 * @param probe 探测结果
 * @returns { supported: boolean, reason: string }
 */
export function isChromiumSupported(probe: VideoProbeResult): {
  supported: boolean
  reason: string
} {
  if (!probe.videoCodec) {
    return { supported: false, reason: '未检测到视频流' }
  }

  if (!CHROMIUM_SUPPORTED_VIDEO_CODECS.has(probe.videoCodec)) {
    return {
      supported: false,
      reason: `视频编码 ${probe.videoCodec.toUpperCase()} 不被 Chromium 原生支持`,
    }
  }

  // H.264 还需要检查像素格式（Chromium 不支持某些 YUV 格式）
  // 但通常 H.264 都是 yuv420p，问题不大

  return { supported: true, reason: '' }
}

/**
 * 生成转码缓存文件路径
 *
 * 缓存策略：基于源文件路径 + mtime 生成 SHA1，作为缓存文件名。
 * 如果源文件被修改（重新生成），mtime 变化 → SHA1 变化 → 不命中缓存。
 */
function getCachePath(sourcePath: string): string {
  let mtime = 0
  try {
    mtime = statSync(sourcePath).mtimeMs
  } catch {
    // ignore
  }

  const key = `${sourcePath}|${mtime}`
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
  return join(CACHE_DIR, `${hash}.mp4`)
}

/**
 * 将视频转码为 H.264 + AAC 的 MP4（Chromium 通用支持格式）
 *
 * 转码参数：
 *   - 视频编码：libx264（H.264），preset fast，CRF 23（质量与体积平衡）
 *   - 音频编码：aac，128kbps
 *   - 像素格式：yuv420p（最大兼容性）
 *   - movflags：+faststart（支持流式播放）
 *
 * @param sourcePath 源视频文件路径
 * @param onProgress 进度回调（可选）
 * @param signal 中断信号（可选）
 * @returns 转码结果
 */
export function transcodeToH264(
  sourcePath: string,
  onProgress?: (progress: TranscodeProgress) => void,
  signal?: { aborted: boolean },
): Promise<TranscodeResult> {
  const ffmpegPath = ensureFfmpeg()
  ensureCacheDir()

  const startTs = Date.now()
  const cachePath = getCachePath(sourcePath)

  // 检查缓存
  if (existsSync(cachePath)) {
    return Promise.resolve({
      outputPath: cachePath,
      fromCache: true,
      elapsedMs: Date.now() - startTs,
    })
  }

  // 先 probe 获取总时长（用于进度计算）
  return probeVideo(sourcePath).then((probe) => {
    const duration = probe.duration || 0

    return new Promise<TranscodeResult>((resolve, reject) => {
      // 临时文件必须以 .mp4 结尾，否则 ffmpeg 无法通过扩展名推断输出格式
      // （"Unable to find a suitable output format for 'xxx.tmp'"）
      const tmpPath = `${cachePath}.tmp.${process.pid}.mp4`

      const args = [
        '-i', sourcePath,
        // 视频编码：H.264
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        // 音频编码：AAC
        '-c:a', 'aac',
        '-b:a', '128k',
        // 兼容性
        '-movflags', '+faststart',
        // 显式指定输出格式（双重保险，避免依赖扩展名推断）
        '-f', 'mp4',
        // 覆盖输出
        '-y',
        tmpPath,
      ]

      const proc = spawn(ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stderrOutput = ''

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        stderrOutput += text

        // 解析进度：frame=  150 fps= 25 q=24.0 size=     256kB time=00:00:05.00 bitrate=...
        if (onProgress && duration > 0) {
          const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.?\d*)/)
          if (timeMatch) {
            const h = parseInt(timeMatch[1], 10)
            const m = parseInt(timeMatch[2], 10)
            const s = parseFloat(timeMatch[3])
            const currentTime = h * 3600 + m * 60 + s
            const percent = Math.min(100, (currentTime / duration) * 100)

            const speedMatch = text.match(/speed=\s*(\d+\.?\d*x)/)
            const speed = speedMatch ? speedMatch[1] : null

            onProgress({ currentTime, duration, percent, speed })
          }
        }

        // 检查中断
        if (signal?.aborted) {
          proc.kill('SIGKILL')
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn ffmpeg: ${err.message}`))
      })

      proc.on('close', (code) => {
        if (signal?.aborted) {
          // 清理临时文件
          try { unlinkSync(tmpPath) } catch { /* ignore */ }
          reject(new Error('转码已取消'))
          return
        }

        if (code !== 0) {
          // 清理临时文件
          try { unlinkSync(tmpPath) } catch { /* ignore */ }
          reject(new Error(`ffmpeg 转码失败（退出码 ${code}）: ${stderrOutput.slice(-500)}`))
          return
        }

        // 原子重命名（tmpPath 和 cachePath 在同一目录，renameSync 是原子操作）
        try {
          renameSync(tmpPath, cachePath)
        } catch (e) {
          // 重命名失败时尝试 copy + unlink（跨设备场景兜底）
          try {
            copyFileSync(tmpPath, cachePath)
            unlinkSync(tmpPath)
          } catch (e2) {
            reject(new Error(`缓存文件重命名失败: ${(e as Error).message}; copy fallback: ${(e2 as Error).message}`))
            return
          }
        }

        resolve({
          outputPath: cachePath,
          fromCache: false,
          elapsedMs: Date.now() - startTs,
        })
      })
    })
  })
}

/**
 * 清理过期的转码缓存
 * @param maxAgeMs 最大保留时间（毫秒），默认 7 天
 */
export function cleanTranscodeCache(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
  if (!existsSync(CACHE_DIR)) return

  try {
    const { readdirSync, unlinkSync } = require('node:fs')
    const files = readdirSync(CACHE_DIR)
    const now = Date.now()

    for (const file of files) {
      const filePath = join(CACHE_DIR, file)
      try {
        const stats = statSync(filePath)
        if (now - stats.mtimeMs > maxAgeMs) {
          unlinkSync(filePath)
        }
      } catch {
        // 单文件清理失败不影响整体
      }
    }
  } catch {
    // 清理失败不影响主流程
  }
}

export { CACHE_DIR }
