/**
 * AudioAssembler — 音频拼接器
 *
 * 职责：
 * 1. 拼接多个音频文件为一个
 * 2. 插入章节间隔静音
 * 3. 添加元数据（标题、作者等）
 * 4. 输出最终音频文件
 *
 * 实现方案：
 * - 使用 ffmpeg-static 进行音频拼接
 * - 支持 WAV 和 MP3 格式
 * - 支持章节标记（如果格式支持）
 *
 * @module audiobook/AudioAssembler
 */

import { spawn } from 'node:child_process'
import * as fs from 'fs'
import * as path from 'path'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { logger } from '@shared/toolkit/LogEngine'
import type { Chapter, TextSegment, AudiobookConfig } from './AudiobookStore'

// ============================================
// 常量
// ============================================

/** ffmpeg 二进制路径 */
const FFMPEG_PATH = ffmpegStatic

/** 默认静音时长（毫秒） */
const DEFAULT_SILENCE_MS = 800

// ============================================
// 类型定义
// ============================================

/** 拼接选项 */
export interface AssembleOptions {
  /** 任务 ID */
  taskId: string
  /** 段落列表 */
  segments: TextSegment[]
  /** 章节列表 */
  chapters: Chapter[]
  /** 任务配置 */
  config: AudiobookConfig
  /** 输出路径 */
  outputPath: string
  /** 进度回调 */
  onProgress?: (progress: { phase: string; percent: number }) => void
}

/** 拼接结果 */
export interface AssembleResult {
  /** 输出文件路径 */
  outputPath: string
  /** 文件大小（字节） */
  fileSize: number
  /** 时长（秒） */
  duration: number
}

// ============================================
// AudioAssembler 类
// ============================================

