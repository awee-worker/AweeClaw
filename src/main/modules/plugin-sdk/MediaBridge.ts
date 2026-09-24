/**
 * 媒体处理桥（MediaBridge）
 *
 * 把客户端随包分发的 ffmpeg-static 二进制收敛成一个受控出口，供插件做
 * 视频/音频的探测、转码、裁剪、拼接、字幕、抽帧与 GIF。
 *
 * 为什么需要这一层：
 * 主进程里已经有三处 ffmpeg 实现 —— 视频预览转码、有声书音频拼接、VTS 语音
 * 转码 —— 但它们各自绑定了业务语义（预览缓存目录、章节结构、固定 PCM 格式），
 * 没有对外出口。插件想处理视频只剩两条绕路：自己 spawn ffmpeg（要求用户机器上
 * 恰好装了 ffmpeg，跨平台不可靠），或借 Python 运行时去调 ffmpeg（多绕一层，
 * 依赖依旧）。两条路的共同问题是：客户端明明已经分发过 ffmpeg，插件却用不上。
 *
 * 因此本桥定位为「通用出口层」：内部按需复用已有实现（probe 直接复用
 * VideoTranscodeService.probeVideo），对外提供不含业务假设的媒体操作。
 *
 * 安全约束（对插件是硬性的）：
 * - 不注入命令：spawn(ffmpegPath, argv)，绝不使用 shell，路径作为独立 argv 元素
 * - 不透传 filter：只接受结构化选项，filter 串在内部按固定模板拼装。ffmpeg 的
 *   movie= / drawtext= 等 filter 能读写文件，一旦允许透传，路径白名单就形同虚设
 * - 限定路径：输入输出必须落在工作区、插件数据目录或 aweeclaw- 前缀的临时目录内，
 *   realpath 后比对前缀（防软链接逃逸）
 * - 并发闸门 + 超时强杀：编码任务吃满 CPU，默认同时只跑 2 个
 *
 * @module plugin-sdk/MediaBridge
 */

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  statSync,
  realpathSync,
  unlinkSync,
  rmSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { logger } from '@shared/toolkit/LogEngine'
import { probeVideo } from '../video-transcode/VideoTranscodeService'

// ─── 常量 ──────────────────────────────────────────────────

/** ffmpeg 二进制路径（ffmpeg-static 提供；null 表示当前平台无预编译二进制） */
const FFMPEG_PATH: string | null = ffmpegStatic

/** 默认执行超时：5 分钟 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
/** 超时上限：30 分钟 */
const MAX_TIMEOUT_MS = 30 * 60 * 1000
/** 并发上限：编码任务吃满 CPU，默认同时只跑 2 个 */
const MAX_CONCURRENCY = 2
/** 强杀前的优雅退出等待 */
const SIGKILL_GRACE_MS = 3000
/** 错误详情保留的 stderr 尾部字符数 */
const STDERR_TAIL_CHARS = 2000
/** 临时目录名前缀（允许清单据此放行临时文件） */
const TEMP_DIR_PREFIX = 'aweeclaw-'
/** 默认产物目录（工作区下） */
const DEFAULT_OUTPUT_SUBDIR = '.aweeclaw/media-out'
/** 多帧抽取上限 */
const MAX_THUMBNAIL_FRAMES = 20
/** GIF 时长上限（毫秒） */
const MAX_GIF_DURATION_MS = 15000
/** GIF 帧率上限 */
const MAX_GIF_FPS = 24
/** 质量档位上限（x264/x265 的合法范围是 0~51） */
const MAX_CRF = 51
/** 混音轨数量上限（amix 会按轨数线性吃掉内存，且四条以上已无实际编排意义） */
const MAX_MIX_TRACKS = 4

/** 视频编码名 → ffmpeg 编码器 */
const VIDEO_ENCODER: Record<string, string> = {
  h264: 'libx264',
  hevc: 'libx265',
  vp9: 'libvpx-vp9',
}

/** 音频编码名 → ffmpeg 编码器 */
const AUDIO_ENCODER: Record<string, string> = {
  aac: 'aac',
  mp3: 'libmp3lame',
}

/** 音频抽取格式 → 编码器 / 容器 / 扩展名 */
const AUDIO_EXTRACT_PROFILE: Record<
  'mp3' | 'aac' | 'wav' | 'pcm',
  { codec: string; container: string; ext: string; forceMono?: boolean; forceRate?: number }
> = {
  mp3: { codec: 'libmp3lame', container: 'mp3', ext: 'mp3' },
  aac: { codec: 'aac', container: 'mp4', ext: 'm4a' },
  wav: { codec: 'pcm_s16le', container: 'wav', ext: 'wav' },
  // 与 VTS 语音链路一致：24kHz / 16bit / 单声道
  pcm: { codec: 'pcm_s16le', container: 's16le', ext: 'pcm', forceMono: true, forceRate: 24000 },
}

/** 抽帧格式 → 扩展名 */
const IMAGE_EXT: Record<'jpg' | 'png' | 'webp', string> = {
  jpg: 'jpg',
  png: 'png',
  webp: 'webp',
}

/** 容器别名：扩展名或 ffmpeg demuxer 名与习惯叫法不一致时做一次归一 */
const FORMAT_ALIAS: Record<string, string> = {
  matroska: 'mkv',
  'mov,mp4,m4a,3gp,3g2,mj2': 'mp4',
}

/** mp4 家族扩展名（决定是否追加 -movflags +faststart） */
const MP4_FAMILY_EXT = new Set(['.mp4', '.m4v', '.mov', '.m4a'])

// ─── 类型定义 ──────────────────────────────────────────────

/** 媒体探测结果 */
export interface MediaProbeResult {
  /** 容器格式（如 'mp4'、'mov'、'mkv'） */
  format: string | null
  /** 时长（毫秒） */
  durationMs: number | null
  /** 视频编码（小写，如 'h264'、'hevc'），无视频流为 null */
  videoCodec: string | null
  /** 音频编码（小写，如 'aac'、'mp3'），无音频流为 null */
  audioCodec: string | null
  width: number | null
  height: number | null
  fps: number | null
  /** 文件大小（字节） */
  sizeBytes: number | null
  /** 是否含视频流 */
  hasVideo: boolean
  /** 是否含音频流 */
  hasAudio: boolean
}

/** 媒体处理产物 */
export interface MediaOutput {
  /** 产物绝对路径 */
  outputPath: string
  /** 产物时长（毫秒）；无法探测格式（如裸 PCM）时为 0 */
  durationMs: number
  /** 产物大小（字节） */
  sizeBytes: number
  /** 实际耗时（毫秒） */
  elapsedMs: number
}

/** 进度回调 */
export type MediaProgressCallback = (info: {
  /** 0~1 */
  progress: number
  /** 已处理时长（毫秒） */
  processedMs: number
  /** 总时长（毫秒） */
  totalMs: number
}) => void

/** 通用执行选项 */
export interface MediaExecOptions {
  /** 超时（毫秒），默认 300000，上限 1800000 */
  timeoutMs?: number
  /** 进度回调（能探测到总时长时才触发） */
  onProgress?: MediaProgressCallback
  /** 允许覆盖已存在的产物，默认 false */
  overwrite?: boolean
  /** 产物绝对路径；与 outputDir 二选一，都不传则落到默认产物目录 */
  outputPath?: string
  /** 产物目录（绝对路径），文件名自动生成 */
  outputDir?: string
}

/** 视频尺寸 */
export interface MediaSize {
  width: number
  height: number
}

/**
 * 缩放适配方式：
 * - contain 等比缩放至完整可见，不足处补黑边（默认，跨平台分发最稳）
 * - cover   等比缩放至铺满，超出部分裁掉
 * - stretch 直接拉伸到目标尺寸（会变形）
 */
export type MediaFit = 'contain' | 'cover' | 'stretch'

/** 转码选项 */
export interface TranscodeOptions extends MediaExecOptions {
  /** 目标视频编码，默认 'h264'；'copy' 表示不重编码 */
  videoCodec?: 'h264' | 'hevc' | 'vp9' | 'copy'
  /** 目标音频编码，默认 'aac'；'copy' 原样保留，'none' 丢弃音轨 */
  audioCodec?: 'aac' | 'mp3' | 'copy' | 'none'
  /** 目标分辨率，不传保持原尺寸 */
  size?: MediaSize
  /** 尺寸适配方式，默认 'contain' */
  fit?: MediaFit
  /** 视频码率（kbps），与 crf 二选一 */
  videoBitrateKbps?: number
  /** 质量档位（0~51，越小越好），与 videoBitrateKbps 二选一 */
  crf?: number
  /** 帧率，不传保持原帧率 */
  fps?: number
}

/** 裁剪选项 */
export interface TrimOptions extends MediaExecOptions {
  /** 起始时间（毫秒） */
  startMs: number
  /** 结束时间（毫秒），与 durationMs 二选一 */
  endMs?: number
  /** 持续时长（毫秒），与 endMs 二选一且优先 */
  durationMs?: number
  /**
   * 是否走流复制（快，但切点被吸附到关键帧，首尾可能有几百毫秒偏差）。
   * 默认 false，即重编码对齐到毫秒级。
   */
  copy?: boolean
}

/** 拼接选项 */
export interface ConcatOptions extends MediaExecOptions {
  /** 'reencode' 统一重编码（慢，稳，默认）；'copy' 直接串联（快，要求同源编码） */
  mode?: 'reencode' | 'copy'
  /** 统一输出尺寸（reencode 模式下生效） */
  size?: MediaSize
  /** 尺寸适配方式，默认 'contain' */
  fit?: MediaFit
}

/** 字幕烧录选项 */
export interface BurnSubtitleOptions extends MediaExecOptions {
  /** 字幕文件路径（.srt / .ass / .ssa） */
  subtitlePath: string
  /** 字幕编码，不传由 libass 探测（utf-8 优先） */
  encoding?: 'utf-8' | 'gbk' | 'big5'
  /** 字号（相对视频高度的百分比），默认 4.5 */
  fontSizePercent?: number
  /** 距底部边距（相对视频高度的百分比），默认 6 */
  marginBottomPercent?: number
  /** 字体名；不传则用 libass 默认字体 */
  fontName?: string
}

/** 叠加选项（画中画 / 水印） */
export interface OverlayOptions extends MediaExecOptions {
  /** 叠加素材路径（图片或视频） */
  overlayPath: string
  /** 定位方式 */
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  /** 缩放（相对主画面宽度比例，0.05~1）；不传保持原尺寸 */
  scaleWidthRatio?: number
  /** 水平偏移（像素），在 position 基础上微调 */
  offsetX?: number
  /** 垂直偏移（像素），在 position 基础上微调 */
  offsetY?: number
  /** 透明度（0~1），默认 1 */
  opacity?: number
}

/** 音频抽取选项 */
export interface ExtractAudioOptions extends MediaExecOptions {
  /** 输出格式，默认 'mp3' */
  format?: 'mp3' | 'aac' | 'wav' | 'pcm'
  /** 采样率，默认 44100；'pcm' 格式强制 24000 */
  sampleRate?: number
  /** 声道数，默认 2；'pcm' 格式强制 1 */
  channels?: number
}

/** 音视频合并选项 */
export interface MuxAudioOptions extends MediaExecOptions {
  /** 音视频时长不一致时的处理，默认 'longest' */
  durationMode?: 'shortest' | 'longest'
  /** 音频相对视频的时间偏移（毫秒），正数表示音频延后 */
  audioDelayMs?: number
  /** 音频音量（0~2），默认 1 */
  audioVolume?: number
}

/** 混音轨（一条待混入的音频） */
export interface MixAudioTrack {
  /** 音频文件路径 */
  path: string
  /** 音量（0~2），默认 1 */
  volume?: number
  /** 延后开始（毫秒），默认 0 */
  delayMs?: number
  /**
   * 输入短于主视频时是否循环铺满，默认 false。
   * 背景音乐通常短于成片，需要循环；配音不应循环。
   */
  loop?: boolean
}

/**
 * 多音轨混音选项
 *
 * 用于把配音与背景音乐叠到同一条音轨上。`muxAudio` 是「替换音轨」语义，
 * 只能加一条音频；需要叠加多条时走这里。
 */
export interface MixAudioOptions extends MediaExecOptions {
  /** 待混入的音轨（1~4 条） */
  tracks: MixAudioTrack[]
  /** 是否保留输入原有的音轨，默认 false（丢弃，只保留混音结果） */
  keepOriginal?: boolean
  /** 原有音轨音量（keepOriginal=true 时生效），默认 1 */
  originalVolume?: number
  /** 原有音轨延后（毫秒），默认 0 */
  originalDelayMs?: number
  /** 输出音频编码，默认 'aac' */
  audioCodec?: 'aac' | 'mp3'
}

/** 抽帧选项 */
export interface ThumbnailOptions extends MediaExecOptions {
  /** 抽取时间点（毫秒），默认取 1/10 处 */
  atMs?: number
  /** 输出格式，默认 'jpg' */
  format?: 'jpg' | 'png' | 'webp'
  /** 输出宽度（像素），高度按比例，默认 720 */
  width?: number
  /** 等间隔抽多帧，与 atMs 互斥，上限 20 */
  frames?: number
}

/** GIF 选项 */
export interface ToGifOptions extends MediaExecOptions {
  /** 起始时间（毫秒） */
  startMs?: number
  /** 持续时长（毫秒），默认 3000，上限 15000 */
  durationMs?: number
  /** 输出宽度，默认 480 */
  width?: number
  /** 帧率，默认 12，上限 24 */
  fps?: number
}

/** ffmpeg 可用性自检结果 */
export interface MediaStatus {
  /** ffmpeg 是否可用 */
  available: boolean
  /** ffmpeg 二进制绝对路径 */
  ffmpegPath: string | null
  /** ffmpeg 版本（首行），不可用时为 null */
  version: string | null
}

/** 媒体处理桥 */
export interface MediaBridge {
  /** 探测媒体信息（不产出文件） */
  probe(inputPath: string): Promise<MediaProbeResult>

  /** 转码（编码 / 分辨率 / 码率 / 帧率） */
  transcode(inputPath: string, options: TranscodeOptions): Promise<MediaOutput>

  /** 裁剪时间区间 */
  trim(inputPath: string, options: TrimOptions): Promise<MediaOutput>

  /** 顺序拼接多个媒体文件 */
  concat(inputPaths: string[], options?: ConcatOptions): Promise<MediaOutput>

  /** 抽取音轨 */
  extractAudio(inputPath: string, options?: ExtractAudioOptions): Promise<MediaOutput>

  /** 音视频合并（替换或添加音轨） */
  muxAudio(videoPath: string, audioPath: string, options?: MuxAudioOptions): Promise<MediaOutput>

  /** 多音轨混音（配音 + 背景音乐叠加到一条音轨） */
  mixAudio(inputPath: string, options: MixAudioOptions): Promise<MediaOutput>

  /** 烧录字幕（硬字幕） */
  burnSubtitle(inputPath: string, options: BurnSubtitleOptions): Promise<MediaOutput>

  /** 叠加图片/视频（画中画、水印） */
  overlay(inputPath: string, options: OverlayOptions): Promise<MediaOutput>

  /** 抽帧（单帧封面或多帧） */
  thumbnail(inputPath: string, options?: ThumbnailOptions): Promise<MediaOutput[]>

  /** 生成 GIF */
  toGif(inputPath: string, options?: ToGifOptions): Promise<MediaOutput>

  /** 能力自检：ffmpeg 是否可用 */
  getStatus(): Promise<MediaStatus>
}

/** 桥接作用域：标识调用方插件，并提供该插件额外允许的读写根 */
export interface MediaBridgeScope {
  /** 调用方插件 ID（写入日志，便于审计） */
  pluginId: string
  /** 插件数据目录（额外允许的读写根） */
  dataDir?: string
}

// ─── 校验与工具函数 ────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/** 取偶数（yuv420p 要求宽高为偶数） */
function toEven(value: number): number {
  const rounded = Math.round(value)
  return rounded % 2 === 0 ? rounded : rounded + 1
}

/** 毫秒 → 秒字符串（ffmpeg 时间参数用，3 位小数足够） */
function msToSeconds(ms: number): string {
  return (ms / 1000).toFixed(3)
}

function isMp4Family(filePath: string): boolean {
  return MP4_FAMILY_EXT.has(path.extname(filePath).toLowerCase())
}

/**
 * 归一容器名。
 *
 * 优先看扩展名：ffmpeg 报的 demuxer 名对调用方没有意义——mp4 会被它报成
 * `mov,mp4,m4a,3gp,3g2,mj2` 这一串（而取容器名的那段解析只截到首个别名 'mov'），
 * 扩展名才是用户认知里的容器。没有扩展名时才退回 demuxer 名。
 */