export class AudioAssembler {
  /**
   * 拼接音频
   *
   * @param options 拼接选项
   * @returns 拼接结果
   */
  async assemble(options: AssembleOptions): Promise<AssembleResult> {
    const { taskId, segments, chapters, config, outputPath, onProgress } = options

    // 确保 ffmpeg 可用
    this.ensureFfmpeg()

    logger.system.info(`[AudioAssembler] 开始拼接音频: ${segments.length} 个段落`)

    // 创建临时目录
    const tmpDir = join(outputPath, '..', `tmp_${taskId}`)
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true })
    }

    try {
      // 阶段 1: 生成静音文件
      onProgress?.({ phase: 'generating_silence', percent: 0 })
      const silencePath = await this.generateSilence(tmpDir, config.chapterSilenceMs || DEFAULT_SILENCE_MS)
      onProgress?.({ phase: 'generating_silence', percent: 100 })

      // 阶段 2: 创建文件列表
      onProgress?.({ phase: 'creating_filelist', percent: 0 })
      const fileListPath = await this.createFileList(tmpDir, segments, chapters, silencePath, config)
      onProgress?.({ phase: 'creating_filelist', percent: 100 })

      // 阶段 3: 拼接音频
      onProgress?.({ phase: 'concatenating', percent: 0 })
      await this.concatenateAudio(fileListPath, outputPath, config)
      onProgress?.({ phase: 'concatenating', percent: 100 })

      // 获取文件信息
      const stats = fs.statSync(outputPath)
      const duration = await this.getAudioDuration(outputPath)

      logger.system.info(`[AudioAssembler] 音频拼接完成: ${outputPath}`)

      return {
        outputPath,
        fileSize: stats.size,
        duration,
      }
    } finally {
      // 清理临时文件
      this.cleanup(tmpDir)
    }
  }

  /**
   * 生成静音文件
   */
  private async generateSilence(tmpDir: string, durationMs: number): Promise<string> {
    const silencePath = join(tmpDir, 'silence.wav')
    const durationSec = durationMs / 1000

    return new Promise((resolve, reject) => {
      const args = [
        '-y',                    // 覆盖输出文件
        '-f', 'lavfi',           // 使用 lavfi 输入格式
        '-i', `anullsrc=r=24000:cl=mono`,  // 生成静音
        '-t', durationSec.toString(),  // 时长
        '-acodec', 'pcm_s16le',  // 编码格式
        '-ar', '24000',          // 采样率
        '-ac', '1',              // 单声道
        silencePath,
      ]

      const proc = spawn(FFMPEG_PATH!, args, { stdio: ['pipe', 'pipe', 'pipe'] })

      let stderrOutput = ''

      proc.stderr?.on('data', (data: Buffer) => {
        stderrOutput += data.toString()
      })

      proc.on('error', (error) => {
        reject(new Error(`ffmpeg 启动失败: ${error.message}`))
      })

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(silencePath)
        } else {
          reject(new Error(`ffmpeg 生成静音失败 (退出码 ${code}): ${stderrOutput.slice(-500)}`))
        }
      })
    })
  }

  /**
   * 创建文件列表
   */
  private async createFileList(
    tmpDir: string,
    segments: TextSegment[],
    chapters: Chapter[],
    silencePath: string,
    config: AudiobookConfig,
  ): Promise<string> {
    const fileListPath = join(tmpDir, 'filelist.txt')
    const lines: string[] = []

    // 按章节组织段落
    const segmentsByChapter = new Map<number, TextSegment[]>()
    for (const segment of segments) {
      if (segment.status !== 'completed' || !segment.audioPath) {
        continue
      }

      const chapterSegments = segmentsByChapter.get(segment.chapterIndex) || []
      chapterSegments.push(segment)
      segmentsByChapter.set(segment.chapterIndex, chapterSegments)
    }

    // 按章节顺序拼接
    for (const chapter of chapters) {
      const chapterSegments = segmentsByChapter.get(chapter.index) || []
      if (chapterSegments.length === 0) {
        continue
      }

      // 添加章节段落
      for (const segment of chapterSegments) {
        lines.push(`file '${segment.audioPath}'`)
      }

      // 添加章节间隔静音（最后一个章节不添加）
      if (chapter.index < chapters.length - 1) {
        lines.push(`file '${silencePath}'`)
      }
    }

    writeFileSync(fileListPath, lines.join('\n'), 'utf-8')
    return fileListPath
  }

  /**
   * 拼接音频
   */
  private async concatenateAudio(
    fileListPath: string,
    outputPath: string,
    config: AudiobookConfig,
  ): Promise<void> {
    // 确保输出目录存在
    const outputDir = path.dirname(outputPath)
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-y',                    // 覆盖输出文件
        '-f', 'concat',          // 使用 concat 格式
        '-safe', '0',            // 允许绝对路径
        '-i', fileListPath,      // 输入文件列表
        '-acodec', config.format === 'mp3' ? 'libmp3lame' : 'pcm_s16le',  // 编码格式
        '-ar', '24000',          // 采样率
        '-ac', '1',              // 单声道
        outputPath,
      ]

      const proc = spawn(FFMPEG_PATH!, args, { stdio: ['pipe', 'pipe', 'pipe'] })

      let stderrOutput = ''

      proc.stderr?.on('data', (data: Buffer) => {
        stderrOutput += data.toString()
      })

      proc.on('error', (error) => {
        reject(new Error(`ffmpeg 启动失败: ${error.message}`))
      })

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`ffmpeg 拼接音频失败 (退出码 ${code}): ${stderrOutput.slice(-500)}`))
        }
      })
    })
  }

  /**
   * 获取音频时长
   */
  private async getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', filePath,
        '-show_entries', 'format=duration',
        '-v', 'quiet',
        '-of', 'csv=p=0',
      ]

      const proc = spawn(FFMPEG_PATH!, args, { stdio: ['pipe', 'pipe', 'pipe'] })

      let stdoutOutput = ''

      proc.stdout?.on('data', (data: Buffer) => {
        stdoutOutput += data.toString()
      })

      proc.on('error', (error) => {
        reject(new Error(`ffprobe 启动失败: ${error.message}`))
      })

      proc.on('exit', (code) => {
        if (code === 0) {
          const duration = parseFloat(stdoutOutput.trim())
          resolve(isNaN(duration) ? 0 : duration)
        } else {
          resolve(0)
        }
      })
    })
  }

  /**
   * 确保 ffmpeg 可用
   */
  private ensureFfmpeg(): void {
    if (!FFMPEG_PATH || !existsSync(FFMPEG_PATH)) {
      throw new Error('ffmpeg 不可用，请确保 ffmpeg-static 已安装')
    }
  }

  /**
   * 清理临时文件
   */
  private cleanup(tmpDir: string): void {
    try {
      if (existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true })
        logger.system.debug(`[AudioAssembler] 已清理临时目录: ${tmpDir}`)
      }
    } catch (error) {
      logger.system.warn(`[AudioAssembler] 清理临时目录失败: ${error}`)
    }
  }
}