function normalizeFormat(rawFormat: string | null, filePath: string): string | null {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase()
  if (ext) return FORMAT_ALIAS[ext] ?? ext
  if (!rawFormat) return null

  const names = rawFormat
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (names.length === 0) return null
  return FORMAT_ALIAS[names.join(',')] ?? FORMAT_ALIAS[names[0]] ?? names[0]
}

/**
 * 转义 ffmpeg filter 参数值。
 *
 * filter 串里的 `\ : ' [ ] , ;` 都是语法字符，出现在路径里必须转义，
 * 否则一个字面量冒号就能把参数切开。
 */
function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/** 校验字体名：只允许常见字符，避免把 force_style 的引号/逗号结构撑破 */
function assertFontName(fontName: string): string {
  const value = fontName.trim()
  if (!/^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5 .-]*$/.test(value)) {
    throw new Error(`[MediaBridge] 字体名含非法字符：${fontName}`)
  }
  return value
}

/**
 * 构造缩放滤镜链。
 *
 * contain 用 decrease + pad 补边，cover 用 increase + crop 裁切，stretch 直接拉伸。
 * 三种方式都补 setsar=1，避免拼接时各段像素宽高比不一致导致 concat 失败。
 */
function buildScaleChain(size: MediaSize, fit: MediaFit): string {
  const w = toEven(size.width)
  const h = toEven(size.height)
  switch (fit) {
    case 'cover':
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`
    case 'stretch':
      return `scale=${w}:${h},setsar=1`
    case 'contain':
    default:
      return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
  }
}

// ─── 桥实现 ────────────────────────────────────────────────

interface RunFfmpegOptions {
  /** 日志标识（操作名） */
  op: string
  timeoutMs: number
  /** 总时长（毫秒），用于进度换算；未知则不回调进度 */
  totalMs?: number
  onProgress?: MediaProgressCallback
}

/**
 * 媒体处理桥实现。
 *
 * 每个插件一个实例（由 createMediaBridge 按 pluginId + dataDir 缓存），实例上
 * 只持有作用域与工作区解析器，没有跨插件共享的业务状态；并发槽位刻意做成全局
 * 的，目的是限制整机同时运行的 ffmpeg 数量，而不是限制单个插件。
 */
export class MediaBridgeService implements MediaBridge {
  private readonly scope: MediaBridgeScope

  /** 运行中的 ffmpeg 进程数（全局共享） */
  private static activeRuns = 0
  /** 并发已满时的排队等待者（全局共享） */
  private static waiters: Array<() => void> = []
  /** ffmpeg 版本缓存（探测一次即可） */
  private static cachedVersion: string | null = null

  constructor(scope: MediaBridgeScope) {
    this.scope = scope
  }

  // ── 能力自检 ──

  async getStatus(): Promise<MediaStatus> {
    const ffmpegPath = this.ensureFfmpeg()
    if (!ffmpegPath) {
      return { available: false, ffmpegPath: null, version: null }
    }
    if (MediaBridgeService.cachedVersion === null) {
      try {
        const { stdout, stderr } = await this.spawnFfmpeg(['-version'], {
          op: 'version',
          timeoutMs: 10000,
        })
        const firstLine =
          `${stdout}${stderr}`.split(/\r?\n/).find((line) => line.trim()) ?? ''
        MediaBridgeService.cachedVersion = firstLine.trim() || 'unknown'
      } catch {
        MediaBridgeService.cachedVersion = 'unknown'
      }
    }
    return { available: true, ffmpegPath, version: MediaBridgeService.cachedVersion }
  }

  // ── 探测 ──

  async probe(inputPath: string): Promise<MediaProbeResult> {
    const absInput = this.assertInputPath(inputPath)
    const raw = await probeVideo(absInput)

    return {
      format: normalizeFormat(raw.format, absInput),
      durationMs: raw.duration != null ? Math.round(raw.duration * 1000) : null,
      videoCodec: raw.videoCodec,
      audioCodec: raw.audioCodec,
      width: raw.width,
      height: raw.height,
      fps: raw.fps,
      sizeBytes: raw.fileSize ?? this.safeFileSize(absInput),
      hasVideo: raw.videoCodec !== null,
      hasAudio: raw.audioCodec !== null,
    }
  }

  // ── 转码 ──

  async transcode(inputPath: string, options: TranscodeOptions): Promise<MediaOutput> {
    // 参数校验一律排在探测与落盘之前：参数写错了就不该去碰文件系统和子进程
    const videoCodec = options.videoCodec ?? 'h264'
    const audioCodec = options.audioCodec ?? 'aac'
    const size = options.size ? this.assertSize(options.size) : undefined
    const fit = options.fit ?? 'contain'
    const crf =
      options.crf !== undefined ? this.assertRange('crf', options.crf, 0, MAX_CRF) : undefined
    const bitrateKbps =
      options.videoBitrateKbps !== undefined
        ? this.assertRange('videoBitrateKbps', options.videoBitrateKbps, 1, 200_000)
        : undefined
    const fps = options.fps !== undefined ? this.assertRange('fps', options.fps, 1, 240) : undefined

    if (videoCodec === 'copy' && (size || fps !== undefined)) {
      throw new Error('[MediaBridge] videoCodec 为 copy 时不能同时改分辨率或帧率')
    }

    const absInput = this.assertInputPath(inputPath)
    const info = await probeVideo(absInput)
    const totalMs = info.duration != null ? Math.round(info.duration * 1000) : undefined

    const outputPath = this.resolveOutputPath(options, 'transcode', 'mp4')
    const replaces = this.prepareOutput(outputPath, options.overwrite)

    const args: string[] = ['-i', absInput]

    // 视频编码
    if (videoCodec === 'copy') {
      args.push('-c:v', 'copy')
    } else {
      const encoder = VIDEO_ENCODER[videoCodec]
      if (!encoder) throw new Error(`[MediaBridge] 不支持的视频编码：${videoCodec}`)
      args.push('-c:v', encoder)
      if (encoder === 'libx264' || encoder === 'libx265') args.push('-preset', 'medium')
      if (crf !== undefined) {
        args.push('-crf', String(crf))
        // libvpx-vp9 的 crf 要配合 -b:v 0 才是恒定质量模式
        if (encoder === 'libvpx-vp9') args.push('-b:v', '0')
      } else if (bitrateKbps !== undefined) {
        args.push('-b:v', `${bitrateKbps}k`)
      }
      if (encoder !== 'libvpx-vp9') args.push('-pix_fmt', 'yuv420p')
    }

    // 音频编码
    if (audioCodec === 'none') {
      args.push('-an')
    } else if (audioCodec === 'copy') {
      args.push('-c:a', 'copy')
    } else {
      const encoder = AUDIO_ENCODER[audioCodec]
      if (!encoder) throw new Error(`[MediaBridge] 不支持的音频编码：${audioCodec}`)
      args.push('-c:a', encoder, '-b:a', '128k')
    }

    // 分辨率与帧率
    const filters: string[] = []
    if (size) filters.push(buildScaleChain(size, fit))
    if (fps !== undefined) filters.push(`fps=${fps}`)
    if (filters.length > 0) args.push('-vf', filters.join(','))

    if (isMp4Family(outputPath)) args.push('-movflags', '+faststart')
    args.push('-y', outputPath)

    const elapsedMs = await this.runWithGate(args, {
      op: 'transcode',
      timeoutMs: this.resolveTimeout(options.timeoutMs),
      totalMs,
      onProgress: options.onProgress,
    })

    return this.buildOutput(outputPath, elapsedMs, replaces)
  }

  // ── 裁剪 ──

  async trim(inputPath: string, options: TrimOptions): Promise<MediaOutput> {
    // 参数校验一律排在探测与落盘之前
    const startMs = this.assertRange('startMs', options.startMs, 0, Number.MAX_SAFE_INTEGER)

    if (options.durationMs === undefined && options.endMs === undefined) {
      throw new Error('[MediaBridge] trim 需要 durationMs 或 endMs')
    }
    const durationMs =
      options.durationMs !== undefined
        ? this.assertRange('durationMs', options.durationMs, 1, Number.MAX_SAFE_INTEGER)
        : this.assertRange('endMs', options.endMs as number, 1, Number.MAX_SAFE_INTEGER) - startMs
    if (durationMs <= 0) {
      throw new Error(`[MediaBridge] trim 区间非法：start=${startMs}ms end=${options.endMs}ms`)
    }

    const absInput = this.assertInputPath(inputPath)
    const ext = path.extname(absInput).replace(/^\./, '').toLowerCase() || 'mp4'
    const outputPath = this.resolveOutputPath(options, 'trim', ext)
    const replaces = this.prepareOutput(outputPath, options.overwrite)

    // -ss 前置走关键帧快速定位，配合默认开启的 accurate_seek 由解码器校正误差
    const args = ['-ss', msToSeconds(startMs), '-i', absInput, '-t', msToSeconds(durationMs)]
    if (options.copy) {
      // 流复制的切点会被吸附到关键帧，时长有偏差，只适合"大致截一段"的场景
      args.push('-c', 'copy')
    } else {
      args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p')
      args.push('-c:a', 'aac', '-b:a', '128k')
    }
    if (isMp4Family(outputPath)) args.push('-movflags', '+faststart')
    args.push('-y', outputPath)

    const elapsedMs = await this.runWithGate(args, {
      op: 'trim',
      timeoutMs: this.resolveTimeout(options.timeoutMs),
      totalMs: durationMs,
      onProgress: options.onProgress,
    })

    return this.buildOutput(outputPath, elapsedMs, replaces)
  }

  // ── 拼接 ──

  async concat(inputPaths: string[], options: ConcatOptions = {}): Promise<MediaOutput> {
    if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
      throw new Error('[MediaBridge] concat 至少需要 2 个输入文件')
    }
    const absInputs = inputPaths.map((item) => this.assertInputPath(item))
    const mode = options.mode ?? 'reencode'
    const fit = options.fit ?? 'contain'
    const size = options.size ? this.assertSize(options.size) : undefined

    const outputPath = this.resolveOutputPath(options, 'concat', 'mp4')
    const replaces = this.prepareOutput(outputPath, options.overwrite)

    const probes = await Promise.all(absInputs.map((file) => probeVideo(file)))
    const totalMs = Math.round(
      probes.reduce((sum, info) => sum + (info.duration ?? 0) * 1000, 0),
    )

    let tempDir: string | null = null
    let args: string[]
    if (mode === 'copy') {
      const built = this.buildConcatCopyArgs(absInputs, outputPath)
      args = built.args
      tempDir = built.tempDir
    } else {
      args = this.buildConcatReencodeArgs(absInputs, probes, outputPath, size, fit)
    }

    let elapsedMs: number
    try {
      elapsedMs = await this.runWithGate(args, {
        op: 'concat',
        timeoutMs: this.resolveTimeout(options.timeoutMs),
        totalMs: totalMs > 0 ? totalMs : undefined,
        onProgress: options.onProgress,
      })
    } finally {
      if (tempDir) this.cleanupTempDir(tempDir)
    }

    return this.buildOutput(outputPath, elapsedMs, replaces)
  }

  /** copy 模式：concat demuxer 直接串联，要求各段编码参数一致 */
  private buildConcatCopyArgs(
    absInputs: string[],
    outputPath: string,
  ): { args: string[]; tempDir: string } {
    const tempDir = this.createTempDir('concat')
    const listPath = path.join(tempDir, 'filelist.txt')
    // concat demuxer 的 file 指令用单引号包裹路径，路径内的单引号按 '\'' 转义
    const lines = absInputs.map((file) => `file '${file.replace(/'/g, "'\\''")}'`)
    writeFileSync(listPath, lines.join('\n'), 'utf-8')

    const args = ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy']
    if (isMp4Family(outputPath)) args.push('-movflags', '+faststart')
    args.push('-y', outputPath)
    return { args, tempDir }
  }

  /**
   * reencode 模式：用 concat filter 统一重编码。
   *
   * 尺寸或帧率不一致时 concat demuxer 会直接失败，filter 方式可以先把各段对齐
   * 再拼；缺音轨的段用 lavfi 静音补齐到该段时长，避免音视频轨数量对不齐。
   */
  private buildConcatReencodeArgs(
    absInputs: string[],
    probes: Awaited<ReturnType<typeof probeVideo>>[],
    outputPath: string,
    size: MediaSize | undefined,
    fit: MediaFit,
  ): string[] {
    if (probes.some((info) => !info.width || !info.height)) {
      throw new Error('[MediaBridge] concat 的 reencode 模式要求各输入都含视频流')
    }
    if (!size) {
      const first = probes[0]
      if (probes.some((info) => info.width !== first.width || info.height !== first.height)) {
        throw new Error('[MediaBridge] concat 的 reencode 模式在输入尺寸不一致时必须显式传 size')
      }
    }

    const args: string[] = []
    const filterParts: string[] = []
    const videoLabels: string[] = []
    const audioLabels: string[] = []

    for (let i = 0; i < absInputs.length; i++) {
      const info = probes[i]
      args.push('-i', absInputs[i])
      const videoIndex = this.countInputs(args) - 1

      const chain = size ? buildScaleChain(size, fit) : 'setsar=1'
      filterParts.push(`[${videoIndex}:v]${chain}[v${videoIndex}]`)
      videoLabels.push(`[v${videoIndex}]`)

      if (info.audioCodec) {
        filterParts.push(`[${videoIndex}:a]aresample=44100[a${videoIndex}]`)
        audioLabels.push(`[a${videoIndex}]`)
      } else {
        // 补一段与该段等长的静音，保证 concat filter 的音频轨数量一致
        const silenceSec = Math.max(0.1, info.duration ?? 0).toFixed(3)
        args.push('-f', 'lavfi', '-t', silenceSec, '-i', 'anullsrc=r=44100:cl=stereo')
        const silenceIndex = this.countInputs(args) - 1
        audioLabels.push(`[${silenceIndex}:a]`)
      }
    }

    const concatInputs: string[] = []
    for (let i = 0; i < videoLabels.length; i++) {
      concatInputs.push(videoLabels[i], audioLabels[i])
    }
    filterParts.push(`${concatInputs.join('')}concat=n=${videoLabels.length}:v=1:a=1[vout][aout]`)

    args.push(
      '-filter_complex', filterParts.join(';'),
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
    )
    if (isMp4Family(outputPath)) args.push('-movflags', '+faststart')
    args.push('-y', outputPath)
    return args
  }

  /** 数出 argv 里 `-i` 的个数，用来推导当前输入的流索引 */
  private countInputs(args: string[]): number {
    let count = 0
    for (const item of args) {
      if (item === '-i') count++
    }
    return count
  }

  // ── 抽取音轨 ──

  async extractAudio(inputPath: string, options: ExtractAudioOptions = {}): Promise<MediaOutput> {
    const absInput = this.assertInputPath(inputPath)
    const format = options.format ?? 'mp3'
    const profile = AUDIO_EXTRACT_PROFILE[format]
    if (!profile) throw new Error(`[MediaBridge] 不支持的音频格式：${format}`)

    const sampleRate = profile.forceRate
      ? profile.forceRate
      : this.assertRange('sampleRate', options.sampleRate ?? 44100, 8000, 192000)
    const channels = profile.forceMono
      ? 1
      : this.assertRange('channels', options.channels ?? 2, 1, 8)

    const outputPath = this.resolveOutputPath(options, 'audio', profile.ext)
    const replaces = this.prepareOutput(outputPath, options.overwrite)

    const info = await probeVideo(absInput)
    const totalMs = info.duration != null ? Math.round(info.duration * 1000) : undefined

    const args = [
      '-i', absInput,
      '-vn',
      '-c:a', profile.codec,
      '-ar', String(sampleRate),
      '-ac', String(channels),
      // 显式给出容器：裸 PCM 这类格式没有扩展名可依据，靠推断会直接选错复用器
      '-f', profile.container,
      '-y', outputPath,
    ]

    const elapsedMs = await this.runWithGate(args, {
      op: 'extractAudio',
      timeoutMs: this.resolveTimeout(options.timeoutMs),
      totalMs,
      onProgress: options.onProgress,
    })

    return this.buildOutput(outputPath, elapsedMs, replaces)
  }

  // ── 音视频合并 ──

  async muxAudio(
    videoPath: string,
    audioPath: string,
    options: MuxAudioOptions = {},
  ): Promise<MediaOutput> {
    const absVideo = this.assertInputPath(videoPath)
    const absAudio = this.assertInputPath(audioPath)

    const volume =
      options.audioVolume !== undefined
        ? this.assertRange('audioVolume', options.audioVolume, 0, 2)
        : undefined
    const delayMs =
      options.audioDelayMs !== undefined
        ? this.assertRange('audioDelayMs', options.audioDelayMs, -600_000, 600_000)
        : 0

    const outputPath = this.resolveOutputPath(options, 'mux', 'mp4')
    const replaces = this.prepareOutput(outputPath, options.overwrite)

    const args: string[] = ['-i', absVideo]
    if (delayMs > 0) {
      // 音频延后：给音频输入加时间戳偏移（-itsoffset 必须紧邻它所修饰的 -i）
      args.push('-itsoffset', msToSeconds(delayMs))
    }
    args.push('-i', absAudio)

    const audioFilters: string[] = []
    if (delayMs < 0) {
      // 音频提前：没有负向 -itsoffset，改为裁掉音频开头，等效于整体前移
      audioFilters.push(`atrim=start=${msToSeconds(-delayMs)}`, 'asetpts=PTS-STARTPTS')
    }
    if (volume !== undefined) audioFilters.push(`volume=${volume}`)

    args.push('-map', '0:v:0', '-map', '1:a:0')
    if (audioFilters.length > 0) args.push('-af', audioFilters.join(','))
    args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k')
    if ((options.durationMode ?? 'longest') === 'shortest') args.push('-shortest')
    if (isMp4Family(outputPath)) args.push('-movflags', '+faststart')
    args.push('-y', outputPath)

    const info = await probeVideo(absVideo)
    const totalMs = info.duration != null ? Math.round(info.duration * 1000) : undefined

    const elapsedMs = await this.runWithGate(args, {
      op: 'muxAudio',
      timeoutMs: this.resolveTimeout(options.timeoutMs),
      totalMs,
      onProgress: options.onProgress,
    })

    return this.buildOutput(outputPath, elapsedMs, replaces)
  }

  // ── 多音轨混音 ──

  async mixAudio(inputPath: string, options: MixAudioOptions): Promise<MediaOutput> {
    const absInput = this.assertInputPath(inputPath)

    const rawTracks = Array.isArray(options.tracks) ? options.tracks : []
    if (rawTracks.length === 0) {
      throw new Error('[MediaBridge] mixAudio 至少需要 1 条音轨')
    }
    if (rawTracks.length > MAX_MIX_TRACKS) {
      throw new Error(
        `[MediaBridge] mixAudio 音轨数上限为 ${MAX_MIX_TRACKS}，当前 ${rawTracks.length}`,
      )
    }

    const tracks: Array<{
      absPath: string
      volume: number
      delayMs: number
      loop: boolean
      loopSize: number
    }> = []
    for (let i = 0; i < rawTracks.length; i += 1) {
      const track = rawTracks[i]
      if (!track || typeof track.path !== 'string' || track.path.length === 0) {
        throw new Error(`[MediaBridge] mixAudio 第 ${i + 1} 条音轨缺少 path`)
      }
      const absPath = this.assertInputPath(track.path)
      const loop = track.loop === true
      // aloop 的 size 是循环缓冲的样本上限：偏大是安全的（实际按输入长度循环），
      // 偏小则只会循环尾部那一截。按 48kHz 上限估个样本数即可。
      let loopSize = 0
      if (loop) {
        const probed = await probeVideo(absPath)
        const seconds = probed.duration != null && probed.duration > 0 ? probed.duration : 5
        loopSize = Math.ceil(seconds * 48000)
      }
      tracks.push({
        absPath,
        volume: this.assertRange(`tracks[${i}].volume`, track.volume ?? 1, 0, 2),
        delayMs: this.assertRange(`tracks[${i}].delayMs`, track.delayMs ?? 0, 0, 600_000),
        loop,
        loopSize,
      })
    }

    const keepOriginal = options.keepOriginal === true
    const originalVolume = this.assertRange('originalVolume', options.originalVolume ?? 1, 0, 2)
    const originalDelayMs = this.assertRange(
      'originalDelayMs',
      options.originalDelayMs ?? 0,
      0,
      600_000,
    )
    const audioEncoder = options.audioCodec === 'mp3' ? AUDIO_ENCODER.mp3 : AUDIO_ENCODER.aac

    const info = await probeVideo(absInput)
    const totalMs = info.duration != null ? Math.round(info.duration * 1000) : undefined
    // probeVideo 给的是 videoCodec / audioCodec，没有 hasVideo / hasAudio 这类布尔字段
    const hasVideo = info.videoCodec != null
    const hasOriginalAudio = info.audioCodec != null

    const outputPath = this.resolveOutputPath(options, 'mix', hasVideo ? 'mp4' : 'm4a')
    const replaces = this.prepareOutput(outputPath, options.overwrite)

    const args: string[] = ['-i', absInput]
    // 循环铺底不能走输入的 -stream_loop：无限循环的输入永远等不到 EOF，
    // 即使输出时长已经够了 ffmpeg 也不退出（实测挂死）。改用 filter 内的 aloop。
    for (const track of tracks) args.push('-i', track.absPath)


    // 每条轨补齐到主输入时长再多截断：apad 先补静音，atrim 再裁齐，
    // 于是「短于成片的配音」在尾部静音、「长于成片的 BGM」被切掉，
    // amix 的 duration=longest 也就必然收敛到成片时长。
    const trimTail =
      totalMs != null && totalMs > 0
        ? ['apad', `atrim=0:${msToSeconds(totalMs)}`, 'asetpts=PTS-STARTPTS']
        : []

    const segments: string[] = []
    const labels: string[] = []

    if (keepOriginal && hasOriginalAudio) {
      const parts = [`volume=${originalVolume}`]
      if (originalDelayMs > 0) parts.push(`adelay=${originalDelayMs}|${originalDelayMs}`)
      segments.push(`[0:a]${[...parts, ...trimTail].join(',')}[mix0]`)
      labels.push('[mix0]')
    }

    tracks.forEach((track, i) => {
      const parts: string[] = []
      if (track.loop) parts.push(`aloop=loop=-1:size=${track.loopSize}`)
      parts.push(`volume=${track.volume}`)
      if (track.delayMs > 0) parts.push(`adelay=${track.delayMs}|${track.delayMs}`)
      const label = `mix${i + 1}`
      segments.push(`[${i + 1}:a]${[...parts, ...trimTail].join(',')}[${label}]`)
      labels.push(`[${label}]`)
    })

    // normalize=0：默认行为会把各轨按输入数平均，配音会被 BGM 拖小声
    segments.push(
      `${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0[aout]`,
    )

    args.push('-filter_complex', segments.join(';'))
    if (hasVideo) args.push('-map', '0:v:0')
    args.push('-map', '[aout]')
    // 画面不重编码：混音只改音轨，重编视频纯属浪费
    if (hasVideo) args.push('-c:v', 'copy')
    args.push('-c:a', audioEncoder, '-b:a', '192k')
    // 时长已知时再上一道输出硬闸：即使 filter 出了意外也不会无限跑
    if (totalMs != null && totalMs > 0) args.push('-t', msToSeconds(totalMs))
    if (isMp4Family(outputPath)) args.push('-movflags', '+faststart')
    args.push('-y', outputPath)

    const elapsedMs = await this.runWithGate(args, {
      op: 'mixAudio',
      timeoutMs: this.resolveTimeout(options.timeoutMs),
      totalMs,
      onProgress: options.onProgress,
    })

    return this.buildOutput(outputPath, elapsedMs, replaces)
  }

  // ── 字幕 ──

  async burnSubtitle(inputPath: string, options: BurnSubtitleOptions): Promise<MediaOutput> {
    const absInput = this.assertInputPath(inputPath)
    const absSubtitle = this.assertInputPath(options.subtitlePath)

    const ext = path.extname(absSubtitle).toLowerCase()
    if (ext !== '.srt' && ext !== '.ass' && ext !== '.ssa') {
      throw new Error(`[MediaBridge] 字幕格式不支持（需 .srt / .ass / .ssa）：${absSubtitle}`)
    }

    const fontSizePercent = this.assertRange(
      'fontSizePercent',
      options.fontSizePercent ?? 4.5,
      0.5,
      30,
    )
    const marginBottomPercent = this.assertRange(
      'marginBottomPercent',
      options.marginBottomPercent ?? 6,
      0,
      50,
    )

    const info = await probeVideo(absInput)
    if (!info.width || !info.height) {
      throw new Error('[MediaBridge] burnSubtitle 要求输入含视频流')
    }

    const fontSize = Math.max(8, Math.round((info.height * fontSizePercent) / 100))
    const marginV = Math.round((info.height * marginBottomPercent) / 100)

    const styleParts = [`FontSize=${fontSize}`, `MarginV=${marginV}`, 'Alignment=2']
    if (options.fontName) styleParts.push(`FontName=${assertFontName(options.fontName)}`)

    const outputPath = this.resolveOutputPath(options, 'subtitle', 'mp4')
    const replaces = this.prepareOutput(outputPath, options.overwrite)

    const totalMs = info.duration != null ? Math.round(info.duration * 1000) : undefined

    // original_size 让 libass 以视频真实像素解释字号，否则会按默认 384x288 放大
    const subtitleFilter =
      `subtitles=${escapeFilterValue(absSubtitle)}` +
      `:original_size=${info.width}x${info.height}` +
      (options.encoding ? `:charenc=${options.encoding}` : '') +
      `:force_style='${styleParts.join(',')}'`

    const args = [
      '-i', absInput,
      '-vf', subtitleFilter,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      // 只改了视频流，音轨原样保留；音频编码不兼容容器时 ffmpeg 会直接报错，便于定位
      '-c:a', 'aac',
      '-b:a', '128k',
    ]
    if (isMp4Family(outputPath)) args.push('-movflags', '+faststart')
    args.push('-y', outputPath)

    const elapsedMs = await this.runWithGate(args, {
      op: 'burnSubtitle',
      timeoutMs: this.resolveTimeout(options.timeoutMs),
      totalMs,
      onProgress: options.onProgress,
    })

    return this.buildOutput(outputPath, elapsedMs, replaces)
  }

  // ── 叠加 ──

  async overlay(inputPath: string, options: OverlayOptions): Promise<MediaOutput> {
    const absInput = this.assertInputPath(inputPath)
    const absOverlay = this.assertInputPath(options.overlayPath)

    if (!options.position) {
      throw new Error('[MediaBridge] overlay 需要指定 position')
    }
    const scaleRatio =
      options.scaleWidthRatio !== undefined
        ? this.assertRange('scaleWidthRatio', options.scaleWidthRatio, 0.05, 1)
        : undefined
    const opacity =
      options.opacity !== undefined ? this.assertRange('opacity', options.opacity, 0, 1) : 1
    const offsetX = options.offsetX !== undefined ? Math.round(options.offsetX) : 0
    const offsetY = options.offsetY !== undefined ? Math.round(options.offsetY) : 0

    const info = await probeVideo(absInput)
    if (!info.width || !info.height) {
      throw new Error('[MediaBridge] overlay 要求主画面含视频流')
    }

    const outputPath = this.resolveOutputPath(options, 'overlay', 'mp4')
    const replaces = this.prepareOutput(outputPath, options.overwrite)

    const overlayParts: string[] = ['format=rgba']
    if (scaleRatio !== undefined) {
      overlayParts.push(`scale=${toEven(info.width * scaleRatio)}:-2`)
    }
    if (opacity < 1) overlayParts.push(`colorchannelmixer=aa=${opacity}`)

    const positionExpr = this.buildOverlayPosition(options.position, offsetX, offsetY)
    const filter =
      `[1:v]${overlayParts.join(',')}[ovl];` +
      `[0:v][ovl]overlay=${positionExpr}:format=auto[vout]`

    const totalMs = info.duration != null ? Math.round(info.duration * 1000) : undefined

    const args = [
      '-i', absInput,
      '-i', absOverlay,
      '-filter_complex', filter,
      '-map', '[vout]',
      // 主画面可能有也可能没有音轨，用 ? 让缺失时跳过而不是报错
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
    ]
    if (isMp4Family(outputPath)) args.push('-movflags', '+faststart')
    args.push('-y', outputPath)

    const elapsedMs = await this.runWithGate(args, {
      op: 'overlay',
      timeoutMs: this.resolveTimeout(options.timeoutMs),
      totalMs,
      onProgress: options.onProgress,
    })

    return this.buildOutput(outputPath, elapsedMs, replaces)
  }

  /** 位置关键词 → overlay 的 x:y 表达式 */
  private buildOverlayPosition(
    position: OverlayOptions['position'],
    offsetX: number,
    offsetY: number,
  ): string {
    const dx = offsetX >= 0 ? `+${offsetX}` : String(offsetX)
    const dy = offsetY >= 0 ? `+${offsetY}` : String(offsetY)
    switch (position) {
      case 'top-left':
        return `0${dx}:0${dy}`
      case 'top-right':
        return `main_w-overlay_w${dx}:0${dy}`
      case 'bottom-left':
        return `0${dx}:main_h-overlay_h${dy}`
      case 'bottom-right':
        return `main_w-overlay_w${dx}:main_h-overlay_h${dy}`
      case 'center':
      default:
        return `(main_w-overlay_w)/2${dx}:(main_h-overlay_h)/2${dy}`
    }
  }

  // ── 抽帧 ──

  async thumbnail(inputPath: string, options: ThumbnailOptions = {}): Promise<MediaOutput[]> {
    const format = options.format ?? 'jpg'
    const ext = IMAGE_EXT[format]
    if (!ext) throw new Error(`[MediaBridge] 不支持的图片格式：${format}`)
    const width = this.assertRange('width', options.width ?? 720, 16, 8192)

    if (options.frames !== undefined && options.atMs !== undefined) {
      throw new Error('[MediaBridge] thumbnail 的 frames 与 atMs 互斥')
    }
    const frames =
      options.frames !== undefined
        ? this.assertRange('frames', options.frames, 2, MAX_THUMBNAIL_FRAMES)
        : undefined

    const absInput = this.assertInputPath(inputPath)
    const info = await probeVideo(absInput)
    const durationMs = info.duration != null ? Math.round(info.duration * 1000) : 0
    const outputDir = this.resolveOutputDir(options, 'thumbs')

    await this.acquire()
    try {
      if (frames !== undefined) {
        if (durationMs <= 0) {
          throw new Error('[MediaBridge] thumbnail 多帧模式需要能探测到输入时长')
        }
        const prefix = this.autoName('frame')
        const startedAt = Date.now()
        const results: MediaOutput[] = []

        for (let i = 0; i < frames; i++) {
          // 取每等分段的中间点，避开片头片尾的黑场
          const atMs = Math.round((durationMs * (i + 0.5)) / frames)
          const target = path.join(outputDir, `${prefix}_${String(i + 1).padStart(3, '0')}.${ext}`)
          const singleStartedAt = Date.now()
          await this.runFfmpeg(this.buildThumbnailArgs(absInput, target, atMs, width, format), {
            op: 'thumbnail',
            timeoutMs: this.resolveTimeout(options.timeoutMs),
          })
          this.assertProduced(target)
          results.push({
            outputPath: target,
            durationMs: 0,
            sizeBytes: this.safeFileSize(target) ?? 0,
            elapsedMs: Date.now() - singleStartedAt,
          })
        }

        logger.system.info(
          `[MediaBridge] plugin=${this.scope.pluginId} thumbnail 多帧完成 frames=${frames} 耗时=${Date.now() - startedAt}ms`,
        )
        return results
      }

      const atMs = this.assertRange(
        'atMs',
        options.atMs ?? Math.max(0, Math.round(durationMs / 10)),
        0,
        Number.MAX_SAFE_INTEGER,
      )
      const target = path.join(outputDir, `${this.autoName('cover')}.${ext}`)
      const startedAt = Date.now()
      await this.runFfmpeg(this.buildThumbnailArgs(absInput, target, atMs, width, format), {
        op: 'thumbnail',
        timeoutMs: this.resolveTimeout(options.timeoutMs),
        totalMs: durationMs || undefined,
        onProgress: options.onProgress,
      })
      this.assertProduced(target)
      return [
        {
          outputPath: target,
          durationMs: 0,
          sizeBytes: this.safeFileSize(target) ?? 0,
          elapsedMs: Date.now() - startedAt,
        },
      ]
    } finally {
      this.release()
    }
  }

  private buildThumbnailArgs(
    absInput: string,
    target: string,
    atMs: number,
    width: number,
    format: 'jpg' | 'png' | 'webp',
  ): string[] {
    const args = [
      // -ss 前置走快速定位，只解码目标点附近的数据
      '-ss', msToSeconds(atMs),
      '-i', absInput,
      '-frames:v', '1',
      '-vf', `scale=${width}:-2`,
    ]
    if (format === 'jpg') args.push('-q:v', '3')
    args.push('-y', target)
    return args
  }

  // ── GIF ──

  async toGif(inputPath: string, options: ToGifOptions = {}): Promise<MediaOutput> {
    const absInput = this.assertInputPath(inputPath)
    const startMs = this.assertRange('startMs', options.startMs ?? 0, 0, Number.MAX_SAFE_INTEGER)
    const durationMs = this.assertRange(
      'durationMs',
      options.durationMs ?? 3000,
      100,
      MAX_GIF_DURATION_MS,
    )
    const width = this.assertRange('width', options.width ?? 480, 16, 1920)
    const fps = this.assertRange('fps', options.fps ?? 12, 1, MAX_GIF_FPS)

    const outputPath = this.resolveOutputPath(options, 'gif', 'gif')
    const replaces = this.prepareOutput(outputPath, options.overwrite)

    // 单趟调色板：一路生成调色板，另一路用调色板量化，省掉两趟写临时文件
    const filter =
      `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];` +
      `[s0]palettegen[p];[s1][p]paletteuse`

    const args = [
      '-ss', msToSeconds(startMs),
      '-t', msToSeconds(durationMs),
      '-i', absInput,
      '-filter_complex', filter,
      '-loop', '0',
      '-y', outputPath,
    ]

    const elapsedMs = await this.runWithGate(args, {
      op: 'toGif',
      timeoutMs: this.resolveTimeout(options.timeoutMs),
      totalMs: durationMs,
      onProgress: options.onProgress,
    })

    return this.buildOutput(outputPath, elapsedMs, replaces)
  }

  // ─── 内部：参数校验 ───────────────────────────────────────

  /** 校验数值范围 */
  private assertRange(name: string, value: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`[MediaBridge] 参数 ${name} 必须是有限数值，收到：${String(value)}`)
    }
    if (value < min || value > max) {
      throw new Error(`[MediaBridge] 参数 ${name} 超出允许范围 ${min}~${max}，收到：${value}`)
    }
    return value
  }

  /** 校验尺寸 */
  private assertSize(size: MediaSize): MediaSize {
    return {
      width: this.assertRange('size.width', size?.width, 16, 8192),
      height: this.assertRange('size.height', size?.height, 16, 8192),
    }
  }

  // ─── 内部：路径校验 ───────────────────────────────────────

  /**
   * 校验输入路径：必须存在、是文件，且落在允许的读写根内。
   *
   * 用 realpath 而不是字面路径做前缀比对，否则工作区里一个指向 /etc 的软链接
   * 就能把校验绕过去。
   */
  private assertInputPath(inputPath: string): string {
    if (typeof inputPath !== 'string' || inputPath.trim() === '') {
      throw new Error('[MediaBridge] 输入路径不能为空')
    }
    if (!path.isAbsolute(inputPath)) {
      throw new Error(`[MediaBridge] 输入路径必须是绝对路径：${inputPath}`)
    }

    let realPath: string
    try {
      realPath = realpathSync(inputPath)
    } catch {
      throw new Error(`[MediaBridge] 输入文件不存在：${inputPath}`)
    }

    let stat: Stats
    try {
      stat = statSync(realPath)
    } catch {
      throw new Error(`[MediaBridge] 无法读取输入文件：${inputPath}`)
    }
    if (!stat.isFile()) {
      throw new Error(`[MediaBridge] 输入必须是文件：${inputPath}`)
    }

    this.assertWithinAllowedRoots(realPath, '输入')
    return realPath
  }

  /**
   * 校验目录并按需创建。
   *
   * 目录可能还不存在，此时无法 realpath 自身，改为对「最近的已存在祖先」做校验，
   * 通过后再逐级创建 —— 否则 `工作区/新建目录/out.mp4` 这类正常用法会被拒。
   */
  private prepareDir(dir: string): void {
    if (!path.isAbsolute(dir)) {
      throw new Error(`[MediaBridge] 目录必须是绝对路径：${dir}`)
    }
    let cursor = dir
    while (!existsSync(cursor)) {
      const parent = path.dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
    this.assertWithinAllowedRoots(realpathSync(cursor), '输出')
    mkdirSync(dir, { recursive: true })
  }

  /** 校验并准备产物路径，返回产物是否已存在（即本次将覆盖） */
  private prepareOutput(outputPath: string, overwrite?: boolean): boolean {
    this.prepareDir(path.dirname(outputPath))

    if (!existsSync(outputPath)) return false

    if (!overwrite) {
      throw new Error(`[MediaBridge] 产物已存在（如需覆盖请传 overwrite: true）：${outputPath}`)
    }
    // 已存在的产物自身也要校验，防止用软链接把写入引到区外
    this.assertWithinAllowedRoots(realpathSync(outputPath), '输出')
    return true
  }

  /** 判断一个绝对路径是否落在允许的读写根内 */
  private assertWithinAllowedRoots(absPath: string, kind: string): void {
    if (this.isUnderAllowedRoot(absPath)) return
    throw new Error(
      `[MediaBridge] ${kind}路径越界，仅允许工作区、插件数据目录或 ${TEMP_DIR_PREFIX}* 临时目录：${absPath}`,
    )
  }

  private isUnderAllowedRoot(absPath: string): boolean {
    const workspace = workspaceResolver()
    if (workspace && this.isInside(absPath, workspace)) return true
    if (this.scope.dataDir && this.isInside(absPath, this.scope.dataDir)) return true
    return this.isUnderAllowedTemp(absPath)
  }

  private isInside(absPath: string, root: string): boolean {
    let realRoot: string
    try {
      realRoot = realpathSync(root)
    } catch {
      return false
    }
    const rel = path.relative(realRoot, absPath)
    if (rel === '') return true
    return !rel.startsWith('..') && !path.isAbsolute(rel)
  }

  /** 系统临时目录下，仅放行名称以 aweeclaw- 开头的目录 */
  private isUnderAllowedTemp(absPath: string): boolean {
    let realTemp: string
    try {
      realTemp = realpathSync(tmpdir())
    } catch {
      return false
    }
    const rel = path.relative(realTemp, absPath)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false
    return rel.split(path.sep)[0].startsWith(TEMP_DIR_PREFIX)
  }

  // ─── 内部：产物路径 ───────────────────────────────────────

  /** 解析产物路径：显式 outputPath > outputDir + 自动文件名 > 默认产物目录 */
  private resolveOutputPath(options: MediaExecOptions, op: string, ext: string): string {
    if (options.outputPath) {
      if (!path.isAbsolute(options.outputPath)) {
        throw new Error(`[MediaBridge] outputPath 必须是绝对路径：${options.outputPath}`)
      }
      return options.outputPath
    }
    return path.join(this.resolveOutputDir(options, op), `${this.autoName(op)}.${ext}`)
  }

  /** 解析产物目录，校验通过后创建 */
  private resolveOutputDir(options: MediaExecOptions, op: string): string {
    if (options.outputDir) {
      this.prepareDir(options.outputDir)
      return options.outputDir
    }

    const workspace = workspaceResolver()
    const dir = workspace
      ? path.join(workspace, DEFAULT_OUTPUT_SUBDIR)
      : this.scope.dataDir
        ? path.join(this.scope.dataDir, 'media-out')
        : path.join(tmpdir(), `${TEMP_DIR_PREFIX}media-out`)
    this.prepareDir(dir)
    logger.system.debug(`[MediaBridge] ${op} 产物落到默认目录：${dir}`)
    return dir
  }

  /** 生成不重复的文件名主体 */
  private autoName(op: string): string {
    const now = new Date()
    const stamp =
      `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-` +
      `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
    const rand = Math.random().toString(36).slice(2, 6)
    return `${op}-${stamp}-${rand}`
  }

  /** 创建本次调用专用的临时目录（落在允许清单内，用完即删） */
  private createTempDir(tag: string): string {
    const dir = path.join(tmpdir(), `${TEMP_DIR_PREFIX}media-${tag}-${this.autoName(tag)}`)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /** 组装 MediaOutput，并探测产物的时长与大小 */
  private async buildOutput(
    outputPath: string,
    elapsedMs: number,
    replaces: boolean,
  ): Promise<MediaOutput> {
    this.assertProduced(outputPath)

    let durationMs = 0
    const sizeBytes = this.safeFileSize(outputPath) ?? 0
    if (path.extname(outputPath).toLowerCase() === '.pcm') {
      // 裸 PCM 没有容器头，按 24kHz/16bit/mono 换算时长
      durationMs = Math.round((sizeBytes / (24000 * 2)) * 1000)
    } else {
      try {
        const info = await probeVideo(outputPath)
        durationMs = info.duration != null ? Math.round(info.duration * 1000) : 0
      } catch {
        durationMs = 0
      }
    }

    logger.system.info(
      `[MediaBridge] plugin=${this.scope.pluginId} 产物=${outputPath} ` +
        `时长=${durationMs}ms 大小=${sizeBytes}B 耗时=${elapsedMs}ms${replaces ? '（已覆盖）' : ''}`,
    )

    return { outputPath, durationMs, sizeBytes, elapsedMs }
  }

  /** 产物必须存在且非空，否则清掉半成品并报错 */
  private assertProduced(outputPath: string): void {
    if (!existsSync(outputPath) || (this.safeFileSize(outputPath) ?? 0) <= 0) {
      try {
        unlinkSync(outputPath)
      } catch {
        /* 半成品清理失败不应覆盖原始错误 */
      }
      throw new Error(`[MediaBridge] 产物未生成或为空：${outputPath}`)
    }
  }

  private safeFileSize(filePath: string): number | null {
    try {
      return statSync(filePath).size
    } catch {
      return null
    }
  }

  // ─── 内部：执行 ───────────────────────────────────────────

  /** 校验 ffmpeg 是否可用 */
  private ensureFfmpeg(): string | null {
    if (!FFMPEG_PATH || !existsSync(FFMPEG_PATH)) return null
    return FFMPEG_PATH
  }

  private resolveTimeout(timeoutMs?: number): number {
    if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS
    return clamp(timeoutMs, 1000, MAX_TIMEOUT_MS)
  }

  /** 取并发槽位后执行（公开方法都走这里） */
  private async runWithGate(args: string[], options: RunFfmpegOptions): Promise<number> {
    await this.acquire()
    try {
      const startedAt = Date.now()
      await this.runFfmpeg(args, options)
      return Date.now() - startedAt
    } finally {
      this.release()
    }
  }

  /**
   * 执行一次 ffmpeg（不取槽位，供已持槽的内部流程复用）。
   *
   * 前置四个全局参数：hide_banner 去掉构建信息，loglevel warning 只留警告与错误，
   * nostats 关掉会被终端宽度截断的逐帧统计行，progress 把结构化进度写到 stderr。
   */
  private runFfmpeg(args: string[], options: RunFfmpegOptions): Promise<void> {
    const base = ['-hide_banner', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:2']
    return this.spawnFfmpeg([...base, ...args], options)
      .catch((error: unknown) => {
        // 失败的产物是残缺的：留着既占空间，又会让同名调用下次撞上「产物已存在」
        this.removePartialOutput(args)
        throw error
      })
      .then(() => undefined)
  }

  /**
   * 从 argv 里取出产物路径。
   *
   * 本模块构造的每条命令都以 `-y <产物路径>` 收尾（各 builder 统一如此），
   * 因此可以据此定位产物，不必让每个调用点再额外传一遍路径。
   */
  private outputPathFromArgs(args: string[]): string | null {
    const index = args.lastIndexOf('-y')
    if (index < 0 || index !== args.length - 2) return null
    const candidate = args[index + 1]
    return typeof candidate === 'string' && path.isAbsolute(candidate) ? candidate : null
  }

  /** 清掉失败留下的半成品 */
  private removePartialOutput(args: string[]): void {
    const outputPath = this.outputPathFromArgs(args)
    if (!outputPath || !existsSync(outputPath)) return
    try {
      unlinkSync(outputPath)
    } catch {
      /* 清理失败不应覆盖原始错误 */
    }
  }

  /**
   * spawn ffmpeg 并等待结束。
   *
   * 进度取 `-progress pipe:2` 的键值对输出，而不是从 stats 行里抠 `time=`：
   * stats 行受终端宽度影响会被截断，键值对稳定且带 `progress=end` 结束标记。
   * stderr 只保留尾部，避免长任务把内存撑爆。
   */
  private spawnFfmpeg(
    args: string[],
    options: RunFfmpegOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = this.ensureFfmpeg()
      if (!ffmpegPath) {
        reject(new Error('[MediaBridge] ffmpeg 二进制不可用，请确认 ffmpeg-static 已正确安装'))
        return
      }

      const child = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let stdout = ''
      let stderrTail = ''
      let settled = false
      // 被超时杀掉的进程退出码同样非 0，靠这个标记把「超时」与「ffmpeg 报错」分开
      let timedOut = false
      let killTimer: NodeJS.Timeout | null = null

      const cleanup = (): void => {
        clearTimeout(timeoutTimer)
        if (killTimer) clearTimeout(killTimer)
      }

      const timeoutTimer = setTimeout(() => {
        if (settled) return
        timedOut = true
        logger.system.warn(
          `[MediaBridge] plugin=${this.scope.pluginId} ${options.op} 超时（${options.timeoutMs}ms），终止 ffmpeg`,
        )
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS)
      }, options.timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = (stdout + chunk.toString('utf8')).slice(-STDERR_TAIL_CHARS)
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        stderrTail = (stderrTail + text).slice(-STDERR_TAIL_CHARS)

        if (options.onProgress && options.totalMs) {
          const processedMs = this.parseProgressMs(text)
          if (processedMs !== null) {
            const totalMs = options.totalMs
            options.onProgress({
              progress: Math.min(1, Math.max(0, processedMs / totalMs)),
              processedMs: Math.min(processedMs, totalMs),
              totalMs,
            })
          }
        }
      })

      child.on('error', (err) => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(`[MediaBridge] 无法启动 ffmpeg：${err.message}`))
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        cleanup()

        if (timedOut) {
          reject(
            new Error(`[MediaBridge] ${options.op} 超时（${options.timeoutMs}ms），进程已被终止`),
          )
          return
        }
        if (code === 0) {
          resolve({ stdout, stderr: stderrTail })
          return
        }
        const tail = stderrTail.trim() || '无错误输出'
        reject(new Error(`[MediaBridge] ${options.op} 失败（退出码 ${code}）：${tail}`))
      })
    })
  }


  /** 从 -progress 输出里解析已处理时长（毫秒）；没有新进度返回 null */
  private parseProgressMs(chunk: string): number | null {
    // ffmpeg 同时输出 out_time_us 与 out_time_ms（历史遗留，两者都是微秒）
    const match = chunk.match(/out_time_(?:us|ms)=(\d+)/)
    if (!match) return null
    const micros = Number.parseInt(match[1], 10)
    if (!Number.isFinite(micros) || micros < 0) return null
    return Math.round(micros / 1000)
  }

  /** 获取并发槽位 */
  private async acquire(): Promise<void> {
    if (MediaBridgeService.activeRuns < MAX_CONCURRENCY) {
      MediaBridgeService.activeRuns++
      return
    }
    await new Promise<void>((resolve) => MediaBridgeService.waiters.push(resolve))
    MediaBridgeService.activeRuns++
  }

  /** 释放并发槽位并唤醒下一个等待者 */
  private release(): void {
    MediaBridgeService.activeRuns = Math.max(0, MediaBridgeService.activeRuns - 1)
    const next = MediaBridgeService.waiters.shift()
    if (next) next()
  }

  /** 清理临时目录 */
  private cleanupTempDir(dir: string): void {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      logger.system.warn(`[MediaBridge] 清理临时目录失败 ${dir}：${error}`)
    }
  }
}

// ─── 单例与工厂 ────────────────────────────────────────────

/**
 * 工作区解析器。
 *
 * 存的是「解析函数」而不是路径快照：工作区随窗口会话变化，而 MediaBridge 实例
 * 是长生命周期的，快照会让插件切了工作区之后仍往旧目录写。
 */
let workspaceResolver: () => string | null = () => null

/** 注册工作区解析器（hostServices 初始化时调用一次） */
export function setMediaWorkspaceResolver(resolver: () => string | null): void {
  workspaceResolver = resolver
}

/** 全局单例：供 globalThis.__AWEECLAW_HOST__.media 使用（不做插件级路径收窄） */
export const mediaBridge = new MediaBridgeService({ pluginId: 'host' })

/** 按插件作用域缓存实例，避免每次取 ctx.host.media 都新建对象 */
const scopedBridges = new Map<string, MediaBridgeService>()

/**
 * 创建（或复用）绑定到某个插件的作用域实例。
 *
 * 与全局单例的差别只有路径允许根：作用域实例额外放行该插件的 dataDir，且日志里
 * 带上 pluginId。并发槽位仍全局共享。
 */
export function createMediaBridge(scope: MediaBridgeScope): MediaBridgeService {
  const key = `${scope.pluginId}\u0000${scope.dataDir ?? ''}`
  const cached = scopedBridges.get(key)
  if (cached) return cached

  const bridge = new MediaBridgeService(scope)
  scopedBridges.set(key, bridge)
  return bridge
}
